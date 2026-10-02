/**
 * 后端图片尺寸解析工具单元测试
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getImageDimension } from '../../api/utils/imageDimension.js';
import { makePngBuffer } from '../helpers.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgdim-test-'));
});

describe('imageDimension 工具函数', () => {
  describe('getImageDimension - PNG', () => {
    it('正确解析 PNG 尺寸', () => {
      const buf = makePngBuffer(200, 100);
      const filePath = path.join(tmpDir, 'test-200x100.png');
      fs.writeFileSync(filePath, buf);

      const dim = getImageDimension(filePath);
      expect(dim).not.toBeNull();
      expect(dim!.width).toBe(200);
      expect(dim!.height).toBe(100);
    });

    it('正方形 PNG', () => {
      const buf = makePngBuffer(64, 64);
      const filePath = path.join(tmpDir, 'test-64x64.png');
      fs.writeFileSync(filePath, buf);

      const dim = getImageDimension(filePath);
      expect(dim).not.toBeNull();
      expect(dim!.width).toBe(64);
      expect(dim!.height).toBe(64);
    });

    it('大尺寸 PNG', () => {
      const buf = makePngBuffer(8000, 4000);
      const filePath = path.join(tmpDir, 'test-8000x4000.png');
      fs.writeFileSync(filePath, buf);

      const dim = getImageDimension(filePath);
      expect(dim).not.toBeNull();
      expect(dim!.width).toBe(8000);
      expect(dim!.height).toBe(4000);
    });
  });

  describe('getImageDimension - 无效文件', () => {
    it('非图片文件返回 null', () => {
      const filePath = path.join(tmpDir, 'not-image.png');
      fs.writeFileSync(filePath, Buffer.alloc(1024, 0xff));

      const dim = getImageDimension(filePath);
      expect(dim).toBeNull();
    });

    it('空文件返回 null', () => {
      const filePath = path.join(tmpDir, 'empty.png');
      fs.writeFileSync(filePath, Buffer.alloc(0));

      const dim = getImageDimension(filePath);
      expect(dim).toBeNull();
    });

    it('过短文件返回 null', () => {
      const filePath = path.join(tmpDir, 'short.png');
      fs.writeFileSync(filePath, Buffer.from([0x89, 0x50]));

      const dim = getImageDimension(filePath);
      expect(dim).toBeNull();
    });
  });
});
