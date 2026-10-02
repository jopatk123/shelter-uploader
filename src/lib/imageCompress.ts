/**
 * 图片压缩工具
 * 上传的图片不限制数量与规格（像素比例），但统一在前端自动压缩：
 *   - 单张图片压缩到 300KB 以内
 *   - 优先保留分辨率：先尽量只降画质，必要时才降低尺寸
 *   - 尽量完整保留 EXIF（GPS、拍摄时间等元数据）
 */
import imageCompression from 'browser-image-compression';

/** 压缩阈值：超过此大小的图片才会被压缩 */
const TARGET_BYTES = 300 * 1024; // 300KB

/**
 * browser-image-compression 的 maxSizeMB 使用 MB（小数）单位
 * 300KB ≈ 0.293MB
 */
const TARGET_MB = TARGET_BYTES / 1024 / 1024;

/** 压缩起始画质：从高画质开始，优先靠降画质达标，其次才降尺寸 */
const INITIAL_QUALITY = 0.9;

/**
 * 判断图片是否需要压缩（超过 300KB 才压缩）
 */
export function shouldCompress(file: File): boolean {
  return file.size > TARGET_BYTES;
}

/**
 * 将图片压缩到 300KB 以内，尽量保留 EXIF 元数据
 *
 * 策略（优先保留分辨率）：
 * - 文件 <= 300KB：直接返回原文件，不做任何处理，100% 保留 EXIF
 * - 文件 > 300KB：使用 browser-image-compression 压缩
 *   - initialQuality 0.9：从高画质开始，库内部会优先迭代降低画质
 *   - 不设置 maxWidthOrHeight：不主动缩放尺寸，仅在画质降到底仍超标时才降尺寸
 *   - preserveExif: true  保留 EXIF 数据
 *   - useWebWorker: true   在 Worker 中处理，不阻塞 UI
 *
 * @returns 压缩后的 File（或原文件，如果不需要压缩）
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!shouldCompress(file)) {
    return file;
  }

  const compressed = await imageCompression(file, {
    maxSizeMB: TARGET_MB,
    useWebWorker: true,
    preserveExif: true,
    initialQuality: INITIAL_QUALITY,
  });

  // 确保文件名和类型保持不变
  return new File([compressed], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
}
