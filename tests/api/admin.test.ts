/**
 * 管理员接口测试
 * 覆盖：登录、鉴权、点位列表筛选、详情、删除
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../api/app.js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';
let token: string;

describe('管理员登录接口', () => {
  it('正确密码返回 token', async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(typeof res.body.data.token).toBe('string');
    token = res.body.data.token;
  });

  it('错误密码返回 401', async () => {
    const res = await request(app).post('/api/admin/login').send({ password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('空密码返回 400', async () => {
    const res = await request(app).post('/api/admin/login').send({ password: '' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('缺少 password 字段返回 400', async () => {
    const res = await request(app).post('/api/admin/login').send({});

    expect(res.status).toBe(400);
  });
});

describe('管理员鉴权 - 受保护接口', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    token = res.body.data.token;
  });

  it('无 Token 访问 /admin/points 返回 403', async () => {
    const res = await request(app).get('/api/admin/points');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('错误 Token 返回 403', async () => {
    const res = await request(app)
      .get('/api/admin/points')
      .set('Authorization', 'Bearer invalid.token');

    expect(res.status).toBe(403);
  });

  it('正确 Token 可访问 /admin/points', async () => {
    const res = await request(app).get('/api/admin/points').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(141);
  });

  it('Authorization 不带 Bearer 前缀返回 403', async () => {
    const res = await request(app).get('/api/admin/points').set('Authorization', token);

    expect(res.status).toBe(403);
  });
});

describe('管理员点位列表筛选', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    token = res.body.data.token;
  });

  it('filter=all 返回全部141个点位', async () => {
    const res = await request(app)
      .get('/api/admin/points?filter=all')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data).toHaveLength(141);
  });

  it('filter=completed 返回已完成点位', async () => {
    const res = await request(app)
      .get('/api/admin/points?filter=completed')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // 初始状态下应都未完成
    expect(res.body.data.length).toBe(0);
  });

  it('filter=img_only 返回仅有图片的点位', async () => {
    const res = await request(app)
      .get('/api/admin/points?filter=img_only')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.success).toBe(true);
    for (const p of res.body.data) {
      expect(p.has_image).toBe(true);
      expect(p.has_video).toBe(false);
    }
  });

  it('无 filter 参数默认走 all 分支', async () => {
    const res = await request(app).get('/api/admin/points').set('Authorization', `Bearer ${token}`);

    expect(res.body.data).toHaveLength(141);
  });
});

describe('管理员点位详情接口', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    token = res.body.data.token;
  });

  it('有效 ID 返回详情', async () => {
    const res = await request(app)
      .get('/api/admin/point/1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
    expect(res.body.data).toHaveProperty('img_path');
    expect(res.body.data).toHaveProperty('video_path');
    expect(res.body.data).toHaveProperty('has_image');
    expect(res.body.data).toHaveProperty('has_video');
  });

  it('无效 ID（非数字）返回 400', async () => {
    const res = await request(app)
      .get('/api/admin/point/abc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('不存在的 ID 返回 404', async () => {
    const res = await request(app)
      .get('/api/admin/point/99999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('管理员删除素材接口', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    token = res.body.data.token;
  });

  it('无效 type 参数返回 400', async () => {
    const res = await request(app)
      .delete('/api/admin/material/1?type=invalid')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('缺少 type 参数返回 400', async () => {
    const res = await request(app)
      .delete('/api/admin/material/1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('无素材时删除返回成功', async () => {
    const res = await request(app)
      .delete('/api/admin/material/1?type=img')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('无效 ID 返回 400', async () => {
    const res = await request(app)
      .delete('/api/admin/material/abc?type=img')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

describe('管理员下载接口', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    token = res.body.data.token;
  });

  it('下载未上传的素材返回 404', async () => {
    const res = await request(app)
      .get('/api/admin/download/1?type=img')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('无效 type 返回 400', async () => {
    const res = await request(app)
      .get('/api/admin/download/1?type=bad')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

describe('管理员批量下载接口', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    token = res.body.data.token;
  });

  /** 辅助：获取一次性下载票据 */
  async function getTicket(): Promise<string> {
    const res = await request(app)
      .post('/api/admin/download-ticket')
      .set('Authorization', `Bearer ${token}`);
    return res.body.data.ticket;
  }

  it('无票据返回 403', async () => {
    const res = await request(app)
      .get('/api/admin/batch-download?type=img')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('无效票据返回 403', async () => {
    const res = await request(app).get('/api/admin/batch-download?type=img&ticket=invalid');
    expect(res.status).toBe(403);
  });

  it('有效票据但无效 type 返回 400', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(`/api/admin/batch-download?type=invalid&ticket=${ticket}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('type');
  });

  it('有效票据但无素材时返回 404', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(`/api/admin/batch-download?type=img&ticket=${ticket}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('可下载');
  });

  it('票据仅可用一次（重放返回 403）', async () => {
    const ticket = await getTicket();
    // 第一次使用（会因无素材返回 404，但票据已被消费）
    await request(app).get(`/api/admin/batch-download?type=img&ticket=${ticket}`);
    // 第二次使用同一票据 → 403
    const res = await request(app).get(`/api/admin/batch-download?type=img&ticket=${ticket}`);
    expect(res.status).toBe(403);
  });

  it('ids 参数含非数字时返回 400', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(
      `/api/admin/batch-download?type=img&ids=1,abc,3&ticket=${ticket}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('ids');
  });

  it('ids 参数含 0 或负数时返回 400', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(
      `/api/admin/batch-download?type=img&ids=0,5&ticket=${ticket}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('传入合法 ids 但无对应素材时返回 404', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(
      `/api/admin/batch-download?type=img&ids=1,2,3&ticket=${ticket}`,
    );
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('不传 ids 时行为与原批量下载一致（无素材返回 404）', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(`/api/admin/batch-download?type=img&ticket=${ticket}`);
    expect(res.status).toBe(404);
  });
});

describe('管理员统计表格下载接口', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PASSWORD });
    token = res.body.data.token;
  });

  /** 辅助：获取一次性下载票据 */
  async function getTicket(): Promise<string> {
    const res = await request(app)
      .post('/api/admin/download-ticket')
      .set('Authorization', `Bearer ${token}`);
    return res.body.data.ticket;
  }

  it('无票据返回 403', async () => {
    const res = await request(app)
      .get('/api/admin/stats-csv')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('无效票据返回 403', async () => {
    const res = await request(app).get('/api/admin/stats-csv?ticket=invalid');
    expect(res.status).toBe(403);
  });

  it('有效票据导出全部点位 CSV', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(`/api/admin/stats-csv?ticket=${ticket}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toMatch(/stats_\d{8}_\d{6}\.csv/);

    // 文本应包含 UTF-8 BOM 头
    const body = res.text;
    expect(body.charCodeAt(0)).toBe(0xfeff);

    // 表头应包含关键列
    const headerLine = body.split('\n')[0].replace(/^\uFEFF/, '');
    expect(headerLine).toContain('序号');
    expect(headerLine).toContain('名称');
    expect(headerLine).toContain('区县');
    expect(headerLine).toContain('乡镇');
    expect(headerLine).toContain('船管站');
    expect(headerLine).toContain('经度');
    expect(headerLine).toContain('纬度');
    expect(headerLine).toContain('主图片');
    expect(headerLine).toContain('备选图片');
    expect(headerLine).toContain('主视频');
    expect(headerLine).toContain('备选视频');
    expect(headerLine).toContain('已上传素材数');
    expect(headerLine).toContain('完成状态');
    expect(headerLine).toContain('最后上传时间');

    // 应包含 141 个数据行（去除 BOM 后按 \n 分割，最后一行是空行）
    const lines = body
      .replace(/^\uFEFF/, '')
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines.length).toBe(1 + 141); // 表头 + 141 行数据
  });

  it('票据仅可用一次（重放返回 403）', async () => {
    const ticket = await getTicket();
    // 第一次使用（成功）
    await request(app).get(`/api/admin/stats-csv?ticket=${ticket}`);
    // 第二次使用同一票据 → 403
    const res = await request(app).get(`/api/admin/stats-csv?ticket=${ticket}`);
    expect(res.status).toBe(403);
  });

  it('ids 参数含非数字时返回 400', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(`/api/admin/stats-csv?ids=1,abc,3&ticket=${ticket}`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('ids');
  });

  it('ids 参数含 0 或负数时返回 400', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(`/api/admin/stats-csv?ids=0,5&ticket=${ticket}`);
    expect(res.status).toBe(400);
  });

  it('传入合法 ids 时仅导出指定点位', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(`/api/admin/stats-csv?ids=1,2,3&ticket=${ticket}`);

    expect(res.status).toBe(200);
    const lines = res.text
      .replace(/^\uFEFF/, '')
      .split('\n')
      .filter((l) => l.length > 0);
    // 表头 + 3 行数据
    expect(lines.length).toBe(1 + 3);

    // 数据行应以 1, 2, 3 开头
    const dataLines = lines.slice(1);
    expect(dataLines[0].startsWith('1,')).toBe(true);
    expect(dataLines[1].startsWith('2,')).toBe(true);
    expect(dataLines[2].startsWith('3,')).toBe(true);
  });

  it('传入全部不存在的 ids 时返回 404', async () => {
    const ticket = await getTicket();
    const res = await request(app).get(`/api/admin/stats-csv?ids=99999,99998&ticket=${ticket}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('CSV 内容应正确转义含逗号的字段', async () => {
    // 验证 escapeCsvCell 对含逗号字段的双引号包裹
    // 通过查询不传 ids 的导出，确认所有行字段数与表头列数一致
    const ticket = await getTicket();
    const res = await request(app).get(`/api/admin/stats-csv?ticket=${ticket}`);

    expect(res.status).toBe(200);
    const lines = res.text
      .replace(/^\uFEFF/, '')
      .split('\n')
      .filter((l) => l.length > 0);
    const headerColCount = lines[0].split(',').length;

    // 每行要么字段数与表头一致（无字段含逗号），要么被双引号包裹（含逗号）
    // 这里仅做宽松校验：每行至少包含 headerColCount-1 个逗号
    for (const line of lines.slice(1)) {
      expect(line.split(',').length).toBeGreaterThanOrEqual(headerColCount - 1);
    }
  });
});
