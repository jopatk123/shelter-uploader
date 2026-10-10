/**
 * 视频上传面板
 * 仅 mp4，不限上传数量，单文件上限 80MB（可通过后端环境变量 VIDEO_MAX_SIZE_MB 配置）
 * 视频时长必须 ≥ 5 秒，低于 5 秒不允许上传
 * 不做任何压缩，分片上传；支持点击多选与拖放，队列串行上传
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import UploadDropzone from '@/components/UploadDropzone';
import UploadQueue, { type QueueItemView } from '@/components/UploadQueue';
import { uploadFile, generateFileId, type UploadProgress } from '@/lib/upload';
import { checkVideoDuration, MIN_VIDEO_DURATION } from '@/lib/videoCheck';
import { getRuntimeConfig } from '@/lib/runtimeConfig';

interface Props {
  pointId: number | null;
  onUploadComplete: () => void;
  /** 有视频超过大小上限时触发（弹出压缩指引） */
  onOverLimit: () => void;
  /** 未选择点位时，空状态 CTA 的回调（由页面把焦点交给点位选择器） */
  onRequestPoint: () => void;
}

/** 上传队列条目 */
interface QueueItem {
  key: string;
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: UploadProgress | null;
  error?: string;
}

const ALLOWED_EXTS = ['.mp4'];

let seqCounter = 0;
function nextKey(): string {
  seqCounter += 1;
  return `video_${Date.now()}_${seqCounter}`;
}

export default function VideoUploadPanel({
  pointId,
  onUploadComplete,
  onOverLimit,
  onRequestPoint,
}: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  // 队列处理锁：保证同一时刻只有一个视频在上传
  const processingRef = useRef(false);
  // 供上传闭包读取最新 pointId（切换点位时队列已重置，不会串点位）
  const pointIdRef = useRef(pointId);
  pointIdRef.current = pointId;

  // 切换点位时重置面板状态（父组件亦会通过 key 重挂载，此处保证面板自包含）
  useEffect(() => {
    setItems([]);
  }, [pointId]);

  const disabled = pointId === null;
  // 单文件上限取自后端运行配置，避免与后端 VIDEO_MAX_SIZE_MB 脱节
  const videoMaxSizeMB = getRuntimeConfig().videoMaxSizeMB;

  const patchItem = useCallback((key: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }, []);

  /** 上传队列中的单个视频：分片上传 → 更新状态 */
  const uploadOne = useCallback(
    async (item: QueueItem) => {
      const pid = pointIdRef.current;
      if (pid === null) return;

      patchItem(item.key, { status: 'uploading', error: undefined, progress: null });

      try {
        const fileId = generateFileId(item.file);
        await uploadFile(item.file, item.file.name, pid, 'video', fileId, (progress) =>
          patchItem(item.key, { progress }),
        );

        patchItem(item.key, { status: 'done', progress: null });
        onUploadComplete();
      } catch (err) {
        patchItem(item.key, {
          status: 'error',
          error: err instanceof Error ? err.message : '上传失败',
        });
      }
    },
    [patchItem, onUploadComplete],
  );

  // 串行消费队列：存在 pending 条目且当前无上传时，启动下一个
  useEffect(() => {
    if (processingRef.current) return;
    const next = items.find((it) => it.status === 'pending');
    if (!next) return;

    processingRef.current = true;
    void (async () => {
      try {
        await uploadOne(next);
      } finally {
        processingRef.current = false;
      }
    })();
  }, [items, uploadOne]);

  /** 点击选择与拖放共用同一入口：校验通过者入队，被拦截者落成失败条目并写明原因 */
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const accepted: QueueItem[] = [];
    const rejected: QueueItem[] = [];
    let overLimit = false;

    for (const file of files) {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) {
        rejected.push({
          key: nextKey(),
          file,
          status: 'error',
          progress: null,
          error: '不支持的视频格式，仅支持 MP4',
        });
        continue;
      }

      // 校验大小：超过上限的文件拦截（弹窗指引压缩），不入队
      if (file.size >= videoMaxSizeMB * 1024 * 1024) {
        overLimit = true;
        rejected.push({
          key: nextKey(),
          file,
          status: 'error',
          progress: null,
          error: `视频超过 ${videoMaxSizeMB}MB 限制，请压缩后上传`,
        });
        continue;
      }

      // 校验视频时长：必须 ≥ 5 秒
      try {
        const { ok, duration } = await checkVideoDuration(file);
        if (!ok) {
          rejected.push({
            key: nextKey(),
            file,
            status: 'error',
            progress: null,
            error: `视频时长必须 ≥ ${MIN_VIDEO_DURATION} 秒才能上传，当前时长 ${duration.toFixed(1)} 秒`,
          });
          continue;
        }
      } catch {
        rejected.push({
          key: nextKey(),
          file,
          status: 'error',
          progress: null,
          error: '无法读取视频时长，文件可能已损坏，请更换视频重试',
        });
        continue;
      }

      accepted.push({ key: nextKey(), file, status: 'pending', progress: null });
    }

    setItems((prev) => [...prev, ...rejected, ...accepted]);
    if (overLimit) onOverLimit();
  };

  const retryItem = (key: string) => {
    patchItem(key, { status: 'pending', error: undefined, progress: null });
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((it) => it.key !== key));
  };

  const clearFinished = () => {
    setItems((prev) => prev.filter((it) => it.status !== 'done'));
  };

  const queueItems: QueueItemView[] = items.map((it) => ({
    key: it.key,
    name: it.file.name,
    size: it.file.size,
    status: it.status,
    progress: it.progress,
    error: it.error,
  }));

  return (
    <div className="flex flex-col rounded-lg border border-base-600 bg-base-700 p-5">
      <h3 className="mb-3 flex items-center gap-2 font-mono text-sm text-base-100">
        <span className="h-2 w-2 rounded-full bg-accent"></span>
        视频上传
      </h3>

      <UploadDropzone
        id="video-input"
        accept=".mp4,video/mp4"
        disabled={disabled}
        title="拖拽到此处，或点击选择"
        hint="不限个数 · 支持多选"
        onRequestPoint={onRequestPoint}
        onFiles={handleFiles}
      />

      <UploadQueue
        items={queueItems}
        unit="个"
        onRetry={retryItem}
        onRemove={removeItem}
        onClearFinished={clearFinished}
        progressVariantFor={() => 'default'}
      />
    </div>
  );
}
