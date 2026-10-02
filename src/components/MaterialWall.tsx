/**
 * 素材墙组件
 * 展示当前选中点位已上传的全部素材（数量不限）
 *
 * 说明：/storage 静态资源受管理员鉴权保护，上传页为公开页面，
 * 因此这里以清单形式展示（类型 / 文件名 / 大小 / 上传时间），不做图片预览。
 * 需要缩略图预览请到管理后台的素材详情查看。
 */
import type { MaterialItem } from '@/types';
import { formatFileSize, formatBeijingTime } from '@/lib/utils';

interface Props {
  materials: MaterialItem[];
  loading: boolean;
}

export default function MaterialWall({ materials, loading }: Props) {
  const imgCount = materials.filter((m) => m.type === 'img').length;
  const videoCount = materials.length - imgCount;

  return (
    <div className="bg-base-700 border border-base-600 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-sm text-base-100 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent"></span>
          已上传素材
        </h3>
        <span className="text-xs text-base-400 font-mono">
          图片 {imgCount} · 视频 {videoCount} · 共 {materials.length}
        </span>
      </div>

      {loading ? (
        <div className="text-center text-sm text-base-400 py-6 animate-pulse">
          加载素材列表中...
        </div>
      ) : materials.length === 0 ? (
        <div className="text-center text-sm text-base-400 py-6 border border-dashed border-base-600 rounded">
          该点位暂无已上传素材
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {materials.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 p-3 bg-base-800 border border-base-600 rounded text-xs font-mono"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={`px-1.5 py-0.5 rounded shrink-0 ${
                    m.type === 'img'
                      ? 'bg-accent/20 text-accent'
                      : 'bg-status-yellow/20 text-status-yellow'
                  }`}
                >
                  {m.type === 'img' ? '图片' : '视频'}
                </span>
                <span className="text-base-200 truncate" title={m.path}>
                  {m.path.split('/').pop()}
                </span>
              </span>
              <span className="flex items-center gap-3 shrink-0 text-base-400">
                <span>{formatFileSize(m.size)}</span>
                <span title={formatBeijingTime(m.upload_time)}>
                  {formatBeijingTime(m.upload_time) || '-'}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
