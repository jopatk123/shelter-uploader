/**
 * 作业人员上传页面
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import PointDotGrid from '@/components/PointDotGrid';
import ImageUploadPanel from '@/components/ImageUploadPanel';
import VideoUploadPanel from '@/components/VideoUploadPanel';
import MaterialWall from '@/components/MaterialWall';
import ConfirmDialog from '@/components/ConfirmDialog';
import { fetchPoints, fetchMaterials, downloadPublicStatsCsv } from '@/lib/api';
import { getRuntimeConfig } from '@/lib/runtimeConfig';
import type { PointStatus, MaterialItem } from '@/types';

export default function UploadPage() {
  const [points, setPoints] = useState<PointStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [showOverLimit, setShowOverLimit] = useState(false);
  const [showNoGpsWarning, setShowNoGpsWarning] = useState(false);
  const [statsDownloading, setStatsDownloading] = useState(false);
  // 上传区的空状态 CTA 需要把焦点交还给点位选择器
  const selectRef = useRef<HTMLSelectElement>(null);

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

  // 选中点位变化时加载该点位的素材墙（上传成功后也会刷新）
  const loadMaterials = useCallback(async (pointId: number) => {
    setMaterialsLoading(true);
    try {
      const data = await fetchMaterials(pointId);
      setMaterials(data);
    } catch (err) {
      console.error('加载素材列表失败:', err);
      setMaterials([]);
    } finally {
      setMaterialsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setMaterials([]);
      return;
    }
    loadMaterials(selectedId);
  }, [selectedId, loadMaterials]);

  const selectedPoint = points.find((p) => p.id === selectedId) || null;
  // 视频上限取自后端运行配置，避免与 VIDEO_MAX_SIZE_MB 脱节
  const videoMaxSizeMB = getRuntimeConfig().videoMaxSizeMB;

  const handleUploadComplete = useCallback(() => {
    loadPoints();
    if (selectedId !== null) loadMaterials(selectedId);
  }, [loadPoints, selectedId, loadMaterials]);

  // 素材墙内删除/替换成功后的刷新（与上传完成同源）
  const handleMaterialsChanged = handleUploadComplete;

  /** 上传区空状态 CTA：滚动到点位选择器并聚焦 */
  const handleRequestPoint = useCallback(() => {
    const select = selectRef.current;
    if (!select) return;
    select.scrollIntoView({ behavior: 'smooth', block: 'center' });
    select.focus({ preventScroll: true });
  }, []);

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
      <header className="bg-base-800 border-b border-base-600 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded bg-accent/20 border border-accent/40 flex items-center justify-center">
              <span className="text-accent font-mono font-bold text-sm">U</span>
            </div>
            <div className="min-w-0">
              <h1 className="font-mono text-sm sm:text-base text-base-100 truncate">
                福州沿海码头避风点点位素材上传系统
              </h1>
              {/* 完成百分比由点阵区独家承担，此处不再重复展示同一数字 */}
              <p className="text-xs text-base-400">福州沿海码头避风点 · {points.length} 个点位</p>
            </div>
          </div>
          <a
            href="/admin"
            className="shrink-0 text-xs text-base-300 hover:text-accent transition-colors font-mono border border-base-600 px-3 py-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            管理后台 →
          </a>
        </div>
      </header>

      <main className="p-4 sm:p-6 max-w-[1600px] mx-auto">
        {/* 点位状态点阵 */}
        <PointDotGrid
          points={points}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          statsDownloading={statsDownloading}
          onDownloadStats={handleDownloadStats}
        />

        {/* 主操作区：点位信息与上传区近似 1:1，上传是主线任务，不再被挤成窄栏 */}
        <div className="grid grid-cols-1 gap-4 lg:mt-6 lg:grid-cols-2 lg:gap-6">
          {/* 左侧：点位选择 + 已上传素材 */}
          <div className="mt-4 min-w-0 space-y-4 lg:mt-0">
            <div className="bg-base-700 border border-base-600 rounded-lg p-5">
              <h3 className="font-mono text-sm text-base-100 mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent"></span>
                当前点位
              </h3>

              <select
                ref={selectRef}
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-base-800 border border-base-600 rounded px-3 py-2.5 text-base sm:text-sm text-base-100 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 font-mono"
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
                <div className="mt-4 p-4 bg-base-800 border border-base-600 rounded animate-fade-in">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-accent text-lg">#{selectedPoint.id}</span>
                    <span className="text-xs text-base-400 font-mono truncate">
                      {selectedPoint.name}
                    </span>
                  </div>
                  {/* 三列紧凑排布：原先两列让卡片偏高，挤占了上传区的纵向空间 */}
                  <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                    <div className="min-w-0">
                      <dt className="text-base-400">区县</dt>
                      <dd className="text-base-100 truncate">{selectedPoint.district}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-base-400">乡镇</dt>
                      <dd className="text-base-100 truncate">{selectedPoint.township || '—'}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-base-400">船管站</dt>
                      <dd className="text-base-100 truncate">{selectedPoint.station || '—'}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-base-400">可停泊</dt>
                      <dd className="text-base-100 truncate">{selectedPoint.capacity || '—'}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-base-400">经度</dt>
                      <dd className="text-base-100 font-mono truncate">
                        {selectedPoint.lon.toFixed(6)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-base-400">纬度</dt>
                      <dd className="text-base-100 font-mono truncate">
                        {selectedPoint.lat.toFixed(6)}
                      </dd>
                    </div>
                  </dl>
                  <div className="pt-2 mt-1 border-t border-base-600 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span
                      className={
                        selectedPoint.img_count > 0 ? 'text-status-green' : 'text-base-400'
                      }
                    >
                      图片:{' '}
                      {selectedPoint.img_count > 0
                        ? `已上传 ${selectedPoint.img_count} 张`
                        : '未上传'}
                    </span>
                    <span
                      className={
                        selectedPoint.video_count > 0 ? 'text-status-green' : 'text-base-400'
                      }
                    >
                      视频:{' '}
                      {selectedPoint.video_count > 0
                        ? `已上传 ${selectedPoint.video_count} 个`
                        : '未上传'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-4 p-4 bg-base-800/50 border border-dashed border-base-600 rounded text-center">
                  <p className="text-sm text-base-300">尚未选择点位</p>
                  <p className="mt-1 text-xs text-base-400">可点击上方点阵中的编号直接选择</p>
                  <button
                    type="button"
                    onClick={handleRequestPoint}
                    className="mt-3 inline-flex min-h-[36px] items-center rounded border border-accent/50 px-3 py-2 text-xs font-mono text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    选择点位
                  </button>
                </div>
              )}
            </div>

            {/* 素材墙：自身即卡片，不再嵌套一层同色边框 */}
            {selectedId !== null && (
              <MaterialWall
                pointId={selectedId}
                materials={materials}
                loading={materialsLoading}
                onChanged={handleMaterialsChanged}
              />
            )}
          </div>

          {/* 右侧：上传区（图片 / 视频，均不限数量） */}
          <div className="min-w-0 grid grid-cols-1 content-start gap-4 2xl:grid-cols-2 lg:gap-6">
            <ImageUploadPanel
              key={`${selectedId ?? 'none'}-img`}
              pointId={selectedId}
              onUploadComplete={handleUploadComplete}
              onMissingGps={() => setShowNoGpsWarning(true)}
              onRequestPoint={handleRequestPoint}
            />
            <VideoUploadPanel
              key={`${selectedId ?? 'none'}-video`}
              pointId={selectedId}
              onUploadComplete={handleUploadComplete}
              onOverLimit={() => setShowOverLimit(true)}
              onRequestPoint={handleRequestPoint}
            />
          </div>
        </div>
      </main>

      {/* 视频超限指引弹窗 */}
      {showOverLimit && (
        <ConfirmDialog
          title={`视频超过${videoMaxSizeMB}MB限制`}
          message={
            <div className="space-y-2">
              <p>当前视频超过{videoMaxSizeMB}MB限制，请按以下步骤压缩后上传：</p>
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
