/**
 * 图片压缩工具
 * 超过 10MB 的图片在浏览器端压缩到 10MB 以内再上传
 * 尽量完整保留 EXIF（GPS、拍摄时间等元数据）
 */
import imageCompression from 'browser-image-compression';

/** 压缩阈值：超过此大小的图片才会被压缩 */
const COMPRESS_THRESHOLD = 10 * 1024 * 1024; // 10MB

/** 压缩目标大小：压缩后文件不超过 10MB */
const COMPRESS_TARGET = 10; // MB

/**
 * 判断图片是否需要压缩
 */
export function shouldCompress(file: File): boolean {
  return file.size > COMPRESS_THRESHOLD;
}

/**
 * 压缩图片到 10MB 以内，尽量保留 EXIF 元数据
 *
 * 策略：
 * - 文件 <= 10MB：直接返回原文件，不做任何处理，100% 保留 EXIF
 * - 文件 > 10MB：使用 browser-image-compression 压缩
 *   - preserveExif: true  保留 EXIF 数据
 *   - useWebWorker: true   在 Worker 中处理，不阻塞 UI
 *   - 自动迭代降低 quality / dimension 直至目标大小
 *
 * @returns 压缩后的 File（或原文件，如果不需要压缩）
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!shouldCompress(file)) {
    return file;
  }

  const compressed = await imageCompression(file, {
    maxSizeMB: COMPRESS_TARGET,
    useWebWorker: true,
    preserveExif: true,
    initialQuality: 0.85,
  });

  // 确保文件名和类型保持不变
  return new File([compressed], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
}
