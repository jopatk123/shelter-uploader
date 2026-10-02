/**
 * 图片压缩工具单元测试
 */
import { describe, it, expect } from 'vitest';
import { shouldCompress } from '@/lib/imageCompress';

describe('imageCompress 工具函数', () => {
  describe('shouldCompress', () => {
    it('小于10MB的文件不需要压缩', () => {
      const file = { size: 5 * 1024 * 1024 } as File;
      expect(shouldCompress(file)).toBe(false);
    });

    it('正好10MB的文件不需要压缩', () => {
      const file = { size: 10 * 1024 * 1024 } as File;
      expect(shouldCompress(file)).toBe(false);
    });

    it('超过10MB的文件需要压缩', () => {
      const file = { size: 10 * 1024 * 1024 + 1 } as File;
      expect(shouldCompress(file)).toBe(true);
    });

    it('大文件（50MB）需要压缩', () => {
      const file = { size: 50 * 1024 * 1024 } as File;
      expect(shouldCompress(file)).toBe(true);
    });
  });
});
