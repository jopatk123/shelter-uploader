/**
 * 运行时配置
 *
 * 从后端 /api/config 拉取前端需要对齐的运行限制（分片大小、视频上限、图片压缩目标），
 * 避免这些阈值在前端被硬编码、与后端可配置项脱节。
 * 应用启动时先加载一次，其后各处同步读取即可。
 */
import { fetchRuntimeConfig } from '@/lib/api';
import type { RuntimeConfig } from '@/types';

/** 兜底默认值：与后端配置默认值保持一致，仅在拉取失败时使用 */
const DEFAULT_CONFIG: RuntimeConfig = {
  chunkSizeMB: 5,
  videoMaxSizeMB: 80,
  imageCompressTargetKB: 500,
};

let current: RuntimeConfig = { ...DEFAULT_CONFIG };

/** 同步获取当前运行时配置 */
export function getRuntimeConfig(): RuntimeConfig {
  return current;
}

/**
 * 应用启动前加载运行时配置
 * 拉取失败时保留默认值并打印警告（后端不可用时上传本身也无法进行）
 */
export async function loadRuntimeConfig(): Promise<void> {
  try {
    current = { ...DEFAULT_CONFIG, ...(await fetchRuntimeConfig()) };
  } catch (err) {
    console.warn('加载运行时配置失败，使用默认值:', err);
  }
}
