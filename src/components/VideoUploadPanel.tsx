/**
 * 视频上传面板
 * 仅 mp4，不限上传数量，单文件上限 80MB（可通过后端环境变量 VIDEO_MAX_SIZE_MB 配置）
 * 视频时长必须 ≥ 10 秒，低于 10 秒不允许上传
 * 不做任何压缩，分片上传；支持一次多选，队列串行上传
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import ProgressBar from '@/components/ProgressBar';
import { uploadFile, generateFileId, type UploadProgress } from '@/lib/upload';
import { checkVideoDuration, MIN_VIDEO_DURATION } from '@/lib/videoCheck';
import { formatFileSize } from '@/lib/utils';
import { getRuntimeConfig } from '@/lib/runtimeConfig';

interface Props {
  pointId: number | null;
  onUploadComplete: () => void;
  /** 有视频超过大小上限时触发（弹出压缩指引） */
  onOverLimit: () => void;
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

export default function VideoUploadPanel({ pointId, onUploadComplete, onOverLimit }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [successCount, setSuccessCount] = useState(0);
  // 队列处理锁：保证同一时刻只有一个视频在上传
  const processingRef = useRef(false);
  // 供上传闭包读取最新 pointId（切换点位时队列已重置，不会串点位）
  const pointIdRef = useRef(pointId);
  pointIdRef.current = pointId;

  // 切换点位时重置面板状态
  useEffect(() => {
    setItems([]);
    setSuccessCount(0);
    if (inputRef.current) inputRef.current.value = '';
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
        setSuccessCount((c) => c + 1);
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
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

      // 校验视频时长：必须 ≥ 10 秒
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
    setSuccessCount(0);
    if (inputRef.current) inputRef.current.value = '';
    if (overLimit) onOverLimit();
  };

  const retryItem = (key: string) => {
    patchItem(key, { status: 'pending', error: undefined, progress: null });
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((it) => it.key !== key));
  };

  const doneCount = items.filter((it) => it.status === 'done').length;
  const errorCount = items.filter((it) => it.status === 'error').length;

  return (
    <div
      className={`bg-base-700 border border-base-600 rounded-lg p-5 ${disabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-sm text-base-100 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent"></span>
          视频上传
        </h3>
        {doneCount > 0 && (
          <span className="text-xs text-status-green font-mono">本批已上传 {doneCount} 个</span>
        )}
      </div>

      <div className="text-xs text-base-400 mb-3 font-mono">
        格式: MP4 · 不限数量 · 单文件上限 {videoMaxSizeMB}MB · 时长 ≥ 10秒
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".mp4,video/mp4"
        multiple
        onChange={handleFileSelect}
        disabled={disabled}
        className="hidden"
        id="video-input"
      />

      <label
        htmlFor={disabled ? '' : 'video-input'}
        className={`
          block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all
          ${
            disabled
              ? 'border-base-600 cursor-not-allowed'
              : 'border-base-500 hover:border-accent hover:bg-base-600/30'
          }
        `}
      >
        <div className="text-base-300">
          <p className="text-sm">点击选择视频（可多选）</p>
          <p className="text-xs text-base-400 mt-1">MP4 · 最大 {videoMaxSizeMB}MB · ≥ 10秒</p>
        </div>
      </label>

      {/* 上传队列 */}
      {items.length > 0 && (
        <div className="mt-4 space-y-2">
          {items.map((item) => (
            <div
              key={item.key}
              className="p-3 bg-base-800 border border-base-600 rounded text-xs font-mono"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-base-200 truncate" title={item.file.name}>
                  {item.file.name}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-base-400">{formatFileSize(item.file.size)}</span>
                  {item.status === 'pending' && <span className="text-base-400">排队中</span>}
                  {item.status === 'uploading' && (
                    <span className="text-accent flex items-center gap-1">
                      <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                      上传中
                    </span>
                  )}
                  {item.status === 'done' && <span className="text-status-green">✓ 完成</span>}
                  {item.status === 'error' && (
                    <>
                      <span className="text-status-red">✗ 失败</span>
                      <button
                        onClick={() => retryItem(item.key)}
                        className="px-2 py-0.5 bg-status-red/20 text-status-red rounded hover:bg-status-red/30 transition-colors"
                      >
                        重试
                      </button>
                    </>
                  )}
                  {(item.status === 'pending' || item.status === 'error') && (
                    <button
                      onClick={() => removeItem(item.key)}
                      className="px-2 py-0.5 text-base-400 hover:text-base-100 transition-colors"
                      title="移除该条目"
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
              {item.status === 'uploading' && item.progress && (
                <div className="mt-2">
                  <ProgressBar percent={item.progress.percent} label={item.progress.message} />
                </div>
              )}
              {item.status === 'error' && item.error && (
                <p className="mt-1 text-status-red break-all">{item.error}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 汇总状态 */}
      {successCount > 0 && (
        <div className="mt-4 p-3 bg-status-green/10 border border-status-green/30 rounded text-sm text-status-green">
          视频上传成功（本批 {successCount} 个）
        </div>
      )}
      {errorCount > 0 && successCount === 0 && items.every((it) => it.status !== 'uploading') && (
        <div className="mt-4 p-3 bg-status-red/10 border border-status-red/30 rounded text-sm text-status-red">
          本批视频全部失败（{errorCount} 个），请检查后重试
        </div>
      )}
    </div>
  );
}
