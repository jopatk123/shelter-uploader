/**
 * 端到端上传测试脚本
 * 使用真实的 图片测试.jpg 和 视频测试.mp4 文件
 * 模拟前端分片上传 + 合并 + 鉴权下载 + 删除 全流程
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const API = process.env.API || 'http://localhost:3001';
const POINT_ID_IMG = 11; // 测试用点位
const POINT_ID_VIDEO = 12;
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

// 禁用代理
process.env.http_proxy = '';
process.env.https_proxy = '';
process.env.HTTP_PROXY = '';
process.env.HTTPS_PROXY = '';
process.env.no_proxy = 'localhost';

function log(...args) {
  console.log('[test]', ...args);
}

function fail(msg) {
  console.error('[FAIL]', msg);
  process.exit(1);
}

/**
 * 通用 fetch 封装
 */
async function req(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

/**
 * 上传单个分片
 */
async function uploadChunk(chunk, index, totalChunks, fileId, pointId, type, fileName) {
  const form = new FormData();
  const blob = new Blob([chunk]);
  form.append('chunk', blob, `chunk-${index}`);
  form.append('index', String(index));
  form.append('totalChunks', String(totalChunks));
  form.append('fileId', fileId);
  form.append('pointId', String(pointId));
  form.append('type', type);
  form.append('fileName', fileName);

  const r = await req(`${API}/api/upload/chunk`, { method: 'POST', body: form });
  if (r.status !== 200 || !r.json.success) {
    fail(`分片 ${index} 上传失败: ${JSON.stringify(r.json)}`);
  }
  return r.json;
}

/**
 * 合并文件
 */
async function completeUpload(fileId, pointId, type, fileName) {
  const r = await req(`${API}/api/upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, pointId: String(pointId), type, fileName }),
  });
  if (r.status !== 200 || !r.json.success) {
    fail(`complete 失败: ${JSON.stringify(r.json)}`);
  }
  return r.json.data;
}

/**
 * 管理员登录
 */
async function login() {
  const r = await req(`${API}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  if (r.status !== 200 || !r.json.success) {
    fail(`登录失败: ${JSON.stringify(r.json)}`);
  }
  return r.json.data.token;
}

/**
 * 获取点位详情
 */
async function getPointDetail(token, id) {
  const r = await req(`${API}/api/admin/point/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status !== 200 || !r.json.success) {
    fail(`获取详情失败: ${JSON.stringify(r.json)}`);
  }
  return r.json.data;
}

/**
 * 删除素材
 */
async function deleteMaterial(token, id, type) {
  const r = await req(`${API}/api/admin/material/${id}?type=${type}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return r;
}

/**
 * 分片切分文件
 */
function splitChunks(filePath) {
  const buf = fs.readFileSync(filePath);
  const total = Math.ceil(buf.length / CHUNK_SIZE);
  const chunks = [];
  for (let i = 0; i < total; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, buf.length);
    chunks.push(buf.subarray(start, end));
  }
  return { chunks, totalSize: buf.length, totalChunks: total };
}

/**
 * 计算文件 sha256
 */
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function testUploadFile(filePath, pointId, type) {
  log(`开始测试 ${type} 上传: ${path.basename(filePath)}`);
  const { chunks, totalSize, totalChunks } = splitChunks(filePath);
  log(`文件大小: ${(totalSize / 1024 / 1024).toFixed(2)}MB，分片数: ${totalChunks}`);

  const fileId = `test-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fileName = path.basename(filePath);

  // 1. 上传所有分片
  for (let i = 0; i < chunks.length; i++) {
    await uploadChunk(chunks[i], i, totalChunks, fileId, pointId, type, fileName);
    log(`  分片 ${i + 1}/${totalChunks} 上传完成`);
  }

  // 2. 合并
  const mergeRes = await completeUpload(fileId, pointId, type, fileName);
  log(`  合并成功: ${mergeRes.path}, size=${mergeRes.size}`);
  if (mergeRes.size !== totalSize) {
    fail(`合并后大小不匹配，期望 ${totalSize}，实际 ${mergeRes.size}`);
  }

  return { mergeRes, originalBuf: fs.readFileSync(filePath) };
}

async function main() {
  log('========== 端到端上传测试开始 ==========');
  log(`API: ${API}`);

  const isRemote = !API.includes('localhost') && !API.includes('127.0.0.1');
  if (isRemote) {
    log('远程模式：跳过本地存储文件校验，仅校验下载内容');
  }

  // 健康检查
  const health = await req(`${API}/api/health`);
  if (health.status !== 200) fail('服务器不可用');
  log('服务器正常');

  // 登录
  const token = await login();
  log('管理员登录成功');

  // 测试文件路径
  const imgPath = path.join(process.cwd(), '图片测试.jpg');
  const videoPath = path.join(process.cwd(), '视频测试.mp4');

  if (!fs.existsSync(imgPath)) fail(`测试图片不存在: ${imgPath}`);
  if (!fs.existsSync(videoPath)) fail(`测试视频不存在: ${videoPath}`);

  // ============ 测试图片上传 ============
  log('\n----- 图片上传测试 -----');
  const imgResult = await testUploadFile(imgPath, POINT_ID_IMG, 'img');
  const originalImgSha = sha256(imgResult.originalBuf);

  // 校验数据库状态
  const imgDetail = await getPointDetail(token, POINT_ID_IMG);
  if (!imgDetail.has_image) fail('数据库未记录图片素材');
  log(`  数据库记录: img_path=${imgDetail.img_path}`);

  // 校验存储文件 sha256（仅本地模式）
  if (!isRemote) {
    const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const storedImgPath = path.join(DATA_DIR, 'storage', imgDetail.img_path);
    const storedImgBuf = fs.readFileSync(storedImgPath);
    const storedImgSha = sha256(storedImgBuf);
    if (storedImgSha !== originalImgSha) {
      fail(`图片 sha256 不匹配\n  原始: ${originalImgSha}\n  存储: ${storedImgSha}`);
    }
    log(`  文件 sha256 校验通过: ${storedImgSha.slice(0, 16)}...`);
  } else {
    log('  跳过本地存储校验（远程模式）');
  }

  // ============ 测试视频上传 ============
  log('\n----- 视频上传测试 -----');
  const videoResult = await testUploadFile(videoPath, POINT_ID_VIDEO, 'video');
  const originalVideoSha = sha256(videoResult.originalBuf);

  const videoDetail = await getPointDetail(token, POINT_ID_VIDEO);
  if (!videoDetail.has_video) fail('数据库未记录视频素材');
  log(`  数据库记录: video_path=${videoDetail.video_path}`);

  if (!isRemote) {
    const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const storedVideoPath = path.join(DATA_DIR, 'storage', videoDetail.video_path);
    const storedVideoBuf = fs.readFileSync(storedVideoPath);
    const storedVideoSha = sha256(storedVideoBuf);
    if (storedVideoSha !== originalVideoSha) {
      fail(`视频 sha256 不匹配\n  原始: ${originalVideoSha}\n  存储: ${storedVideoSha}`);
    }
    log(`  文件 sha256 校验通过: ${storedVideoSha.slice(0, 16)}...`);
  } else {
    log('  跳过本地存储校验（远程模式）');
  }

  // ============ 测试覆盖上传 ============
  log('\n----- 覆盖上传测试 -----');
  log('  再次上传图片到同一点位');
  const reUpload = await testUploadFile(imgPath, POINT_ID_IMG, 'img');
  const reDetail = await getPointDetail(token, POINT_ID_IMG);
  if (reDetail.img_path === imgDetail.img_path) {
    fail('覆盖上传未生成新文件名');
  }
  log(`  旧文件路径: ${imgDetail.img_path}`);
  log(`  新文件路径: ${reDetail.img_path}`);

  if (!isRemote) {
    const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const oldStoredPath = path.join(DATA_DIR, 'storage', imgDetail.img_path);
    if (fs.existsSync(oldStoredPath)) {
      fail(`旧文件未被删除: ${oldStoredPath}`);
    }
    log('  旧文件已删除');
  } else {
    log('  跳过旧文件删除校验（远程模式）');
  }

  // ============ 测试下载 ============
  log('\n----- 下载测试 -----');
  const dlRes = await fetch(
    `${API}/api/admin/download/${POINT_ID_IMG}?type=img`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!dlRes.ok) fail(`下载失败: ${dlRes.status}`);
  const dlBuf = Buffer.from(await dlRes.arrayBuffer());
  const dlSha = sha256(dlBuf);
  if (dlSha !== originalImgSha) {
    fail(`下载文件 sha256 不匹配\n  原始: ${originalImgSha}\n  下载: ${dlSha}`);
  }
  log(`  下载图片 sha256 校验通过: ${dlSha.slice(0, 16)}...`);
  log(`  Content-Disposition: ${dlRes.headers.get('content-disposition')}`);

  // ============ 测试删除 ============
  log('\n----- 删除测试 -----');
  const delRes = await deleteMaterial(token, POINT_ID_IMG, 'img');
  if (delRes.status !== 200 || !delRes.json.success) {
    fail(`删除图片失败: ${JSON.stringify(delRes.json)}`);
  }
  const afterDelDetail = await getPointDetail(token, POINT_ID_IMG);
  if (afterDelDetail.has_image) fail('删除后仍显示已上传');
  log('  图片已删除');

  const delVideoRes = await deleteMaterial(token, POINT_ID_VIDEO, 'video');
  if (delVideoRes.status !== 200) fail(`删除视频失败: ${JSON.stringify(delVideoRes.json)}`);
  log('  视频已删除');

  log('\n========== ✅ 全部测试通过 ==========');
}

main().catch(err => {
  console.error('未捕获错误:', err);
  process.exit(1);
});
