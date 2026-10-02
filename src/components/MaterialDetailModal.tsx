/**
 * 素材详情弹窗
 * 4 类素材（主图/备选图/主视频/备选视频）：
 *   - 图片缩略图预览
 *   - 下载（带进度条）
 *   - 删除
 */
import { useState, useEffect, useCallback } from 'react';
import { adminDownload, adminDeleteMaterial, getToken } from '@/lib/api';
import ProgressBar from '@/components/ProgressBar';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { PointDetail, MaterialType } from '@/types';

interface Props {
  point: PointDetail;
  onClose: () => void;
  onChanged: () => void;
}

/** 素材类型元信息 */
const MATERIAL_META: {
  type: MaterialType;
  title: string;
  pathKey: 'img_path' | 'img_path_alt' | 'video_path' | 'video_path_alt';
  hasKey: 'has_image' | 'has_image_alt' | 'has_video' | 'has_video_alt';
  isImage: boolean;
}[] = [
  { type: 'img', title: '主图片', pathKey: 'img_path', hasKey: 'has_image', isImage: true },
  {
    type: 'img_alt',
    title: '备选图片',
    pathKey: 'img_path_alt',
    hasKey: 'has_image_alt',
    isImage: true,
  },
  { type: 'video', title: '主视频', pathKey: 'video_path', hasKey: 'has_video', isImage: false },
  {
    type: 'video_alt',
    title: '备选视频',
    pathKey: 'video_path_alt',
    hasKey: 'has_video_alt',
    isImage: false,
  },
];

export default function MaterialDetailModal({ point, onClose, onChanged }: Props) {
  const [downloadType, setDownloadType] = useState<MaterialType | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<MaterialType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

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
   * 加载所有已上传图片的 blob URL，在组件卸载或点位变化时自动 revoke
   */
  useEffect(() => {
    const imageMeta = MATERIAL_META.filter((m) => m.isImage && point[m.hasKey] && point[m.pathKey]);
    if (imageMeta.length === 0) return;

    let cancelled = false;
    const urls: Record<string, string> = {};
    const errs: Record<string, boolean> = {};

    (async () => {
      for (const meta of imageMeta) {
        const path = point[meta.pathKey];
        if (!path) continue;
        const blobUrl = await loadImageBlob(path);
        if (cancelled) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          return;
        }
        if (blobUrl) {
          urls[meta.type] = blobUrl;
        } else {
          errs[meta.type] = true;
        }
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

  const handleDownload = async (type: MaterialType) => {
    const meta = MATERIAL_META.find((m) => m.type === type)!;
    const filePath = point[meta.pathKey];
    const ext = filePath ? filePath.substring(filePath.lastIndexOf('.')) : '';

    setDownloadType(type);
    setDownloadProgress(0);
    setError(null);

    try {
      await adminDownload(point.id, type, ext, (p) => setDownloadProgress(p));
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败');
    } finally {
      setTimeout(() => {
        setDownloadType(null);
        setDownloadProgress(0);
      }, 1000);
    }
  };

  const handleDelete = async (type: MaterialType) => {
    setError(null);
    try {
      await adminDeleteMaterial(point.id, type);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

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
              {point.city} · {point.district} · {point.township}
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

          {MATERIAL_META.map((meta) => {
            const has = point[meta.hasKey];
            const path = point[meta.pathKey];
            const isAlt = meta.type.endsWith('_alt');
            const accentText = isAlt ? 'text-status-yellow' : 'text-accent';

            return (
              <div key={meta.type} className="bg-base-800 border border-base-600 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-mono text-sm text-base-100 flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${isAlt ? 'bg-status-yellow' : 'bg-accent'}`}
                    ></span>
                    {meta.title}
                  </h4>
                  <span
                    className={`text-xs font-mono ${has ? 'text-status-green' : 'text-status-red'}`}
                  >
                    {has ? '已上传' : '未上传'}
                  </span>
                </div>

                {has && path ? (
                  <div className="space-y-3">
                    {/* 图片预览（通过 blob URL 展示受鉴权保护的图片） */}
                    {meta.isImage && (
                      <div
                        className="bg-base-900 rounded-lg overflow-hidden flex items-center justify-center"
                        style={{ maxHeight: '260px' }}
                      >
                        {imageUrls[meta.type] ? (
                          <img
                            src={imageUrls[meta.type]}
                            alt={`点位${point.id} ${meta.title}`}
                            className="max-w-full object-contain"
                            style={{ maxHeight: '260px' }}
                          />
                        ) : imageErrors[meta.type] ? (
                          <div className="text-sm text-status-red py-8">图片加载失败</div>
                        ) : (
                          <div className="text-sm text-base-400 py-8 animate-pulse">
                            加载图片中...
                          </div>
                        )}
                      </div>
                    )}
                    {!meta.isImage && (
                      <div className="text-center text-sm text-base-300 py-4 bg-base-900 rounded">
                        视频已上传（不提供在线播放）
                      </div>
                    )}

                    {downloadType === meta.type && (
                      <ProgressBar percent={downloadProgress} label={`下载${meta.title}中`} />
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownload(meta.type)}
                        disabled={downloadType !== null}
                        className={`flex-1 py-2 text-sm ${accentText === 'text-accent' ? 'bg-accent text-base-900' : 'bg-status-yellow text-base-900'} rounded hover:opacity-90 transition-opacity disabled:opacity-50 font-medium`}
                      >
                        下载{meta.title}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(meta.type)}
                        disabled={downloadType !== null}
                        className="px-4 py-2 text-sm text-status-red border border-status-red/30 rounded hover:bg-status-red/10 transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-sm text-base-400 py-6">暂无{meta.title}素材</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 删除确认 */}
      {deleteConfirm && (
        <ConfirmDialog
          title="确认删除素材"
          message={`确定删除点位 #${point.id} 的${MATERIAL_META.find((m) => m.type === deleteConfirm)!.title}素材吗？此操作不可撤销。`}
          confirmText="确认删除"
          onConfirm={() => {
            handleDelete(deleteConfirm);
            setDeleteConfirm(null);
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
