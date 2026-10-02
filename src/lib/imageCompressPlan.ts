/**
 * 压缩阶梯（纯函数，不碰画布）。
 *
 * 手机原图常见 1200 万～4800 万像素。若从原分辨率开始压：
 * - 移动端画布 / 内存直接失败
 * - 每轮只缩小约 5%，十轮后仍远超 500KB，库却把超标文件交出去
 *
 * 这里按目标体积估算一个安全的起始长边，再逐级缩小，并且长边和像素数
 * 都不超过移动端画布的安全范围。
 */

/** iOS / 微信 WebView 常见的画布长边上限 */
export const CANVAS_MAX_EDGE = 4096;

/** 单次解码像素上限（约 8MP，RGBA 约 32MB），避免大图把页面打崩 */
export const MAX_DECODE_PIXELS = 8_000_000;

/** 长边低于此值后不再缩小，只继续降画质 */
export const MIN_LONG_EDGE = 960;

/** JPEG APP1 最大约 64KB。超过就不预留，避免主体没空间可压 */
export const MAX_EXIF_RESERVE_BYTES = 64 * 1024;

/** 预留 EXIF 之后，主体至少还要有这么多预算，否则放弃 EXIF */
export const MIN_BODY_BUDGET_BYTES = 128 * 1024;

const QUALITY_LADDER = [0.82, 0.7, 0.58, 0.46];
const LAST_RESORT_QUALITY = 0.35;

export interface CompressStep {
  width: number;
  height: number;
  qualities: number[];
}

/** 含兜底画质的完整质量序列，解码被迫降采样时使用 */
export function allQualities(): number[] {
  return [...QUALITY_LADDER, LAST_RESORT_QUALITY];
}

/**
 * 计算图片主体的字节预算。
 * EXIF 放得进目标、且主体仍有足够空间时，从目标里扣掉 EXIF；否则用满整个目标。
 */
export function bodyBudgetForExif(targetBytes: number, exifBytes: number): number {
  if (exifBytes <= 0 || exifBytes > MAX_EXIF_RESERVE_BYTES) return targetBytes;
  if (targetBytes - exifBytes < MIN_BODY_BUDGET_BYTES) return targetBytes;
  return targetBytes - exifBytes;
}

/**
 * 规划从大到小的压缩阶梯。尺寸已是显示方向（EXIF 旋转之后）的宽高。
 * 不会把图片放大。
 */
export function planCompressionSteps(
  width: number,
  height: number,
  fileSize: number,
  bodyBudget: number,
): CompressStep[] {
  if (width < 1 || height < 1) {
    throw new Error('图片尺寸无效');
  }
  if (bodyBudget < 1) {
    throw new Error('压缩目标无效');
  }

  const longEdge = Math.max(width, height);
  const minLong = Math.min(longEdge, MIN_LONG_EDGE);
  const areaRatio = Math.min(1, (bodyBudget / Math.max(fileSize, 1)) * 1.15);
  let scale = Math.min(1, Math.max(0.2, Math.sqrt(areaRatio) * 1.2));

  const steps: CompressStep[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < 8; i++) {
    let w = Math.max(1, Math.round(width * scale));
    let h = Math.max(1, Math.round(height * scale));
    const reachedFloor = Math.max(w, h) < minLong;
    if (reachedFloor) {
      const fittedScale = minLong / longEdge;
      w = Math.max(1, Math.round(width * fittedScale));
      h = Math.max(1, Math.round(height * fittedScale));
    }

    const fitted = fitWithinLimits(w, h);
    const key = `${fitted.width}x${fitted.height}`;
    const atFloor = reachedFloor || Math.max(fitted.width, fitted.height) <= minLong;
    if (!seen.has(key)) {
      seen.add(key);
      steps.push({
        width: fitted.width,
        height: fitted.height,
        qualities: atFloor ? allQualities() : [...QUALITY_LADDER],
      });
    }
    if (atFloor) break;
    scale *= 0.75;
  }

  return steps;
}

/** 压缩后的文件名：超标图片统一编码为 JPEG */
export function toJpegFileName(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const dot = name.lastIndexOf('.');
  const base = dot > slash ? name.slice(0, dot) : name;
  return `${base}.jpg`;
}

function fitWithinLimits(width: number, height: number): { width: number; height: number } {
  let w = width;
  let h = height;
  const longEdge = Math.max(w, h);
  if (longEdge > CANVAS_MAX_EDGE) {
    const scale = CANVAS_MAX_EDGE / longEdge;
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
  }
  const pixels = w * h;
  if (pixels > MAX_DECODE_PIXELS) {
    const scale = Math.sqrt(MAX_DECODE_PIXELS / pixels);
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
  }
  return { width: w, height: h };
}
