import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 将字节数格式化为易读的文件大小字符串（如 1.5 MB / 320 KB / 512 B）
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
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
 * 点位上传状态（圆点颜色、完成百分比、导出状态共用这一套）
 * - complete: 图片 + 视频 均已上传（绿色，计入完成百分比）
 * - partial:  仅上传其中之一（黄色，不计入完成百分比）
 * - empty:    均未上传（红色）
 */
export type PointState = 'complete' | 'partial' | 'empty';

/**
 * 依据图片 / 视频上传数量判定点位状态
 * 完成百分比只统计 complete，避免「只传了一种」被算成已经做完
 */
export function getPointState(imgCount: number, videoCount: number): PointState {
  const hasImage = imgCount > 0;
  const hasVideo = videoCount > 0;
  if (hasImage && hasVideo) return 'complete';
  if (hasImage || hasVideo) return 'partial';
  return 'empty';
}
