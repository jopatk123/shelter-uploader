/**
 * 点位状态点阵组件
 * 141个圆点：绿色=主图+主视频全部完成，黄色=仅上传其一（统计算完成），红色=均未上传
 * 点阵上方增加按区域（区县）分组的统计，一眼看出各区域完成进度
 * 点击区域卡片可高亮闪烁该区域对应的点位
 */
import { useState, useMemo } from 'react';
import type { PointStatus } from '@/types';
import { getPointState, type PointState } from '@/lib/utils';

interface Props {
  points: PointStatus[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  statsDownloading?: boolean;
  onDownloadStats?: () => void;
}

interface RegionStat {
  name: string;
  total: number;
  completed: number;
  partial: number;
}

// 状态 → 圆点背景色 / 光晕颜色
const STATE_BG: Record<PointState, string> = {
  complete: 'bg-status-green',
  partial: 'bg-status-yellow',
  empty: 'bg-status-red',
};
const STATE_GLOW: Record<PointState, string> = {
  complete: '0 0 6px #22c55e88',
  partial: '0 0 6px #f59e0b88',
  empty: '0 0 6px #ef444488',
};

export default function PointDotGrid({
  points,
  selectedId,
  onSelect,
  statsDownloading,
  onDownloadStats,
}: Props) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [highlightedDistrict, setHighlightedDistrict] = useState<string | null>(null);

  const completedCount = points.filter((p) => p.has_image || p.has_video).length;
  const partialCount = points.filter(
    (p) => getPointState(p.has_image, p.has_video) === 'partial',
  ).length;

  // 按区县分组统计
  const regionStats = useMemo<RegionStat[]>(() => {
    const map = new Map<string, RegionStat>();
    for (const p of points) {
      let stat = map.get(p.district);
      if (!stat) {
        stat = { name: p.district, total: 0, completed: 0, partial: 0 };
        map.set(p.district, stat);
      }
      stat.total++;
      const state = getPointState(p.has_image, p.has_video);
      if (state === 'complete' || state === 'partial') stat.completed++;
      if (state === 'partial') stat.partial++;
    }
    // 按总数降序排列
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [points]);

  const totalPercent = points.length > 0 ? Math.round((completedCount / points.length) * 100) : 0;

  const handleRegionClick = (districtName: string) => {
    setHighlightedDistrict(highlightedDistrict === districtName ? null : districtName);
  };

  return (
    <div className="bg-base-700 border border-base-600 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="font-mono text-sm text-base-200">
            点位状态总览
            <span className="ml-2 text-base-400">
              完成 {completedCount} · 部分 {partialCount} · 共 {points.length}
            </span>
            <span className="ml-2 text-accent font-bold">{totalPercent}%</span>
          </h3>
          {onDownloadStats && (
            <button
              onClick={onDownloadStats}
              disabled={statsDownloading || points.length === 0}
              title="导出全部点位统计为 CSV 表格（含区域、经纬度、各素材上传状态等）"
              className="px-3 py-1.5 text-xs font-mono rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 bg-base-300/20 border-base-300/40 text-base-100 hover:bg-base-300/30"
            >
              {statsDownloading && (
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
              )}
              {statsDownloading ? '生成表格中...' : '导出统计表格'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-base-300">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-status-green"></span>
            全部完成
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-status-yellow"></span>
            部分完成
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-status-red"></span>
            未开始
          </span>
        </div>
      </div>

      {/* 按区域分组统计 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        {regionStats.map((r) => {
          const percent = r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0;
          const isAllDone = r.completed === r.total;
          // 区域整体状态：全部完成→绿；存在部分完成→黄；否则→青
          const barColor = isAllDone
            ? 'bg-status-green'
            : r.partial > 0
              ? 'bg-status-yellow'
              : 'bg-accent';
          const isActive = highlightedDistrict === r.name;
          return (
            <button
              key={r.name}
              onClick={() => handleRegionClick(r.name)}
              className={`
                bg-base-800 border rounded-lg p-3 text-left
                transition-all duration-200 cursor-pointer
                hover:bg-base-800/80 hover:border-accent/60 hover:shadow-lg hover:shadow-accent/10
                ${isActive ? 'border-accent shadow-md shadow-accent/30 ring-2 ring-accent/30' : 'border-base-600'}
              `}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-xs text-base-100 truncate">{r.name}</span>
                <span
                  className={`font-mono text-xs ${isAllDone ? 'text-status-green' : 'text-base-400'}`}
                >
                  {r.completed}/{r.total} · {percent}%
                </span>
              </div>
              <div className="h-1.5 bg-base-900 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColor}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] text-base-400 font-mono">
                {isAllDone
                  ? '已完成'
                  : `缺 ${r.total - r.completed} 个${r.partial > 0 ? ` · 部分 ${r.partial}` : ''}`}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-47 gap-1.5" style={{ gridTemplateColumns: 'repeat(47, 1fr)' }}>
        {points.map((p) => {
          const state = getPointState(p.has_image, p.has_video);
          const isSelected = p.id === selectedId;
          const isHovered = p.id === hoveredId;
          const isHighlighted = highlightedDistrict !== null && highlightedDistrict === p.district;
          const hasActiveHighlight = highlightedDistrict !== null;

          let scale = 1;
          if (isSelected) {
            scale = 1.1;
          } else if (isHovered) {
            scale = 1.25;
          } else if (isHighlighted) {
            scale = 1.1;
          } else if (hasActiveHighlight) {
            scale = 0.7;
          }

          return (
            <div
              key={p.id}
              className="relative cursor-pointer"
              onMouseEnter={() => setHoveredId(p.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelect(p.id)}
            >
              <div
                className={`
                  w-full aspect-square rounded-full transition-all duration-150
                  ${STATE_BG[state]}
                  ${isSelected ? 'ring-2 ring-accent ring-offset-2 ring-offset-base-700' : ''}
                  ${isHighlighted ? 'ring-1 ring-accent ring-offset-1 ring-offset-base-700' : ''}
                  hover:shadow-lg
                `}
                style={{
                  transform: `scale(${scale})`,
                  boxShadow: isHighlighted ? '0 0 6px #00d4ff66' : STATE_GLOW[state],
                }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-[8px] font-mono text-base-900 font-bold pointer-events-none">
                {p.id}
              </span>

              {isHovered && (
                <div className="dot-tooltip font-mono">
                  <span className="text-accent">#{p.id}</span> {p.name}
                  <br />
                  <span className="text-base-300">
                    {[p.township, p.station].filter(Boolean).join(' · ') || p.district}
                  </span>
                  <br />
                  <span className="text-base-400 text-[10px]">
                    {p.lon.toFixed(4)}, {p.lat.toFixed(4)}
                  </span>
                  <br />
                  <span className="text-base-300 text-[10px]">
                    图: {p.has_image ? '✓' : '✗'} 视频: {p.has_video ? '✓' : '✗'}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
