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
export const VIDEO_MAX_SIZE_MB = optionalInt('VIDEO_MAX_SIZE_MB', 80);

/**
 * 图片单文件大小上限（KB）：服务端硬上限
 * 用于拦截绕过前端直接调用接口的超大文件
 */
export const IMAGE_MAX_SIZE_KB = optionalInt('IMAGE_MAX_SIZE_KB', 600);

/**
 * 前端图片压缩目标（KB）
 * 前端把超过该值的图片压缩到该值以内；故意低于 IMAGE_MAX_SIZE_KB，
 * 给压缩结果留出冗余（极端图片压缩后可能略超目标），避免边界情况下被服务端拒绝
 */
export const IMAGE_COMPRESS_TARGET_KB = optionalInt('IMAGE_COMPRESS_TARGET_KB', 500);

/**
 * 允许跨域访问的来源（逗号分隔，如 "https://a.com,https://b.com"）
 * 未配置（默认）表示不启用 CORS：前后端同源部署，浏览器不会发起跨域请求
 */
export const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? '').trim();

/** 数据存储目录（未配置时由 db.ts 回退到项目内 data 目录） */
export const DATA_DIR = process.env.DATA_DIR;

/**
 * 弱配置启动告警（不阻断启动，但公网部署时必须整改）
 * - JWT_SECRET 过短：token 签名可被离线暴力破解伪造
 * - ADMIN_PASSWORD 命中常见弱口令表：配合 15 分钟 20 次限流虽难以在线爆破，
 *   但攻击者可多 IP 并行尝试，必须更换
 */
const COMMON_WEAK_PASSWORDS = new Set([
  '123456',
  'password',
  'admin',
  'admin123',
  '12345678',
  '123456789',
  'abc123',
  '88888888',
]);

if (JWT_SECRET.length < 32) {
  console.warn(
    `[config] ⚠️ JWT_SECRET 长度仅 ${JWT_SECRET.length} 字符，建议使用 ≥ 32 字符的随机字符串，` +
      '否则 token 签名可能被离线暴力破解伪造',
  );
}
if (COMMON_WEAK_PASSWORDS.has(ADMIN_PASSWORD)) {
  console.warn(
    '[config] ⚠️ ADMIN_PASSWORD 为常见弱口令，公网部署会在短时间内被爆破，请立即更换强密码',
  );
}
