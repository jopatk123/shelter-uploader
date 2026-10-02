/**
 * 批量下载工具栏
 *
 * 上下文感知：
 *   - 未选中任何点位：按钮显示"下载全部 (M)"，行为同原批量下载
 *   - 选中若干点位：按钮显示"下载选中 (N)"，仅下载选中点位中已上传该类型素材的部分
 *
 * 配合点位的复选框列使用，由父组件维护 selectedIds。
 */
import type { MaterialType, PointStatus } from '@/types';

const BATCH_TYPES: { type: MaterialType; label: string; shortLabel: string }[] = [
  { type: 'img', label: '主图片', shortLabel: '图片' },
  { type: 'img_alt', label: '备选图片', shortLabel: '备图' },
  { type: 'video', label: '主视频', shortLabel: '视频' },
  { type: 'video_alt', label: '备选视频', shortLabel: '备视频' },
];

/** MaterialType → PointStatus 上的 has_xxx 字段名 */
const HAS_KEY: Record<MaterialType, keyof PointStatus> = {
  img: 'has_image',
  img_alt: 'has_image_alt',
  video: 'has_video',
  video_alt: 'has_video_alt',
};

interface Props {
  points: PointStatus[];
  selectedIds: Set<number>;
  downloading: MaterialType | null;
  batchMsg: string | null;
  statsDownloading: boolean;
  statsMsg: string | null;
  onDownload: (type: MaterialType, ids?: number[]) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onInvertSelection: () => void;
  onDownloadStats: (ids?: number[]) => void;
}

export default function BatchDownloadToolbar({
  points,
  selectedIds,
  downloading,
  batchMsg,
  statsDownloading,
  statsMsg,
  onDownload,
  onSelectAll,
  onClearSelection,
  onInvertSelection,
  onDownloadStats,
}: Props) {
  const hasSelection = selectedIds.size > 0;
  const selectedIdsArr = Array.from(selectedIds);

  // 在"选中"模式下，仅统计选中点位中已上传对应类型素材的数量
  // 在"全部"模式下，统计全部已上传该类型素材的数量
  const countFor = (type: MaterialType): number => {
    const key = HAS_KEY[type];
    const pool = hasSelection ? points.filter((p) => selectedIds.has(p.id)) : points;
    return pool.filter((p) => p[key]).length;
  };

  return (
    <div className="mb-4 p-3 bg-base-700 border border-base-600 rounded-lg space-y-3">
      {/* 选择操作行 */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-base-400 font-mono">点位选择:</span>
        <button
          onClick={onSelectAll}
          className="px-3 py-1.5 text-xs font-mono rounded border bg-base-700 text-base-300 border-base-600 hover:bg-base-600 transition-colors"
        >
          全选
        </button>
        <button
          onClick={onClearSelection}
          disabled={selectedIds.size === 0}
          className="px-3 py-1.5 text-xs font-mono rounded border bg-base-700 text-base-300 border-base-600 hover:bg-base-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          清空选择
        </button>
        <button
          onClick={onInvertSelection}
          disabled={points.length === 0}
          className="px-3 py-1.5 text-xs font-mono rounded border bg-base-700 text-base-300 border-base-600 hover:bg-base-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          反选
        </button>
        <span className={`text-xs font-mono ${hasSelection ? 'text-accent' : 'text-base-400'}`}>
          {hasSelection
            ? `已选 ${selectedIds.size} / ${points.length} 个点位（仅下载选中）`
            : `共 ${points.length} 个点位（将下载全部）`}
        </span>
      </div>

      {/* 类型按钮行 */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-base-400 font-mono">批量下载:</span>
        {BATCH_TYPES.map((bt) => {
          const count = countFor(bt.type);
          const isDownloading = downloading === bt.type;
          const isAlt = bt.type.endsWith('_alt');
          const colorClass = isAlt
            ? 'bg-status-yellow/20 border-status-yellow/40 text-status-yellow hover:bg-status-yellow/30'
            : 'bg-accent/20 border-accent/40 text-accent hover:bg-accent/30';
          const labelPrefix = hasSelection ? '下载选中' : '下载全部';
          return (
            <button
              key={bt.type}
              onClick={() => onDownload(bt.type, hasSelection ? selectedIdsArr : undefined)}
              disabled={downloading !== null || count === 0}
              title={
                hasSelection ? `仅下载选中点位中已上传的${bt.label}` : `下载全部已上传的${bt.label}`
              }
              className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${colorClass}`}
            >
              {isDownloading && (
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
              )}
              {isDownloading ? `打包${bt.shortLabel}中...` : `${labelPrefix}${bt.label} (${count})`}
            </button>
          );
        })}
        {batchMsg && (
          <span className="text-xs text-status-green font-mono ml-auto">{batchMsg}</span>
        )}
      </div>

      {/* 统计表格下载行 */}
      <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-base-600/50">
        <span className="text-xs text-base-400 font-mono">统计导出:</span>
        <button
          onClick={() => onDownloadStats(hasSelection ? selectedIdsArr : undefined)}
          disabled={statsDownloading || downloading !== null || points.length === 0}
          title={
            hasSelection
              ? `导出选中的 ${selectedIds.size} 个点位统计为 CSV 表格`
              : `导出全部 ${points.length} 个点位统计为 CSV 表格`
          }
          className="px-3 py-1.5 text-xs font-mono rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 bg-base-300/20 border-base-300/40 text-base-100 hover:bg-base-300/30"
        >
          {statsDownloading && (
            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
          )}
          {statsDownloading
            ? '生成表格中...'
            : `${hasSelection ? '导出选中' : '导出全部'}统计表格 (${hasSelection ? selectedIds.size : points.length})`}
        </button>
        <span className="text-xs text-base-500 font-mono">
          CSV 含区域、经纬度、各素材上传状态、完成度等
        </span>
        {statsMsg && (
          <span className="text-xs text-status-green font-mono ml-auto">{statsMsg}</span>
        )}
      </div>
    </div>
  );
}
