/**
 * 图片压缩工具
 * 上传的图片不限制数量与规格（像素比例），但统一在前端自动压缩：
 *   - 单张图片压缩到压缩目标以内（默认 500KB，由后端 IMAGE_COMPRESS_TARGET_KB 下发）
 *   - 优先保留分辨率：先尽量只降画质，必要时才降低尺寸
 *   - 尽量完整保留 EXIF（GPS、拍摄时间等元数据）
 *
 * 压缩目标故意低于服务端硬上限（IMAGE_MAX_SIZE_KB，默认 600KB），
 * 给极端图片的压缩结果留出冗余，避免边界情况下被服务端拒绝。
 */
import imageCompression from 'browser-image-compression';
import { getRuntimeConfig } from '@/lib/runtimeConfig';

/** 压缩起始画质：从高画质开始，优先靠降画质达标，其次才降尺寸 */
const INITIAL_QUALITY = 0.9;

/** 当前生效的图片压缩目标（字节） */
function targetBytes(): number {
  return getRuntimeConfig().imageCompressTargetKB * 1024;
}

/**
 * 判断图片是否需要压缩（超过压缩目标才压缩）
 */
export function shouldCompress(file: File): boolean {
  return file.size > targetBytes();
}

/**
 * 将图片压缩到压缩目标以内，尽量保留 EXIF 元数据
 *
 * 策略（优先保留分辨率）：
 * - 文件 <= 目标：直接返回原文件，不做任何处理，100% 保留 EXIF
 * - 文件 > 目标：使用 browser-image-compression 压缩
 *   - initialQuality 0.9：从高画质开始，库内部会优先迭代降低画质
 *   - 不设置 maxWidthOrHeight：不主动缩放尺寸，仅在画质降到底仍超标时才降尺寸
 *   - preserveExif: true  保留 EXIF 数据
 *   - useWebWorker: true   在 Worker 中处理，不阻塞 UI
 *
 * @returns 压缩后的 File（或原文件，如果不需要压缩）
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  const limitBytes = targetBytes();
  if (file.size <= limitBytes) {
    return file;
  }

  const compressed = await imageCompression(file, {
    maxSizeMB: limitBytes / 1024 / 1024,
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
