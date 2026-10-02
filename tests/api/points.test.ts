/**
 * 公开点位接口测试
 * GET /api/points
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/app.js';

describe('GET /api/points', () => {
  it('返回成功响应且包含 141 个点位', async () => {
    const res = await request(app).get('/api/points');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(141);
  });

  it('点位数据结构正确', async () => {
    const res = await request(app).get('/api/points');
    const first = res.body.data[0];

    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('district');
    expect(first).toHaveProperty('township');
    expect(first).toHaveProperty('station');
    expect(first).toHaveProperty('lon');
    expect(first).toHaveProperty('lat');
    expect(first).toHaveProperty('has_image');
    expect(first).toHaveProperty('has_video');
    expect(first).toHaveProperty('upload_time');
    expect(typeof first.id).toBe('number');
    expect(typeof first.has_image).toBe('boolean');
    expect(typeof first.has_video).toBe('boolean');
  });

  it('初始状态下所有点位素材状态为 false', async () => {
    const res = await request(app).get('/api/points');
    for (const p of res.body.data) {
      // 已上传的允许为 true，但测试库初始化时应全为 false
      expect(p.has_image).toBe(false);
      expect(p.has_video).toBe(false);
      expect(p.upload_time).toBeNull();
    }
  });

  it('点位 ID 从 1 开始连续递增', async () => {
    const res = await request(app).get('/api/points');
    for (let i = 0; i < res.body.data.length; i++) {
      expect(res.body.data[i].id).toBe(i + 1);
    }
  });
});

describe('GET /api/health', () => {
  it('返回健康状态（含 DB 可读性与磁盘空间）', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.db).toBe('ok');
    expect(res.body.data.degraded).toBe(false);
    expect(res.body.data.disk).toBeDefined();
    expect(typeof res.body.data.disk.freeMB).toBe('number');
    expect(typeof res.body.data.disk.totalMB).toBe('number');
  });
});
