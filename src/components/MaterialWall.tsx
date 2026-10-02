/**
 * 素材墙组件
 * 展示当前选中点位已上传的全部素材（数量不限）：
 *   - 图片缩略图网格，点击打开灯箱查看原图（公开预览端点，免鉴权）
 *   - 视频内嵌播放器（公开端点支持 HTTP Range 流式播放，可拖动进度条）
 *   - 每项支持删除（确认弹窗防误删）
 *   - 每项支持替换：选择新文件 → 校验/压缩 → 上传新素材 → 成功后删除旧素材
 *     （先传新后删旧：任一步失败都不会丢失旧素材）
 */
import { useState, useRef, useEffect } from 'react';
import ProgressBar from '@/components/ProgressBar';
import ConfirmDialog from '@/components/ConfirmDialog';
import { deletePointMaterial, materialFileUrl } from '@/lib/api';
import { uploadFile, generateFileId, type UploadProgress } from '@/lib/upload';
import { compressImageIfNeeded, shouldCompress } from '@/lib/imageCompress';
import { checkImageReadable, checkBlackPixelRatio, MAX_BLACK_RATIO } from '@/lib/imageCheck';
import { checkVideoDuration, MIN_VIDEO_DURATION } from '@/lib/videoCheck';
import { formatFileSize, formatBeijingTime } from '@/lib/utils';
import type { MaterialItem } from '@/types';

interface Props {
  pointId: number;
  materials: MaterialItem[];
  loading: boolean;
  /** 删除/替换成功后触发（刷新点位统计与素材列表） */
  onChanged: () => void;
}

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const VIDEO_EXTS = ['.mp4'];
const VIDEO_MAX_SIZE = 100 * 1024 * 1024; // 100MB，与后端 VIDEO_MAX_SIZE_MB 默认值一致

export default function MaterialWall({ pointId, materials, loading, onChanged }: Props) {
  const [deleteTarget, setDeleteTarget] = useState<MaterialItem | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // 替换中的素材 id 与进度
  const [busyId, setBusyId] = useState<number | null>(null);
  const [replaceProgress, setReplaceProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 灯箱当前展示的图片在 images 数组中的下标
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // 替换用隐藏文件输入（图片/视频各一个）
  const imgInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // 供 file input onChange 闭包读取的替换目标
  const replaceTargetRef = useRef<MaterialItem | null>(null);

  const images = materials.filter((m) => m.type === 'img');
  const videos = materials.filter((m) => m.type === 'video');

  // ── 删除 ──

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeletingId(target.id);
    setError(null);
    try {
      await deletePointMaterial(pointId, target.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  };

  // ── 替换 ──

  /** 触发替换：记录目标素材并打开对应类型的文件选择器 */
  const handleReplaceClick = (item: MaterialItem) => {
    if (busyId !== null || deletingId !== null) return;
    replaceTargetRef.current = item;
    setError(null);
    const input = item.type === 'img' ? imgInputRef.current : videoInputRef.current;
    input?.click();
  };

  /**
   * 上传替换文件到指定点位并删除旧素材
   * 顺序严格为：先上传新（失败则旧素材不受影响）→ 再删旧
   */
  const runReplace = async (oldItem: MaterialItem, file: File) => {
    setBusyId(oldItem.id);
    setReplaceProgress(null);
    setError(null);
    try {
      if (oldItem.type === 'img') {
        // 校验图片可解码（拒绝损坏/伪造文件）
        try {
          await checkImageReadable(file);
        } catch {
          throw new Error('无法读取图片，文件可能已损坏，请更换图片重试');
        }

        // 校验纯黑像素占比（校验器异常不阻塞，与上传面板策略一致）
        try {
          const { ok, ratio, sampledPixels } = await checkBlackPixelRatio(file);
          if (!ok) {
            throw new Error(
              `纯黑像素占比 ${(ratio * 100).toFixed(2)}% 超过 ${(MAX_BLACK_RATIO * 100).toFixed(
                0,
              )}% 限制（采样 ${sampledPixels} 像素），可能为全黑/损坏图`,
            );
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('纯黑')) throw err;
          console.warn('纯黑像素校验异常，跳过', file.name);
        }

        // 压缩到 300KB 以内（尽量保留 EXIF）
        if (shouldCompress(file)) {
          setReplaceProgress({
            phase: 'compressing',
            percent: 0,
            message: '正在压缩图片（保留EXIF）...',
          });
        }
        const fileToUpload = await compressImageIfNeeded(file);
        const fileId = generateFileId(fileToUpload);
        await uploadFile(fileToUpload, fileToUpload.name, pointId, 'img', fileId, (progress) =>
          setReplaceProgress(progress),
        );
      } else {
        // 视频：大小与时长校验（与上传面板策略一致）
        if (file.size >= VIDEO_MAX_SIZE) {
          throw new Error(`视频超过 ${VIDEO_MAX_SIZE / 1024 / 1024}MB 限制，请压缩后上传`);
        }
        try {
          const { ok, duration } = await checkVideoDuration(file);
          if (!ok) {
            throw new Error(
              `视频时长必须 ≥ ${MIN_VIDEO_DURATION} 秒才能上传，当前时长 ${duration.toFixed(1)} 秒`,
            );
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('时长')) throw err;
          throw new Error('无法读取视频时长，文件可能已损坏，请更换视频重试');
        }

        const fileId = generateFileId(file);
        await uploadFile(file, file.name, pointId, 'video', fileId, (progress) =>
          setReplaceProgress(progress),
        );
      }

      // 新素材已入库，安全删除旧素材
      await deletePointMaterial(pointId, oldItem.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '替换失败');
    } finally {
      setBusyId(null);
      setReplaceProgress(null);
      replaceTargetRef.current = null;
    }
  };

  const handleReplaceFile = (type: MaterialItem['type']) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      const target = replaceTargetRef.current;
      input.value = '';
      if (!file || !target || target.type !== type) return;

      // 后缀校验
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      const allowed = type === 'img' ? IMAGE_EXTS : VIDEO_EXTS;
      if (!allowed.includes(ext)) {
        setError(`替换文件格式不支持，仅支持 ${allowed.join(', ')}`);
        replaceTargetRef.current = null;
        return;
      }

      void runReplace(target, file);
    };
  };

  // ── 灯箱键盘导航 ──

  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowLeft') {
        setLightboxIndex((i) =>
          i === null ? null : (i + images.length - 1) % Math.max(images.length, 1),
        );
      }
      if (e.key === 'ArrowRight') {
        setLightboxIndex((i) => (i === null ? null : (i + 1) % Math.max(images.length, 1)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, images.length]);

  const busy = busyId !== null || deletingId !== null;

  const renderActions = (m: MaterialItem) =>
    busyId === m.id ? (
      <ProgressBar
        percent={replaceProgress?.percent ?? 0}
        label={replaceProgress?.message ?? '替换中'}
        variant={replaceProgress?.phase === 'compressing' ? 'compress' : 'default'}
      />
    ) : (
      <div className="flex gap-1.5">
        <button
          onClick={() => handleReplaceClick(m)}
          disabled={busy}
          className="flex-1 py-1 text-[10px] text-accent border border-accent/40 rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
        >
          替换
        </button>
        <button
          onClick={() => setDeleteTarget(m)}
          disabled={busy}
          className="flex-1 py-1 text-[10px] text-status-red border border-status-red/30 rounded hover:bg-status-red/10 transition-colors disabled:opacity-50"
        >
          删除
        </button>
      </div>
    );

  const renderMeta = (m: MaterialItem) => (
    <div className="flex items-center justify-between text-[10px] text-base-400 font-mono min-w-0">
      <span className="truncate" title={m.path}>
        {m.path.split('/').pop()}
      </span>
      <span className="shrink-0 ml-2 flex items-center gap-1.5">
        <span title={formatBeijingTime(m.upload_time)}>{formatFileSize(m.size)}</span>
      </span>
    </div>
  );

  return (
    <div className="bg-base-700 border border-base-600 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-sm text-base-100 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent"></span>
          已上传素材
        </h3>
        <span className="text-xs text-base-400 font-mono">
          图片 {images.length} · 视频 {videos.length} · 共 {materials.length}
        </span>
      </div>

      {error && (
        <div className="mb-3 p-2.5 bg-status-red/10 border border-status-red/30 rounded text-xs text-status-red flex items-start justify-between gap-2">
          <span className="break-all">{error}</span>
          <button
            onClick={() => setError(null)}
            className="shrink-0 text-base-400 hover:text-base-100"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center text-sm text-base-400 py-6 animate-pulse">
          加载素材列表中...
        </div>
      ) : materials.length === 0 ? (
        <div className="text-center text-sm text-base-400 py-6 border border-dashed border-base-600 rounded">
          该点位暂无已上传素材
        </div>
      ) : (
        <div className="space-y-4 max-h-[26rem] overflow-y-auto pr-1">
          {/* 图片缩略图网格 */}
          {images.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {images.map((m, idx) => (
                <div
                  key={m.id}
                  className="bg-base-800 border border-base-600 rounded overflow-hidden space-y-1.5 p-1.5"
                >
                  <button
                    onClick={() => setLightboxIndex(idx)}
                    className="block w-full aspect-square bg-base-900 rounded overflow-hidden cursor-zoom-in"
                    title="点击查看大图"
                  >
                    <img
                      src={materialFileUrl(pointId, m.id)}
                      alt={`点位${pointId} 图片 #${m.id}`}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </button>
                  {renderMeta(m)}
                  {renderActions(m)}
                </div>
              ))}
            </div>
          )}

          {/* 视频内嵌播放 */}
          {videos.length > 0 && (
            <div className="space-y-2">
              {videos.map((m) => (
                <div
                  key={m.id}
                  className="bg-base-800 border border-base-600 rounded p-2 space-y-1.5"
                >
                  <video
                    controls
                    preload="metadata"
                    src={materialFileUrl(pointId, m.id)}
                    className="w-full max-h-48 bg-black rounded"
                  />
                  {renderMeta(m)}
                  {renderActions(m)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 替换文件选择器（隐藏） */}
      <input
        ref={imgInputRef}
        type="file"
        accept={IMAGE_EXTS.join(',')}
        onChange={handleReplaceFile('img')}
        className="hidden"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={VIDEO_EXTS.join(',')}
        onChange={handleReplaceFile('video')}
        className="hidden"
      />

      {/* 删除确认 */}
      {deleteTarget && (
        <ConfirmDialog
          title="确认删除素材"
          message={`确定删除该${deleteTarget.type === 'img' ? '图片' : '视频'}素材吗？此操作不可撤销。`}
          confirmText="确认删除"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* 图片灯箱 */}
      {lightboxIndex !== null && images[lightboxIndex] && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center animate-fade-in"
          onClick={() => setLightboxIndex(null)}
        >
          <div
            className="max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={materialFileUrl(pointId, images[lightboxIndex].id)}
              alt={`点位${pointId} 图片 ${lightboxIndex + 1}/${images.length}`}
              className="max-w-[90vw] max-h-[75vh] object-contain rounded"
            />
            <div className="flex items-center gap-4 text-base-300 font-mono text-sm">
              <button
                onClick={() =>
                  setLightboxIndex((i) =>
                    i === null ? null : (i + images.length - 1) % images.length,
                  )
                }
                className="px-3 py-1.5 border border-base-600 rounded hover:bg-base-700 transition-colors"
              >
                ← 上一张
              </button>
              <span>
                {lightboxIndex + 1} / {images.length}
              </span>
              <button
                onClick={() =>
                  setLightboxIndex((i) => (i === null ? null : (i + 1) % images.length))
                }
                className="px-3 py-1.5 border border-base-600 rounded hover:bg-base-700 transition-colors"
              >
                下一张 →
              </button>
            </div>
          </div>
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-5 text-base-300 hover:text-base-100 text-2xl px-2"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
