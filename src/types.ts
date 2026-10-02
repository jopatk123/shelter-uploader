/**
 * 共享类型定义
 */

/**
 * 素材类型：图片 / 视频
 * v2 起不分主/备，每个点位不限上传数量
 */
export type MaterialType = 'img' | 'video';

export interface PointInfo {
  id: number;
  name: string;
  city: string;
  district: string;
  township: string;
  location: string;
  station: string;
  capacity: string;
  lon: number;
  lat: number;
  remark: string;
}

export interface PointStatus extends PointInfo {
  /** 已上传图片数量 */
  img_count: number;
  /** 已上传视频数量 */
  video_count: number;
  /** 已上传素材总数（图片 + 视频） */
  uploaded_count: number;
  upload_time: string | null;
}

/** 单条素材记录 */
export interface MaterialItem {
  id: number;
  type: MaterialType;
  path: string;
  size: number;
  upload_time: string | null;
}

export interface PointDetail {
  id: number;
  name: string;
  district: string;
  township: string;
  station: string;
  lon: number;
  lat: number;
  img_count: number;
  video_count: number;
  uploaded_count: number;
  upload_time: string | null;
  materials: MaterialItem[];
}

/** 后端运行限制配置（前端需对齐的上传阈值） */
export interface RuntimeConfig {
  /** 上传分片大小（MB） */
  chunkSizeMB: number;
  /** 视频单文件大小上限（MB） */
  videoMaxSizeMB: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
