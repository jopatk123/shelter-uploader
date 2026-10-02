/**
 * 限流中间件单元测试
 * 覆盖：窗口内放行、超限返回 429、窗口过期后重置、按来源 IP 独立计数
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createRateLimiter } from '../../api/middleware/rateLimit.js';

/** 限流中间件实际使用到的响应能力（用于测试断言） */
interface FakeResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  status(code: number): FakeResponse;
  json(payload: unknown): FakeResponse;
}

/** 构造最小可用的 req / res / next 替身 */
function makeCtx(ip: string) {
  const req = { ip } as Request;
  const res: FakeResponse = {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, resAsResponse: res as unknown as Response };
}

describe('createRateLimiter', () => {
  it('窗口内未超过上限时全部放行', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 3 });

    for (let i = 0; i < 3; i++) {
      const { req, res, resAsResponse, next } = makeCtx('1.1.1.1');
      limiter(req, resAsResponse, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    }
  });

  it('超过上限返回 429 且不进入后续处理', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2, message: '太频繁' });

    for (let i = 0; i < 2; i++) {
      const { req, resAsResponse, next } = makeCtx('2.2.2.2');
      limiter(req, resAsResponse, next);
    }

    const { req, res, resAsResponse, next } = makeCtx('2.2.2.2');
    limiter(req, resAsResponse, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ success: false, error: '太频繁' });
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('不同来源 IP 各自独立计数', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });

    const a = makeCtx('3.3.3.3');
    limiter(a.req, a.resAsResponse, a.next);
    expect(a.next).toHaveBeenCalledTimes(1);

    // 同一 IP 第二次被限流
    const a2 = makeCtx('3.3.3.3');
    limiter(a2.req, a2.resAsResponse, a2.next);
    expect(a2.res.statusCode).toBe(429);

    // 另一 IP 不受影响
    const b = makeCtx('4.4.4.4');
    limiter(b.req, b.resAsResponse, b.next);
    expect(b.next).toHaveBeenCalledTimes(1);
  });

  it('窗口过期后计数重置', () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter({ windowMs: 1000, max: 1 });

      const first = makeCtx('5.5.5.5');
      limiter(first.req, first.resAsResponse, first.next);
      expect(first.next).toHaveBeenCalledTimes(1);

      const blocked = makeCtx('5.5.5.5');
      limiter(blocked.req, blocked.resAsResponse, blocked.next);
      expect(blocked.res.statusCode).toBe(429);

      vi.advanceTimersByTime(1001);

      const afterWindow = makeCtx('5.5.5.5');
      limiter(afterWindow.req, afterWindow.resAsResponse, afterWindow.next);
      expect(afterWindow.next).toHaveBeenCalledTimes(1);
      expect(afterWindow.res.statusCode).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
