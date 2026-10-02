/**
 * 分片上传工具
 * 支持分片切分、进度回调
 */

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB 分片

/** 素材类型：主图 / 备选图 / 主视频 / 备选视频 */
export type UploadType = 'img' | 'img_alt' | 'video' | 'video_alt';

export interface UploadProgress {
  phase: 'idle' | 'compressing' | 'uploading' | 'merging' | 'done' | 'error';
  percent: number;
  message: string;
}

/**
 * 生成文件唯一标识
 */
export function generateFileId(file: File): string {
  const ext = file.name.substring(file.name.lastIndexOf('.'));
  return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext}`;
}

/**
 * 上传单个分片
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
  const formData = new FormData();
  formData.append('chunk', chunk, `chunk-${index}`);
  formData.append('index', String(index));
  formData.append('totalChunks', String(totalChunks));
  formData.append('fileId', fileId);
  formData.append('pointId', String(pointId));
  formData.append('type', type);
  formData.append('fileName', fileName);

  const res = await fetch('/api/upload/chunk', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '分片上传失败' }));
    throw new Error(err.error || `分片 ${index} 上传失败`);
  }
}

/**
 * 通知后端合并文件
 */
async function completeUpload(
  fileId: string,
  pointId: number,
  type: UploadType,
  fileName: string,
  totalChunks: number,
): Promise<void> {
  const res = await fetch('/api/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, pointId, type, fileName, totalChunks }),
  });

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
  const fileSize = file.size;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

  // 逐片上传
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fileSize);
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
