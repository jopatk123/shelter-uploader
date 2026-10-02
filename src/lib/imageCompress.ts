/**
 * 图片压缩。
 *
 * 超过压缩目标（默认 500KB）的图片在本页完成压缩，不走外部 CDN Worker：
 * - 先按文件头知道像素尺寸，再用 createImageBitmap 直接解码到安全分辨率
 * - 画质从高到低，仍超标就缩小长边，直到放进目标或明确失败
 * - PNG / WEBP 超标时改为 JPEG（透明区域铺白），体积才降得下来
 * - 原 JPEG 的 EXIF（GPS、拍摄时间）在塞进目标体积时保留，放不下就丢掉 EXIF 换上传成功
 *
 * 不在这里把仍超标的文件交给上传：服务端硬上限只会再拒绝一次。
 */
import { getRuntimeConfig } from '@/lib/runtimeConfig';
import { readImageSizeFromFile, type ImageSize } from '@/lib/imageSize';
import { insertApp1, readJpegOrientation, takeExifApp1 } from '@/lib/jpegExif';
import {
  allQualities,
  bodyBudgetForExif,
  planCompressionSteps,
  toJpegFileName,
  type CompressStep,
} from '@/lib/imageCompressPlan';

type BitmapSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
type DrawableCanvas = HTMLCanvasElement | OffscreenCanvas;
type DrawCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface DecodedImage {
  bitmap: ImageBitmap;
  /** 实际解码出的、旋转前的宽高。比计划更小时，后续按这个尺寸画，避免放大 */
  storedWidth: number;
  storedHeight: number;
  reduced: boolean;
}

function targetBytes(): number {
  return getRuntimeConfig().imageCompressTargetKB * 1024;
}

/** 判断图片是否需要压缩（超过压缩目标才压缩） */
export function shouldCompress(file: File): boolean {
  return file.size > targetBytes();
}

/**
 * 将图片压到压缩目标以内。
 * 未超标时原样返回（格式和 EXIF 都不动）。
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  const limit = targetBytes();
  if (file.size <= limit) return file;

  const header = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const size = await readImageSizeFromFile(file);
  const orientation = readJpegOrientation(header);
  const app1 = takeExifApp1(header);
  const display = displaySize(size, orientation);

  const reserved = app1 ? bodyBudgetForExif(limit, app1.byteLength) : limit;
  const keepExif = app1 !== null && reserved < limit;

  let encoded = await encodeUnderBudget(file, display, orientation, reserved, file.size);
  let usedExif = keepExif;
  if (!encoded && keepExif) {
    encoded = await encodeUnderBudget(file, display, orientation, limit, file.size);
    usedExif = false;
  }
  if (!encoded) {
    throw new Error('这张图片压缩后仍超过大小限制，请换一张较小的照片');
  }

  let bytes = encoded;
  if (usedExif && app1 && bytes.byteLength + app1.byteLength <= limit) {
    bytes = insertApp1(bytes, app1);
  }

  return new File([bytes], toJpegFileName(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}

function displaySize(size: ImageSize | null, orientation: number): ImageSize | null {
  if (!size) return null;
  if (orientation >= 5 && orientation <= 8) {
    return { width: size.height, height: size.width };
  }
  return size;
}

async function encodeUnderBudget(
  file: File,
  display: ImageSize | null,
  orientation: number,
  bodyBudget: number,
  fileSize: number,
): Promise<Uint8Array | null> {
  const known = display ?? (await probeDisplaySize(file));
  if (!known) {
    throw new Error('无法压缩这张图片，请换一张照片后重试');
  }

  const steps = planCompressionSteps(known.width, known.height, fileSize, bodyBudget);
  const swap = orientation >= 5 && orientation <= 8;
  const first = steps[0];
  const decodeWidth = swap ? first.height : first.width;
  const decodeHeight = swap ? first.width : first.height;

  const decoded = await decodeScaled(file, decodeWidth, decodeHeight);
  const renderSteps = decoded.reduced
    ? [
        {
          width: swap ? decoded.storedHeight : decoded.storedWidth,
          height: swap ? decoded.storedWidth : decoded.storedHeight,
          qualities: allQualities(),
        },
      ]
    : steps;

  try {
    for (const step of renderSteps) {
      const canvas = renderOriented(decoded.bitmap, orientation, step.width, step.height);
      const fitted = await encodeQualities(canvas, step, bodyBudget);
      releaseCanvas(canvas);
      if (fitted) return fitted;
    }
    return null;
  } finally {
    decoded.bitmap.close();
  }
}

async function encodeQualities(
  canvas: DrawableCanvas,
  step: CompressStep,
  bodyBudget: number,
): Promise<Uint8Array | null> {
  for (const quality of step.qualities) {
    const blob = await canvasToJpeg(canvas, quality);
    if (blob.size <= bodyBudget) {
      return new Uint8Array(await blob.arrayBuffer());
    }
  }
  return null;
}

/**
 * 尺寸读不到时，只限制宽度做一次解码。
 * 只传 resizeWidth 时浏览器会保持宽高比，不会被拉成正方形。
 */
async function probeDisplaySize(file: File): Promise<ImageSize | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file, {
      resizeWidth: 1600,
      resizeQuality: 'low',
      imageOrientation: 'none',
    });
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    if (size.width < 1 || size.height < 1) return null;
    return size;
  } catch {
    return null;
  }
}

async function decodeScaled(file: File, width: number, height: number): Promise<DecodedImage> {
  const attempts: Array<[number, number]> = [];
  let w = Math.max(1, width);
  let h = Math.max(1, height);
  for (let i = 0; i < 3; i++) {
    attempts.push([w, h]);
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
  }

  let lastError: unknown;
  if (typeof createImageBitmap === 'function') {
    for (let i = 0; i < attempts.length; i++) {
      const [rw, rh] = attempts[i];
      try {
        const bitmap = await createImageBitmap(file, {
          resizeWidth: rw,
          resizeHeight: rh,
          resizeQuality: 'high',
          imageOrientation: 'none',
        });
        return {
          bitmap,
          storedWidth: bitmap.width || rw,
          storedHeight: bitmap.height || rh,
          reduced: i > 0,
        };
      } catch (err) {
        lastError = err;
      }
    }
  }

  try {
    const [rw, rh] = attempts[attempts.length - 1];
    const bitmap = await decodeViaElement(file, rw, rh);
    return { bitmap, storedWidth: rw, storedHeight: rh, reduced: true };
  } catch (err) {
    lastError = err;
  }

  if (lastError instanceof Error && lastError.message) {
    throw new Error('无法压缩这张图片，请换一张照片后重试');
  }
  throw new Error('无法压缩这张图片，请换一张照片后重试');
}

function decodeViaElement(file: File, width: number, height: number): Promise<ImageBitmap> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return Promise.reject(new Error('无法压缩这张图片，请换一张照片后重试'));
  }
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法压缩这张图片，请换一张照片后重试'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(createImageBitmap(canvas));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法压缩这张图片，请换一张照片后重试'));
    };
    img.src = url;
  });
}

function renderOriented(
  source: BitmapSource,
  orientation: number,
  displayWidth: number,
  displayHeight: number,
): DrawableCanvas {
  const swap = orientation >= 5 && orientation <= 8;
  const srcW = swap ? displayHeight : displayWidth;
  const srcH = swap ? displayWidth : displayHeight;
  const canvas = createCanvas(displayWidth, displayHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法压缩这张图片，请换一张照片后重试');

  const draw = ctx as DrawCtx;
  draw.fillStyle = '#ffffff';
  draw.fillRect(0, 0, displayWidth, displayHeight);
  draw.imageSmoothingEnabled = true;
  draw.imageSmoothingQuality = 'high';
  applyOrientation(draw, orientation, srcW, srcH);
  draw.drawImage(source, 0, 0, srcW, srcH);
  return canvas;
}

/** 与 JPEG Orientation 1–8 对应的画布变换，输出像素是正方向 */
function applyOrientation(ctx: DrawCtx, orientation: number, srcW: number, srcH: number): void {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, srcW, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, srcW, srcH);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, srcH);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, srcH, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, srcH, srcW);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, srcW);
      break;
    default:
      break;
  }
}

function createCanvas(width: number, height: number): DrawableCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToJpeg(canvas: DrawableCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('图片压缩失败'));
      },
      'image/jpeg',
      quality,
    );
  });
}

function releaseCanvas(canvas: DrawableCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}
