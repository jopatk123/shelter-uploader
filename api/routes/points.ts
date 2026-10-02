/**
 * 公开点位接口（上传页免鉴权）
 */
import { Router } from 'express';
import { db } from '../db.js';
import { formatBeijingTime, beijingTimestamp } from '../utils/time.js';

const router = Router();

/**
 * CSV 表格列定义
 */
const STATS_CSV_COLUMNS: Array<{ key: string; header: string }> = [
  { key: 'id', header: '序号' },
  { key: 'name', header: '名称' },
  { key: 'district', header: '区县' },
  { key: 'township', header: '乡镇' },
  { key: 'station', header: '船管站' },
  { key: 'lon', header: '经度' },
  { key: 'lat', header: '纬度' },
  { key: 'img_count', header: '图片数' },
  { key: 'video_count', header: '视频数' },
  { key: 'uploaded_count', header: '已上传素材数' },
  { key: 'status', header: '完成状态' },
  { key: 'upload_time', header: '最后上传时间' },
];

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'boolean' ? (value ? '是' : '否') : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function describePointStatus(imgCount: number, videoCount: number): string {
  if (imgCount > 0 || videoCount > 0) return '已完成';
  return '未上传';
}

/** 点位素材聚合查询 SQL（与 /api/points、CSV 导出共用） */
const POINTS_AGG_QUERY = `
  SELECT
    p.id, p.name, p.district, p.township, p.station, p.lon, p.lat,
    COALESCE(SUM(CASE WHEN m.material_type = 'img' THEN 1 ELSE 0 END), 0) AS img_count,
    COALESCE(SUM(CASE WHEN m.material_type = 'video' THEN 1 ELSE 0 END), 0) AS video_count,
    MAX(m.upload_time) AS upload_time
  FROM point_info p
  LEFT JOIN material m ON p.id = m.point_id
  GROUP BY p.id
  ORDER BY p.id
`;

interface PointAggRow {
  id: number;
  name: string;
  district: string;
  township: string;
  station: string;
  lon: number;
  lat: number;
  img_count: number;
  video_count: number;
  upload_time: string | null;
}

/**
 * GET /api/points/stats-csv
 * 公开导出点位统计表格（CSV 格式，免鉴权）
 * 用于上传页面的公开访问场景，与 admin/stats-csv 返回相同格式
 */
router.get('/stats-csv', (_req, res) => {
  const rows = db.prepare(POINTS_AGG_QUERY).all() as PointAggRow[];

  const dataRows = rows.map((r) => ({
    id: r.id,
    name: r.name,
    district: r.district,
    township: r.township,
    station: r.station,
    lon: r.lon,
    lat: r.lat,
    img_count: r.img_count,
    video_count: r.video_count,
    uploaded_count: r.img_count + r.video_count,
    status: describePointStatus(r.img_count, r.video_count),
    upload_time: formatBeijingTime(r.upload_time),
  }));

  const headerLine = STATS_CSV_COLUMNS.map((c) => escapeCsvCell(c.header)).join(',');
  const bodyLines = dataRows.map((row) =>
    STATS_CSV_COLUMNS.map((col) => escapeCsvCell(row[col.key as keyof typeof row])).join(','),
  );
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

  console.log(`[points/stats-csv] 公开导出完成: ${dataRows.length} 行`);

  res.send(csvContent);
});

/**
 * GET /api/points
 * 获取全部141个避风点点位列表（含素材数量统计）
 */
router.get('/', (_req, res) => {
  const rows = db.prepare(POINTS_AGG_QUERY).all() as PointAggRow[];

  const points = rows.map((r) => ({
    id: r.id,
    name: r.name,
    district: r.district,
    township: r.township,
    station: r.station,
    lon: r.lon,
    lat: r.lat,
    img_count: r.img_count,
    video_count: r.video_count,
    uploaded_count: r.img_count + r.video_count,
    upload_time: r.upload_time,
  }));

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

  const materials = db
    .prepare(
      `SELECT id, point_id, material_type AS type, file_path, file_size, upload_time
       FROM material
       WHERE point_id = ?
       ORDER BY id DESC`,
    )
    .all(pointId);

  res.json({ success: true, data: materials });
});

export default router;
