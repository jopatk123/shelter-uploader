/**
 * 点位统计与 CSV 导出公共逻辑
 *
 * 公开接口（routes/points.ts）与管理员接口（routes/admin.ts）共用同一套：
 *   - 点位素材聚合 SQL
 *   - CSV 列定义与单元格转义
 *   - 完成状态文案
 *   - CSV 文本拼装与响应头
 * 避免这些逻辑在两处路由中重复维护、改一处漏一处。
 */
import type { Response } from 'express';
import { db } from '../db.js';
import { formatBeijingTime, beijingTimestamp } from './time.js';

/** 点位素材聚合查询结果行 */
export interface PointAggRow {
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

/** 点位列表行（在聚合行基础上补充素材总数） */
export interface PointStatusRow extends PointAggRow {
  uploaded_count: number;
}

/** 管理后台点位列表筛选类型 */
export type PointFilter = 'all' | 'img_only' | 'video_only' | 'completed';

/** 筛选条件对应的 HAVING 子句（基于聚合后的 img_count / video_count） */
const FILTER_HAVING: Record<Exclude<PointFilter, 'all'>, string> = {
  img_only: 'HAVING img_count > 0 AND video_count = 0',
  video_only: 'HAVING img_count = 0 AND video_count > 0',
  completed: 'HAVING img_count > 0 AND video_count > 0',
};

/** CSV 表格列定义 */
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

/**
 * 将字段值格式化为 CSV 单元格安全字符串
 * - 含逗号、双引号、换行的字段用双引号包裹，内部双引号转义为两个双引号
 * - null / undefined 转为空字符串
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
 * 依据图片/视频上传情况判定完成状态文案
 * 与圆点颜色一致：两种都有才是已完成，只有一种是部分完成
 */
export function describePointStatus(imgCount: number, videoCount: number): string {
  if (imgCount > 0 && videoCount > 0) return '已完成';
  if (imgCount > 0 || videoCount > 0) return '部分完成';
  return '未上传';
}

/**
 * 查询点位素材聚合数据
 * @param options.ids    仅查询指定点位；不传表示不限制
 * @param options.filter 按素材构成筛选（仅管理后台列表使用）
 */
export function queryPointAgg(
  options: { ids?: number[] | null; filter?: PointFilter } = {},
): PointAggRow[] {
  const { ids = null, filter = 'all' } = options;

  // 动态占位符避免 SQL 注入
  const placeholders = ids && ids.length > 0 ? ids.map(() => '?').join(',') : null;
  const whereClause = placeholders ? `WHERE p.id IN (${placeholders})` : '';
  // 未知筛选值等价于不筛选（?? 兜底，避免拼出 "undefined" 子句）
  const havingClause = filter === 'all' ? '' : (FILTER_HAVING[filter] ?? '');
  const params: unknown[] = ids ?? [];

  return db
    .prepare(
      `
    SELECT
      p.id, p.name, p.district, p.township, p.station, p.lon, p.lat,
      COALESCE(SUM(CASE WHEN m.material_type = 'img' THEN 1 ELSE 0 END), 0) AS img_count,
      COALESCE(SUM(CASE WHEN m.material_type = 'video' THEN 1 ELSE 0 END), 0) AS video_count,
      MAX(m.upload_time) AS upload_time
    FROM point_info p
    LEFT JOIN material m ON p.id = m.point_id
    ${whereClause}
    GROUP BY p.id
    ${havingClause}
    ORDER BY p.id
  `,
    )
    .all(...params) as PointAggRow[];
}

/**
 * 聚合行 → 点位列表行（补充素材总数 uploaded_count）
 * upload_time 保持数据库原始值，由前端统一格式化
 */
export function toPointStatusRows(rows: PointAggRow[]): PointStatusRow[] {
  return rows.map((r) => ({
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
}

/**
 * 生成统计表格 CSV 文本（UTF-8 BOM 头确保 Excel 正确显示中文）
 */
export function buildStatsCsv(rows: PointAggRow[]): string {
  const dataRows = toPointStatusRows(rows).map((r) => ({
    ...r,
    status: describePointStatus(r.img_count, r.video_count),
    // CSV 中输出可读的北京时间
    upload_time: formatBeijingTime(r.upload_time),
  }));

  const headerLine = STATS_CSV_COLUMNS.map((c) => escapeCsvCell(c.header)).join(',');
  const bodyLines = dataRows.map((row) =>
    STATS_CSV_COLUMNS.map((col) => escapeCsvCell(row[col.key as keyof typeof row])).join(','),
  );

  return '\uFEFF' + headerLine + '\n' + bodyLines.join('\n') + '\n';
}

/**
 * 生成统计表格文件名：stats_YYYYMMDD_HHmmss.csv（北京时间）
 */
export function statsCsvFileName(): string {
  return `stats_${beijingTimestamp()}.csv`;
}

/**
 * 以附件形式发送 CSV 响应
 */
export function sendCsv(res: Response, content: string, fileName: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(content);
}
