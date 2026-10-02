/**
 * 视频时长校验工具
 * 要求上传的视频时长 ≥ 10 秒，低于 10 秒不允许上传
 */

/** 最小允许时长（秒） */
export const MIN_VIDEO_DURATION = 10;

/**
 * 判断视频时长是否满足要求（≥ 10 秒）
 */
export function isDurationValid(duration: number): boolean {
  return duration >= MIN_VIDEO_DURATION;
}

/**
 * 校验视频文件时长
 * 通过 HTML5 <video> 元素加载元数据获取真实时长
 *
 * @returns 校验结果：ok 表示是否通过，duration 为视频时长（秒）
 */
export async function checkVideoDuration(file: File): Promise<{ ok: boolean; duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      resolve({ ok: isDurationValid(duration), duration });
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取视频时长，文件可能已损坏或格式不支持'));
    };

    video.src = url;
  });
}
