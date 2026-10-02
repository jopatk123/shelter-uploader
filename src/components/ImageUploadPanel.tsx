/**
 * 图片上传面板
 * 支持 jpg/png/webp，不限上传数量、不限尺寸规格（像素比例）
 * 超过压缩目标（默认 500KB，由后端 IMAGE_COMPRESS_TARGET_KB 下发）的图片在前端自动压缩到
 * 目标以内（大图先降到安全分辨率，EXIF 放得下才保留）；支持一次多选，队列串行上传
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import ProgressBar from '@/components/ProgressBar';
import { uploadFile, generateFileId, type UploadProgress } from '@/lib/upload';
import { compressImageIfNeeded, shouldCompress } from '@/lib/imageCompress';
import { getRuntimeConfig } from '@/lib/runtimeConfig';
import { formatFileSize } from '@/lib/utils';
import {
  checkImageReadable,
  hasGpsExif,
  checkBlackPixelRatio,
  MAX_BLACK_RATIO,
} from '@/lib/imageCheck';

interface Props {
  pointId: number | null;
  onUploadComplete: () => void;
  /**
   * 上传成功但存在图片不含 EXIF GPS 经纬度信息时触发
   * （仅对 JPEG 文件检测；用于提示用户上传相机/手机原图）
   */
  onMissingGps?: () => void;
}

/** 上传队列条目 */
interface QueueItem {
  /** 本地唯一标识 */
  key: string;
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: UploadProgress | null;
  error?: string;
}

const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

let seqCounter = 0;
function nextKey(): string {
  seqCounter += 1;
  return `img_${Date.now()}_${seqCounter}`;
}

export default function ImageUploadPanel({ pointId, onUploadComplete, onMissingGps }: Props) {
  // 压缩目标取自后端运行配置，避免提示文案与 IMAGE_COMPRESS_TARGET_KB 脱节
  const imageCompressTargetKB = getRuntimeConfig().imageCompressTargetKB;
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [successCount, setSuccessCount] = useState(0);
  // 队列处理锁：保证同一时刻只有一张图在上传（压缩/上传串行，避免 canvas 内存峰值）
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

  const patchItem = useCallback((key: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }, []);

  /** 上传队列中的单张图片：压缩 → 分片上传 → 更新状态 */
  const uploadOne = useCallback(
    async (item: QueueItem) => {
      const pid = pointIdRef.current;
      if (pid === null) return;

      patchItem(item.key, { status: 'uploading', error: undefined, progress: null });

      try {
        // 并行检测 EXIF GPS（不阻塞上传，仅用于上传后提示）
        // null：PNG/WEBP 等不适用，不提示；false：JPEG 没有经纬度
        const gpsCheckPromise = hasGpsExif(item.file).catch(() => false as const);

        // 超过压缩目标的图片先压缩（大图会先降到安全分辨率）
        if (shouldCompress(item.file)) {
          patchItem(item.key, {
            progress: { phase: 'compressing', percent: 0, message: '正在压缩图片（保留EXIF）...' },
          });
        }
        const fileToUpload = await compressImageIfNeeded(item.file);

        const fileId = generateFileId(fileToUpload);
        await uploadFile(fileToUpload, fileToUpload.name, pid, 'img', fileId, (progress) =>
          patchItem(item.key, { progress }),
        );

        patchItem(item.key, { status: 'done', progress: null });
        setSuccessCount((c) => c + 1);
        onUploadComplete();

        // 仅 JPEG 且不含 GPS 时提示；PNG/WEBP 返回 null，不弹窗
        const hasGps = await gpsCheckPromise;
        if (hasGps === false) onMissingGps?.();
      } catch (err) {
        patchItem(item.key, {
          status: 'error',
          error: err instanceof Error ? err.message : '上传失败',
        });
      }
    },
    [patchItem, onUploadComplete, onMissingGps],
  );

  // 串行消费队列：存在 pending 条目且当前无上传时，启动下一张
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

    for (const file of files) {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) {
        rejected.push({
          key: nextKey(),
          file,
          status: 'error',
          progress: null,
          error: `不支持的格式，仅支持 ${ALLOWED_EXTS.join(', ')}`,
        });
        continue;
      }

      // 校验图片可解码（拒绝损坏/伪造文件）
      try {
        await checkImageReadable(file);
      } catch {
        rejected.push({
          key: nextKey(),
          file,
          status: 'error',
          progress: null,
          error: '无法读取图片，文件可能已损坏，请更换图片重试',
        });
        continue;
      }

      // 校验纯黑像素占比（防止上传全黑/损坏图）
      try {
        const { ok, ratio, sampledPixels } = await checkBlackPixelRatio(file);
        if (!ok) {
          const percent = (ratio * 100).toFixed(2);
          const limitPercent = (MAX_BLACK_RATIO * 100).toFixed(0);
          rejected.push({
            key: nextKey(),
            file,
            status: 'error',
            progress: null,
            error: `纯黑像素占比 ${percent}% 超过 ${limitPercent}% 限制（采样 ${sampledPixels} 像素），可能为全黑/损坏图`,
          });
          continue;
        }
      } catch {
        // 黑像素校验失败不阻塞上传（后端仍会做可解析性校验兜底）
        console.warn('纯黑像素校验异常，跳过', file.name);
      }

      accepted.push({ key: nextKey(), file, status: 'pending', progress: null });
    }

    setItems((prev) => [...prev, ...rejected, ...accepted]);
    setSuccessCount(0);
    if (inputRef.current) inputRef.current.value = '';
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
          图片上传
        </h3>
        {doneCount > 0 && (
          <span className="text-xs text-status-green font-mono">本批已上传 {doneCount} 张</span>
        )}
      </div>

      <div className="text-xs text-base-400 mb-3 font-mono">
        格式: JPG / PNG / WEBP · 不限数量与规格 · 自动压缩至 {imageCompressTargetKB}KB 以内 ·
        纯黑像素 ≤ 10%
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp"
        multiple
        onChange={handleFileSelect}
        disabled={disabled}
        className="hidden"
        id="image-input"
      />

      <label
        htmlFor={disabled ? '' : 'image-input'}
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
          <p className="text-sm">点击选择图片（可多选）</p>
          <p className="text-xs text-base-400 mt-1">
            JPG / PNG / WEBP · 自动压缩至 {imageCompressTargetKB}KB 以内
          </p>
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
                  <ProgressBar
                    percent={item.progress.percent}
                    label={item.progress.message}
                    variant={item.progress.phase === 'compressing' ? 'compress' : 'default'}
                  />
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
          图片上传成功（本批 {successCount} 张）
        </div>
      )}
      {errorCount > 0 && successCount === 0 && items.every((it) => it.status !== 'uploading') && (
        <div className="mt-4 p-3 bg-status-red/10 border border-status-red/30 rounded text-sm text-status-red">
          本批图片全部失败（{errorCount} 张），请检查后重试
        </div>
      )}
    </div>
  );
}
