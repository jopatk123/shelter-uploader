/**
 * 作业人员上传页面
 */
import { useState, useEffect, useCallback } from 'react';
import PointDotGrid from '@/components/PointDotGrid';
import ImageUploadPanel from '@/components/ImageUploadPanel';
import VideoUploadPanel from '@/components/VideoUploadPanel';
import ConfirmDialog from '@/components/ConfirmDialog';
import { fetchPoints, downloadPublicStatsCsv } from '@/lib/api';
import type { PointStatus } from '@/types';

export default function UploadPage() {
  const [points, setPoints] = useState<PointStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    message: string;
    callback: () => void;
  } | null>(null);
  const [showOverLimit, setShowOverLimit] = useState(false);
  const [showNoGpsWarning, setShowNoGpsWarning] = useState(false);
  const [statsDownloading, setStatsDownloading] = useState(false);

  const loadPoints = useCallback(async () => {
    try {
      const data = await fetchPoints();
      setPoints(data);
    } catch (err) {
      console.error('加载点位失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPoints();
  }, [loadPoints]);

  const selectedPoint = points.find((p) => p.id === selectedId) || null;
  const completedCount = points.filter((p) => p.has_image || p.has_video).length;
  const completedPercent =
    points.length > 0 ? Math.round((completedCount / points.length) * 100) : 0;

  const handleNeedConfirm = (callback: () => void) => {
    setConfirmAction({
      message: `点位 #${selectedId} 已有该类型素材，是否覆盖原有素材？`,
      callback,
    });
  };

  const handleDownloadStats = async () => {
    setStatsDownloading(true);
    try {
      await downloadPublicStatsCsv();
    } finally {
      setStatsDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-base-300 font-mono animate-pulse">加载点位数据中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-900">
      {/* 顶部栏 */}
      <header className="bg-base-800 border-b border-base-600 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-accent/20 border border-accent/40 flex items-center justify-center">
              <span className="text-accent font-mono font-bold text-sm">U</span>
            </div>
            <div>
              <h1 className="font-mono text-base text-base-100">
                福州沿海码头避风点点位素材上传系统
              </h1>
              <p className="text-xs text-base-400">
                福州沿海码头避风点 · {points.length}个点位 ·{' '}
                <span className="text-accent font-bold">{completedPercent}%</span> 已完成
              </p>
            </div>
          </div>
          <a
            href="/admin"
            className="text-xs text-base-300 hover:text-accent transition-colors font-mono border border-base-600 px-3 py-1.5 rounded"
          >
            管理后台 →
          </a>
        </div>
      </header>

      <main className="p-6 max-w-[1600px] mx-auto">
        {/* 点位状态点阵 */}
        <PointDotGrid
          points={points}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          statsDownloading={statsDownloading}
          onDownloadStats={handleDownloadStats}
        />

        {/* 主操作区 */}
        <div className="grid grid-cols-3 gap-6 mt-6">
          {/* 左侧：点位选择 */}
          <div className="col-span-1">
            <div className="bg-base-700 border border-base-600 rounded-lg p-5">
              <h3 className="font-mono text-sm text-base-100 mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent"></span>
                选择点位
              </h3>

              <select
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-base-800 border border-base-600 rounded px-3 py-2.5 text-sm text-base-100 focus:border-accent focus:outline-none font-mono"
              >
                <option value="">-- 请选择点位 --</option>
                {points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} | {p.name} | {p.township || p.district} | {p.lon.toFixed(4)},{' '}
                    {p.lat.toFixed(4)}
                  </option>
                ))}
              </select>

              {selectedPoint ? (
                <div className="mt-4 p-4 bg-base-800 border border-base-600 rounded space-y-2 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-accent text-lg">#{selectedPoint.id}</span>
                    <span className="text-xs text-base-400 font-mono">{selectedPoint.city}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-base-400">区县</span>
                      <p className="text-base-100">{selectedPoint.district}</p>
                    </div>
                    <div>
                      <span className="text-base-400">乡镇</span>
                      <p className="text-base-100">{selectedPoint.township || '—'}</p>
                    </div>
                    <div>
                      <span className="text-base-400">船管站</span>
                      <p className="text-base-100">{selectedPoint.station || '—'}</p>
                    </div>
                    <div>
                      <span className="text-base-400">可停泊数量</span>
                      <p className="text-base-100">{selectedPoint.capacity || '—'}</p>
                    </div>
                    <div>
                      <span className="text-base-400">经度</span>
                      <p className="text-base-100 font-mono">{selectedPoint.lon.toFixed(6)}</p>
                    </div>
                    <div>
                      <span className="text-base-400">纬度</span>
                      <p className="text-base-100 font-mono">{selectedPoint.lat.toFixed(6)}</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-base-600 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span
                      className={selectedPoint.has_image ? 'text-status-green' : 'text-status-red'}
                    >
                      主图: {selectedPoint.has_image ? '已上传' : '未上传'}
                    </span>
                    <span
                      className={
                        selectedPoint.has_image_alt ? 'text-status-green' : 'text-status-red'
                      }
                    >
                      备图: {selectedPoint.has_image_alt ? '已上传' : '未上传'}
                    </span>
                    <span
                      className={selectedPoint.has_video ? 'text-status-green' : 'text-status-red'}
                    >
                      主视频: {selectedPoint.has_video ? '已上传' : '未上传'}
                    </span>
                    <span
                      className={
                        selectedPoint.has_video_alt ? 'text-status-green' : 'text-status-red'
                      }
                    >
                      备视频: {selectedPoint.has_video_alt ? '已上传' : '未上传'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-4 p-4 bg-base-800/50 border border-dashed border-base-600 rounded text-center text-sm text-base-400">
                  必须先选择点位才能上传素材
                </div>
              )}
            </div>
          </div>

          {/* 右侧：上传区（4面板：主图/备选图/主视频/备选视频） */}
          <div className="col-span-2 grid grid-cols-2 gap-4">
            <ImageUploadPanel
              key={`${selectedId ?? 'none'}-img`}
              pointId={selectedId}
              hasExisting={!!selectedPoint?.has_image}
              onUploadComplete={loadPoints}
              onNeedConfirm={handleNeedConfirm}
              onMissingGps={() => setShowNoGpsWarning(true)}
              type="img"
            />
            <ImageUploadPanel
              key={`${selectedId ?? 'none'}-img_alt`}
              pointId={selectedId}
              hasExisting={!!selectedPoint?.has_image_alt}
              onUploadComplete={loadPoints}
              onNeedConfirm={handleNeedConfirm}
              onMissingGps={() => setShowNoGpsWarning(true)}
              type="img_alt"
            />
            <VideoUploadPanel
              key={`${selectedId ?? 'none'}-video`}
              pointId={selectedId}
              hasExisting={!!selectedPoint?.has_video}
              onUploadComplete={loadPoints}
              onNeedConfirm={handleNeedConfirm}
              onOverLimit={() => setShowOverLimit(true)}
              type="video"
            />
            <VideoUploadPanel
              key={`${selectedId ?? 'none'}-video_alt`}
              pointId={selectedId}
              hasExisting={!!selectedPoint?.has_video_alt}
              onUploadComplete={loadPoints}
              onNeedConfirm={handleNeedConfirm}
              onOverLimit={() => setShowOverLimit(true)}
              type="video_alt"
            />
          </div>
        </div>
      </main>

      {/* 覆盖确认弹窗 */}
      {confirmAction && (
        <ConfirmDialog
          title="确认覆盖素材"
          message={confirmAction.message}
          confirmText="覆盖上传"
          onConfirm={() => {
            confirmAction.callback();
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* 视频超限指引弹窗 */}
      {showOverLimit && (
        <ConfirmDialog
          title="视频超过100MB限制"
          message={
            <div className="space-y-2">
              <p>当前视频超过100MB限制，请按以下步骤压缩后上传：</p>
              <ol className="list-decimal list-inside text-base-300 space-y-1 pl-2">
                <li>将视频拖拽至微信文件传输助手/好友发送</li>
                <li>微信会自动压缩视频</li>
                <li>保存压缩后的视频再上传</li>
              </ol>
            </div>
          }
          confirmText="我知道了"
          cancelText="关闭"
          onConfirm={() => setShowOverLimit(false)}
          onCancel={() => setShowOverLimit(false)}
        />
      )}

      {/* 图片无 GPS 经纬度提示弹窗 */}
      {showNoGpsWarning && (
        <ConfirmDialog
          title="图片未含经纬度信息"
          message={
            <div className="space-y-2">
              <p>
                你上传的图片不含经纬度信息，请尽量上传相机/手机拍摄的原图，不要经过微信QQ等工具发送。
              </p>
              <p className="text-base-400 text-xs">
                提示：微信/QQ 等工具发送图片会剥离 EXIF 元数据（含 GPS
                经纬度），导致图片丢失拍摄位置信息。
              </p>
            </div>
          }
          confirmText="我知道了"
          cancelText="关闭"
          onConfirm={() => setShowNoGpsWarning(false)}
          onCancel={() => setShowNoGpsWarning(false)}
        />
      )}
    </div>
  );
}
