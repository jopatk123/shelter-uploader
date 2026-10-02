/**
 * 管理员后台页面
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import LoginModal from '@/components/LoginModal';
import MaterialDetailModal from '@/components/MaterialDetailModal';
import ConfirmDialog from '@/components/ConfirmDialog';
import BatchDownloadToolbar from '@/components/BatchDownloadToolbar';
import {
  adminLogin,
  adminFetchPoints,
  adminFetchPointDetail,
  adminDeleteMaterial,
  adminBatchDownload,
  adminDownloadStatsCsv,
  getToken,
  setToken,
  clearToken,
} from '@/lib/api';
import type { PointStatus, PointDetail, MaterialType } from '@/types';
import { getPointState, formatBeijingTime } from '@/lib/utils';

type FilterType = 'all' | 'img_only' | 'video_only' | 'completed';

const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'img_only', label: '仅传图' },
  { value: 'video_only', label: '仅传视频' },
  { value: 'completed', label: '已完成' },
];

/** MaterialType → 中文标签 */
const TYPE_LABEL: Record<MaterialType, string> = {
  img: '图片',
  video: '视频',
};

export default function AdminPage() {
  const [authed, setAuthed] = useState(!!getToken());
  const [points, setPoints] = useState<PointStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [detailPoint, setDetailPoint] = useState<PointDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [clearConfirm, setClearConfirm] = useState<{ id: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchDownloading, setBatchDownloading] = useState<MaterialType | null>(null);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  // 统计表格下载状态
  const [statsDownloading, setStatsDownloading] = useState(false);
  const [statsMsg, setStatsMsg] = useState<string | null>(null);
  // 选中的点位 ID 集合（用于批量下载的选择模式）
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const handleAuthError = useCallback((err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Token') || msg.includes('403')) {
      setAuthed(false);
      clearToken();
      return true;
    }
    return false;
  }, []);

  const loadPoints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminFetchPoints('all');
      setPoints(data);
    } catch (err) {
      if (!handleAuthError(err)) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, [handleAuthError]);

  useEffect(() => {
    if (authed) {
      loadPoints();
    }
  }, [authed, loadPoints]);

  const handleLogin = async (password: string) => {
    const token = await adminLogin(password);
    setToken(token);
    setAuthed(true);
  };

  const handleLogout = () => {
    clearToken();
    setAuthed(false);
    setPoints([]);
    setSelectedIds(new Set());
  };

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setDetailPoint(null);
    try {
      const detail = await adminFetchPointDetail(id);
      setDetailPoint(detail);
    } catch (err) {
      if (!handleAuthError(err)) {
        setError(err instanceof Error ? err.message : '获取详情失败');
      }
    } finally {
      setDetailLoading(false);
    }
  };

  // 前端筛选逻辑（与后端保持一致）
  const filteredPoints = useMemo(() => {
    if (filter === 'all') return points;
    if (filter === 'img_only') return points.filter((p) => p.img_count > 0 && p.video_count === 0);
    if (filter === 'video_only')
      return points.filter((p) => p.img_count === 0 && p.video_count > 0);
    if (filter === 'completed') return points.filter((p) => p.uploaded_count > 0);
    return points;
  }, [points, filter]);

  // 各筛选类别的数量统计
  const filterCounts = useMemo(
    () => ({
      all: points.length,
      img_only: points.filter((p) => p.img_count > 0 && p.video_count === 0).length,
      video_only: points.filter((p) => p.img_count === 0 && p.video_count > 0).length,
      completed: points.filter((p) => p.uploaded_count > 0).length,
    }),
    [points],
  );

  // 统计概览（必须在早期 return 之前调用，避免 Hook 顺序不一致）
  const stats = useMemo(
    () => ({
      total: points.length,
      imgTotal: points.reduce((sum, p) => sum + p.img_count, 0),
      videoTotal: points.reduce((sum, p) => sum + p.video_count, 0),
      materialTotal: points.reduce((sum, p) => sum + p.uploaded_count, 0),
      completed: points.filter((p) => p.uploaded_count > 0).length,
      partial: points.filter((p) => getPointState(p.img_count, p.video_count) === 'partial').length,
      empty: points.filter((p) => p.uploaded_count === 0).length,
    }),
    [points],
  );

  const handleClearAll = async (id: number) => {
    setError(null);
    try {
      // 拉取点位详情，按素材行 id 逐个删除（每点位素材数量不限）
      const detail = await adminFetchPointDetail(id);
      const errors: string[] = [];
      for (const m of detail.materials) {
        try {
          await adminDeleteMaterial(m.id);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : `素材 #${m.id} 删除失败`);
        }
      }
      // 无论部分成功或失败，都刷新列表以反映最新状态
      await loadPoints();
      if (errors.length > 0) {
        setError(`部分素材删除失败: ${errors.join('; ')}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取详情失败');
    }
  };

  const handleBatchDownload = async (type: MaterialType, ids?: number[]) => {
    const label = TYPE_LABEL[type];
    const countKey = type === 'img' ? 'img_count' : 'video_count';
    const targetIds = ids ?? filteredPoints.map((p) => p.id);
    const pool = points.filter((p) => targetIds.includes(p.id));
    const pointCount = pool.filter((p) => p[countKey] > 0).length;
    const fileCount = pool.reduce((sum, p) => sum + p[countKey], 0);
    const scopeLabel = ids && ids.length > 0 ? '选中点位' : '当前筛选';

    if (fileCount === 0) {
      setBatchMsg(`${scopeLabel}中暂无已上传的${label}素材`);
      setTimeout(() => setBatchMsg(null), 3000);
      return;
    }

    setBatchDownloading(type);
    setBatchMsg(null);
    setError(null);
    try {
      await adminBatchDownload(type, targetIds);
      setBatchMsg(
        `${scopeLabel} ${label}共 ${fileCount} 个文件（${pointCount} 个点位），下载已开始`,
      );
      setTimeout(() => setBatchMsg(null), 5000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : `${label}批量下载失败`;
      setError(msg);
    } finally {
      setBatchDownloading(null);
    }
  };

  const handleDownloadStats = async (ids?: number[]) => {
    const targetIds = ids ?? filteredPoints.map((p) => p.id);
    const scopeLabel = ids && ids.length > 0 ? '选中点位' : '当前筛选';
    const count = targetIds.length;

    if (count === 0) {
      setStatsMsg('暂无点位可导出');
      setTimeout(() => setStatsMsg(null), 3000);
      return;
    }

    setStatsDownloading(true);
    setStatsMsg(null);
    setError(null);
    try {
      await adminDownloadStatsCsv(targetIds);
      setStatsMsg(`${scopeLabel}共 ${count} 个点位，CSV 表格下载已开始`);
      setTimeout(() => setStatsMsg(null), 5000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '统计表格下载失败';
      setError(msg);
    } finally {
      setStatsDownloading(false);
    }
  };

  // ── 选择操作 ──
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredPoints.map((p) => p.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const invertSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set<number>();
      for (const p of filteredPoints) {
        if (!prev.has(p.id)) next.add(p.id);
      }
      return next;
    });
  };

  // 当前页是否全选（用于表头复选框的 indeterminate 状态）
  const allSelected = filteredPoints.length > 0 && selectedIds.size === filteredPoints.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < filteredPoints.length;

  if (!authed) {
    return <LoginModal onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-base-900">
      {/* 顶部栏 */}
      <header className="bg-base-800 border-b border-base-600 px-4 py-3 sm:px-6 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-accent/20 border border-accent/40 flex items-center justify-center">
              <span className="text-accent font-mono font-bold text-sm">A</span>
            </div>
            <div>
              <h1 className="font-mono text-base text-base-100">管理后台</h1>
              <p className="text-xs text-base-400">福州沿海码头避风点点位素材管理系统</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="text-xs text-base-300 hover:text-accent transition-colors font-mono border border-base-600 px-3 py-1.5 rounded"
            >
              上传页面 →
            </a>
            <button
              onClick={handleLogout}
              className="text-xs text-status-red hover:text-status-red/80 transition-colors font-mono border border-status-red/30 px-3 py-1.5 rounded"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-6 max-w-[1600px] mx-auto">
        {/* 统计概览 */}
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          <StatCard label="总点位数" value={stats.total} color="text-base-100" />
          <StatCard label="图片素材" value={stats.imgTotal} color="text-accent" />
          <StatCard label="视频素材" value={stats.videoTotal} color="text-accent" />
          <StatCard label="素材总数" value={stats.materialTotal} color="text-base-100" />
          <StatCard label="已完成" value={stats.completed} color="text-status-green" />
          <StatCard label="部分完成" value={stats.partial} color="text-status-yellow" />
          <StatCard label="未开始" value={stats.empty} color="text-status-red" />
        </div>

        {/* 批量下载工具栏（含点位选择操作） */}
        <BatchDownloadToolbar
          points={filteredPoints}
          selectedIds={selectedIds}
          downloading={batchDownloading}
          batchMsg={batchMsg}
          statsDownloading={statsDownloading}
          statsMsg={statsMsg}
          onDownload={handleBatchDownload}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onInvertSelection={invertSelection}
          onDownloadStats={handleDownloadStats}
        />

        {error && (
          <div className="mb-4 p-3 bg-status-red/10 border border-status-red/30 rounded text-sm text-status-red">
            {error}
          </div>
        )}

        {/* 筛选栏 */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-base-400 font-mono mr-2">筛选:</span>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`
                px-3 py-1.5 text-xs font-mono rounded transition-colors
                ${
                  filter === f.value
                    ? 'bg-accent text-base-900 font-medium'
                    : 'bg-base-700 text-base-300 border border-base-600 hover:bg-base-600'
                }
              `}
            >
              {f.label}
              <span
                className={`ml-1.5 ${filter === f.value ? 'text-base-900/70' : 'text-base-500'}`}
              >
                ({filterCounts[f.value]})
              </span>
            </button>
          ))}
          <span className="ml-auto text-xs text-base-400 font-mono">
            {loading ? '加载中...' : `共 ${filteredPoints.length} 条`}
          </span>
        </div>

        {/* 点位列表表格 */}
        <div className="bg-base-700 border border-base-600 rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-base-800 border-b border-base-600 text-xs font-mono text-base-400">
                <th className="text-center px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    checked={allSelected}
                    onChange={() => {
                      if (allSelected) clearSelection();
                      else selectAll();
                    }}
                    disabled={loading || filteredPoints.length === 0}
                    className="w-4 h-4 cursor-pointer accent-current"
                    title="全选/取消全选"
                  />
                </th>
                <th className="text-left px-4 py-3">序号</th>
                <th className="text-left px-4 py-3">区县</th>
                <th className="text-left px-4 py-3">名称</th>
                <th className="text-left px-4 py-3">经纬度</th>
                <th className="text-center px-2 py-3">图片数</th>
                <th className="text-center px-2 py-3">视频数</th>
                <th className="text-left px-4 py-3">最后上传</th>
                <th className="text-center px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-base-400">
                    加载中...
                  </td>
                </tr>
              ) : filteredPoints.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-base-400">
                    无符合条件的点位
                  </td>
                </tr>
              ) : (
                filteredPoints.map((p) => {
                  const isChecked = selectedIds.has(p.id);
                  return (
                    <tr
                      key={p.id}
                      className={`border-b border-base-600/50 hover:bg-base-600/30 transition-colors ${
                        isChecked ? 'bg-accent/10' : ''
                      }`}
                    >
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(p.id)}
                          className="w-4 h-4 cursor-pointer accent-current"
                          title={`选择点位 #${p.id}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-accent">#{p.id}</td>
                      <td className="px-4 py-3 text-base-200">{p.district}</td>
                      <td className="px-4 py-3 text-base-200">{p.name}</td>
                      <td className="px-4 py-3 text-base-400 font-mono text-xs">
                        {p.lon.toFixed(4)}, {p.lat.toFixed(4)}
                      </td>
                      <td className="px-2 py-3 text-center font-mono">
                        <span className={p.img_count > 0 ? 'text-status-green' : 'text-base-500'}>
                          {p.img_count}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-center font-mono">
                        <span className={p.video_count > 0 ? 'text-status-green' : 'text-base-500'}>
                          {p.video_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-base-400 text-xs font-mono">
                        {formatBeijingTime(p.upload_time) || '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openDetail(p.id)}
                            className="px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors"
                          >
                            查看
                          </button>
                          {p.uploaded_count > 0 && (
                            <button
                              onClick={() => setClearConfirm({ id: p.id })}
                              className="px-2 py-1 text-xs text-status-red hover:bg-status-red/10 rounded transition-colors"
                            >
                              清空
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* 素材详情弹窗 */}
      {detailPoint && (
        <MaterialDetailModal
          point={detailPoint}
          onClose={() => setDetailPoint(null)}
          onChanged={async () => {
            await loadPoints();
            // 刷新详情
            const updated = await adminFetchPointDetail(detailPoint.id);
            setDetailPoint(updated);
          }}
        />
      )}

      {/* 加载中提示 */}
      {detailLoading && !detailPoint && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="text-base-200 font-mono animate-pulse">加载中...</div>
        </div>
      )}

      {/* 清空确认 */}
      {clearConfirm && (
        <ConfirmDialog
          title="确认清空素材"
          message={`确定清空点位 #${clearConfirm.id} 的全部素材吗？此操作不可撤销。`}
          confirmText="确认清空"
          onConfirm={() => {
            handleClearAll(clearConfirm.id);
            setClearConfirm(null);
          }}
          onCancel={() => setClearConfirm(null)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-base-700 border border-base-600 rounded-lg p-3">
      <div className="text-xs text-base-400 font-mono mb-1">{label}</div>
      <div className={`font-mono text-2xl ${color}`}>{value}</div>
    </div>
  );
}
