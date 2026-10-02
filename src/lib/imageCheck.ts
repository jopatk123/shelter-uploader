/**
 * 图片校验工具
 * - EXIF GPS 检测：提示用户上传原图（勿经微信/QQ 转发）
 * - 纯黑像素占比校验：防止全黑/损坏图入库
 *
 * 注意：不再限制图片像素比例，普通相机/手机照片均可上传。
 */
import { readImageSizeFromFile, type ImageSize } from '@/lib/imageSize';

/**
 * 校验图片文件是否可正常解码并读取尺寸。
 * 尺寸来自文件头；解码时把长边缩到 64 像素，只验证文件能打开，
 * 避免上传前把手机原图按全分辨率展开一次。
 *
 * @returns 校验结果：ok 表示是否成功读取尺寸，width/height 为图片原始尺寸
 */
export async function checkImageReadable(
  file: File,
): Promise<{ ok: boolean; width: number; height: number }> {
  const headerSize = await readImageSizeFromFile(file);

  // 优先使用 createImageBitmap（性能好，不污染 DOM）
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await decodeForReadableCheck(file, headerSize);
      const width = headerSize?.width ?? bitmap.width;
      const height = headerSize?.height ?? bitmap.height;
      bitmap.close();
      if (width < 1 || height < 1) {
        throw new Error('无法读取图片尺寸，文件可能已损坏');
      }
      return { ok: true, width, height };
    } catch {
      // createImageBitmap 失败（如格式不支持），回退到 Image 元素
    }
  }

  // 回退方案：通过 Image 元素 + URL.createObjectURL 读取尺寸
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { naturalWidth, naturalHeight } = img;
      URL.revokeObjectURL(url);
      resolve({ ok: true, width: naturalWidth, height: naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取图片尺寸，文件可能已损坏'));
    };
    img.src = url;
  });
}

// ────────────────── EXIF GPS 检测 ──────────────────
//
// 用户提示：相机/手机原图通常含 EXIF GPS 经纬度信息；
// 若图片经过微信/QQ 等工具发送，EXIF 通常被剥离。
// 上传成功后若无 GPS，将提示用户尽量上传原图。
//
// 仅检测 JPEG（相机原图默认 JPEG），PNG/WEBP 跳过检测不提示。

const JPEG_SOI = 0xd8; // Start of Image
const JPEG_APP1 = 0xe1; // APP1 段（EXIF / XMP）
const JPEG_SOS = 0xda; // Start of Scan（之后为压缩数据）

const EXIF_TIFF_TAG_GPS_IFD = 0x8825;
const EXIF_GPS_TAG_LATITUDE = 0x0002;
const EXIF_GPS_TAG_LONGITUDE = 0x0004;

/** 文件名/MIME 看起来像 JPEG */
function looksLikeJpeg(file: File): boolean {
  const lower = file.name.toLowerCase();
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || file.type === 'image/jpeg';
}

/**
 * 检测 JPEG 文件是否包含 EXIF GPS 经纬度信息
 *
 * 通过解析 JPEG 的 APP1(Exif) 段，查找 GPS IFD 中是否存在
 * GPSLatitude(0x0002) 与 GPSLongitude(0x0004) 标签。
 *
 * 仅支持 JPEG。PNG/WEBP 等其他格式返回 null，表示不适用，调用方不要据此弹提示。
 * JPEG 解析失败或没有经纬度返回 false。
 */
export async function hasGpsExif(file: File): Promise<boolean | null> {
  if (!looksLikeJpeg(file)) return null;

  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    // JPEG 必须以 FF D8 开头
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== JPEG_SOI) return false;

    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      // 跳过 0xFF 填充字节
      let marker = bytes[offset + 1];
      while (marker === 0xff && offset + 2 < bytes.length) {
        offset += 1;
        marker = bytes[offset + 1];
      }

      // standalone markers（无段长度）
      if (marker >= 0xd0 && marker <= 0xd9) {
        offset += 2;
        continue;
      }

      const segLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (segLength < 2 || offset + 2 + segLength > bytes.length) break;

      // APP1 段：检查是否为 EXIF
      if (marker === JPEG_APP1 && segLength >= 8) {
        const exifIdOffset = offset + 4;
        if (
          bytes[exifIdOffset] === 0x45 && // E
          bytes[exifIdOffset + 1] === 0x78 && // x
          bytes[exifIdOffset + 2] === 0x69 && // i
          bytes[exifIdOffset + 3] === 0x66 && // f
          bytes[exifIdOffset + 4] === 0x00 &&
          bytes[exifIdOffset + 5] === 0x00
        ) {
          const tiffOffset = exifIdOffset + 6;
          if (checkGpsInTiff(view, tiffOffset)) return true;
        }
      }

      offset += 2 + segLength;
      if (marker === JPEG_SOS) break; // 之后为压缩数据，无 APP 段
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * 在 TIFF 数据中查找 GPS IFD，检查是否同时含经纬度标签
 */
function checkGpsInTiff(view: DataView, tiffOffset: number): boolean {
  if (tiffOffset + 8 > view.byteLength) return false;

  // 字节序：II(0x4949)=小端，MM(0x4d4d)=大端
  const byteOrder = view.getUint16(tiffOffset);
  const littleEndian = byteOrder === 0x4949;
  if (!littleEndian && byteOrder !== 0x4d4d) return false;

  const readU16 = (offset: number) => view.getUint16(offset, littleEndian);
  const readU32 = (offset: number) => view.getUint32(offset, littleEndian);

  // TIFF magic = 0x002A
  if (readU16(tiffOffset + 2) !== 0x002a) return false;

  // IFD0 偏移（相对 TIFF 起始）
  const ifd0Offset = tiffOffset + readU32(tiffOffset + 4);
  if (ifd0Offset + 2 > view.byteLength) return false;

  const ifd0Count = readU16(ifd0Offset);
  let gpsIfdPointer = 0;

  for (let i = 0; i < ifd0Count; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = readU16(entryOffset);
    if (tag === EXIF_TIFF_TAG_GPS_IFD) {
      gpsIfdPointer = readU32(entryOffset + 8);
      break; // 找到 GPS IFD 即可
    }
  }

  if (gpsIfdPointer === 0) return false;

  const gpsIfdOffset = tiffOffset + gpsIfdPointer;
  if (gpsIfdOffset + 2 > view.byteLength) return false;

  const gpsCount = readU16(gpsIfdOffset);
  let hasLat = false;
  let hasLon = false;

  for (let i = 0; i < gpsCount; i++) {
    const entryOffset = gpsIfdOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = readU16(entryOffset);
    if (tag === EXIF_GPS_TAG_LATITUDE) hasLat = true;
    else if (tag === EXIF_GPS_TAG_LONGITUDE) hasLon = true;
    if (hasLat && hasLon) return true;
  }

  return hasLat && hasLon;
}

// ────────────────── 纯黑像素占比校验 ──────────────────
//
// 防御性校验：部分夜景或损坏图存在大片纯黑区域，
// 这类图片对点位采集无价值。校验图片中纯黑像素占比，超过阈值则拒绝上传。
//
// 设计权衡：
// - 前端用 Canvas 解码像素做精确校验，用户立即得到反馈
// - 后端不重复校验（解码 JPEG/WEBP 像素需引入第三方依赖，与项目"避免膨胀"原则冲突）
// - "纯黑"严格定义为 RGB(0,0,0)；提供 BLACK_THRESHOLD 常量便于后续放宽到近黑

/** 纯黑像素占比上限（超过则拒绝上传） */
export const MAX_BLACK_RATIO = 0.1;

/** "纯黑"判定阈值：三通道 RGB 值均 ≤ 此值视为纯黑（默认 0 = 严格 RGB(0,0,0)） */
export const BLACK_THRESHOLD = 0;

/**
 * 统计 RGBA 像素数据中纯黑像素的数量与占比
 *
 * 纯函数：仅依赖输入数据，无副作用，便于单元测试。
 * 输入为 Canvas getImageData 返回的 Uint8ClampedArray / Uint8Array，
 * 每 4 字节表示一个像素的 R、G、B、A。
 *
 * @param data     RGBA 像素数据
 * @param threshold 三通道 RGB 值均 ≤ 此值视为纯黑（默认 0）
 * @returns { black, total, ratio } black=纯黑像素数，total=总像素数，ratio=占比（0~1）
 */
export function countBlackPixels(
  data: Uint8ClampedArray | Uint8Array,
  threshold: number = BLACK_THRESHOLD,
): { black: number; total: number; ratio: number } {
  const total = Math.floor(data.length / 4);
  if (total === 0) return { black: 0, total: 0, ratio: 0 };

  let black = 0;
  for (let i = 0; i < total; i++) {
    const offset = i * 4;
    // 透明像素不计入（A=0 时 RGB 通常为 0 但视觉上不是黑色）
    if (data[offset + 3] === 0) continue;
    if (
      data[offset] <= threshold &&
      data[offset + 1] <= threshold &&
      data[offset + 2] <= threshold
    ) {
      black++;
    }
  }
  return { black, total, ratio: black / total };
}

/** 降采样最大边长：超过此尺寸的图片会缩放到此尺寸内再统计，避免大图卡 UI */
const BLACK_CHECK_MAX_DIMENSION = 2048;

/**
 * 校验图片纯黑像素占比是否在阈值内
 *
 * 实现细节：
 * - 通过 Canvas drawImage 解码图片到 canvas
 * - 大图降采样到最大边 2048 像素内（保持原始比例），降低内存与计算量
 * - 使用 getImageData 读取像素，调用 countBlackPixels 统计
 * - 任何解码异常均视为「无法校验」，放行上传（避免误伤）
 *
 * @returns { ok, ratio, sampledPixels }
 *   - ok: true 表示通过校验（占比 ≤ MAX_BLACK_RATIO）；false 表示超限应拒绝
 *   - ratio: 纯黑像素占比（0~1）
 *   - sampledPixels: 采样像素总数（降采样后）
 */
export async function checkBlackPixelRatio(
  file: File,
): Promise<{ ok: boolean; ratio: number; sampledPixels: number }> {
  try {
    const bitmap = await loadBitmapForSampling(file);
    const { width, height } = bitmap;

    // 降采样：保持原始宽高比，最大边不超过 BLACK_CHECK_MAX_DIMENSION
    const maxDim = Math.max(width, height);
    const scale = maxDim > BLACK_CHECK_MAX_DIMENSION ? BLACK_CHECK_MAX_DIMENSION / maxDim : 1;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      // 无法获取 canvas 上下文（极少见），放行
      return { ok: true, ratio: 0, sampledPixels: 0 };
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    const imageData = ctx.getImageData(0, 0, targetW, targetH);
    const { total, ratio } = countBlackPixels(imageData.data);

    // 释放资源
    if ('close' in bitmap && typeof bitmap.close === 'function') {
      bitmap.close();
    }

    return { ok: ratio <= MAX_BLACK_RATIO, ratio, sampledPixels: total };
  } catch {
    // 解码失败：放行（其他校验会兜底）
    return { ok: true, ratio: 0, sampledPixels: 0 };
  }
}

/**
 * 加载图片为 ImageBitmap 或 HTMLImageElement，供 Canvas 绘制使用
 * 优先用 createImageBitmap（性能更好），失败时回退到 Image + createObjectURL
 */
async function loadBitmapForSampling(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      const size = await readImageSizeFromFile(file);
      if (size) {
        const maxDim = Math.max(size.width, size.height);
        const scale = maxDim > BLACK_CHECK_MAX_DIMENSION ? BLACK_CHECK_MAX_DIMENSION / maxDim : 1;
        try {
          return await createImageBitmap(file, {
            imageOrientation: 'from-image',
            resizeQuality: 'low',
            resizeWidth: Math.max(1, Math.round(size.width * scale)),
            resizeHeight: Math.max(1, Math.round(size.height * scale)),
          });
        } catch {
          return await createImageBitmap(file);
        }
      }
      return await createImageBitmap(file);
    } catch {
      // fallthrough to Image fallback
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法解码图片'));
    };
    img.src = url;
  });
}

/** 能读到文件头时按长边 64 像素解码，只证明文件可打开 */
async function decodeForReadableCheck(file: File, headerSize: ImageSize | null): Promise<ImageBitmap> {
  if (!headerSize) return createImageBitmap(file);

  const longEdge = Math.max(headerSize.width, headerSize.height);
  const scale = longEdge > 64 ? 64 / longEdge : 1;
  try {
    return await createImageBitmap(file, {
      imageOrientation: 'from-image',
      resizeQuality: 'low',
      resizeWidth: Math.max(1, Math.round(headerSize.width * scale)),
      resizeHeight: Math.max(1, Math.round(headerSize.height * scale)),
    });
  } catch {
    return createImageBitmap(file);
  }
}
