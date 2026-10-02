/**
 * 共享类型定义
 */

/**
 * 素材类型：主图 / 备选图 / 主视频 / 备选视频
 */
export type MaterialType = 'img' | 'img_alt' | 'video' | 'video_alt';

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
  has_image: boolean;
  has_image_alt: boolean;
  has_video: boolean;
  has_video_alt: boolean;
  upload_time: string | null;
}

export interface PointDetail extends PointStatus {
  img_path: string | null;
  img_path_alt: string | null;
  video_path: string | null;
  video_path_alt: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
