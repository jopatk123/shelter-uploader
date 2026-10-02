import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 将 SQLite 存储的 UTC 时间字符串格式化为北京时间字符串
 *
 * 背景：后端通过 SQLite datetime('now') 写入 upload_time，返回的是 UTC 时间，
 * 格式 'YYYY-MM-DD HH:MM:SS'，且不带时区标识。前端直接展示会比北京时间慢 8 小时。
 *
 * 实现要点：
 * - 在原始字符串末尾附加 'Z'，让 JS Date 按 UTC 解析
 * - 使用 'sv-SE' locale 输出 ISO 8601 风格 'YYYY-MM-DD HH:MM:SS'
 * - 指定 timeZone: 'Asia/Shanghai' 转换为北京时间（CST，UTC+8）
 *
 * @param utcStr SQLite 返回的 UTC 时间字符串；空值返回空串
 * @returns 北京时间字符串 'YYYY-MM-DD HH:MM:SS'；解析失败时回退为原始输入
 */
export function formatBeijingTime(utcStr: string | null | undefined): string {
  if (!utcStr) return '';
  const date = new Date(utcStr + 'Z');
  if (Number.isNaN(date.getTime())) return utcStr;
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false });
}

/**
 * 点位上传状态（仅用于圆点/UI 颜色区分，不影响完成百分比统计）
 * - complete: 主图 + 主视频 均已上传（绿色）
 * - partial:  仅上传其中之一（黄色，统计上也算完成）
 * - empty:    均未上传（红色）
 */
export type PointState = 'complete' | 'partial' | 'empty';

/**
 * 依据主图 / 主视频上传情况判定点位状态
 * 仅基于 has_image 与 has_video，与备选素材无关
 * 统计完成百分比使用 has_image || has_video，即 partial 也计入完成
 */
export function getPointState(hasImage: boolean, hasVideo: boolean): PointState {
  if (hasImage && hasVideo) return 'complete';
  if (hasImage || hasVideo) return 'partial';
  return 'empty';
}
