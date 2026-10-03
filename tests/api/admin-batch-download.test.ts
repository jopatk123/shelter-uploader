/**
 * 批量下载接口测试
 * 覆盖：一次性票据鉴权、type 参数校验、单类型与「图片+视频」混装打包的条目命名
 *
 * zip 校验方式：打包用 store 模式（素材本身已是压缩格式，不再二次压缩），
 * 因此条目名以明文存在于本地文件头中，可直接在缓冲区里匹配，无需引入解压库。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../api/app.js';
import { makeWidePng, makeValidMp4 } from '../helpers.js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

// 与其它测试文件使用的点位（1~13）错开，避免共用临时库时相互干扰
const POINT_BOTH = 30; // 同时有图片与视频
const POINT_IMG_ONLY = 31; // 只有图片

let token = '';

/** 复用上传链路往指定点位写入一个素材，返回素材行 id */
async function uploadMaterial(
  pointId: number,
  type: 'img' | 'video',
  fileName: string,
): Promise<number> {
  const fileId = `fid-batch-${type}-${pointId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const buf = type === 'img' ? makeWidePng(50) : makeValidMp4(15);

  await request(app)
    .post('/api/upload/chunk')
    .field('fileId', fileId)
    .field('index', '0')
    .field('totalChunks', '1')
    .field('pointId', String(pointId))
    .field('type', type)
    .field('fileName', fileName)
    .attach('chunk', buf, { filename: 'c0', contentType: 'application/octet-stream' });

  const res = await request(app)
    .post('/api/upload/complete')
    .send({ fileId, pointId: String(pointId), type, fileName, totalChunks: '1' });

  expect(res.status).toBe(200);
  return res.body.data.id as number;
}

/** 取一次性下载票据（需 JWT） */
async function getTicket(): Promise<string> {
  const res = await request(app)
    .post('/api/admin/download-ticket')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.data.ticket as string;
}

/** 把响应体原样收成 Buffer（supertest 默认不会为 application/zip 走二进制解析） */
const binaryParser = (
  res: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void,
): void => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** 发起批量下载，返回 zip 缓冲区 */
async function download(
  type: string,
  ids?: number[],
): Promise<{ status: number; body: Buffer; headers: Record<string, string> }> {
  const ticket = await getTicket();
  let url = `/api/admin/batch-download?type=${type}&ticket=${encodeURIComponent(ticket)}`;
  if (ids && ids.length > 0) url += `&ids=${ids.join(',')}`;

  const res = await request(app).get(url).buffer(true).parse(binaryParser);

  return {
    status: res.status,
    body: Buffer.isBuffer(res.body) ? res.body : Buffer.alloc(0),
    headers: res.headers as Record<string, string>,
  };
}

interface ZipEntry {
  pointId: number;
  name: string;
}

/**
 * 从 zip 缓冲区中提取「点位 → 素材条目名」
 * 条目形如 point_30_灰炉头码头/img_1.png；点位名含中文，故这里只取 ASCII 部分做断言
 */
function zipEntries(buf: Buffer): ZipEntry[] {
  const text = buf.toString('latin1');
  const re = /point_(\d+)_[^/]*\/((?:img|video)_\d+\.[a-z0-9]+)/g;
  const seen = new Map<string, ZipEntry>();
  for (const m of text.matchAll(re)) {
    const entry = { pointId: Number(m[1]), name: m[2] };
    // 本地文件头与中央目录会各出现一次，去重
    seen.set(`${entry.pointId}/${entry.name}`, entry);
  }
  return [...seen.values()];
}

const namesOf = (entries: ZipEntry[], pointId: number): string[] =>
  entries
    .filter((e) => e.pointId === pointId)
    .map((e) => e.name)
    .sort();

beforeAll(async () => {
  const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
  token = res.body.data.token;

  await uploadMaterial(POINT_BOTH, 'img', 'both-1.png');
  await uploadMaterial(POINT_BOTH, 'video', 'both-1.mp4');
  await uploadMaterial(POINT_IMG_ONLY, 'img', 'img-only-1.png');
});

describe('批量下载 - 鉴权与参数校验', () => {
  it('缺少 ticket 返回 403', async () => {
    const res = await request(app).get('/api/admin/batch-download?type=all');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('无效应答票据返回 403', async () => {
    const res = await request(app).get('/api/admin/batch-download?type=all&ticket=deadbeef');

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('票据');
  });

  it('type 非法返回 400，且错误信息列出全部可用取值', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(
      `/api/admin/batch-download?type=gif&ticket=${encodeURIComponent(ticket)}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('img');
    expect(res.body.error).toContain('video');
    expect(res.body.error).toContain('all');
  });

  it('缺少 type 参数返回 400', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(
      `/api/admin/batch-download?ticket=${encodeURIComponent(ticket)}`,
    );

    expect(res.status).toBe(400);
  });
});

describe('批量下载 - 单类型打包（回归）', () => {
  it('type=img 只打包图片，zip 前缀为 images_', async () => {
    const { status, body, headers } = await download('img', [POINT_BOTH]);

    expect(status).toBe(200);
    expect(headers['content-type']).toContain('application/zip');
    expect(headers['content-disposition']).toMatch(/images_.*\.zip/);

    const entries = zipEntries(body);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.name.startsWith('img_'))).toBe(true);
  });

  it('type=video 只打包视频，zip 前缀为 videos_', async () => {
    const { status, headers, body } = await download('video', [POINT_BOTH]);

    expect(status).toBe(200);
    expect(headers['content-disposition']).toMatch(/videos_.*\.zip/);

    const entries = zipEntries(body);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.name.startsWith('video_'))).toBe(true);
  });
});

describe('批量下载 - type=all 图片 + 视频混装', () => {
  it('两种类型装进同一个 zip，zip 前缀为 materials_', async () => {
    const { status, headers, body } = await download('all', [POINT_BOTH]);

    expect(status).toBe(200);
    expect(headers['content-type']).toContain('application/zip');
    expect(headers['content-disposition']).toMatch(/materials_.*\.zip/);

    const entries = zipEntries(body);
    const names = namesOf(entries, POINT_BOTH);
    expect(names.some((n) => n.startsWith('img_'))).toBe(true);
    expect(names.some((n) => n.startsWith('video_'))).toBe(true);
  });

  it('同一点位的图片与视频落在同一个文件夹（目录项不重复）', async () => {
    const { body } = await download('all', [POINT_BOTH]);
    const text = body.toString('latin1');

    // 条目名形如 point_30_xxx/img_1.png，同一文件夹前缀只应出现一种写法
    const folders = new Set([...text.matchAll(/point_30_[^/]*\//g)].map((m) => m[0]));
    expect(folders.size).toBe(1);
  });

  it('混装不改变编号：与 type=img 得到相同的图片条目名', async () => {
    const all = await download('all', [POINT_BOTH]);
    const imgOnly = await download('img', [POINT_BOTH]);

    const imgNamesInAll = namesOf(zipEntries(all.body), POINT_BOTH).filter((n) =>
      n.startsWith('img_'),
    );

    expect(imgNamesInAll).toEqual(namesOf(zipEntries(imgOnly.body), POINT_BOTH));
  });

  it('ids 过滤生效：不含目标点位的文件不会被打包', async () => {
    const { body } = await download('all', [POINT_IMG_ONLY]);
    const entries = zipEntries(body);

    expect(namesOf(entries, POINT_IMG_ONLY).length).toBeGreaterThan(0);
    expect(namesOf(entries, POINT_BOTH)).toHaveLength(0);
  });

  it('不传 ids 时打包全部已上传素材的点位', async () => {
    const { status, body } = await download('all');

    expect(status).toBe(200);
    const entries = zipEntries(body);
    expect(namesOf(entries, POINT_BOTH).length).toBeGreaterThan(0);
    expect(namesOf(entries, POINT_IMG_ONLY).length).toBeGreaterThan(0);
  });

  it('类型全覆盖：zip 中出现的素材条目与库中实际数量一致', async () => {
    const detail = await request(app)
      .get(`/api/admin/point/${POINT_BOTH}`)
      .set('Authorization', `Bearer ${token}`);
    const expected = (detail.body.data.img_count + detail.body.data.video_count) as number;

    const { body } = await download('all', [POINT_BOTH]);
    expect(namesOf(zipEntries(body), POINT_BOTH)).toHaveLength(expected);
  });
});
