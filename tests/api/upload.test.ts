/**
 * 分片上传接口端到端测试
 * 覆盖：分片上传、合并、后缀/大小校验、图片可解析性校验（不限比例）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../api/app.js';
import fs from 'fs';
import path from 'path';
import { makeWidePng, makeSquarePng, makeValidMp4, makeShortMp4 } from '../helpers.js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';
let token: string;

// 测试用：构造一个假 buffer（仅测试分片上传流程，不经过合并的图片校验）
function makeFakeImageBuffer(size: number): Buffer {
  return Buffer.alloc(size, 0xff);
}

describe('运行时配置接口', () => {
  it('GET /api/config 下发图片压缩目标，供前端压缩阈值对齐', async () => {
    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.imageCompressTargetKB).toBeGreaterThan(0);
    expect(res.body.data.videoMaxSizeMB).toBeGreaterThan(0);
    expect(res.body.data.chunkSizeMB).toBeGreaterThan(0);
  });
});

describe('上传流程 - 分片接口', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    token = res.body.data.token;
  });

  it('缺少必要参数返回 400', async () => {
    const res = await request(app).post('/api/upload/chunk').field('fileId', 'fid');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('参数非法');
  });

  it('未上传分片文件返回 400', async () => {
    const res = await request(app)
      .post('/api/upload/chunk')
      .field('fileId', 'fid-1')
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', '1')
      .field('type', 'img')
      .field('fileName', 'test.jpg');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('未收到');
  });

  it('成功上传单个分片', async () => {
    const buf = makeFakeImageBuffer(1024);
    const res = await request(app)
      .post('/api/upload/chunk')
      .field('fileId', 'fid-success')
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', '1')
      .field('type', 'img')
      .field('fileName', 'test.jpg')
      .attach('chunk', buf, { filename: 'chunk-0', contentType: 'application/octet-stream' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fileId).toBe('fid-success');
    expect(res.body.data.index).toBe(0);
  });

  it('GET /check 已移除，返回 404', async () => {
    const res = await request(app).get('/api/upload/check?fileId=any');
    expect(res.status).toBe(404);
  });
});

describe('上传流程 - 分片数量上限', () => {
  // 默认配置：分片 5MB，图片硬上限 600KB → 最多 ceil(600KB/5MB)+2 = 3 片
  const IMAGE_MAX_CHUNKS = Math.ceil((600 * 1024) / (5 * 1024 * 1024)) + 2;

  it('totalChunks 超过上限返回 400', async () => {
    const res = await request(app)
      .post('/api/upload/chunk')
      .field('fileId', 'fid-over-chunks')
      .field('index', '0')
      .field('totalChunks', String(IMAGE_MAX_CHUNKS + 100))
      .field('pointId', '1')
      .field('type', 'img')
      .field('fileName', 'a.jpg')
      .attach('chunk', makeFakeImageBuffer(32), {
        filename: 'c0',
        contentType: 'application/octet-stream',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('分片总数超出上限');
  });

  it('分片序号超出声明的 totalChunks 返回 400', async () => {
    const res = await request(app)
      .post('/api/upload/chunk')
      .field('fileId', 'fid-index-out-of-range')
      .field('index', '5')
      .field('totalChunks', '1')
      .field('pointId', '1')
      .field('type', 'img')
      .field('fileName', 'a.jpg')
      .attach('chunk', makeFakeImageBuffer(32), {
        filename: 'c5',
        contentType: 'application/octet-stream',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('超出声明的分片总数');
  });

  it('合并时 totalChunks 超过上限返回 400', async () => {
    const res = await request(app)
      .post('/api/upload/complete')
      .send({
        fileId: 'fid-complete-over-chunks',
        pointId: '1',
        type: 'img',
        fileName: 'a.jpg',
        totalChunks: String(IMAGE_MAX_CHUNKS + 100),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('分片总数超出上限');
  });
});

describe('上传流程 - 合并接口', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    token = res.body.data.token;
  });

  it('上传并合并图片素材，校验数据库与文件', async () => {
    const fileId = `fid-merge-${Date.now()}`;
    const buf = makeWidePng(100); // 200×100 合法 PNG（宽幅样例）

    // 上传1个分片
    await request(app)
      .post('/api/upload/chunk')
      .field('fileId', fileId)
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', '3')
      .field('type', 'img')
      .field('fileName', 'pic.png')
      .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

    // 合并
    const mergeRes = await request(app)
      .post('/api/upload/complete')
      .send({ fileId, pointId: '3', type: 'img', fileName: 'pic.png', totalChunks: '1' });

    expect(mergeRes.status).toBe(200);
    expect(mergeRes.body.success).toBe(true);
    expect(mergeRes.body.data.pointId).toBe(3);
    expect(mergeRes.body.data.type).toBe('img');
    expect(mergeRes.body.data.path).toContain('point_3');
    expect(mergeRes.body.data.path).toMatch(/\.png$/);

    // 通过管理员接口校验数据（v2：INSERT 语义，materials 列表含新素材）
    const detailRes = await request(app)
      .get('/api/admin/point/3')
      .set('Authorization', `Bearer ${token}`);

    expect(detailRes.body.data.img_count).toBeGreaterThanOrEqual(1);
    expect(detailRes.body.data.materials[0].path).toContain('point_3');
    expect(detailRes.body.data.upload_time).toBeTruthy();
  });

  it('非法 type 返回 400', async () => {
    const res = await request(app)
      .post('/api/upload/complete')
      .send({ fileId: 'fid', pointId: '1', type: 'invalid', fileName: 'a.jpg', totalChunks: '1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('类型');
  });

  it('不允许的文件后缀返回 400', async () => {
    const res = await request(app)
      .post('/api/upload/complete')
      .send({ fileId: 'fid', pointId: '1', type: 'img', fileName: 'evil.exe', totalChunks: '1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('后缀');
  });

  it('视频类型只允许 .mp4', async () => {
    const res = await request(app)
      .post('/api/upload/complete')
      .send({ fileId: 'fid', pointId: '1', type: 'video', fileName: 'v.avi', totalChunks: '1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('后缀');
  });

  it('缺少 totalChunks 返回 400', async () => {
    const res = await request(app)
      .post('/api/upload/complete')
      .send({ fileId: 'fid', pointId: '1', type: 'img', fileName: 'a.jpg' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('totalChunks');
  });

  it('totalChunks 与实际分片数不匹配返回 400', async () => {
    const fileId = `fid-mismatch-${Date.now()}`;
    const buf = makeFakeImageBuffer(512);

    // 只上传1个分片
    await request(app)
      .post('/api/upload/chunk')
      .field('fileId', fileId)
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', '1')
      .field('type', 'img')
      .field('fileName', 'a.jpg')
      .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

    // 声明 totalChunks=3 但实际只有1个分片
    const res = await request(app)
      .post('/api/upload/complete')
      .send({ fileId, pointId: '1', type: 'img', fileName: 'a.jpg', totalChunks: '3' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('分片不完整');
  });

  it('分片目录不存在返回 400', async () => {
    const res = await request(app)
      .post('/api/upload/complete')
      .send({
        fileId: 'not-exist-' + Date.now(),
        pointId: '1',
        type: 'img',
        fileName: 'a.jpg',
        totalChunks: '1',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('分片目录');
  });

  it('缺少必要参数返回 400', async () => {
    const res = await request(app).post('/api/upload/complete').send({ fileId: 'fid' });

    expect(res.status).toBe(400);
  });

  it('重复上传同一类型素材时追加记录（数量不限），旧文件与记录均保留', async () => {
    const pointId = '4';
    const fileId1 = `fid-append-1-${Date.now()}`;
    const buf = makeWidePng(50); // 100×50 合法 PNG

    // 第一次上传
    await request(app)
      .post('/api/upload/chunk')
      .field('fileId', fileId1)
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', pointId)
      .field('type', 'img')
      .field('fileName', 'a.png')
      .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

    const merge1 = await request(app)
      .post('/api/upload/complete')
      .send({ fileId: fileId1, pointId, type: 'img', fileName: 'a.png', totalChunks: '1' });
    const firstPath = merge1.body.data.path;

    // 第二次上传（v2 起不再覆盖，作为新素材追加）
    const fileId2 = `fid-append-2-${Date.now()}`;
    await request(app)
      .post('/api/upload/chunk')
      .field('fileId', fileId2)
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', pointId)
      .field('type', 'img')
      .field('fileName', 'b.png')
      .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

    const merge2 = await request(app)
      .post('/api/upload/complete')
      .send({ fileId: fileId2, pointId, type: 'img', fileName: 'b.png', totalChunks: '1' });

    expect(merge2.status).toBe(200);
    expect(merge2.body.success).toBe(true);
    expect(merge2.body.data.id).not.toBe(merge1.body.data.id);
    expect(merge2.body.data.path).not.toBe(firstPath);

    // v2 语义：旧文件仍存在（不再删除）
    const DATA_DIR = process.env.DATA_DIR!;
    const oldFullPath = path.join(DATA_DIR, 'storage', firstPath);
    expect(fs.existsSync(oldFullPath)).toBe(true);

    // 新文件存在
    const newFullPath = path.join(DATA_DIR, 'storage', merge2.body.data.path);
    expect(fs.existsSync(newFullPath)).toBe(true);

    // 数据库追加为两条素材记录
    const detailRes = await request(app)
      .get(`/api/admin/point/${pointId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detailRes.body.data.img_count).toBe(2);
    expect(detailRes.body.data.uploaded_count).toBe(2);
  });

  it('上传完成后可通过 /admin/download 下载', async () => {
    const pointId = '5';
    const fileId = `fid-download-${Date.now()}`;
    const buf = makeWidePng(80); // 160×80 合法 PNG

    await request(app)
      .post('/api/upload/chunk')
      .field('fileId', fileId)
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', pointId)
      .field('type', 'img')
      .field('fileName', 'dl.png')
      .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

    const mergeRes = await request(app)
      .post('/api/upload/complete')
      .send({ fileId, pointId, type: 'img', fileName: 'dl.png', totalChunks: '1' });
    const materialId = mergeRes.body.data.id;

    const dlRes = await request(app)
      .get(`/api/admin/download/${materialId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(dlRes.status).toBe(200);
    expect(dlRes.headers['content-disposition']).toContain('attachment');
    expect(dlRes.body.length).toBeGreaterThan(0);
  });

  it('上传完成后可通过 DELETE /admin/material 删除', async () => {
    const pointId = '6';
    const fileId = `fid-delete-${Date.now()}`;
    const buf = makeWidePng(60); // 120×60 合法 PNG

    await request(app)
      .post('/api/upload/chunk')
      .field('fileId', fileId)
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', pointId)
      .field('type', 'img')
      .field('fileName', 'del.png')
      .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

    const mergeRes = await request(app)
      .post('/api/upload/complete')
      .send({ fileId, pointId, type: 'img', fileName: 'del.png', totalChunks: '1' });
    const materialId = mergeRes.body.data.id;

    // 删除（v2 起按素材行 id 删除，不再需要 type 参数）
    const delRes = await request(app)
      .delete(`/api/admin/material/${materialId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // 验证已删除
    const detailRes = await request(app)
      .get(`/api/admin/point/${pointId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detailRes.body.data.img_count).toBe(0);
    expect(detailRes.body.data.materials).toHaveLength(0);
    // 删除最后一个素材后 upload_time 应被清空
    expect(detailRes.body.data.upload_time).toBeNull();
  });

  it('普通比例图片（1:1）正常上传', async () => {
    const pointId = '8';
    const fileId = `fid-square-${Date.now()}`;
    const buf = makeSquarePng(100); // 100×100 普通比例 PNG

    await request(app)
      .post('/api/upload/chunk')
      .field('fileId', fileId)
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', pointId)
      .field('type', 'img')
      .field('fileName', 'square.png')
      .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

    const res = await request(app)
      .post('/api/upload/complete')
      .send({ fileId, pointId, type: 'img', fileName: 'square.png', totalChunks: '1' });

    // 新规则：不限制像素比例，1:1 普通照片应上传成功
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 验证文件已落盘、数据库已写入
    const detailRes = await request(app)
      .get(`/api/admin/point/${pointId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detailRes.body.data.img_count).toBeGreaterThanOrEqual(1);
  });

  it('无法解析的图片文件被拒绝', async () => {
    const pointId = '9';
    const fileId = `fid-corrupt-${Date.now()}`;
    const buf = makeFakeImageBuffer(1024); // 非 PNG/JPEG 数据

    await request(app)
      .post('/api/upload/chunk')
      .field('fileId', fileId)
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', pointId)
      .field('type', 'img')
      .field('fileName', 'corrupt.png')
      .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

    const res = await request(app)
      .post('/api/upload/complete')
      .send({ fileId, pointId, type: 'img', fileName: 'corrupt.png', totalChunks: '1' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('无法解析');
  });

  it('同一点位可上传多张图片（数量不限）', async () => {
    const pointId = '10';
    const paths: string[] = [];

    // 连续上传两张图片到同一点位，均应成功且各自成为独立素材
    for (const [i, size] of [120, 80].entries()) {
      const fileId = `fid-multi-img-${pointId}-${i}-${Date.now()}`;
      const buf = makeWidePng(size);

      await request(app)
        .post('/api/upload/chunk')
        .field('fileId', fileId)
        .field('index', '0')
        .field('totalChunks', '1')
        .field('pointId', pointId)
        .field('type', 'img')
        .field('fileName', `multi-${i}.png`)
        .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

      const res = await request(app)
        .post('/api/upload/complete')
        .send({ fileId, pointId, type: 'img', fileName: `multi-${i}.png`, totalChunks: '1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('img');
      paths.push(res.body.data.path);
    }

    // 两次上传路径不同（不覆盖）
    expect(paths[0]).not.toBe(paths[1]);

    const detailRes = await request(app)
      .get(`/api/admin/point/${pointId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detailRes.body.data.img_count).toBe(2);
  });
});

describe('上传流程 - 多分片视频合并', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    token = res.body.data.token;
  });

  it('上传3个分片并合并成视频文件', async () => {
    const fileId = `fid-multi-${Date.now()}`;
    const pointId = '7';
    const mp4Buf = makeValidMp4(15); // 15 秒合法视频
    const chunkSize = Math.ceil(mp4Buf.length / 3);

    // 上传3个分片
    for (let i = 0; i < 3; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, mp4Buf.length);
      const buf = mp4Buf.subarray(start, end);
      await request(app)
        .post('/api/upload/chunk')
        .field('fileId', fileId)
        .field('index', String(i))
        .field('totalChunks', '3')
        .field('pointId', pointId)
        .field('type', 'video')
        .field('fileName', 'multi.mp4')
        .attach('chunk', buf, { filename: `c${i}`, contentType: 'application/octet-stream' });
    }

    // 合并
    const mergeRes = await request(app)
      .post('/api/upload/complete')
      .send({ fileId, pointId, type: 'video', fileName: 'multi.mp4', totalChunks: '3' });

    expect(mergeRes.status).toBe(200);
    expect(mergeRes.body.success).toBe(true);
    expect(mergeRes.body.data.size).toBe(mp4Buf.length);

    // 校验文件内容：分片按顺序拼接后与原始 buffer 完全一致
    const DATA_DIR = process.env.DATA_DIR!;
    const fullPath = path.join(DATA_DIR, 'storage', mergeRes.body.data.path);
    const fileBuf = fs.readFileSync(fullPath);
    expect(fileBuf.length).toBe(mp4Buf.length);
    expect(fileBuf.equals(mp4Buf)).toBe(true);
  });

  it('短视频（< 10秒）被拒绝', async () => {
    const pointId = '11';
    const fileId = `fid-short-${Date.now()}`;
    const buf = makeShortMp4(5); // 5 秒短视频

    await request(app)
      .post('/api/upload/chunk')
      .field('fileId', fileId)
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', pointId)
      .field('type', 'video')
      .field('fileName', 'short.mp4')
      .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

    const res = await request(app)
      .post('/api/upload/complete')
      .send({ fileId, pointId, type: 'video', fileName: 'short.mp4', totalChunks: '1' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('10 秒');
    expect(res.body.error).toContain('5.0 秒');

    // 验证数据库未写入
    const detailRes = await request(app)
      .get(`/api/admin/point/${pointId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detailRes.body.data.video_count).toBe(0);
  });

  it('无法解析的视频文件被拒绝', async () => {
    const pointId = '12';
    const fileId = `fid-corrupt-mp4-${Date.now()}`;
    const buf = makeFakeImageBuffer(1024); // 非 MP4 数据

    await request(app)
      .post('/api/upload/chunk')
      .field('fileId', fileId)
      .field('index', '0')
      .field('totalChunks', '1')
      .field('pointId', pointId)
      .field('type', 'video')
      .field('fileName', 'corrupt.mp4')
      .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

    const res = await request(app)
      .post('/api/upload/complete')
      .send({ fileId, pointId, type: 'video', fileName: 'corrupt.mp4', totalChunks: '1' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('无法解析');
  });

  it('同一点位可上传多个视频（数量不限）', async () => {
    const pointId = '13';
    const paths: string[] = [];

    // 连续上传两个合法视频到同一点位，均应成功且各自成为独立素材
    for (const [i, duration] of [20, 30].entries()) {
      const fileId = `fid-multi-video-${pointId}-${i}-${Date.now()}`;
      const buf = makeValidMp4(duration);

      await request(app)
        .post('/api/upload/chunk')
        .field('fileId', fileId)
        .field('index', '0')
        .field('totalChunks', '1')
        .field('pointId', pointId)
        .field('type', 'video')
        .field('fileName', `multi-${i}.mp4`)
        .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

      const res = await request(app)
        .post('/api/upload/complete')
        .send({ fileId, pointId, type: 'video', fileName: `multi-${i}.mp4`, totalChunks: '1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('video');
      paths.push(res.body.data.path);
    }

    expect(paths[0]).not.toBe(paths[1]);

    const detailRes = await request(app)
      .get(`/api/admin/point/${pointId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detailRes.body.data.video_count).toBe(2);
  });
});
