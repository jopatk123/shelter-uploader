/**
 * 批量下载接口测试（手动脚本，依赖本地素材文件 图片测试.jpg / 视频测试.mp4）
 * 上传素材到多个点位 → 调用批量下载 → 验证 zip 内容
 *
 * v2 契约：
 *   - 每点位不限上传数量，/complete 为 INSERT 语义并返回素材行 id
 *   - 批量下载使用一次性票据鉴权（POST /api/admin/download-ticket 获取）
 *   - 删除素材按素材行 id（DELETE /api/admin/material/:id）
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const API = 'http://localhost:3001';
const ADMIN_PASSWORD = '123456';
const POINT_IDS = [21, 22, 23]; // 测试用点位

process.env.http_proxy = '';
process.env.https_proxy = '';
process.env.no_proxy = 'localhost';

function log(...args) {
  console.log('[batch-test]', ...args);
}
function fail(msg) {
  console.error('[FAIL]', msg);
  process.exit(1);
}

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

async function login() {
  const r = await req(`${API}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  return r.json.data.token;
}

async function getTicket(token) {
  const r = await req(`${API}/api/admin/download-ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.json.data.ticket;
}

async function uploadToPoint(pointId, filePath, type) {
  const buf = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const fileId = `batch-test-${pointId}-${type}-${Date.now()}`;
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const totalChunks = Math.ceil(buf.length / CHUNK_SIZE);

  // 上传分片
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, buf.length);
    const chunk = buf.subarray(start, end);
    const form = new FormData();
    form.append('chunk', new Blob([chunk]), `chunk-${i}`);
    form.append('index', String(i));
    form.append('totalChunks', String(totalChunks));
    form.append('fileId', fileId);
    form.append('pointId', String(pointId));
    form.append('type', type);
    form.append('fileName', fileName);
    const r = await req(`${API}/api/upload/chunk`, { method: 'POST', body: form });
    if (r.status !== 200) fail(`点位${pointId} 分片${i} 上传失败`);
  }

  // 合并（v2：INSERT 新素材，返回素材行 id）
  const r = await req(`${API}/api/upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileId,
      pointId: String(pointId),
      type,
      fileName,
      totalChunks: String(totalChunks),
    }),
  });
  if (r.status !== 200) fail(`点位${pointId} 合并失败: ${JSON.stringify(r.json)}`);
  log(`  点位 ${pointId} 上传 ${type} 完成: id=${r.json.data.id} path=${r.json.data.path}`);
  return r.json.data.id;
}

async function deleteMaterial(token, materialId) {
  await req(`${API}/api/admin/material/${materialId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function main() {
  log('========== 批量下载测试开始 ==========');

  const token = await login();
  log('登录成功');

  const imgPath = path.join(process.cwd(), '图片测试.jpg');
  const videoPath = path.join(process.cwd(), '视频测试.mp4');

  // 1. 上传图片到 3 个点位
  log('\n--- 上传图片到 3 个点位 ---');
  const imgIds = {};
  for (const pid of POINT_IDS) {
    imgIds[pid] = await uploadToPoint(pid, imgPath, 'img');
  }

  // 2. 上传视频到 2 个点位
  log('\n--- 上传视频到 2 个点位 ---');
  const videoIds = {};
  for (const pid of POINT_IDS.slice(0, 2)) {
    videoIds[pid] = await uploadToPoint(pid, videoPath, 'video');
  }

  // 3. 测试批量下载图片（一次性票据鉴权）
  log('\n--- 批量下载图片 ---');
  const imgTicket = await getTicket(token);
  const imgZipRes = await fetch(`${API}/api/admin/batch-download?type=img&ticket=${imgTicket}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!imgZipRes.ok) fail(`批量下载图片失败: ${imgZipRes.status}`);

  const imgCd = imgZipRes.headers.get('content-disposition');
  log(`  Content-Type: ${imgZipRes.headers.get('content-type')}`);
  log(`  Content-Disposition: ${imgCd}`);

  const imgZipBuf = Buffer.from(await imgZipRes.arrayBuffer());
  const imgZipPath = path.join(process.cwd(), 'data', 'test-batch-images.zip');
  fs.writeFileSync(imgZipPath, imgZipBuf);
  log(`  zip 保存到: ${imgZipPath} (${(imgZipBuf.length / 1024).toFixed(1)}KB)`);

  // 用 unzip 验证 zip 内容
  const imgList = execSync(`unzip -l "${imgZipPath}"`, { encoding: 'utf-8' });
  log('  zip 内容:');
  console.log(imgList);

  // 验证 zip 包含 3 个文件
  const imgFileLines = imgList.split('\n').filter((l) => l.trim().endsWith('.jpg'));
  if (imgFileLines.length !== 3) {
    fail(`期望 3 个 jpg 文件，实际 ${imgFileLines.length}`);
  }
  log(`  ✅ 包含 ${imgFileLines.length} 个图片文件`);

  // 验证文件名包含点位 ID
  for (const line of imgFileLines) {
    const fname = line.trim().split(/\s+/).pop();
    log(`    - ${fname}`);
    if (!fname.startsWith('point_')) fail(`文件名格式错误: ${fname}`);
  }

  // 4. 测试批量下载视频
  log('\n--- 批量下载视频 ---');
  const videoTicket = await getTicket(token);
  const videoZipRes = await fetch(
    `${API}/api/admin/batch-download?type=video&ticket=${videoTicket}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!videoZipRes.ok) fail(`批量下载视频失败: ${videoZipRes.status}`);

  const videoZipBuf = Buffer.from(await videoZipRes.arrayBuffer());
  const videoZipPath = path.join(process.cwd(), 'data', 'test-batch-videos.zip');
  fs.writeFileSync(videoZipPath, videoZipBuf);
  log(`  zip 保存到: ${videoZipPath} (${(videoZipBuf.length / 1024 / 1024).toFixed(2)}MB)`);

  const videoList = execSync(`unzip -l "${videoZipPath}"`, { encoding: 'utf-8' });
  log('  zip 内容:');
  console.log(videoList);

  const videoFileLines = videoList.split('\n').filter((l) => l.trim().endsWith('.mp4'));
  if (videoFileLines.length !== 2) {
    fail(`期望 2 个 mp4 文件，实际 ${videoFileLines.length}`);
  }
  log(`  ✅ 包含 ${videoFileLines.length} 个视频文件`);

  // 5. 测试无效 type
  log('\n--- 测试无效 type ---');
  const invalidTicket = await getTicket(token);
  const invalidRes = await req(
    `${API}/api/admin/batch-download?type=invalid&ticket=${invalidTicket}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (invalidRes.status !== 400) fail(`期望 400，实际 ${invalidRes.status}`);
  log(`  ✅ 无效 type 返回 400: ${invalidRes.json.error}`);

  // 6. 测试无素材的批量下载（先删除所有图片素材）
  log('\n--- 测试无素材场景 ---');
  for (const pid of POINT_IDS) {
    await deleteMaterial(token, imgIds[pid]);
  }
  const emptyTicket = await getTicket(token);
  const emptyRes = await req(`${API}/api/admin/batch-download?type=img&ticket=${emptyTicket}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (emptyRes.status !== 404) fail(`期望 404，实际 ${emptyRes.status}`);
  log(`  ✅ 无素材返回 404: ${emptyRes.json.error}`);

  // 7. 清理视频素材
  for (const pid of POINT_IDS.slice(0, 2)) {
    await deleteMaterial(token, videoIds[pid]);
  }

  // 清理 zip 测试文件
  fs.unlinkSync(imgZipPath);
  fs.unlinkSync(videoZipPath);
  log('\n--- 清理完成 ---');

  log('\n========== ✅ 批量下载测试全部通过 ==========');
}

main().catch((err) => {
  console.error('未捕获错误:', err);
  process.exit(1);
});
