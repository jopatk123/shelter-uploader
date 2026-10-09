/**
 * 管理员接口（需 Admin Token 鉴权）
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { db, STORAGE_DIR } from '../db.js';
import {
  authMiddleware,
  adminOrTicketMiddleware,
  generateToken,
  verifyPassword,
  matchesApiToken,
  generateDownloadTicket,
} from '../middleware/auth.js';
import { beijingTimestamp } from '../utils/time.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { parsePositiveIntParam } from './points.js';
import {
  queryPointAgg,
  toPointStatusRows,
  buildStatsCsv,
  statsCsvFileName,
  sendCsv,
  type PointFilter,
} from '../utils/pointsStats.js';

const router = Router();

/**
 * 登录限流：同一 IP 15 分钟内最多 20 次尝试
 * 防止对外部署时管理员密码被暴力破解（ADMIN_PASSWORD 为单一静态口令，无验证码与锁定机制）
 */
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: '登录尝试过于频繁，请 15 分钟后再试',
});

/**
 * 素材类型（v2 起不分主/备，每点位不限数量）
 */
const MATERIAL_TYPES = ['img', 'video'] as const;
type MaterialType = (typeof MATERIAL_TYPES)[number];

/**
 * 批量下载的打包范围：单类型，或把图片与视频装进同一个 zip
 * 注意与 MATERIAL_TYPES 区分——上传/删除等接口只认单一类型，这里多出的 'all' 仅服务打包
 */
const BATCH_TYPES = [...MATERIAL_TYPES, 'all'] as const;
type BatchType = (typeof BATCH_TYPES)[number];

/** 打包范围 → zip 文件名前缀 */
const ZIP_PREFIX: Record<BatchType, string> = {
  img: 'images',
  video: 'videos',
  all: 'materials',
};

function isBatchType(type: string): type is BatchType {
  return (BATCH_TYPES as readonly string[]).includes(type);
}

/**
 * POST /api/admin/login
 * 校验管理密码或 API_TOKEN，返回 24 小时会话 Token
 */
router.post('/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (!password) {
    res.status(400).json({ success: false, error: '请输入密码' });
    return;
  }

  // 管理密码与 API_TOKEN 都可换取 24 小时会话，供管理后台页面使用
  if (!verifyPassword(password) && !matchesApiToken(password)) {
    // 记录失败来源 IP（不记录密码或 Token），便于部署后审计暴力破解尝试
    console.warn(`[admin/login] 密码错误，来源 IP: ${req.ip ?? 'unknown'}`);
    res.status(401).json({ success: false, error: '密码错误' });
    return;
  }

  const token = generateToken();
  res.json({ success: true, data: { token } });
});

/**
 * 解析 ids 查询参数（逗号分隔的正整数字符串）
 * 返回去重排序后的 ID 数组；参数缺失返回 null（表示不限制）；
 * 任何非法字符返回抛出 Error（由调用方转为 400）
 */
function parseIdsParam(raw: unknown): number[] | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  const ids: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`ids 包含非法值: ${p}`);
    }
    ids.push(n);
  }
  // 去重 + 排序，便于日志和缓存友好
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

/**
 * GET /api/admin/stats-csv?ticket=xxx[&ids=1,2,3]
 * 下载点位统计表格（CSV 格式，UTF-8 BOM 头确保 Excel 正确显示中文）
 *   - 不传 ids：导出全部点位
 *   - 传 ids：仅导出指定点位
 *
 * 鉴权方式：Authorization Bearer（JWT 或 API_TOKEN），或一次性下载票据（60秒有效，仅可用一次）
 *
 * 表格列：序号、名称、区县、乡镇、船管站、经度、纬度、
 *         图片数、视频数、已上传素材数、完成状态、最后上传时间
 */
router.get('/stats-csv', adminOrTicketMiddleware, (req, res) => {
  // 解析可选 ids 参数；非法值返回 400
  let ids: number[] | null = null;
  try {
    ids = parseIdsParam(req.query.ids);
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
    return;
  }

  // 查询：默认全部，传 ids 时仅查询指定点位
  const rows = queryPointAgg({ ids });

  if (rows.length === 0) {
    res.status(404).json({ success: false, error: '没有可导出的点位' });
    return;
  }

  const scopeLabel = ids ? `指定 ${ids.length} 个点位` : '全部点位';
  console.log(`[stats-csv] 导出完成 (${scopeLabel}): ${rows.length} 行`);

  sendCsv(res, buildStatsCsv(rows), statsCsvFileName());
});

/**
 * GET /api/admin/batch-download?type=img|video|all&ticket=xxx[&ids=1,2,3]
 * 批量下载点位素材（zip 流式打包）
 *   - type=img / video：只打包该类型
 *   - type=all：图片与视频混装进同一个 zip（这也是与上传/删除接口的区别所在）
 *   - 不传 ids：下载所有已上传素材的点位
 *   - 传 ids：仅下载指定点位中已上传素材的部分（未上传的点位自动跳过）
 *
 * v2 起每点位不限素材数量，zip 内按点位分文件夹，同点位内按类型分别编号：
 *   point_{id}_{点位名称}/{img|video}_{序号}.{ext}
 * 序号按 (点位, 类型) 各自从 1 开始，所以 type=all 时同一个文件夹里
 * img_1.jpg 与 video_1.mp4 并存，与分类型下载得到的命名完全一致。
 *
 * 鉴权方式：Authorization Bearer（JWT 或 API_TOKEN），或一次性下载票据（60秒有效，仅可用一次）
 * 票据通过 POST /api/admin/download-ticket（需管理凭证）获取
 *
 * 容错策略：
 *   - 磁盘上不存在的文件自动跳过，记录警告
 *   - 单个文件添加失败不影响其他文件
 *   - 客户端断开自动中止打包，释放资源
 *   - 全部文件不存在时返回 404
 */
router.get('/batch-download', adminOrTicketMiddleware, (req, res) => {
  const type = req.query.type as string;
  if (!isBatchType(type)) {
    res.status(400).json({ success: false, error: 'type 参数无效，仅支持 img / video / all' });
    return;
  }

  // 解析可选 ids 参数；非法值返回 400
  let ids: number[] | null = null;
  try {
    ids = parseIdsParam(req.query.ids);
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
    return;
  }

  // 逐条件拼装 WHERE，全部走占位符绑定，避免 SQL 注入
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (type !== 'all') {
    conditions.push('m.material_type = ?');
    params.push(type);
  }
  if (ids) {
    conditions.push(`p.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // v2 起每点位不限素材数量：按素材行查询，打包时按点位分文件夹，同点位内按序号编号
  // 一并取出 m.material_type，使条目命名不依赖请求参数（type=all 时一个请求里两种类型混排）
  const rows = db
    .prepare(
      `
    SELECT p.id, p.name, m.id AS material_id, m.material_type, m.file_path
    FROM point_info p
    INNER JOIN material m ON p.id = m.point_id
    ${where}
    ORDER BY p.id, m.material_type, m.id
  `,
    )
    .all(...params) as Array<{
    id: number;
    name: string;
    material_id: number;
    material_type: MaterialType;
    file_path: string;
  }>;

  if (rows.length === 0) {
    res.status(404).json({ success: false, error: '没有可下载的素材' });
    return;
  }

  // 生成 zip 文件名（北京时间）
  const ts = beijingTimestamp();
  const zipName = `${ZIP_PREFIX[type]}_${ts}.zip`;

  // 设置响应头
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
  // 告知浏览器保持连接，支持大文件长时间传输
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 所有素材已是压缩格式（JPEG/PNG/WebP/MP4），统一用 store 模式避免重复压缩
  const archive = archiver('zip', { store: true });

  // ── 背压控制：客户端断开时中止打包 ──
  let clientDisconnected = false;
  const onClientClose = () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      archive.abort();
      console.log(`[batch-download] 客户端断开，已终止 ${type} 打包`);
    }
  };
  req.on('close', onClientClose);

  // ── 超时控制：30 分钟无响应则终止（防止僵尸连接） ──
  req.setTimeout(30 * 60 * 1000, () => {
    console.warn(`[batch-download] ${type} 打包超时，强制终止`);
    if (!res.writableEnded) {
      clientDisconnected = true;
      archive.abort();
      res.end();
    }
  });

  // ── archiver 错误处理 ──
  archive.on('error', (err: Error) => {
    if (clientDisconnected) return;
    console.error('[batch-download] archiver 致命错误:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: '打包失败' });
    } else {
      // 响应头已发出无法改状态码；销毁连接让客户端明确感知失败，避免连接挂到超时
      res.destroy();
    }
  });

  // ── 完成日志 ──
  archive.on('finish', () => {
    console.log(`[batch-download] ${type} 打包完成`);
  });

  // 流式 pipe 到响应
  archive.pipe(res);

  // ── 逐个添加文件，逐文件容错 ──
  let addedCount = 0;
  let skippedCount = 0;
  // 素材序号按「点位 + 类型」计数（按 id 升序），使 type=all 与分类型下载的编号保持一致
  const seqCounter = new Map<string, number>();

  for (const row of rows) {
    if (clientDisconnected) break;

    const fullPath = path.join(STORAGE_DIR, row.file_path);

    // 磁盘文件不存在 → 跳过并记录警告
    if (!fs.existsSync(fullPath)) {
      console.warn(`[batch-download] 跳过缺失文件: ${row.file_path}`);
      skippedCount++;
      continue;
    }

    // 安全文件夹名（点位名称可能含中文标点，仅替换文件系统非法字符）
    const safeName = row.name.replace(/[/\\:*?"<>|]/g, '_');
    const seqKey = `${row.id}:${row.material_type}`;
    const seq = (seqCounter.get(seqKey) ?? 0) + 1;
    seqCounter.set(seqKey, seq);

    const ext = path.extname(row.file_path);
    const entryName = `point_${row.id}_${safeName}/${row.material_type}_${seq}${ext}`;

    try {
      archive.file(fullPath, { name: entryName });
      addedCount++;
    } catch (err) {
      // 单文件添加失败不影响整体
      console.error(`[batch-download] 添加失败 ${entryName}:`, (err as Error).message);
      skippedCount++;
    }
  }

  // 打印统计摘要
  const scopeLabel = ids ? `指定 ${ids.length} 个点位` : '全部点位';
  console.log(
    `[batch-download] ${type} 统计 (${scopeLabel}): 成功 ${addedCount} 个, 跳过 ${skippedCount} 个 (共 ${rows.length} 条记录)`,
  );

  // ── 如果所有文件都无效 ──
  if (addedCount === 0) {
    // 清理监听器
    req.off('close', onClientClose);
    archive.abort();
    if (!res.headersSent) {
      // 清除之前设置的 zip 相关响应头，避免浏览器尝试下载 JSON
      res.removeHeader('Content-Type');
      res.removeHeader('Content-Disposition');
      res.removeHeader('X-Content-Type-Options');
      res.status(404).json({ success: false, error: '文件均不存在，无法下载' });
    }
    return;
  }

  // ── 完成打包，开始传输 ──
  archive.finalize();
});

// 以下接口均需鉴权
router.use(authMiddleware);

/**
 * POST /api/admin/download-ticket
 * 获取一次性下载票据（60秒有效，仅可用一次）
 * 用于浏览器原生下载场景，替代 URL 中直接传递 JWT token
 */
router.post('/download-ticket', (_req, res) => {
  const ticket = generateDownloadTicket();
  res.json({ success: true, data: { ticket } });
});

/**
 * GET /api/admin/points
 * 点位总览（含素材数量、上传时间），支持按素材构成筛选
 * query: filter=all|img_only|video_only|completed
 *   - img_only:   仅有图片（无视频）
 *   - video_only: 仅有视频（无图片）
 *   - completed:  图片和视频都已上传
 */
router.get('/points', (req, res) => {
  const filter = ((req.query.filter as string) || 'all') as PointFilter;

  const points = toPointStatusRows(queryPointAgg({ filter }));

  res.json({ success: true, data: points });
});

/**
 * GET /api/admin/point/:id
 * 点位详情（含该点位全部素材列表）
 */
router.get('/point/:id', (req, res) => {
  const pointId = parsePositiveIntParam(req.params.id);
  if (pointId === null) {
    res.status(400).json({ success: false, error: '点位ID无效' });
    return;
  }

  const row = db
    .prepare(
      `
    SELECT p.id, p.name, p.district, p.township, p.station, p.lon, p.lat
    FROM point_info p
    WHERE p.id = ?
  `,
    )
    .get(pointId) as
    | {
        id: number;
        name: string;
        district: string;
        township: string;
        station: string;
        lon: number;
        lat: number;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ success: false, error: '点位不存在' });
    return;
  }

  const materials = db
    .prepare(
      `
    SELECT id, material_type, file_path, file_size, upload_time
    FROM material
    WHERE point_id = ?
    ORDER BY id DESC
  `,
    )
    .all(pointId) as Array<{
    id: number;
    material_type: string;
    file_path: string;
    file_size: number;
    upload_time: string | null;
  }>;

  const imgCount = materials.filter((m) => m.material_type === 'img').length;
  const videoCount = materials.length - imgCount;
  // 最新上传时间（素材按 id DESC 排列，首个非空值即最新）
  const uploadTime = materials.find((m) => m.upload_time)?.upload_time ?? null;

  res.json({
    success: true,
    data: {
      ...row,
      img_count: imgCount,
      video_count: videoCount,
      uploaded_count: materials.length,
      upload_time: uploadTime,
      materials: materials.map((m) => ({
        id: m.id,
        type: m.material_type,
        path: m.file_path,
        size: m.file_size,
        upload_time: m.upload_time,
      })),
    },
  });
});

/**
 * GET /api/admin/download/:id
 * 下载单个素材（流式传输），:id 为素材行 id
 */
router.get('/download/:id', (req, res) => {
  const materialId = parsePositiveIntParam(req.params.id);
  if (materialId === null) {
    res.status(400).json({ success: false, error: '素材ID无效' });
    return;
  }

  const row = db.prepare(`SELECT file_path FROM material WHERE id = ?`).get(materialId) as
    { file_path: string } | undefined;

  if (!row) {
    res.status(404).json({ success: false, error: '素材不存在' });
    return;
  }

  const fullPath = path.join(STORAGE_DIR, row.file_path);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ success: false, error: '文件不存在' });
    return;
  }

  const fileName = path.basename(fullPath);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', fs.statSync(fullPath).size);

  const stream = fs.createReadStream(fullPath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: '文件读取失败' });
    }
  });
  // 客户端断开时销毁 stream，避免资源泄漏
  res.on('close', () => {
    stream.destroy();
  });
  stream.pipe(res);
});

/**
 * DELETE /api/admin/material/:id
 * 删除素材（:id 为素材行 id），同步删除数据库记录与磁盘文件
 */
router.delete('/material/:id', (req, res) => {
  const materialId = parsePositiveIntParam(req.params.id);
  if (materialId === null) {
    res.status(400).json({ success: false, error: '素材ID无效' });
    return;
  }

  const row = db.prepare(`SELECT file_path FROM material WHERE id = ?`).get(materialId) as
    { file_path: string } | undefined;

  if (!row) {
    res.status(404).json({ success: false, error: '素材不存在' });
    return;
  }

  const fullPath = path.join(STORAGE_DIR, row.file_path);

  // 先删数据库记录（先DB后文件，最坏留孤儿文件，由定时清理兜底）
  db.prepare(`DELETE FROM material WHERE id = ?`).run(materialId);

  // DB 提交后删除文件（失败则留孤儿文件，由定时清理兜底）
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch (err) {
      console.warn(`[admin/material] 删除文件失败 ${fullPath}:`, (err as Error).message);
    }
  }

  res.json({ success: true, message: '素材已删除' });
});

export default router;
