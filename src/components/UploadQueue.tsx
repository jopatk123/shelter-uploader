/**
 * 上传队列 UI（图片 / 视频上传面板共用）
 *
 * 收敛两处原本复制粘贴的队列渲染：计数汇总、结果结论条、条目行、进度条。
 * 队列状态仍由各面板持有，这里只负责渲染 + 派发操作回调。
 */
import ProgressBar from '@/components/ProgressBar';
import { formatFileSize } from '@/lib/utils';
import { summarizeQueue, type QueueStatus } from '@/lib/queueSummary';
import type { UploadProgress } from '@/lib/upload';

/**
 * 队列条目的视图形态
 * 只暴露渲染所需字段，避免高层面板的内部结构泄漏到 UI 组件
 */
export interface QueueItemView {
  key: string;
  name: string;
  size: number;
  status: QueueStatus;
  progress: UploadProgress | null;
  error?: string;
}

interface Props {
  items: QueueItemView[];
  /** 计数单位：图片用「张」，视频用「个」 */
  unit: string;
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
  onClearFinished: () => void;
  /**
   * 压缩阶段需要区别于上传阶段的进度条配色；视频无压缩阶段，恒返回 'default'
   */
  progressVariantFor: (phase: UploadProgress['phase']) => 'default' | 'compress';
}

/** 单个队列行的状态标签 */
function StatusTag({ status }: { status: QueueStatus }) {
  if (status === 'pending') return <span className="text-base-400">排队中</span>;
  if (status === 'done') return <span className="text-status-green">✓ 完成</span>;
  if (status === 'error') return <span className="text-status-red">✗ 失败</span>;
  return (
    <span className="flex items-center gap-1 text-accent">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
      上传中
    </span>
  );
}

export default function UploadQueue({
  items,
  unit,
  onRetry,
  onRemove,
  onClearFinished,
  progressVariantFor,
}: Props) {
  if (items.length === 0) return null;

  // 计数与结论文案统一由纯函数派生，避免各面板自行维护成功数导致口径不一致
  const summary = summarizeQueue(items, unit);
  const { done, error, settled, total, active, percent, conclusion } = summary;

  const conclusionClass =
    conclusion?.tone === 'ok'
      ? 'bg-status-green/10 border-status-green/30 text-status-green'
      : conclusion?.tone === 'warn'
        ? 'bg-status-yellow/10 border-status-yellow/30 text-status-yellow'
        : 'bg-status-red/10 border-status-red/30 text-status-red';

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-base-300">
          队列 {settled}/{total}
          {error > 0 && <span className="text-status-red"> · {error} 失败</span>}
          {active > 0 && <span className="text-accent"> · {active} 进行中</span>}
        </span>
        {done > 0 && (
          <button
            type="button"
            onClick={onClearFinished}
            className="rounded px-2 py-1 text-xs font-mono text-base-400 transition-colors hover:text-base-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            清除已完成
          </button>
        )}
      </div>
      <ProgressBar percent={percent} />

      {conclusion && (
        <div role="status" className={`mt-3 rounded border p-2.5 text-xs ${conclusionClass}`}>
          {conclusion.text}
        </div>
      )}

      <ol className="mt-3 space-y-2">
        {items.map((item, index) => (
          <li
            key={item.key}
            className={`rounded border p-3 font-mono text-xs ${
              item.status === 'error'
                ? 'border-status-red/40 bg-status-red/5'
                : item.status === 'done'
                  ? 'border-base-600 bg-base-800/60'
                  : 'border-base-600 bg-base-800'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-base-400">#{index + 1}</span>
                <span className="truncate text-base-200" title={item.name}>
                  {item.name}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-base-400">{formatFileSize(item.size)}</span>
                <StatusTag status={item.status} />
                {item.status === 'error' && (
                  <button
                    type="button"
                    onClick={() => onRetry(item.key)}
                    className="inline-flex min-h-[28px] items-center rounded bg-status-red/20 px-2.5 text-status-red transition-colors hover:bg-status-red/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/60"
                  >
                    重试
                  </button>
                )}
                {item.status !== 'uploading' && (
                  <button
                    type="button"
                    onClick={() => onRemove(item.key)}
                    title="移除该条目"
                    aria-label={`移除 ${item.name}`}
                    className="inline-flex min-h-[28px] items-center rounded px-2 text-base-400 transition-colors hover:text-base-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    ✕
                  </button>
                )}
              </span>
            </div>

            {item.status === 'uploading' && item.progress && (
              <div className="mt-2">
                <ProgressBar
                  percent={item.progress.percent}
                  label={item.progress.message}
                  variant={progressVariantFor(item.progress.phase)}
                />
              </div>
            )}

            {item.status === 'error' && item.error && (
              <p className="mt-1 break-all text-status-red">{item.error}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
