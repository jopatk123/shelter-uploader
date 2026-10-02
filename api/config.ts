/**
 * 运行时配置：集中读取并校验环境变量
 *
 * 设计要点：
 * 1. 顶部先执行 dotenv.config()，再读取环境变量。
 *    ESM 中 import 会先于模块体执行，若把 dotenv.config() 放在 app.ts 的模块体里，
 *    则在它之前被 import 的模块（db / routes / middleware）读取到的 env 还不包含 .env，
 *    因此所有 env 读取统一收敛到本模块，由本模块负责先加载 .env。
 * 2. 管理员凭据（JWT_SECRET / ADMIN_PASSWORD）为必需项，缺失或为空时直接抛错阻断启动，
 *    不再提供内置默认值，避免部署时忘记配置而用公开默认口令裸奔。
 */
import dotenv from 'dotenv';

dotenv.config();

/**
 * 读取必需的环境变量，缺失或为空白时抛错（阻断启动）
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `缺少必需的环境变量 ${name}：请在项目根目录创建 .env 文件（可参考 .env.example）并完成配置后再启动`,
    );
  }
  return value;
}

/**
 * 读取可选的正整数环境变量，缺失或非法时回退默认值
 */
function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 服务监听端口 */
export const PORT = optionalInt('PORT', 3001);

/** 管理员 JWT 签名密钥（必需） */
export const JWT_SECRET = requireEnv('JWT_SECRET');

/** 管理员登录密码（必需） */
export const ADMIN_PASSWORD = requireEnv('ADMIN_PASSWORD');

/** 上传分片大小（MB） */
export const CHUNK_SIZE_MB = optionalInt('CHUNK_SIZE', 5);

/** 视频单文件大小上限（MB） */
export const VIDEO_MAX_SIZE_MB = optionalInt('VIDEO_MAX_SIZE_MB', 100);

/** 数据存储目录（未配置时由 db.ts 回退到项目内 data 目录） */
export const DATA_DIR = process.env.DATA_DIR;
