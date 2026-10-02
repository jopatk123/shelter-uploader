/**
 * 后端 MP4 视频时长解析工具单元测试
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getVideoDuration,
  isDurationValid,
  MIN_VIDEO_DURATION,
} from '../../api/utils/videoDuration.js';
import { makeMp4Buffer } from '../helpers.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videodur-test-'));
});

describe('videoDuration 工具函数', () => {
  describe('getVideoDuration', () => {
    it('正确解析 15 秒视频', () => {
      const buf = makeMp4Buffer(15);
      const filePath = path.join(tmpDir, 'test-15s.mp4');
      fs.writeFileSync(filePath, buf);

      const duration = getVideoDuration(filePath);
      expect(duration).not.toBeNull();
      expect(duration).toBeCloseTo(15, 1);
    });

    it('正确解析 5 秒视频', () => {
      const buf = makeMp4Buffer(5);
      const filePath = path.join(tmpDir, 'test-5s.mp4');
      fs.writeFileSync(filePath, buf);

      const duration = getVideoDuration(filePath);
      expect(duration).not.toBeNull();
      expect(duration).toBeCloseTo(5, 1);
    });

    it('正确解析 60 秒视频', () => {
      const buf = makeMp4Buffer(60);
      const filePath = path.join(tmpDir, 'test-60s.mp4');
      fs.writeFileSync(filePath, buf);

      const duration = getVideoDuration(filePath);
      expect(duration).not.toBeNull();
      expect(duration).toBeCloseTo(60, 1);
    });

    it('非 MP4 文件返回 null', () => {
      const filePath = path.join(tmpDir, 'not-mp4.mp4');
      fs.writeFileSync(filePath, Buffer.alloc(1024, 0xff));

      const duration = getVideoDuration(filePath);
      expect(duration).toBeNull();
    });

    it('空文件返回 null', () => {
      const filePath = path.join(tmpDir, 'empty.mp4');
      fs.writeFileSync(filePath, Buffer.alloc(0));

      const duration = getVideoDuration(filePath);
      expect(duration).toBeNull();
    });

    it('缺少 moov box 的文件返回 null', () => {
      // 只有 ftyp box，没有 moov
      const ftypBox = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x10]), // size=16
        Buffer.from('ftyp', 'ascii'),
        Buffer.from('isom', 'ascii'),
        Buffer.from([0x00, 0x00, 0x02, 0x00]),
      ]);
      const filePath = path.join(tmpDir, 'no-moov.mp4');
      fs.writeFileSync(filePath, ftypBox);

      const duration = getVideoDuration(filePath);
      expect(duration).toBeNull();
    });
  });

  describe('isDurationValid', () => {
    it('10 秒通过', () => {
      expect(isDurationValid(10)).toBe(true);
    });

    it('超过 10 秒通过', () => {
      expect(isDurationValid(15)).toBe(true);
      expect(isDurationValid(30)).toBe(true);
    });

    it('低于 10 秒不通过', () => {
      expect(isDurationValid(5)).toBe(false);
      expect(isDurationValid(9.9)).toBe(false);
    });

    it('零或负值不通过', () => {
      expect(isDurationValid(0)).toBe(false);
      expect(isDurationValid(-1)).toBe(false);
    });
  });

  describe('MIN_VIDEO_DURATION 常量', () => {
    it('值为 10', () => {
      expect(MIN_VIDEO_DURATION).toBe(10);
    });
  });
});
