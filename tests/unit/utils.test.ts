/**
 * 前端工具函数单元测试
 */
import { describe, it, expect } from 'vitest';
import { cn, getPointState, formatBeijingTime } from '@/lib/utils';

describe('cn 工具函数', () => {
  it('合并多个 className', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('过滤 falsy 值', () => {
    expect(cn('foo', false, null, undefined, 'bar')).toBe('foo bar');
  });

  it('Tailwind 冲突类名去重（后者覆盖前者）', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('对象形式条件类名', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active');
  });

  it('空入参返回空字符串', () => {
    expect(cn()).toBe('');
  });
});

describe('getPointState 点位状态判定', () => {
  it('主图 + 主视频 均上传 → complete', () => {
    expect(getPointState(true, true)).toBe('complete');
  });

  it('仅上传主图 → partial', () => {
    expect(getPointState(true, false)).toBe('partial');
  });

  it('仅上传主视频 → partial', () => {
    expect(getPointState(false, true)).toBe('partial');
  });

  it('均未上传 → empty', () => {
    expect(getPointState(false, false)).toBe('empty');
  });
});

describe('formatBeijingTime UTC→北京时间转换', () => {
  it('空值返回空字符串', () => {
    expect(formatBeijingTime(null)).toBe('');
    expect(formatBeijingTime(undefined)).toBe('');
    expect(formatBeijingTime('')).toBe('');
  });

  it('UTC 正午对应北京时间 20:00:00（UTC+8）', () => {
    // SQLite datetime('now') 格式：'YYYY-MM-DD HH:MM:SS'（UTC，无时区标识）
    expect(formatBeijingTime('2026-07-20 12:00:00')).toBe('2026-07-20 20:00:00');
  });

  it('UTC 跨日转北京时间：UTC 18:00 → 北京时间次日 02:00', () => {
    expect(formatBeijingTime('2026-07-20 18:00:00')).toBe('2026-07-21 02:00:00');
  });

  it('UTC 月末跨月：2026-01-31 18:00 → 北京时间 2026-02-01 02:00', () => {
    expect(formatBeijingTime('2026-01-31 18:00:00')).toBe('2026-02-01 02:00:00');
  });

  it('非法输入回退为原始字符串', () => {
    expect(formatBeijingTime('not-a-date')).toBe('not-a-date');
  });
});
