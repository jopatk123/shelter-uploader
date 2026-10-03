/**
 * 上传队列汇总派生逻辑
 *
 * 原先各上传面板用独立的 successCount state 记录成功数，并在新一批文件入队时清零，
 * 结果队列里仍显示「✓ 完成」的条目与「本批已上传 0 张」互相矛盾。
 * 改为从队列条目**纯派生**后两者天然一致，也便于单测。
 */

/** 队列条目状态 */
export type QueueStatus = 'pending' | 'uploading' | 'done' | 'error';

/** 队列汇总信息 */
export interface QueueSummary {
  total: number;
  pending: number;
  uploading: number;
  done: number;
  error: number;
  /** 已落定（成功或失败）的数量 */
  settled: number;
  /** 仍在排队或上传中的数量 */
  active: number;
  /** 落定比例（整数百分比） */
  percent: number;
  /**
   * 队列静止时给出的结论；队列仍在进行时为 null，
   * 避免在用户还在等待时反复闪结点类型的提示
   */
  conclusion: { tone: 'ok' | 'warn' | 'bad'; text: string } | null;
}

/**
 * 依据队列条目状态派生汇总与结论文案
 *
 * @param items 队列条目（只读取 status）
 * @param unit 计数单位：图片用「张」，视频用「个」
 */
export function summarizeQueue(
  items: readonly { status: QueueStatus }[],
  unit: string,
): QueueSummary {
  const countOf = (status: QueueStatus) => items.filter((it) => it.status === status).length;

  const pending = countOf('pending');
  const uploading = countOf('uploading');
  const done = countOf('done');
  const error = countOf('error');
  const total = items.length;
  const settled = done + error;
  const active = pending + uploading;
  const percent = total > 0 ? Math.round((settled / total) * 100) : 0;

  let conclusion: QueueSummary['conclusion'] = null;
  if (total > 0 && active === 0) {
    if (error === 0) {
      conclusion = { tone: 'ok', text: `本批 ${total} ${unit}全部上传完成` };
    } else if (done === 0) {
      conclusion = { tone: 'bad', text: `本批 ${total} ${unit}全部失败，请查看下方原因后重试` };
    } else {
      conclusion = {
        tone: 'warn',
        text: `${done} ${unit}成功，${error} ${unit}失败，失败项可重试`,
      };
    }
  }

  return { total, pending, uploading, done, error, settled, active, percent, conclusion };
}
