/**
 * 图片校验工具单元测试（可解码校验 / EXIF GPS / 纯黑像素占比）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkImageReadable,
  hasGpsExif,
  countBlackPixels,
  MAX_BLACK_RATIO,
  BLACK_THRESHOLD,
} from '@/lib/imageCheck';
import {
  makeJpegWithGpsExif,
  makeJpegWithoutGpsExif,
  makeJpegWithGpsLatOnly,
  makeJpegWithGpsExifBigEndian,
  makeJpegWithoutApp1,
  makeJpegWithXmpOnly,
  makePngBuffer,
} from '../helpers';

/** 将 Buffer 转为浏览器 File 对象（Node 18+ 全局可用） */
function bufferToFile(buf: Buffer, name: string, type = 'image/jpeg'): File {
  return new File([new Uint8Array(buf)], name, { type });
}

describe('imageCheck 工具函数', () => {
  describe('checkImageReadable', () => {
    // Node 环境无浏览器解码能力，通过 stub createImageBitmap 模拟
    const globals = globalThis as { createImageBitmap?: unknown };
    let originalCreateImageBitmap: unknown;

    beforeEach(() => {
      originalCreateImageBitmap = globals.createImageBitmap;
    });

    afterEach(() => {
      globals.createImageBitmap = originalCreateImageBitmap;
    });

    it('可解码图片返回 ok 与原始尺寸', async () => {
      globals.createImageBitmap = async () => ({ width: 200, height: 100, close: () => {} });
      const file = bufferToFile(makePngBuffer(200, 100), 'photo.png', 'image/png');

      const result = await checkImageReadable(file);
      expect(result.ok).toBe(true);
      expect(result.width).toBe(200);
      expect(result.height).toBe(100);
    });

    it('任意比例（竖屏/方图）均可读取，不限制宽高比', async () => {
      globals.createImageBitmap = async () => ({ width: 100, height: 300, close: () => {} });
      const file = bufferToFile(makePngBuffer(100, 300), 'tall.png', 'image/png');

      const result = await checkImageReadable(file);
      expect(result.ok).toBe(true);
      expect(result.width).toBe(100);
      expect(result.height).toBe(300);
    });

    it('无法解码时抛出异常', async () => {
      globals.createImageBitmap = async () => {
        throw new Error('decode failed');
      };
      const file = bufferToFile(Buffer.alloc(64, 0xff), 'broken.png', 'image/png');

      await expect(checkImageReadable(file)).rejects.toThrow();
    });
  });

  describe('hasGpsExif', () => {
    it('JPEG 含完整 GPS（纬度+经度）返回 true', async () => {
      const file = bufferToFile(makeJpegWithGpsExif(), 'photo.jpg');
      await expect(hasGpsExif(file)).resolves.toBe(true);
    });

    it('JPEG 含 EXIF 但无 GPS IFD 返回 false', async () => {
      const file = bufferToFile(makeJpegWithoutGpsExif(), 'no-gps.jpg');
      await expect(hasGpsExif(file)).resolves.toBe(false);
    });

    it('JPEG 含 GPS IFD 但仅有纬度（无经度）返回 false', async () => {
      const file = bufferToFile(makeJpegWithGpsLatOnly(), 'lat-only.jpg');
      await expect(hasGpsExif(file)).resolves.toBe(false);
    });

    it('大端（MM）字节序 JPEG 含完整 GPS 返回 true', async () => {
      const file = bufferToFile(makeJpegWithGpsExifBigEndian(), 'big-endian.jpg');
      await expect(hasGpsExif(file)).resolves.toBe(true);
    });

    it('JPEG 无 APP1 段返回 false', async () => {
      const file = bufferToFile(makeJpegWithoutApp1(), 'no-app1.jpg');
      await expect(hasGpsExif(file)).resolves.toBe(false);
    });

    it('JPEG APP1 为 XMP（非 EXIF）返回 false', async () => {
      const file = bufferToFile(makeJpegWithXmpOnly(), 'xmp.jpg');
      await expect(hasGpsExif(file)).resolves.toBe(false);
    });

    it('PNG 文件跳过检测，返回 null（不视为缺少 GPS）', async () => {
      const png = makePngBuffer(200, 100);
      const file = bufferToFile(png, 'photo.png', 'image/png');
      await expect(hasGpsExif(file)).resolves.toBeNull();
    });

    it('WEBP 文件跳过检测，返回 null（不视为缺少 GPS）', async () => {
      const buf = makeJpegWithGpsExif();
      const file = bufferToFile(buf, 'photo.webp', 'image/webp');
      await expect(hasGpsExif(file)).resolves.toBeNull();
    });

    it('文件名 .jpeg 后缀也可识别', async () => {
      const file = bufferToFile(makeJpegWithGpsExif(), 'photo.jpeg');
      await expect(hasGpsExif(file)).resolves.toBe(true);
    });

    it('仅凭 MIME=image/jpeg 也可识别（即使扩展名非 jpg）', async () => {
      const file = bufferToFile(makeJpegWithGpsExif(), 'photo.bin', 'image/jpeg');
      await expect(hasGpsExif(file)).resolves.toBe(true);
    });

    it('空文件返回 false', async () => {
      const file = bufferToFile(Buffer.alloc(0), 'empty.jpg');
      await expect(hasGpsExif(file)).resolves.toBe(false);
    });

    it('损坏数据（非 JPEG 头）返回 false', async () => {
      const file = bufferToFile(Buffer.alloc(64, 0xab), 'broken.jpg');
      await expect(hasGpsExif(file)).resolves.toBe(false);
    });
  });

  describe('countBlackPixels', () => {
    /** 构造 RGBA 像素数据：每个像素 [r,g,b,a] */
    function makeRgba(pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
      const buf = new Uint8ClampedArray(pixels.length * 4);
      pixels.forEach((p, i) => {
        buf[i * 4] = p[0];
        buf[i * 4 + 1] = p[1];
        buf[i * 4 + 2] = p[2];
        buf[i * 4 + 3] = p[3];
      });
      return buf;
    }

    it('空数据返回 0', () => {
      const result = countBlackPixels(new Uint8ClampedArray(0));
      expect(result.black).toBe(0);
      expect(result.total).toBe(0);
      expect(result.ratio).toBe(0);
    });

    it('全黑像素（RGB=0,0,0 + 不透明）：black=total，ratio=1', () => {
      const data = makeRgba([
        [0, 0, 0, 255],
        [0, 0, 0, 255],
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ]);
      const result = countBlackPixels(data);
      expect(result.black).toBe(4);
      expect(result.total).toBe(4);
      expect(result.ratio).toBe(1);
    });

    it('无黑像素：black=0，ratio=0', () => {
      const data = makeRgba([
        [255, 255, 255, 255],
        [128, 128, 128, 255],
        [1, 1, 1, 255], // 严格阈值 0 下不算黑
        [255, 0, 0, 255], // 红色不算黑
      ]);
      const result = countBlackPixels(data);
      expect(result.black).toBe(0);
      expect(result.total).toBe(4);
      expect(result.ratio).toBe(0);
    });

    it('半黑像素：ratio=0.5', () => {
      const data = makeRgba([
        [0, 0, 0, 255],
        [255, 255, 255, 255],
        [0, 0, 0, 255],
        [128, 128, 128, 255],
      ]);
      const result = countBlackPixels(data);
      expect(result.black).toBe(2);
      expect(result.total).toBe(4);
      expect(result.ratio).toBe(0.5);
    });

    it('透明像素（A=0）不计入黑像素，但计入 total', () => {
      // RGB(0,0,0) 但 A=0：视觉上是透明，不是黑色
      const data = makeRgba([
        [0, 0, 0, 0],
        [0, 0, 0, 255],
        [255, 255, 255, 255],
        [0, 0, 0, 255],
      ]);
      const result = countBlackPixels(data);
      expect(result.black).toBe(2); // 仅 2 个不透明纯黑
      expect(result.total).toBe(4);
      expect(result.ratio).toBe(0.5);
    });

    it('仅一通道为 0 不算黑（如 RGB=0,128,255）', () => {
      const data = makeRgba([
        [0, 128, 255, 255],
        [255, 0, 255, 255],
        [255, 255, 0, 255],
      ]);
      const result = countBlackPixels(data);
      expect(result.black).toBe(0);
    });

    it('阈值放宽：threshold=10 时 RGB(5,5,5) 视为黑', () => {
      const data = makeRgba([
        [5, 5, 5, 255], // threshold=10 下算黑
        [10, 10, 10, 255], // 边界值，<= 10 算黑
        [11, 11, 11, 255], // 超过阈值不算黑
        [0, 0, 0, 255], // 严格纯黑也算
      ]);
      const result = countBlackPixels(data, 10);
      expect(result.black).toBe(3);
      expect(result.total).toBe(4);
      expect(result.ratio).toBe(0.75);
    });

    it('10% 阈值边界：12 像素中 1 黑（8.3%）通过，2 黑（16.7%）不通过', () => {
      // 模拟 12 像素中 1 个纯黑
      const pixels1: Array<[number, number, number, number]> = Array(11).fill([
        255, 255, 255, 255,
      ]) as Array<[number, number, number, number]>;
      pixels1.push([0, 0, 0, 255]);
      expect(countBlackPixels(makeRgba(pixels1)).ratio).toBeLessThanOrEqual(MAX_BLACK_RATIO);

      // 模拟 12 像素中 2 个纯黑
      const pixels2: Array<[number, number, number, number]> = Array(10).fill([
        255, 255, 255, 255,
      ]) as Array<[number, number, number, number]>;
      pixels2.push([0, 0, 0, 255], [0, 0, 0, 255]);
      expect(countBlackPixels(makeRgba(pixels2)).ratio).toBeGreaterThan(MAX_BLACK_RATIO);
    });

    it('常量值正确', () => {
      expect(MAX_BLACK_RATIO).toBe(0.1);
      expect(BLACK_THRESHOLD).toBe(0);
    });

    it('支持 Uint8Array 输入（与 Uint8ClampedArray 等价）', () => {
      const data = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
      const result = countBlackPixels(data);
      expect(result.black).toBe(1);
      expect(result.total).toBe(2);
      expect(result.ratio).toBe(0.5);
    });

    it('数据长度非 4 倍数时向下取整', () => {
      // 5 字节 = 1 个完整像素 + 1 字节剩余
      const data = new Uint8ClampedArray([0, 0, 0, 255, 99]);
      const result = countBlackPixels(data);
      expect(result.total).toBe(1);
      expect(result.black).toBe(1);
    });
  });
});
