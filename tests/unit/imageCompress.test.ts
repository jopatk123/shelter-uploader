/**
 * 图片压缩：体积门槛、压缩阶梯、EXIF 回写
 * 画布编码依赖浏览器，这里覆盖不碰画布的决策与 JPEG 拼接。
 */
import { describe, it, expect } from 'vitest';
import { compressImageIfNeeded, shouldCompress } from '@/lib/imageCompress';
import {
  CANVAS_MAX_EDGE,
  MAX_DECODE_PIXELS,
  bodyBudgetForExif,
  planCompressionSteps,
  toJpegFileName,
} from '@/lib/imageCompressPlan';
import { insertApp1, readJpegOrientation, takeExifApp1 } from '@/lib/jpegExif';
import { readImageSize } from '@/lib/imageSize';
import { hasGpsExif } from '@/lib/imageCheck';
import { makeJpegWithGpsExif, makePngBuffer } from '../helpers';

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

  describe('planCompressionSteps', () => {
    const target = 500 * 1024;

    it('小图不会被放大', () => {
      const steps = planCompressionSteps(100, 80, 5 * 1024 * 1024, target);
      expect(steps).toHaveLength(1);
      expect(steps[0].width).toBe(100);
      expect(steps[0].height).toBe(80);
    });

    it('只比目标大一点的照片仍从较高分辨率开始', () => {
      const steps = planCompressionSteps(4000, 3000, 600 * 1024, target);
      const longEdge = Math.max(steps[0].width, steps[0].height);
      expect(longEdge).toBeGreaterThan(3000);
      expect(longEdge).toBeLessThanOrEqual(CANVAS_MAX_EDGE);
    });

    it('十几 MB 的手机原图不会从原始边长起步', () => {
      const steps = planCompressionSteps(8000, 6000, 15 * 1024 * 1024, target);
      expect(Math.max(steps[0].width, steps[0].height)).toBeLessThan(2500);
    });

    it('每一档都不超过画布长边和像素上限，并且越来越小', () => {
      const steps = planCompressionSteps(9000, 7000, 20 * 1024 * 1024, target);
      let prev = Infinity;
      for (const step of steps) {
        const longEdge = Math.max(step.width, step.height);
        expect(longEdge).toBeLessThanOrEqual(CANVAS_MAX_EDGE);
        expect(step.width * step.height).toBeLessThanOrEqual(MAX_DECODE_PIXELS);
        expect(longEdge).toBeLessThanOrEqual(prev);
        prev = longEdge;
      }
      expect(steps[steps.length - 1].qualities).toContain(0.35);
    });
  });

  describe('bodyBudgetForExif / 文件名', () => {
    it('EXIF 放得进目标时从主体预算里扣掉', () => {
      expect(bodyBudgetForExif(500 * 1024, 40 * 1024)).toBe(460 * 1024);
    });

    it('EXIF 太大或会挤掉主体预算时不再预留', () => {
      expect(bodyBudgetForExif(500 * 1024, 0)).toBe(500 * 1024);
      expect(bodyBudgetForExif(500 * 1024, 80 * 1024)).toBe(500 * 1024);
      expect(bodyBudgetForExif(150 * 1024, 40 * 1024)).toBe(150 * 1024);
    });

    it('压缩产物使用 jpg 后缀', () => {
      expect(toJpegFileName('现场.png')).toBe('现场.jpg');
      expect(toJpegFileName('a.b/c.webp')).toBe('a.b/c.jpg');
      expect(toJpegFileName('无后缀')).toBe('无后缀.jpg');
    });
  });

  describe('EXIF 回写', () => {
    it('保留 GPS，并把 Orientation 改成 1', async () => {
      const oriented = jpegWithOrientation(6);
      expect(readJpegOrientation(oriented)).toBe(6);

      const app1 = takeExifApp1(oriented);
      expect(app1).not.toBeNull();
      const rewritten = new Uint8Array(2 + app1!.length);
      rewritten[0] = 0xff;
      rewritten[1] = 0xd8;
      rewritten.set(app1!, 2);
      expect(readJpegOrientation(rewritten)).toBe(1);
      expect(readJpegOrientation(oriented)).toBe(6);

      const gps = takeExifApp1(new Uint8Array(makeJpegWithGpsExif()));
      const merged = insertApp1(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), gps!);
      const file = new File([merged], 'a.jpg', { type: 'image/jpeg' });
      await expect(hasGpsExif(file)).resolves.toBe(true);
    });

    it('大端 Orientation 同样改写成 1', () => {
      const oriented = jpegWithOrientation(8, false);
      expect(readJpegOrientation(oriented)).toBe(8);
      const app1 = takeExifApp1(oriented)!;
      const rewritten = new Uint8Array(2 + app1.length);
      rewritten[0] = 0xff;
      rewritten[1] = 0xd8;
      rewritten.set(app1, 2);
      expect(readJpegOrientation(rewritten)).toBe(1);
    });
  });

  describe('readImageSize', () => {
    it('读取 PNG 宽高', () => {
      expect(readImageSize(new Uint8Array(makePngBuffer(320, 180)))).toEqual({
        width: 320,
        height: 180,
      });
    });

    it('读取 JPEG SOF 与 WEBP VP8X 宽高', () => {
      expect(readImageSize(jpegWithSize(4032, 3024))).toEqual({ width: 4032, height: 3024 });
      expect(readImageSize(webpVp8x(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    });
  });

  describe('compressImageIfNeeded', () => {
    it('未超过目标时返回原文件', async () => {
      const file = new File([new Uint8Array([1, 2, 3])], 'small.jpg', { type: 'image/jpeg' });
      await expect(compressImageIfNeeded(file)).resolves.toBe(file);
    });

    it('无法解码的大图给出明确失败，而不是继续上传', async () => {
      const file = new File([new Uint8Array(600 * 1024)], 'big.jpg', { type: 'image/jpeg' });
      await expect(compressImageIfNeeded(file)).rejects.toThrow('无法压缩这张图片');
    });

    it('大图会压进目标体积、改成 jpg，并在放得下时保留 GPS', async () => {
      const globals = globalThis as {
        createImageBitmap?: unknown;
        OffscreenCanvas?: unknown;
      };
      const previousBitmap = globals.createImageBitmap;
      const previousCanvas = globals.OffscreenCanvas;
      globals.createImageBitmap = async (_file: Blob, opts?: { resizeWidth?: number; resizeHeight?: number }) => ({
        width: opts?.resizeWidth ?? 1600,
        height: opts?.resizeHeight ?? 1200,
        close() {},
      });
      globals.OffscreenCanvas = class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          return {
            fillStyle: '',
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
            fillRect() {},
            transform() {},
            drawImage() {},
          };
        }
        async convertToBlob() {
          const bytes = new Uint8Array(Math.max(64, Math.round(this.width * this.height * 0.02)));
          bytes[0] = 0xff;
          bytes[1] = 0xd8;
          bytes[2] = 0xff;
          bytes[3] = 0xd9;
          return new Blob([bytes], { type: 'image/jpeg' });
        }
      };

      try {
        const gps = makeJpegWithGpsExif();
        const sof = jpegWithSize(4000, 3000).subarray(2);
        const padded = new Uint8Array(520 * 1024);
        padded.set(gps.subarray(0, gps.length - 2), 0);
        padded.set(sof, gps.length - 2);
        const file = new File([padded], '码头.png', { type: 'image/png' });

        const out = await compressImageIfNeeded(file);
        expect(out.name).toBe('码头.jpg');
        expect(out.type).toBe('image/jpeg');
        expect(out.size).toBeLessThanOrEqual(500 * 1024);
        expect(out.size).toBeLessThan(file.size);
        await expect(hasGpsExif(out)).resolves.toBe(true);
      } finally {
        globals.createImageBitmap = previousBitmap;
        globals.OffscreenCanvas = previousCanvas;
      }
    });
  });
});

/** 构造带 Orientation 标签的最小 JPEG */
function jpegWithOrientation(orientation: number, littleEndian = true): Uint8Array {
  const tiff = new Uint8Array(8 + 2 + 12 + 4);
  const view = new DataView(tiff.buffer);
  tiff[0] = littleEndian ? 0x49 : 0x4d;
  tiff[1] = littleEndian ? 0x49 : 0x4d;
  view.setUint16(2, 0x002a, littleEndian);
  view.setUint32(4, 8, littleEndian);
  view.setUint16(8, 1, littleEndian);
  view.setUint16(10, 0x0112, littleEndian);
  view.setUint16(12, 3, littleEndian);
  view.setUint32(14, 1, littleEndian);
  view.setUint16(18, orientation, littleEndian);

  const exifId = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  const payloadLen = exifId.length + tiff.length;
  const segLength = 2 + payloadLen;
  const out = new Uint8Array(2 + 4 + payloadLen + 2);
  out[0] = 0xff;
  out[1] = 0xd8;
  out[2] = 0xff;
  out[3] = 0xe1;
  out[4] = (segLength >> 8) & 0xff;
  out[5] = segLength & 0xff;
  out.set(exifId, 6);
  out.set(tiff, 12);
  out[out.length - 2] = 0xff;
  out[out.length - 1] = 0xd9;
  return out;
}

/** FF D8 + SOF0，宽高按解析器的字段位置写入 */
function jpegWithSize(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xc0;
  bytes[7] = (height >> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (width >> 8) & 0xff;
  bytes[10] = width & 0xff;
  return bytes;
}

/** 最小 VP8X 头，宽高为 24-bit 减一 */
function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  const write = (text: string, offset: number) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  write('RIFF', 0);
  write('WEBP', 8);
  write('VP8X', 12);
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >> 8) & 0xff;
  bytes[29] = (h >> 16) & 0xff;
  return bytes;
}
