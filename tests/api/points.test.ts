/**
 * 公开点位接口测试
 * GET /api/points、GET /api/points/:id/materials、
 * GET /api/points/:id/materials/:materialId/file、
 * DELETE /api/points/:id/materials/:materialId
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import app from '../../api/app.js';
import { db, STORAGE_DIR } from '../../api/db.js';
import { makeWidePng } from '../helpers.js';

/** 真实上传一张图片到指定点位，返回素材行 id 与磁盘路径 */
async function uploadPngToPoint(pointId: number, fileName = 'pic.png') {
  const fileId = `fid-${pointId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const buf = makeWidePng(100); // 200×100 合法 PNG

  await request(app)
    .post('/api/upload/chunk')
    .field('fileId', fileId)
    .field('index', '0')
    .field('totalChunks', '1')
    .field('pointId', String(pointId))
    .field('type', 'img')
    .field('fileName', fileName)
    .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

  const mergeRes = await request(app)
    .post('/api/upload/complete')
    .send({ fileId, pointId: String(pointId), type: 'img', fileName, totalChunks: '1' });
  expect(mergeRes.status).toBe(200);

  const list = await request(app).get(`/api/points/${pointId}/materials`);
  const item = list.body.data[0] as { id: number; path: string };
  return { materialId: item.id, relPath: item.path as string };
}

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

describe('GET /api/points/:id/materials/:materialId/file', () => {
  it('非法点位ID或素材ID返回 400', async () => {
    const res1 = await request(app).get('/api/points/abc/materials/1/file');
    expect(res1.status).toBe(400);
    expect(res1.body.success).toBe(false);

    const res2 = await request(app).get('/api/points/1/materials/xyz/file');
    expect(res2.status).toBe(400);
    expect(res2.body.success).toBe(false);

    // 数字混合字母不应被 parseInt 误解析为合法值
    const res3 = await request(app).get('/api/points/12abc/materials/1/file');
    expect(res3.status).toBe(400);
  });

  it('素材不存在返回 404', async () => {
    const res = await request(app).get('/api/points/1/materials/999999/file');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('素材不存在');
  });

  it('素材不属于该点位（pointId 与 materialId 不匹配）返回 404', async () => {
    const { materialId } = await uploadPngToPoint(10);

    // 用别的点位 id 访问该素材
    const res = await request(app).get(`/api/points/11/materials/${materialId}/file`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('素材不存在');
  });

  it('公开免鉴权返回图片内容与正确 Content-Type', async () => {
    const pointId = 12;
    const buf = makeWidePng(100);
    const { materialId } = await uploadPngToPoint(pointId);

    const res = await request(app).get(`/api/points/${pointId}/materials/${materialId}/file`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(res.body, buf)).toBe(0);
  });

  it('支持 HTTP Range 请求（视频拖动进度条依赖）', async () => {
    const pointId = 13;
    const { materialId } = await uploadPngToPoint(pointId);

    const res = await request(app)
      .get(`/api/points/${pointId}/materials/${materialId}/file`)
      .set('Range', 'bytes=0-99');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toMatch(/^bytes 0-99\/\d+$/);
    expect(res.body.length).toBe(100);
  });

  it('数据库记录的越界路径被拒绝（路径遍历防御）', async () => {
    // 模拟脏数据/攻击样本：file_path 指向 STORAGE_DIR 之外
    const insert = db
      .prepare(
        `INSERT INTO material (point_id, material_type, file_path, file_size, upload_time)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
      .run(14, 'img', path.join('..', 'evil.png'), 10);
    const evilId = Number(insert.lastInsertRowid);

    const res = await request(app).get(`/api/points/14/materials/${evilId}/file`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('路径非法');
  });

  it('磁盘文件缺失返回 404', async () => {
    const pointId = 15;
    const { materialId, relPath } = await uploadPngToPoint(pointId);

    // 直接删除磁盘文件（模拟孤儿记录）
    fs.unlinkSync(path.join(STORAGE_DIR, relPath));

    const res = await request(app).get(`/api/points/${pointId}/materials/${materialId}/file`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('文件不存在');
  });
});

describe('DELETE /api/points/:id/materials/:materialId', () => {
  it('非法点位ID或素材ID返回 400', async () => {
    const res1 = await request(app).delete('/api/points/abc/materials/1');
    expect(res1.status).toBe(400);

    const res2 = await request(app).delete('/api/points/1/materials/xyz');
    expect(res2.status).toBe(400);
  });

  it('素材不存在或不属于该点位返回 404', async () => {
    const res1 = await request(app).delete('/api/points/1/materials/999999');
    expect(res1.status).toBe(404);

    const { materialId } = await uploadPngToPoint(20);
    const res2 = await request(app).delete(`/api/points/21/materials/${materialId}`);
    expect(res2.status).toBe(404);
  });

  it('公开删除成功：数据库记录与磁盘文件同步移除', async () => {
    const pointId = 22;
    const { materialId, relPath } = await uploadPngToPoint(pointId);
    const fullPath = path.join(STORAGE_DIR, relPath);
    expect(fs.existsSync(fullPath)).toBe(true);

    const res = await request(app).delete(`/api/points/${pointId}/materials/${materialId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // DB 记录已删除
    const row = db.prepare(`SELECT id FROM material WHERE id = ?`).get(materialId);
    expect(row).toBeUndefined();

    // 磁盘文件已删除
    expect(fs.existsSync(fullPath)).toBe(false);

    // 删除后文件端点 404
    const fileRes = await request(app).get(`/api/points/${pointId}/materials/${materialId}/file`);
    expect(fileRes.status).toBe(404);

    // 重复删除 404
    const again = await request(app).delete(`/api/points/${pointId}/materials/${materialId}`);
    expect(again.status).toBe(404);
  });

  it('删除后点位素材统计同步归零', async () => {
    const pointId = 23;
    const { materialId } = await uploadPngToPoint(pointId);

    const before = await request(app).get('/api/points');
    const pointBefore = before.body.data.find((p: { id: number }) => p.id === pointId);
    expect(pointBefore.uploaded_count).toBeGreaterThanOrEqual(1);

    await request(app).delete(`/api/points/${pointId}/materials/${materialId}`);

    const after = await request(app).get('/api/points');
    const pointAfter = after.body.data.find((p: { id: number }) => p.id === pointId);
    // 该点位在本用例中只上传过这一张图（前序用例删除了各自素材）
    expect(pointAfter.uploaded_count).toBe(0);
    expect(pointAfter.img_count).toBe(0);
  });
});
