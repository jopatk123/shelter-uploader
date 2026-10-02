/**
 * 视频单文件大小上限测试
 * 通过环境变量 VIDEO_MAX_SIZE_MB 将上限调整为 1MB（需在导入应用前设置）
 * 覆盖：超过上限被拒绝、低于上限正常上传
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeValidMp4WithPadding } from '../helpers.js';

// upload.ts 在模块初始化时读取该变量，必须先于动态导入设置
process.env.VIDEO_MAX_SIZE_MB = '1';

const { default: request } = await import('supertest');
const { default: app } = await import('../../api/app.js');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';
let token: string;

/** 上传单个视频分片并合并，返回响应 */
async function uploadVideo(pointId: string, fileId: string, fileName: string, buf: Buffer) {
  await request(app)
    .post('/api/upload/chunk')
    .field('fileId', fileId)
    .field('index', '0')
    .field('totalChunks', '1')
    .field('pointId', pointId)
    .field('type', 'video')
    .field('fileName', fileName)
    .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

  return request(app)
    .post('/api/upload/complete')
    .send({ fileId, pointId, type: 'video', fileName, totalChunks: '1' });
}

describe('上传流程 - 视频大小上限', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    token = res.body.data.token;
  });

  it('超过大小上限（> 1MB）的视频被拒绝', async () => {
    const pointId = '14';
    const fileId = `fid-oversize-${Date.now()}`;
    const buf = makeValidMp4WithPadding(1.5 * 1024 * 1024);

    const res = await uploadVideo(pointId, fileId, 'big.mp4', buf);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('文件大小超过限制');
    expect(res.body.error).toContain('1MB');

    // 数据库未写入（管理员详情接口需鉴权）
    const detailRes = await request(app)
      .get(`/api/admin/point/${pointId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detailRes.body.data.video_count).toBe(0);
  });

  it('低于大小上限的 15 秒视频正常上传', async () => {
    const pointId = '15';
    const fileId = `fid-within-limit-${Date.now()}`;
    const buf = makeValidMp4WithPadding(900 * 1024);

    const res = await uploadVideo(pointId, fileId, 'ok.mp4', buf);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.size).toBe(buf.length);
    expect(res.body.data.path).toContain('point_15');
  });
});
