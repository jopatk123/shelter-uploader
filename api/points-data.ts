/**
 * 福州沿海码头避风点点位固定数据（141 个）
 *
 * 来源：福州沿海码头避风点点位.xlsx（市海洋与渔业局提供，WGS84 坐标系）
 * 字段：序号/编号/名称/市/县/乡镇/位置/船管站/可停泊数量/经度/纬度/备注
 */

// 点位数据按序号拆分存放，避免单文件过大（AGENTS.md 单文件行数上限）：
//   - data/points-1-70.ts   序号 1-70
//   - data/points-71-141.ts 序号 71-141
import { POINTS_PART_1 } from './data/points-1-70.js';
import { POINTS_PART_2 } from './data/points-71-141.js';

export interface PointData {
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

export const POINTS_DATA: PointData[] = [...POINTS_PART_1, ...POINTS_PART_2];
