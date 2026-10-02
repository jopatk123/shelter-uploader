/**
 * 鉴权中间件单元测试
 * 覆盖：密码校验、Token 生成与验证、错误分支
 */
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';

// 设置测试环境变量（在 import 模块前）
process.env.ADMIN_PASSWORD = '123456';
process.env.JWT_SECRET = 'test-secret-key';

const { generateToken, verifyPassword, authMiddleware } =
  await import('../../api/middleware/auth.js');

describe('auth middleware', () => {
  describe('verifyPassword', () => {
    it('正确密码返回 true', () => {
      expect(verifyPassword('123456')).toBe(true);
    });

    it('错误密码返回 false', () => {
      expect(verifyPassword('wrong')).toBe(false);
    });

    it('空密码返回 false', () => {
      expect(verifyPassword('')).toBe(false);
    });
  });

  describe('generateToken', () => {
    it('返回有效 JWT token，包含 admin role', () => {
      const token = generateToken();
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, 'test-secret-key') as jwt.JwtPayload;
      expect(decoded.role).toBe('admin');
      expect(decoded.exp).toBeDefined();
    });

    it('不同次调用生成不同 token（iat 不同）', async () => {
      const t1 = generateToken();
      await new Promise((r) => setTimeout(r, 1100));
      const t2 = generateToken();
      expect(t1).not.toBe(t2);
    });
  });

  describe('authMiddleware', () => {
    const mockRes = () => {
      const res: any = {
        statusCode: 200,
        body: null as unknown,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(data: unknown) {
          this.body = data;
          return this;
        },
      };
      return res;
    };

    it('缺少 Authorization 头返回 403', () => {
      const req = { headers: {} } as any;
      const res = mockRes();
      const next = () => {
        throw new Error('next 不应被调用');
      };

      authMiddleware(req, res, next);
      expect(res.statusCode).toBe(403);
      expect((res.body as any).success).toBe(false);
    });

    it('Authorization 头不带 Bearer 前缀返回 403', () => {
      const req = { headers: { authorization: 'Basic abc' } } as any;
      const res = mockRes();
      authMiddleware(req, res, () => {
        throw new Error('next 不应被调用');
      });

      expect(res.statusCode).toBe(403);
    });

    it('无效 Token 返回 403', () => {
      const req = { headers: { authorization: 'Bearer invalid.token.here' } } as any;
      const res = mockRes();
      authMiddleware(req, res, () => {
        throw new Error('next 不应被调用');
      });

      expect(res.statusCode).toBe(403);
      expect((res.body as any).error).toContain('Token');
    });

    it('有效 Token 调用 next', () => {
      const token = generateToken();
      const req = { headers: { authorization: `Bearer ${token}` } } as any;
      const res = mockRes();
      let called = false;
      authMiddleware(req, res, () => {
        called = true;
      });

      expect(called).toBe(true);
      expect(res.statusCode).toBe(200);
    });
  });
});
