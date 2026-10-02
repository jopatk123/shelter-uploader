/**
 * 前端上传工具函数单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateFileId, uploadFile } from '@/lib/upload';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('upload 工具函数', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('generateFileId', () => {
    it('生成包含扩展名的 ID', () => {
      const file = { name: 'test.jpg' } as unknown as File;
      const id = generateFileId(file);
      expect(id.endsWith('.jpg')).toBe(true);
    });

    it('不同次调用生成不同 ID', () => {
      const file = { name: 'a.png' } as unknown as File;
      const ids = new Set([generateFileId(file), generateFileId(file)]);
      expect(ids.size).toBe(2);
    });

    it('无扩展名文件也能正常生成', () => {
      const file = { name: 'noext' } as unknown as File;
      const id = generateFileId(file);
      expect(id).toBeTruthy();
    });
  });

  describe('uploadFile', () => {
    it('完整上传2片视频并合并', async () => {
      const buf = Buffer.alloc(7 * 1024 * 1024, 2);
      const blob = new Blob([buf]);

      // chunk1 OK
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
      // chunk2 OK
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
      // complete OK
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ success: true }),
      });

      const progresses: { phase: string; percent: number }[] = [];
      await uploadFile(blob, 'test.mp4', 1, 'video', 'fid', (p) => {
        progresses.push({ phase: p.phase, percent: p.percent });
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(progresses[progresses.length - 1].phase).toBe('done');
      expect(progresses[progresses.length - 1].percent).toBe(100);
    });

    it('分片上传失败抛错（4xx 客户端错误不重试）', async () => {
      const buf = Buffer.alloc(6 * 1024 * 1024, 3);
      const blob = new Blob([buf]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: '磁盘已满' }),
      });

      await expect(uploadFile(blob, 'test.mp4', 1, 'video', 'fid', () => {})).rejects.toThrow(
        '磁盘已满',
      );
      // 4xx 不重试，仅请求一次
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('5xx 服务端错误自动重试后成功', async () => {
      const buf = Buffer.alloc(3 * 1024 * 1024, 5);
      const blob = new Blob([buf]);

      // 第一次 500，重试一次后成功
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: '服务器内部错误' }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
        // complete
        .mockResolvedValueOnce({ json: async () => ({ success: true }) });

      vi.useFakeTimers();
      try {
        const p = uploadFile(blob, 'test.mp4', 1, 'video', 'fid', () => {});
        await vi.advanceTimersByTimeAsync(2000);
        await p;
      } finally {
        vi.useRealTimers();
      }

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('5xx 重试用尽后抛出最后一次错误', async () => {
      const buf = Buffer.alloc(3 * 1024 * 1024, 6);
      const blob = new Blob([buf]);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: '磁盘已满' }),
      });

      vi.useFakeTimers();
      try {
        const p = uploadFile(blob, 'test.mp4', 1, 'video', 'fid', () => {});
        // 先附加断言再推进时钟：否则 promise 在 advanceTimersByTimeAsync 期间
        // reject 时暂无 handler，会被 Vitest 判定为 unhandled rejection
        const assertion = expect(p).rejects.toThrow('磁盘已满');
        await vi.advanceTimersByTimeAsync(5000);
        await assertion;
      } finally {
        vi.useRealTimers();
      }

      // 首次 + 2 次重试
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('合并失败抛错', async () => {
      const buf = Buffer.alloc(3 * 1024 * 1024, 4);
      const blob = new Blob([buf]);

      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ success: false, error: '合并失败' }),
      });

      await expect(uploadFile(blob, 'test.mp4', 1, 'video', 'fid', () => {})).rejects.toThrow(
        '合并失败',
      );
    });
  });
});
