/**
 * 上传队列汇总派生逻辑单测
 */
import { describe, it, expect } from 'vitest';
import { summarizeQueue, type QueueStatus } from '@/lib/queueSummary';

/** 便捷构造：用状态字符序列生成队列条目 */
const of = (...statuses: QueueStatus[]) => statuses.map((status) => ({ status }));

describe('summarizeQueue', () => {
  it('空队列不产出结论，且百分比为 0', () => {
    const result = summarizeQueue([], '张');
    expect(result.total).toBe(0);
    expect(result.percent).toBe(0);
    expect(result.conclusion).toBeNull();
  });

  it('统计各状态数量与落定进度', () => {
    const result = summarizeQueue(of('done', 'done', 'error', 'pending', 'uploading'), '张');
    expect(result.total).toBe(5);
    expect(result.done).toBe(2);
    expect(result.error).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.uploading).toBe(1);
    expect(result.settled).toBe(3);
    expect(result.active).toBe(2);
    expect(result.percent).toBe(60);
  });

  it('队列仍在进行时不给结论，避免争抢注意力', () => {
    expect(summarizeQueue(of('done', 'uploading'), '张').conclusion).toBeNull();
    expect(summarizeQueue(of('done', 'pending'), '张').conclusion).toBeNull();
  });

  it('全部成功时给出成功结论', () => {
    const result = summarizeQueue(of('done', 'done', 'done'), '个');
    expect(result.conclusion).toEqual({ tone: 'ok', text: '本批 3 个全部上传完成' });
  });

  it('全部失败时给出失败结论', () => {
    const result = summarizeQueue(of('error', 'error'), '张');
    expect(result.conclusion).toEqual({
      tone: 'bad',
      text: '本批 2 张全部失败，请查看下方原因后重试',
    });
  });

  it('部分失败时同时报出成功与失败数（提示可重试）', () => {
    const result = summarizeQueue(of('done', 'done', 'error'), '张');
    expect(result.conclusion).toEqual({
      tone: 'warn',
      text: '2 张成功，1 张失败，失败项可重试',
    });
  });

  it('跨补件入队后计数保持一致（回归：原先新一批文件会把成功数清零）', () => {
    // 第一批 3 张成功后再加入第二批 2 张失败，成功数必须仍为 3
    const result = summarizeQueue(of('done', 'done', 'done', 'error', 'error'), '张');
    expect(result.done).toBe(3);
    expect(result.error).toBe(2);
    expect(result.percent).toBe(100);
  });

  it('计数单位按素材类型透传到文案', () => {
    expect(summarizeQueue(of('done'), '个').conclusion?.text).toContain('个');
    expect(summarizeQueue(of('done'), '张').conclusion?.text).toContain('张');
  });
});
