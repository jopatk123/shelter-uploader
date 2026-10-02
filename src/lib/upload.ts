/**
 * 分片上传工具
 * 支持分片切分、进度回调
 */
import { getRuntimeConfig } from '@/lib/runtimeConfig';

/** 素材类型：图片 / 视频（v2 起不分主备） */
export type UploadType = 'img' | 'video';

export interface UploadProgress {
  phase: 'idle' | 'compressing' | 'uploading' | 'merging' | 'done' | 'error';
  percent: number;
  message: string;
}

/**
 * 生成文件唯一标识
 * 使用 crypto.randomUUID() 保证全局唯一，避免时间戳 + 随机数在并发下碰撞
 * （fileId 决定分片临时目录，碰撞会导致不同文件的分片互相串写）
 */
export function generateFileId(file: File): string {
  const dotIndex = file.name.lastIndexOf('.');
  const ext = dotIndex >= 0 ? file.name.substring(dotIndex) : '';
  return `${crypto.randomUUID()}${ext}`;
}

/** 单片上传超时：弱网下 5MB 分片应在 120 秒内完成，超时视为本次尝试失败 */
const CHUNK_TIMEOUT_MS = 120 * 1000;

/** 单片失败后的自动重试次数（含首次共 3 次尝试） */
const CHUNK_RETRIES = 2;

/** 重试间隔基数（毫秒），按尝试次数线性退避 */
const RETRY_DELAY_MS = 1000;

/** 合并请求超时：大文件合并 + 服务端校验耗时较长 */
const COMPLETE_TIMEOUT_MS = 180 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带超时的 fetch（超时后中止请求）
 * 超时抛出语义化错误，便于上层提示
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('请求超时，请检查网络后重试');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 上传单个分片（失败自动重试）
 * - 网络异常 / 超时 / 5xx / 429（限流）：间隔后自动重试
 * - 4xx 参数类错误：重试也不会成功，立即失败
 */
async function uploadChunk(
  chunk: Blob,
  index: number,
  totalChunks: number,
  fileId: string,
  pointId: number,
  type: UploadType,
  fileName: string,
): Promise<void> {
  const maxAttempts = 1 + CHUNK_RETRIES;
  let lastError: Error = new Error(`分片 ${index} 上传失败`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await sleep(RETRY_DELAY_MS * attempt);
    }

    let giveUp = false;
    try {
      // FormData 需每次尝试重建（body 不可复用）
      const formData = new FormData();
      formData.append('chunk', chunk, `chunk-${index}`);
      formData.append('index', String(index));
      formData.append('totalChunks', String(totalChunks));
      formData.append('fileId', fileId);
      formData.append('pointId', String(pointId));
      formData.append('type', type);
      formData.append('fileName', fileName);

      const res = await fetchWithTimeout(
        '/api/upload/chunk',
        { method: 'POST', body: formData },
        CHUNK_TIMEOUT_MS,
      );

      if (res.ok) return;

      const err = (await res.json().catch(() => ({ error: '' }))) as { error?: string };
      lastError = new Error(err.error || `分片 ${index} 上传失败`);
      // 4xx（限流 429 除外）属于请求本身问题，重试无意义
      giveUp = res.status >= 400 && res.status < 500 && res.status !== 429;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('网络异常');
    }

    if (giveUp) break;
  }

  throw lastError;
}

/**
 * 通知后端合并文件（仅超时保护，不自动重试：
 * 成功后分片目录已被服务端删除，盲目重试会造成重复入库）
 */
async function completeUpload(
  fileId: string,
  pointId: number,
  type: UploadType,
  fileName: string,
  totalChunks: number,
): Promise<void> {
  const res = await fetchWithTimeout(
    '/api/upload/complete',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, pointId, type, fileName, totalChunks }),
    },
    COMPLETE_TIMEOUT_MS,
  );

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || '文件合并失败');
  }
}

/**
 * 执行分片上传
 */
export async function uploadFile(
  file: Blob,
  originalName: string,
  pointId: number,
  type: UploadType,
  fileId: string,
  onProgress: (progress: UploadProgress) => void,
): Promise<void> {
  // 分片大小取自后端配置，确保不超过后端 multer 的单片限制
  const chunkSize = getRuntimeConfig().chunkSizeMB * 1024 * 1024;
  const fileSize = file.size;
  const totalChunks = Math.ceil(fileSize / chunkSize);

  // 逐片上传
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, fileSize);
    const chunk = file.slice(start, end);

    await uploadChunk(chunk, i, totalChunks, fileId, pointId, type, originalName);

    const percent = Math.round(((i + 1) / totalChunks) * 100);
    onProgress({ phase: 'uploading', percent, message: `分片 ${i + 1}/${totalChunks} 上传中` });
  }

  // 通知合并
  onProgress({ phase: 'merging', percent: 100, message: '正在合并文件...' });
  await completeUpload(fileId, pointId, type, originalName, totalChunks);

  onProgress({ phase: 'done', percent: 100, message: '上传完成' });
}
