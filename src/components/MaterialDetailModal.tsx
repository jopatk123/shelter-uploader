/**
 * 素材详情弹窗
 * 展示点位的全部素材（数量不限）：
 *   - 图片缩略图预览（通过 blob URL，需管理员鉴权）
 *   - 下载（带进度条）
 *   - 删除
 */
import { useState, useEffect, useCallback } from 'react';
import { adminDownload, adminDeleteMaterial, getToken } from '@/lib/api';
import ProgressBar from '@/components/ProgressBar';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { PointDetail, MaterialItem } from '@/types';
import { formatBeijingTime, formatFileSize } from '@/lib/utils';

interface Props {
  point: PointDetail;
  onClose: () => void;
  onChanged: () => void;
}

export default function MaterialDetailModal({ point, onClose, onChanged }: Props) {
  const [downloadId, setDownloadId] = useState<number | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<MaterialItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 图片素材 id → blob URL（受鉴权保护的图片预览）
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});
  const [imageErrors, setImageErrors] = useState<Record<number, boolean>>({});

  /**
   * 通过 Authorization Header 获取受保护的图片，转为 blob URL 用于预览
   * 避免将 JWT token 暴露在 img src URL 中
   */
  const loadImageBlob = useCallback(async (path: string): Promise<string | null> => {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await fetch(`/storage/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, []);

  /**
   * 加载所有已上传图片的 blob URL，在组件卸载或素材变化时自动 revoke
   */
  useEffect(() => {
    const images = point.materials.filter((m) => m.type === 'img');
    if (images.length === 0) return;

    let cancelled = false;
    const urls: Record<number, string> = {};
    const errs: Record<number, boolean> = {};

    (async () => {
      for (const m of images) {
        const blobUrl = await loadImageBlob(m.path);
        if (cancelled) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          return;
        }
        if (blobUrl) urls[m.id] = blobUrl;
        else errs[m.id] = true;
      }
      setImageUrls(urls);
      setImageErrors(errs);
    })();

    return () => {
      cancelled = true;
      for (const url of Object.values(urls)) {
        URL.revokeObjectURL(url);
      }
      setImageUrls({});
      setImageErrors({});
    };
  }, [point, loadImageBlob]);

  const handleDownload = async (item: MaterialItem) => {
    const ext = item.path.substring(item.path.lastIndexOf('.'));

    setDownloadId(item.id);
    setDownloadProgress(0);
    setError(null);

    try {
      await adminDownload(item.id, ext, (p) => setDownloadProgress(p));
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败');
    } finally {
      setTimeout(() => {
        setDownloadId(null);
        setDownloadProgress(0);
      }, 1000);
    }
  };

  const handleDelete = async (item: MaterialItem) => {
    setError(null);
    try {
      await adminDeleteMaterial(item.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const images = point.materials.filter((m) => m.type === 'img');
  const videos = point.materials.filter((m) => m.type === 'video');

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-base-700 border border-base-600 rounded-lg max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-5 border-b border-base-600 sticky top-0 bg-base-700 z-10">
          <div>
            <h3 className="font-mono text-lg text-base-100">
              点位 <span className="text-accent">#{point.id}</span>
            </h3>
            <p className="text-xs text-base-400 mt-0.5">
              {point.district} · {point.township} · 图片 {point.img_count} · 视频{' '}
              {point.video_count}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-base-400 hover:text-base-100 transition-colors text-xl px-2"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-status-red/10 border border-status-red/30 rounded text-sm text-status-red">
              {error}
            </div>
          )}

          {point.materials.length === 0 && (
            <div className="text-center text-sm text-base-400 py-8">该点位暂无已上传素材</div>
          )}

          {/* 图片素材 */}
          {images.length > 0 && (
            <div>
              <h4 className="font-mono text-sm text-base-100 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                图片（{images.length}）
              </h4>
              <div className="grid grid-cols-2 gap-3">
                {images.map((m) => (
                  <div
                    key={m.id}
                    className="bg-base-800 border border-base-600 rounded-lg p-3 space-y-2"
                  >
                    {/* 图片预览（通过 blob URL 展示受鉴权保护的图片） */}
                    <div
                      className="bg-base-900 rounded-lg overflow-hidden flex items-center justify-center"
                      style={{ maxHeight: '200px' }}
                    >
                      {imageUrls[m.id] ? (
                        <img
                          src={imageUrls[m.id]}
                          alt={`点位${point.id} 图片 #${m.id}`}
                          className="max-w-full object-contain"
                          style={{ maxHeight: '200px' }}
                        />
                      ) : imageErrors[m.id] ? (
                        <div className="text-sm text-status-red py-8">图片加载失败</div>
                      ) : (
                        <div className="text-sm text-base-400 py-8 animate-pulse">
                          加载图片中...
                        </div>
                      )}
                    </div>

                    <div className="text-[10px] text-base-400 font-mono flex items-center justify-between">
                      <span title={m.path}>{m.path.split('/').pop()}</span>
                      <span className="shrink-0 ml-2">{formatFileSize(m.size)}</span>
                    </div>

                    {downloadId === m.id && (
                      <ProgressBar percent={downloadProgress} label="下载中" />
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownload(m)}
                        disabled={downloadId !== null}
                        className="flex-1 py-1.5 text-xs bg-accent text-base-900 rounded hover:opacity-90 transition-opacity disabled:opacity-50 font-medium"
                      >
                        下载
                      </button>
                      <button
                        onClick={() => setDeleteTarget(m)}
                        disabled={downloadId !== null}
                        className="px-3 py-1.5 text-xs text-status-red border border-status-red/30 rounded hover:bg-status-red/10 transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 视频素材 */}
          {videos.length > 0 && (
            <div>
              <h4 className="font-mono text-sm text-base-100 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-status-yellow"></span>
                视频（{videos.length}）
              </h4>
              <div className="space-y-2">
                {videos.map((m) => (
                  <div
                    key={m.id}
                    className="bg-base-800 border border-base-600 rounded-lg p-3 space-y-2"
                  >
                    <div className="text-xs text-base-300 py-2 bg-base-900 rounded">
                      视频已上传（不提供在线播放）
                    </div>
                    <div className="text-[10px] text-base-400 font-mono flex items-center justify-between">
                      <span title={m.path}>{m.path.split('/').pop()}</span>
                      <span className="shrink-0 ml-2">{formatFileSize(m.size)}</span>
                    </div>
                    <div className="text-[10px] text-base-500 font-mono">
                      {formatBeijingTime(m.upload_time)}
                    </div>
                    {downloadId === m.id && (
                      <ProgressBar percent={downloadProgress} label="下载中" />
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownload(m)}
                        disabled={downloadId !== null}
                        className="flex-1 py-1.5 text-xs bg-accent text-base-900 rounded hover:opacity-90 transition-opacity disabled:opacity-50 font-medium"
                      >
                        下载
                      </button>
                      <button
                        onClick={() => setDeleteTarget(m)}
                        disabled={downloadId !== null}
                        className="px-3 py-1.5 text-xs text-status-red border border-status-red/30 rounded hover:bg-status-red/10 transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 删除确认 */}
      {deleteTarget && (
        <ConfirmDialog
          title="确认删除素材"
          message={`确定删除该${
            deleteTarget.type === 'img' ? '图片' : '视频'
          }素材吗？此操作不可撤销。`}
          confirmText="确认删除"
          onConfirm={() => {
            handleDelete(deleteTarget);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
