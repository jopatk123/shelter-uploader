/**
 * 图片单文件大小上限测试
 * 通过环境变量 IMAGE_MAX_SIZE_KB 将上限调整为 1024KB（需在导入应用前设置）
 * 覆盖：超过上限被拒绝、低于上限正常上传
 *
 * 背景：前端会把超过 500KB 的图片压缩到 500KB 以内，但后端必须能拦截
 * 绕过前端直接调用接口上传的超大文件，否则磁盘可被无限占用。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeWidePng } from '../helpers.js';

// upload.ts 在模块初始化时读取该变量，必须先于动态导入设置
process.env.IMAGE_MAX_SIZE_KB = '1024';

const { default: request } = await import('supertest');
const { default: app } = await import('../../api/app.js');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';
let token: string;

/** 构造指定大小的合法 PNG：PNG 头部保留合法结构，尾部填充字节凑足大小 */
function makeLargePng(paddingBytes: number): Buffer {
  const base = makeWidePng(100);
  return Buffer.concat([base, Buffer.alloc(paddingBytes, 0x00)]);
}

/** 上传单分片并合并，返回 complete 响应 */
async function uploadImage(pointId: string, fileId: string, fileName: string, buf: Buffer) {
  await request(app)
    .post('/api/upload/chunk')
    .field('fileId', fileId)
    .field('index', '0')
    .field('totalChunks', '1')
    .field('pointId', pointId)
    .field('type', 'img')
    .field('fileName', fileName)
    .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

  return request(app)
    .post('/api/upload/complete')
    .send({ fileId, pointId, type: 'img', fileName, totalChunks: '1' });
}

describe('上传流程 - 图片大小上限', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    token = res.body.data.token;
  });

  it('超过大小上限（> 1024KB）的图片被拒绝且不入库', async () => {
    const pointId = '16';
    const fileId = `fid-img-oversize-${Date.now()}`;
    const buf = makeLargePng(1.5 * 1024 * 1024);

    const res = await uploadImage(pointId, fileId, 'big.png', buf);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('文件大小超过限制');
    expect(res.body.error).toContain('1024KB');

    const detailRes = await request(app)
      .get(`/api/admin/point/${pointId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detailRes.body.data.img_count).toBe(0);
  });

  it('低于大小上限的图片正常上传', async () => {
    const pointId = '17';
    const fileId = `fid-img-within-limit-${Date.now()}`;
    const buf = makeLargePng(200 * 1024); // 约 200KB + PNG 头

    const res = await uploadImage(pointId, fileId, 'ok.png', buf);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.size).toBe(buf.length);
  });
});
