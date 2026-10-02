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
  ticketMiddleware,
  generateToken,
  verifyPassword,
  generateDownloadTicket,
} from '../middleware/auth.js';
import { formatBeijingTime, beijingTimestamp } from '../utils/time.js';

const router = Router();

/**
 * 素材类型 → 数据库列名 映射
 * img / img_alt / video / video_alt
 */
const TYPE_COLUMN: Record<string, string> = {
  img: 'img_path',
  img_alt: 'img_path_alt',
  video: 'video_path',
  video_alt: 'video_path_alt',
};

/**
 * 校验 type 合法性，返回列名；非法返回 null
 */
function validateType(type: string): string | null {
  return TYPE_COLUMN[type] ?? null;
}

/**
 * POST /api/admin/login
 * 密码校验，返回 Token
 */
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    res.status(400).json({ success: false, error: '请输入密码' });
    return;
  }

  if (!verifyPassword(password)) {
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
 * CSV 表格列定义：每个条目对应一列
 * - key: 行对象字段名
 * - header: CSV 表头文字
 */
interface StatsCsvColumn {
  key: string;
  header: string;
}

const STATS_CSV_COLUMNS: StatsCsvColumn[] = [
  { key: 'id', header: '序号' },
  { key: 'name', header: '名称' },
  { key: 'district', header: '区县' },
  { key: 'township', header: '乡镇' },
  { key: 'station', header: '船管站' },
  { key: 'lon', header: '经度' },
  { key: 'lat', header: '纬度' },
  { key: 'has_image', header: '主图片' },
  { key: 'has_image_alt', header: '备选图片' },
  { key: 'has_video', header: '主视频' },
  { key: 'has_video_alt', header: '备选视频' },
  { key: 'uploaded_count', header: '已上传素材数' },
  { key: 'status', header: '完成状态' },
  { key: 'upload_time', header: '最后上传时间' },
];

/**
 * 将字段值统一格式化为 CSV 单元格安全字符串
 * - 字符串中的双引号转义为两个双引号
 * - 含逗号、双引号、换行符的字段用双引号包裹
 * - null/undefined 转为空字符串
 */
function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'boolean' ? (value ? '是' : '否') : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * 依据主图/主视频上传情况判定完成状态文案（与前端 getPointState 语义一致）
 */
function describePointStatus(hasImage: boolean, hasVideo: boolean): string {
  if (hasImage || hasVideo) return '已完成';
  return '未上传';
}

/**
 * GET /api/admin/stats-csv?ticket=xxx[&ids=1,2,3]
 * 下载点位统计表格（CSV 格式，UTF-8 BOM 头确保 Excel 正确显示中文）
 *   - 不传 ids：导出全部点位
 *   - 传 ids：仅导出指定点位
 *
 * 鉴权方式：一次性下载票据（60秒有效，仅可用一次）
 *
 * 表格列：序号、名称、区县、乡镇、船管站、经度、纬度、
 *         主图片、备选图片、主视频、备选视频、
 *         已上传素材数、完成状态、最后上传时间
 */
router.get('/stats-csv', ticketMiddleware, (req, res) => {
  // 解析可选 ids 参数；非法值返回 400
  let ids: number[] | null = null;
  try {
    ids = parseIdsParam(req.query.ids);
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
    return;
  }

  // 构造查询：默认全部，传 ids 时仅查询指定点位
  const placeholders = ids ? ids.map(() => '?').join(',') : null;
  const idFilter = placeholders ? `WHERE p.id IN (${placeholders})` : '';
  const params: unknown[] = ids ?? [];

  const rows = db
    .prepare(
      `
    SELECT
      p.id, p.name, p.district, p.township, p.station, p.lon, p.lat,
      m.img_path, m.img_path_alt, m.video_path, m.video_path_alt, m.upload_time
    FROM point_info p
    LEFT JOIN point_material m ON p.id = m.point_id
    ${idFilter}
    ORDER BY p.id
  `,
    )
    .all(...params) as Array<{
    id: number;
    name: string;
    district: string;
    township: string;
    station: string;
    lon: number;
    lat: number;
    img_path: string | null;
    img_path_alt: string | null;
    video_path: string | null;
    video_path_alt: string | null;
    upload_time: string | null;
  }>;

  if (rows.length === 0) {
    res.status(404).json({ success: false, error: '没有可导出的点位' });
    return;
  }

  // 计算字段并组装行
  const dataRows = rows.map((r) => {
    const hasImage = !!r.img_path;
    const hasImageAlt = !!r.img_path_alt;
    const hasVideo = !!r.video_path;
    const hasVideoAlt = !!r.video_path_alt;
    const uploadedCount = [hasImage, hasImageAlt, hasVideo, hasVideoAlt].filter(Boolean).length;
    return {
      id: r.id,
      name: r.name,
      district: r.district,
      township: r.township,
      station: r.station,
      lon: r.lon,
      lat: r.lat,
      has_image: hasImage,
      has_image_alt: hasImageAlt,
      has_video: hasVideo,
      has_video_alt: hasVideoAlt,
      uploaded_count: uploadedCount,
      status: describePointStatus(hasImage, hasVideo),
      upload_time: formatBeijingTime(r.upload_time),
    };
  });

  // 生成 CSV 文本
  const headerLine = STATS_CSV_COLUMNS.map((c) => escapeCsvCell(c.header)).join(',');
  const bodyLines = dataRows.map((row) =>
    STATS_CSV_COLUMNS.map((col) => escapeCsvCell(row[col.key as keyof typeof row])).join(','),
  );
  // 加 UTF-8 BOM 头，确保 Excel 打开时正确识别中文
  const csvContent = '\uFEFF' + headerLine + '\n' + bodyLines.join('\n') + '\n';

  // 生成文件名：stats_YYYYMMDD_HHmmss.csv（北京时间）
  const ts = beijingTimestamp();
  const fileName = `stats_${ts}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const scopeLabel = ids ? `指定 ${ids.length} 个点位` : '全部点位';
  console.log(`[stats-csv] 导出完成 (${scopeLabel}): ${dataRows.length} 行`);

  res.send(csvContent);
});

/**
 * GET /api/admin/batch-download?type=img|img_alt|video|video_alt&ticket=xxx[&ids=1,2,3]
 * 批量下载点位素材（zip 流式打包）
 *   - 不传 ids：下载所有已上传该类型素材的点位
 *   - 传 ids：仅下载指定点位中已上传该类型素材的部分（未上传的点位自动跳过）
 *
 * 文件名规则：point_{id}_{点位名称}_{type}.{ext}
 *
 * 鉴权方式：一次性下载票据（60秒有效，仅可用一次）
 * 票据通过 POST /api/admin/download-ticket（需 JWT 鉴权）获取
 *
 * 容错策略：
 *   - 磁盘上不存在的文件自动跳过，记录警告
 *   - 单个文件添加失败不影响其他文件
 *   - 客户端断开自动中止打包，释放资源
 *   - 全部文件不存在时返回 404
 */
router.get('/batch-download', ticketMiddleware, (req, res) => {
  const type = req.query.type as string;
  const column = validateType(type);
  if (!column) {
    res
      .status(400)
      .json({ success: false, error: 'type 参数无效，仅支持 img / img_alt / video / video_alt' });
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

  // 构造查询：默认全部，传 ids 时仅查询指定点位
  // 使用动态占位符避免 SQL 注入
  const placeholders = ids ? ids.map(() => '?').join(',') : null;
  const idFilter = placeholders ? `AND p.id IN (${placeholders})` : '';
  const params: unknown[] = ids ?? [];

  const rows = db
    .prepare(
      `
    SELECT p.id, p.name, m.${column} AS rel_path
    FROM point_info p
    INNER JOIN point_material m ON p.id = m.point_id
    WHERE m.${column} IS NOT NULL ${idFilter}
    ORDER BY p.id
  `,
    )
    .all(...params) as Array<{ id: number; name: string; rel_path: string }>;

  if (rows.length === 0) {
    res.status(404).json({ success: false, error: '没有可下载的素材' });
    return;
  }

  // 生成 zip 文件名（北京时间）
  const ts = beijingTimestamp();
  const typeLabelMap: Record<string, string> = {
    img: 'images',
    img_alt: 'images_alt',
    video: 'videos',
    video_alt: 'videos_alt',
  };
  const zipName = `${typeLabelMap[type]}_${ts}.zip`;

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

  for (const row of rows) {
    if (clientDisconnected) break;

    const fullPath = path.join(STORAGE_DIR, row.rel_path);

    // 磁盘文件不存在 → 跳过并记录警告
    if (!fs.existsSync(fullPath)) {
      console.warn(`[batch-download] 跳过缺失文件: ${row.rel_path}`);
      skippedCount++;
      continue;
    }

    // 安全文件名（点位名称可能含中文标点，仅替换文件系统非法字符）
    const ext = path.extname(row.rel_path);
    const safeName = row.name.replace(/[/\\:*?"<>|]/g, '_');
    const entryName = `point_${row.id}_${safeName}_${type}${ext}`;

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
 * 点位总览（含素材状态、上传时间），支持按状态筛选
 * query: filter=all|img_only|video_only|completed
 */
router.get('/points', (req, res) => {
  const filter = (req.query.filter as string) || 'all';

  let whereClause = '';
  if (filter === 'img_only') {
    whereClause = 'WHERE m.img_path IS NOT NULL AND m.video_path IS NULL';
  } else if (filter === 'video_only') {
    whereClause = 'WHERE m.img_path IS NULL AND m.video_path IS NOT NULL';
  } else if (filter === 'completed') {
    whereClause = 'WHERE m.img_path IS NOT NULL OR m.video_path IS NOT NULL';
  }

  const rows = db
    .prepare(
      `
    SELECT
      p.id, p.name, p.district, p.township, p.station, p.lon, p.lat,
      m.img_path, m.img_path_alt, m.video_path, m.video_path_alt, m.upload_time
    FROM point_info p
    LEFT JOIN point_material m ON p.id = m.point_id
    ${whereClause}
    ORDER BY p.id
  `,
    )
    .all() as Array<{
    id: number;
    name: string;
    district: string;
    township: string;
    station: string;
    lon: number;
    lat: number;
    img_path: string | null;
    img_path_alt: string | null;
    video_path: string | null;
    video_path_alt: string | null;
    upload_time: string | null;
  }>;

  const points = rows.map((r) => ({
    id: r.id,
    name: r.name,
    district: r.district,
    township: r.township,
    station: r.station,
    lon: r.lon,
    lat: r.lat,
    has_image: !!r.img_path,
    has_image_alt: !!r.img_path_alt,
    has_video: !!r.video_path,
    has_video_alt: !!r.video_path_alt,
    img_path: r.img_path,
    img_path_alt: r.img_path_alt,
    video_path: r.video_path,
    video_path_alt: r.video_path_alt,
    upload_time: r.upload_time,
  }));

  res.json({ success: true, data: points });
});

/**
 * GET /api/admin/point/:id
 * 点位详情
 */
router.get('/point/:id', (req, res) => {
  const pointId = parseInt(req.params.id);
  if (isNaN(pointId)) {
    res.status(400).json({ success: false, error: '点位ID无效' });
    return;
  }

  const row = db
    .prepare(
      `
    SELECT
      p.id, p.name, p.district, p.township, p.station, p.lon, p.lat,
      m.img_path, m.img_path_alt, m.video_path, m.video_path_alt, m.upload_time
    FROM point_info p
    LEFT JOIN point_material m ON p.id = m.point_id
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
        img_path: string | null;
        img_path_alt: string | null;
        video_path: string | null;
        video_path_alt: string | null;
        upload_time: string | null;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ success: false, error: '点位不存在' });
    return;
  }

  res.json({
    success: true,
    data: {
      ...row,
      has_image: !!row.img_path,
      has_image_alt: !!row.img_path_alt,
      has_video: !!row.video_path,
      has_video_alt: !!row.video_path_alt,
    },
  });
});

/**
 * GET /api/admin/download/:id?type=img|img_alt|video|video_alt
 * 下载素材（流式传输）
 */
router.get('/download/:id', (req, res) => {
  const pointId = parseInt(req.params.id);
  const type = req.query.type as string;
  const column = validateType(type);

  if (isNaN(pointId) || !column) {
    res.status(400).json({ success: false, error: '参数无效' });
    return;
  }

  const row = db
    .prepare(`SELECT ${column} AS rel_path FROM point_material WHERE point_id = ?`)
    .get(pointId) as { rel_path: string | null } | undefined;

  if (!row) {
    res.status(404).json({ success: false, error: '点位不存在' });
    return;
  }

  if (!row.rel_path) {
    res.status(404).json({ success: false, error: '该类型素材未上传' });
    return;
  }

  const fullPath = path.join(STORAGE_DIR, row.rel_path);
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
 * DELETE /api/admin/material/:id?type=img|img_alt|video|video_alt
 * 删除素材
 */
router.delete('/material/:id', (req, res) => {
  const pointId = parseInt(req.params.id);
  const type = req.query.type as string;
  const column = validateType(type);

  if (isNaN(pointId) || !column) {
    res.status(400).json({ success: false, error: '参数无效' });
    return;
  }

  const row = db
    .prepare(`SELECT ${column} AS rel_path FROM point_material WHERE point_id = ?`)
    .get(pointId) as { rel_path: string | null } | undefined;

  if (!row) {
    res.status(404).json({ success: false, error: '点位不存在' });
    return;
  }

  if (!row.rel_path) {
    res.json({ success: true, message: '无素材需删除' });
    return;
  }

  const fullPath = path.join(STORAGE_DIR, row.rel_path);

  // 先更新数据库（与 /complete 策略一致：先DB后文件，最坏留孤儿文件而非DB指向已删文件）
  // 若该素材是该点位最后一个，同步清空 upload_time
  db.transaction(() => {
    db.prepare(`UPDATE point_material SET ${column} = NULL WHERE point_id = ?`).run(pointId);

    // 检查是否所有素材都已清空
    const remaining = db
      .prepare(
        `SELECT img_path, img_path_alt, video_path, video_path_alt FROM point_material WHERE point_id = ?`,
      )
      .get(pointId) as
      | {
          img_path: string | null;
          img_path_alt: string | null;
          video_path: string | null;
          video_path_alt: string | null;
        }
      | undefined;

    if (
      remaining &&
      !remaining.img_path &&
      !remaining.img_path_alt &&
      !remaining.video_path &&
      !remaining.video_path_alt
    ) {
      db.prepare(`UPDATE point_material SET upload_time = NULL WHERE point_id = ?`).run(pointId);
    }
  })();

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
