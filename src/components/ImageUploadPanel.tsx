/**
 * 图片上传面板
 * 支持 jpg/png/webp，不限上传数量、不限尺寸规格（像素比例）
 * 超过压缩目标（默认 500KB，由后端 IMAGE_COMPRESS_TARGET_KB 下发）的图片在前端自动压缩到
 * 目标以内（大图先降到安全分辨率，EXIF 放得下才保留）；支持点击多选与拖放，队列串行上传
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import UploadDropzone from '@/components/UploadDropzone';
import UploadQueue, { type QueueItemView } from '@/components/UploadQueue';
import { uploadFile, generateFileId, type UploadProgress } from '@/lib/upload';
import { compressImageIfNeeded, shouldCompress } from '@/lib/imageCompress';
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
  /** 未选择点位时，空状态 CTA 的回调（由页面把焦点交给点位选择器） */
  onRequestPoint: () => void;
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

export default function ImageUploadPanel({
  pointId,
  onUploadComplete,
  onMissingGps,
  onRequestPoint,
}: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  // 队列处理锁：保证同一时刻只有一张图在上传（压缩/上传串行，避免 canvas 内存峰值）
  const processingRef = useRef(false);
  // 供上传闭包读取最新 pointId（切换点位时队列已重置，不会串点位）
  const pointIdRef = useRef(pointId);
  pointIdRef.current = pointId;

  // 切换点位时重置面板状态（父组件亦会通过 key 重挂载，此处保证面板自包含）
  useEffect(() => {
    setItems([]);
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

  /** 点击选择与拖放共用同一入口：校验通过者入队，被拦截者落成失败条目并写明原因 */
  const handleFiles = async (files: File[]) => {
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
      } catch (err) {
        rejected.push({
          key: nextKey(),
          file,
          status: 'error',
          progress: null,
          error: err instanceof Error ? err.message : '无法校验图片是否为纯黑，请更换图片重试',
        });
        continue;
      }

      accepted.push({ key: nextKey(), file, status: 'pending', progress: null });
    }

    setItems((prev) => [...prev, ...rejected, ...accepted]);
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
        图片上传
      </h3>

      <UploadDropzone
        id="image-input"
        accept=".jpg,.jpeg,.png,.webp"
        disabled={disabled}
        title="拖拽到此处，或点击选择"
        hint="不限张数与规格 · 支持多选"
        onRequestPoint={onRequestPoint}
        onFiles={handleFiles}
      />

      <UploadQueue
        items={queueItems}
        unit="张"
        onRetry={retryItem}
        onRemove={removeItem}
        onClearFinished={clearFinished}
        progressVariantFor={(phase) => (phase === 'compressing' ? 'compress' : 'default')}
      />
    </div>
  );
}
