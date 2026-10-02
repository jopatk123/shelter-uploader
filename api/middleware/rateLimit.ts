/**
 * 轻量内存限流中间件（固定窗口计数，按来源 IP 维度）
 *
 * 使用场景：
 *   - 管理员登录：防止密码被离线/在线暴力破解
 *   - 上传接口：限制单 IP 的分片写入速率，配合单文件大小上限约束磁盘占用
 *
 * 设计取舍：
 *   - 单进程内存实现，不引入 redis 等外部依赖；容器为单实例部署，足够
 *   - 键为 req.ip。未启用 trust proxy，直连部署（IP:PORT）下即客户端真实 IP；
 *     若后续在前置 Nginx 后运行，需相应开启 trust proxy 才能按真实 IP 区分
 *   - 惰性清理：仅当记录数超过阈值时扫描剔除过期项，避免高频请求下的 O(n) 开销
 */
import type { Request, Response, NextFunction } from 'express';

interface Hit {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** 统计窗口长度（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大请求数，超出返回 429 */
  max: number;
  /** 触发限流时的错误提示 */
  message?: string;
}

/** 记录数超过该阈值时执行一次过期项清理 */
const SWEEP_THRESHOLD = 10000;

/**
 * 创建限流中间件
 * 每次调用返回独立实例，各自维护自己的计数（便于不同接口使用不同阈值）
 */
export function createRateLimiter({ windowMs, max, message }: RateLimitOptions) {
  const hits = new Map<string, Hit>();

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();

    // 惰性清理过期记录，防止 Map 随访问 IP 增长而无界膨胀
    if (hits.size > SWEEP_THRESHOLD) {
      for (const [key, hit] of hits) {
        if (hit.resetAt <= now) hits.delete(key);
      }
    }

    const key = req.ip ?? 'unknown';
    const hit = hits.get(key);

    // 新窗口：重置计数
    if (!hit || hit.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    hit.count += 1;
    if (hit.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((hit.resetAt - now) / 1000)));
      res.status(429).json({ success: false, error: message ?? '请求过于频繁，请稍后再试' });
      return;
    }

    next();
  };
}
