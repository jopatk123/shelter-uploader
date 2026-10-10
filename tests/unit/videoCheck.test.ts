/**
 * 视频时长校验工具单元测试
 */
import { describe, it, expect } from 'vitest';
import { isDurationValid, MIN_VIDEO_DURATION } from '@/lib/videoCheck';

describe('videoCheck 工具函数', () => {
  describe('isDurationValid', () => {
    it('正好 5 秒通过', () => {
      expect(isDurationValid(5)).toBe(true);
    });

    it('超过 5 秒通过', () => {
      expect(isDurationValid(15)).toBe(true);
      expect(isDurationValid(30.5)).toBe(true);
      expect(isDurationValid(120)).toBe(true);
    });

    it('低于 5 秒不通过', () => {
      expect(isDurationValid(3)).toBe(false);
      expect(isDurationValid(4.9)).toBe(false);
      expect(isDurationValid(0)).toBe(false);
    });

    it('负值不通过', () => {
      expect(isDurationValid(-1)).toBe(false);
      expect(isDurationValid(-10)).toBe(false);
    });
  });

  describe('MIN_VIDEO_DURATION 常量', () => {
    it('值为 5', () => {
      expect(MIN_VIDEO_DURATION).toBe(5);
    });
  });
});
