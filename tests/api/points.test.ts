/**
 * 公开点位接口测试
 * GET /api/points、GET /api/points/:id/materials
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/app.js';
import { makeWidePng } from '../helpers.js';

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
    expect(first).toHaveProperty('img_count');
    expect(first).toHaveProperty('video_count');
    expect(first).toHaveProperty('uploaded_count');
    expect(first).toHaveProperty('upload_time');
    expect(typeof first.id).toBe('number');
    expect(typeof first.img_count).toBe('number');
    expect(typeof first.video_count).toBe('number');
  });

  it('初始状态下所有点位素材数量为 0', async () => {
    const res = await request(app).get('/api/points');
    for (const p of res.body.data) {
      // 已上传的允许大于 0，但测试库初始化时应全为 0
      expect(p.img_count).toBe(0);
      expect(p.video_count).toBe(0);
      expect(p.uploaded_count).toBe(0);
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

describe('GET /api/points/:id/materials', () => {
  it('点位ID无效返回 400', async () => {
    const res = await request(app).get('/api/points/abc/materials');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('点位ID无效');
  });

  it('不存在或无素材的点位返回空数组', async () => {
    const res = await request(app).get('/api/points/999/materials');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it('返回字段契约与前端 MaterialItem 一致（path/size/type）', async () => {
    // 先真实上传一张图片到点位 4，制造素材数据
    const fileId = `fid-materials-${Date.now()}`;
    const buf = makeWidePng(100); // 200×100 合法 PNG

    await request(app)
      .post('/api/upload/chunk')
      .field('fileId', fileId)
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', '4')
      .field('type', 'img')
      .field('fileName', 'pic.png')
      .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

    const mergeRes = await request(app)
      .post('/api/upload/complete')
      .send({ fileId, pointId: '4', type: 'img', fileName: 'pic.png', totalChunks: '1' });
    expect(mergeRes.status).toBe(200);

    // 拉取素材列表，校验字段契约
    const res = await request(app).get('/api/points/4/materials');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const item = res.body.data[0];
    // 回归防护：此前误返回 DB 原始列名 file_path/file_size，
    // 导致前端 MaterialWall 读取 m.path 崩溃、整页白屏
    expect(item).toHaveProperty('path');
    expect(item).toHaveProperty('size');
    expect(item).toHaveProperty('type');
    expect(item.path).toContain('point_4');
    expect(typeof item.size).toBe('number');
    expect(item.type).toBe('img');
    expect(item.upload_time).toBeTruthy();
  });
});
