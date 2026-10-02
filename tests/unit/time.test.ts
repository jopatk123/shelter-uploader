/**
 * 后端时间工具单元测试
 * 覆盖 formatBeijingTime（UTC→北京时间）与 beijingTimestamp（文件名时间戳）
 */
import { describe, it, expect } from 'vitest';
import { formatBeijingTime, beijingTimestamp } from '../../api/utils/time.js';

describe('formatBeijingTime UTC→北京时间', () => {
  it('空值返回空字符串', () => {
    expect(formatBeijingTime(null)).toBe('');
    expect(formatBeijingTime(undefined)).toBe('');
    expect(formatBeijingTime('')).toBe('');
  });

  it('UTC 00:00 → 北京时间 08:00（同日）', () => {
    expect(formatBeijingTime('2026-07-20 00:00:00')).toBe('2026-07-20 08:00:00');
  });

  it('UTC 12:00 → 北京时间 20:00（同日）', () => {
    expect(formatBeijingTime('2026-07-20 12:00:00')).toBe('2026-07-20 20:00:00');
  });

  it('UTC 18:00 → 北京时间次日 02:00（跨日）', () => {
    expect(formatBeijingTime('2026-07-20 18:00:00')).toBe('2026-07-21 02:00:00');
  });

  it('UTC 月末跨月', () => {
    expect(formatBeijingTime('2026-01-31 18:00:00')).toBe('2026-02-01 02:00:00');
  });

  it('UTC 年末跨年', () => {
    expect(formatBeijingTime('2026-12-31 18:00:00')).toBe('2027-01-01 02:00:00');
  });

  it('非法输入回退为原始字符串', () => {
    expect(formatBeijingTime('not-a-date')).toBe('not-a-date');
  });
});

describe('beijingTimestamp 文件名时间戳', () => {
  it('格式为 YYYYMMDD_HHMMSS（14 字符）', () => {
    const ts = beijingTimestamp();
    expect(ts).toMatch(/^\d{8}_\d{6}$/);
    expect(ts.length).toBe(15); // 8 + 1(下划线) + 6
  });

  it('与时区无关：无论宿主时区如何，都应返回 Asia/Shanghai 时间', () => {
    // 此用例本身不直接断言绝对值（依赖运行时时刻），
    // 但通过对比 toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }) 间接验证
    const expected = new Date()
      .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false })
      .replace(/[-: ]/g, (m) => (m === ' ' ? '_' : ''));
    expect(beijingTimestamp()).toBe(expected);
  });
});
