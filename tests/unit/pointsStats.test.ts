/**
 * 点位完成状态文案
 * 与圆点颜色共用口径：两种素材都有才算已完成
 */
import { describe, it, expect } from 'vitest';
import { describePointStatus } from '../../api/utils/pointsStats.js';

describe('describePointStatus', () => {
  it('图片和视频都有 → 已完成', () => {
    expect(describePointStatus(1, 1)).toBe('已完成');
    expect(describePointStatus(3, 2)).toBe('已完成');
  });

  it('只有图片或只有视频 → 部分完成', () => {
    expect(describePointStatus(2, 0)).toBe('部分完成');
    expect(describePointStatus(0, 1)).toBe('部分完成');
  });

  it('都没有 → 未上传', () => {
    expect(describePointStatus(0, 0)).toBe('未上传');
  });
});
