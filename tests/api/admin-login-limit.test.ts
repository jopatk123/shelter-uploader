/**
 * 管理员登录限流测试
 * 登录接口按 IP 限制为 15 分钟 20 次，超过返回 429
 *
 * 说明：限流计数器为模块级单例，本文件单独运行时初始计数为 0，
 * 因此需要在同一文件内连续发起 20 次请求来触达阈值。
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/app.js';

const MAX_ATTEMPTS = 20;

describe('管理员登录 - 限流', () => {
  it(`连续 ${MAX_ATTEMPTS} 次错误密码后第 ${MAX_ATTEMPTS + 1} 次请求返回 429`, async () => {
    // 前 MAX_ATTEMPTS 次均正常返回 401（密码错误，而非被限流）
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ password: `wrong-${i}` });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app).post('/api/admin/login').send({ password: 'wrong-final' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    expect(blocked.body.error).toContain('频繁');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('被限流后即使密码正确也不放行', async () => {
    const correct = process.env.ADMIN_PASSWORD || '123456';
    const res = await request(app).post('/api/admin/login').send({ password: correct });
    expect(res.status).toBe(429);
  });
});
