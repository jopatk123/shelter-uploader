/**
 * 图片压缩工具单元测试
 * 规则：单张图片上限 500KB（运行时配置默认值），超过才压缩（优先保留分辨率）
 */
import { describe, it, expect } from 'vitest';
import { shouldCompress } from '@/lib/imageCompress';

describe('imageCompress 工具函数', () => {
  describe('shouldCompress', () => {
    it('小于500KB的文件不需要压缩', () => {
      const file = { size: 500 * 1024 - 1 } as File;
      expect(shouldCompress(file)).toBe(false);
    });

    it('正好500KB的文件不需要压缩', () => {
      const file = { size: 500 * 1024 } as File;
      expect(shouldCompress(file)).toBe(false);
    });

    it('超过500KB的文件需要压缩', () => {
      const file = { size: 500 * 1024 + 1 } as File;
      expect(shouldCompress(file)).toBe(true);
    });

    it('大文件（50MB）需要压缩', () => {
      const file = { size: 50 * 1024 * 1024 } as File;
      expect(shouldCompress(file)).toBe(true);
    });
  });
});
