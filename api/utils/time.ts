/**
 * 时间工具：统一处理 UTC ↔ 北京时间（Asia/Shanghai，CST/UTC+8）转换
 *
 * 背景：
 * - 后端通过 SQLite datetime('now') 写入 upload_time，存储的是 UTC 时间，
 *   格式 'YYYY-MM-DD HH:MM:SS'，且不带时区标识。
 * - Docker 容器默认时区为 UTC，直接用 new Date().getHours() 等本地方法
 *   得到的也是 UTC 时间，导出 CSV 文件名时间戳会与用户实际感受差 8 小时。
 *
 * 约定：
 * - 数据库列存储 UTC 字符串（保留国际化基础）
 * - API 返回值保留 UTC 字符串（契约稳定）
 * - 仅在「展示层」（CSV 内容、CSV 文件名）转换为北京时间
 */

const BEIJING_TZ = 'Asia/Shanghai';

/**
 * 将 SQLite 存储的 UTC 时间字符串格式化为北京时间字符串
 * @param utcStr SQLite 返回的 UTC 时间字符串，如 '2026-07-20 07:30:00'；为空返回空串
 * @returns 北京时间字符串 'YYYY-MM-DD HH:MM:SS'；解析失败时回退为原始输入
 */
export function formatBeijingTime(utcStr: string | null | undefined): string {
  if (!utcStr) return '';
  // SQLite datetime('now') 格式无时区标识，附加 'Z' 让 JS Date 按 UTC 解析
  const date = new Date(utcStr + 'Z');
  if (Number.isNaN(date.getTime())) return utcStr;
  // sv-SE locale 输出 ISO 8601 风格 'YYYY-MM-DD HH:MM:SS'
  return date.toLocaleString('sv-SE', { timeZone: BEIJING_TZ, hour12: false });
}

/**
 * 生成当前北京时间的紧凑时间戳，用于 CSV 文件名
 * @returns 形如 '20260720_153000'
 */
export function beijingTimestamp(): string {
  // sv-SE locale → 'YYYY-MM-DD HH:MM:SS'，去掉分隔符并替换空格为下划线
  const formatted = new Date().toLocaleString('sv-SE', {
    timeZone: BEIJING_TZ,
    hour12: false,
  });
  // 'YYYY-MM-DD HH:MM:SS' → 'YYYYMMDD_HHMMSS'
  return formatted.replace(/[-: ]/g, (m) => (m === ' ' ? '_' : ''));
}
