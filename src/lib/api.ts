/**
 * API 客户端
 */
import type {
  PointStatus,
  PointDetail,
  MaterialItem,
  ApiResponse,
  BatchDownloadType,
  RuntimeConfig,
} from '@/types';

const TOKEN_KEY = 'uploader_admin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * 获取后端运行限制配置（公开接口）
 * 用于让前端的上传阈值与后端可配置项（分片大小、视频上限）保持一致
 */
export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const res = await fetch('/api/config');
  const json: ApiResponse<RuntimeConfig> = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || '获取运行配置失败');
  return json.data;
}

/**
 * 获取全部点位状态
 */
export async function fetchPoints(): Promise<PointStatus[]> {
  const res = await fetch('/api/points');
  const json: ApiResponse<PointStatus[]> = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || '获取点位失败');
  return json.data;
}

/**
 * 获取单个点位的全部素材列表（上传页素材墙使用，公开免鉴权）
 */
export async function fetchMaterials(pointId: number): Promise<MaterialItem[]> {
  const res = await fetch(`/api/points/${pointId}/materials`);
  const json: ApiResponse<MaterialItem[]> = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || '获取素材列表失败');
  return json.data;
}

/**
 * 公开下载点位统计表格（CSV，免鉴权）
 * 用于上传页面的公开访问场景，直接发起浏览器原生下载
 */
export async function downloadPublicStatsCsv(): Promise<void> {
  const url = '/api/points/stats-csv';
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 素材文件的公开访问 URL（免鉴权）
 * 服务端按 pointId + materialId 双重校验，支持 Range（视频拖动进度条）
 * 可直接用于 <img src> / <video src>，无需 token
 */
export function materialFileUrl(pointId: number, materialId: number): string {
  return `/api/points/${pointId}/materials/${materialId}/file`;
}

/**
 * 公开删除素材（上传页免鉴权）
 * 前端删除前需经确认弹窗；管理后台删除请用 adminDeleteMaterial
 */
export async function deletePointMaterial(pointId: number, materialId: number): Promise<void> {
  const res = await fetch(`/api/points/${pointId}/materials/${materialId}`, {
    method: 'DELETE',
  });
  const json: ApiResponse<unknown> = await res.json();
  if (!json.success) throw new Error(json.error || '删除失败');
}

/**
 * 管理员登录
 */
export async function adminLogin(password: string): Promise<string> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const json: ApiResponse<{ token: string }> = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || '登录失败');
  return json.data.token;
}

/**
 * 管理员获取点位列表（带筛选）
 */
export async function adminFetchPoints(filter: string): Promise<PointStatus[]> {
  const res = await fetch(`/api/admin/points?filter=${filter}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const json: ApiResponse<PointStatus[]> = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || '获取点位失败');
  return json.data;
}

/**
 * 管理员获取点位详情
 */
export async function adminFetchPointDetail(id: number): Promise<PointDetail> {
  const res = await fetch(`/api/admin/point/${id}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const json: ApiResponse<PointDetail> = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || '获取详情失败');
  return json.data;
}

/**
 * 管理员删除素材（:id 为素材行 id）
 */
export async function adminDeleteMaterial(id: number): Promise<void> {
  const res = await fetch(`/api/admin/material/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const json: ApiResponse<unknown> = await res.json();
  if (!json.success) throw new Error(json.error || '删除失败');
}

/**
 * 管理员下载素材（带进度回调，:id 为素材行 id）
 */
export async function adminDownload(
  id: number,
  ext: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  const res = await fetch(`/api/admin/download/${id}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '下载失败' }));
    throw new Error(err.error || '下载失败');
  }

  const contentLength = res.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength) : 0;

  if (!res.body || !total) {
    // 无法获取进度，直接用 blob 下载
    const blob = await res.blob();
    triggerDownload(blob, getDownloadFileName(id, ext));
    onProgress(100);
    return;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress(Math.round((received / total) * 100));
    }
  }

  const blob = new Blob(chunks as BlobPart[]);
  triggerDownload(blob, getDownloadFileName(id, ext));
  onProgress(100);
}

function getDownloadFileName(id: number, ext: string): string {
  return `material_${id}${ext}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 获取一次性下载票据（需 JWT 鉴权）
 * 票据 60 秒有效，仅可用一次，用于浏览器原生下载场景
 */
async function fetchDownloadTicket(): Promise<string> {
  const res = await fetch('/api/admin/download-ticket', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const json: ApiResponse<{ ticket: string }> = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || '获取下载票据失败');
  return json.data.ticket;
}

/**
 * 管理员批量下载（zip 打包点位素材）
 *
 * 使用一次性下载票据替代 URL 中直接传递 JWT token，避免 token 泄露。
 * 流程：先通过鉴权接口获取票据 → 用票据发起浏览器原生流式下载
 *
 * @param type 打包范围：'img' / 'video' / 'all'（'all' = 图片与视频装进同一个 zip）
 * @param ids  可选：仅下载指定点位；不传或传空数组则下载全部已上传对应素材的点位
 */
export async function adminBatchDownload(type: BatchDownloadType, ids?: number[]): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('未登录');

  // 步骤1：获取一次性下载票据（通过 Authorization Header 鉴权）
  const ticket = await fetchDownloadTicket();

  // 步骤2：用票据发起浏览器原生下载
  // 票据 60 秒内有效且仅可用一次，即使泄露也无法重放
  let url = `/api/admin/batch-download?type=${type}&ticket=${encodeURIComponent(ticket)}`;
  if (ids && ids.length > 0) {
    url += `&ids=${encodeURIComponent(ids.join(','))}`;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = ''; // 文件名由服务端 Content-Disposition 响应头决定
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 管理员下载点位统计表格（CSV）
 *
 * 使用一次性下载票据替代 URL 中直接传递 JWT token，避免 token 泄露。
 * 流程：先通过鉴权接口获取票据 → 用票据发起浏览器原生下载
 *
 * @param ids 可选：仅导出指定点位；不传或传空数组则导出全部点位
 */
export async function adminDownloadStatsCsv(ids?: number[]): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('未登录');

  // 步骤1：获取一次性下载票据
  const ticket = await fetchDownloadTicket();

  // 步骤2：用票据发起浏览器原生下载
  let url = `/api/admin/stats-csv?ticket=${encodeURIComponent(ticket)}`;
  if (ids && ids.length > 0) {
    url += `&ids=${encodeURIComponent(ids.join(','))}`;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = ''; // 文件名由服务端 Content-Disposition 响应头决定
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
