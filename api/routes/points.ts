/**
 * 公开点位接口（上传页免鉴权）
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { db, STORAGE_DIR } from '../db.js';
import {
  queryPointAgg,
  toPointStatusRows,
  buildStatsCsv,
  statsCsvFileName,
  sendCsv,
} from '../utils/pointsStats.js';

const router = Router();

/**
 * 严格解析正整数路由参数（与 upload.ts 的参数校验风格一致）
 * parseInt 会把 "12abc" 解析为 12，这里用全数字正则避免误匹配
 */
function parsePositiveIntParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

/**
 * 解析素材文件的真实磁盘路径，并做路径遍历防御
 * file_path 存储为 `point_{id}/{type}_{ts}{ext}`，正常不会越界；
 * 此处防御性校验 resolve 后必须仍位于 STORAGE_DIR 内
 * 返回 null 表示路径非法（攻击样本或脏数据）
 */
function resolveMaterialPath(relPath: string): string | null {
  const fullPath = path.resolve(STORAGE_DIR, relPath);
  if (!fullPath.startsWith(STORAGE_DIR + path.sep)) return null;
  return fullPath;
}

/**
 * GET /api/points/stats-csv
 * 公开导出点位统计表格（CSV 格式，免鉴权）
 * 用于上传页面的公开访问场景，与 admin/stats-csv 返回相同格式
 */
router.get('/stats-csv', (_req, res) => {
  const rows = queryPointAgg();

  console.log(`[points/stats-csv] 公开导出完成: ${rows.length} 行`);

  sendCsv(res, buildStatsCsv(rows), statsCsvFileName());
});

/**
 * GET /api/points
 * 获取全部141个避风点点位列表（含素材数量统计）
 */
router.get('/', (_req, res) => {
  const points = toPointStatusRows(queryPointAgg());

  res.json({ success: true, data: points });
});

/**
 * GET /api/points/:id/materials
 * 获取单个点位的全部素材列表（上传时间倒序）
 * 上传页素材墙与后台详情共用
 */
router.get('/:id/materials', (req, res) => {
  const pointId = parseInt(req.params.id);
  if (isNaN(pointId) || pointId <= 0) {
    res.status(400).json({ success: false, error: '点位ID无效' });
    return;
  }

  // 字段契约与前端 MaterialItem 类型保持一致（path/size，同 /api/admin/point/:id 的 materials）
  const materials = db
    .prepare(
      `SELECT id, material_type AS type, file_path AS path, file_size AS size, upload_time
       FROM material
       WHERE point_id = ?
       ORDER BY id DESC`,
    )
    .all(pointId);

  res.json({ success: true, data: materials });
});

/**
 * GET /api/points/:id/materials/:materialId/file
 * 公开获取单个素材文件（免鉴权，用于上传页图片预览与视频在线播放）
 *   - res.sendFile 自动处理 Content-Type（img→image/*、mp4→video/mp4）
 *   - 自动支持 HTTP Range 请求（视频拖动进度条必需）
 *
 * 安全设计：
 *   - pointId + materialId 双重校验，素材必须属于该点位
 *   - resolve 后路径必须位于 STORAGE_DIR 内（路径遍历防御）
 *
 * 信任模型说明：上传页本身公开（任何人可向任意点位上传素材），
 * 预览能力与之对称；暴露面为「知道素材 id 的人可查看该素材」
 */
router.get('/:id/materials/:materialId/file', (req, res) => {
  const pointId = parsePositiveIntParam(req.params.id);
  const materialId = parsePositiveIntParam(req.params.materialId);

  if (pointId === null || materialId === null) {
    res.status(400).json({ success: false, error: '点位ID或素材ID无效' });
    return;
  }

  const row = db
    .prepare(`SELECT file_path FROM material WHERE id = ? AND point_id = ?`)
    .get(materialId, pointId) as { file_path: string } | undefined;

  if (!row) {
    res.status(404).json({ success: false, error: '素材不存在' });
    return;
  }

  const fullPath = resolveMaterialPath(row.file_path);
  if (!fullPath) {
    res.status(400).json({ success: false, error: '素材路径非法' });
    return;
  }

  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ success: false, error: '文件不存在' });
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ success: false, error: '文件读取失败' });
    }
  });
});

/**
 * DELETE /api/points/:id/materials/:materialId
 * 公开删除素材（免鉴权，上传页误传后的自主纠错能力）
 *   - 同步删除数据库记录与磁盘文件（先 DB 后文件，与 admin 端点一致）
 *   - 文件删除失败仅留孤儿文件，由定时清理兜底
 *
 * 前端删除前有确认弹窗防误删；信任模型与公开上传对称
 */
router.delete('/:id/materials/:materialId', (req, res) => {
  const pointId = parsePositiveIntParam(req.params.id);
  const materialId = parsePositiveIntParam(req.params.materialId);

  if (pointId === null || materialId === null) {
    res.status(400).json({ success: false, error: '点位ID或素材ID无效' });
    return;
  }

  const row = db
    .prepare(`SELECT file_path FROM material WHERE id = ? AND point_id = ?`)
    .get(materialId, pointId) as { file_path: string } | undefined;

  if (!row) {
    res.status(404).json({ success: false, error: '素材不存在' });
    return;
  }

  const fullPath = resolveMaterialPath(row.file_path);
  if (!fullPath) {
    res.status(400).json({ success: false, error: '素材路径非法' });
    return;
  }

  // 先删数据库记录，提交后再删磁盘文件
  db.prepare(`DELETE FROM material WHERE id = ?`).run(materialId);

  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch (err) {
      console.warn(`[points/material] 删除文件失败 ${fullPath}:`, (err as Error).message);
    }
  }

  console.log(`[points/material] 公开删除素材: point_${pointId} material_${materialId}`);
  res.json({ success: true, message: '素材已删除' });
});

export default router;
