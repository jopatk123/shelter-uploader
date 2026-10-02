/**
 * 素材详情弹窗
 * 展示点位的全部素材（数量不限）：
 *   - 图片预览（公开预览端点，免鉴权）
 *   - 视频在线播放（公开端点支持 Range 流式播放）
 *   - 下载（带进度条）
 *   - 删除
 */
import { useState } from 'react';
import { adminDownload, adminDeleteMaterial, materialFileUrl } from '@/lib/api';
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
                    {/* 图片预览（公开预览端点） */}
                    <div
                      className="bg-base-900 rounded-lg overflow-hidden flex items-center justify-center"
                      style={{ maxHeight: '200px' }}
                    >
                      <img
                        src={materialFileUrl(point.id, m.id)}
                        alt={`点位${point.id} 图片 #${m.id}`}
                        loading="lazy"
                        className="max-w-full object-contain"
                        style={{ maxHeight: '200px' }}
                      />
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
                    {/* 视频在线播放（公开端点支持 Range 流式播放） */}
                    <video
                      controls
                      preload="metadata"
                      src={materialFileUrl(point.id, m.id)}
                      className="w-full max-h-64 bg-black rounded"
                    />
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
