/**
 * 管理员 Token 鉴权中间件
 */
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { JWT_SECRET, ADMIN_PASSWORD, API_TOKEN } from '../config.js';

/**
 * 一次性下载票据存储（内存中，TTL 60 秒）
 * 用于批量下载等需要浏览器原生流式下载的场景，替代 URL 中直接传递 JWT token
 */
interface DownloadTicket {
  createdAt: number;
  used: boolean;
}
const TICKET_TTL_MS = 60 * 1000; // 60 秒有效期
const downloadTickets = new Map<string, DownloadTicket>();

/**
 * 生成管理员 Token
 */
export function generateToken(): string {
  return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
}

/**
 * 对两段字符串做 SHA-256 后再恒定时间比较，避免逐字节短路比较产生的时序侧信道
 */
function timingSafeStringEqual(left: string, right: string): boolean {
  const a = crypto.createHash('sha256').update(left, 'utf8').digest();
  const b = crypto.createHash('sha256').update(right, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * 校验密码
 */
export function verifyPassword(password: string): boolean {
  return timingSafeStringEqual(password, ADMIN_PASSWORD);
}

/**
 * 校验是否为环境变量中配置的长期 API Token
 * 未配置 API_TOKEN 时恒为 false
 */
export function matchesApiToken(presented: string): boolean {
  if (!API_TOKEN || !presented) return false;
  return timingSafeStringEqual(presented, API_TOKEN);
}

/**
 * 管理凭证：长期 API Token，或未过期的管理员 JWT
 */
export function isAdminCredential(token: string): boolean {
  if (matchesApiToken(token)) return true;
  try {
    jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * 生成一次性下载票据（已通过鉴权的调用方才可使用）
 * 票据 60 秒内有效，仅可使用一次
 */
export function generateDownloadTicket(): string {
  const ticket = crypto.randomBytes(32).toString('hex');
  downloadTickets.set(ticket, { createdAt: Date.now(), used: false });

  // 顺带清理过期票据
  const now = Date.now();
  for (const [key, val] of downloadTickets) {
    if (now - val.createdAt > TICKET_TTL_MS * 2) {
      downloadTickets.delete(key);
    }
  }

  return ticket;
}

/**
 * 校验并消费一次性下载票据（成功后立即标记为已使用）
 */
function consumeDownloadTicket(ticket: string): boolean {
  const record = downloadTickets.get(ticket);
  if (!record) return false;
  if (record.used) return false;
  if (Date.now() - record.createdAt > TICKET_TTL_MS) {
    downloadTickets.delete(ticket);
    return false;
  }
  record.used = true;
  downloadTickets.delete(ticket);
  return true;
}

/**
 * 从请求中提取 Token（仅支持 Authorization Header）
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

/**
 * 鉴权中间件：校验 Authorization Header 中的 Token
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(403).json({ success: false, error: '未提供认证Token，禁止访问' });
    return;
  }

  if (!isAdminCredential(token)) {
    res.status(403).json({ success: false, error: 'Token无效或已过期' });
    return;
  }

  next();
}

/**
 * 管理凭证或一次性下载票据
 * 浏览器原生下载继续用票据；Agent 可直接带 Authorization: Bearer（JWT 或 API_TOKEN）
 * 凭证有效时不消费票据
 */
export function adminOrTicketMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token && isAdminCredential(token)) {
    next();
    return;
  }

  ticketMiddleware(req, res, next);
}

/**
 * 一次性票据鉴权中间件：校验 Query 参数中的 ticket
 * 用于浏览器原生下载场景（如 batch-download），替代 URL 中直接传递 JWT
 */
export function ticketMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ticket = req.query?.ticket;
  if (typeof ticket !== 'string' || ticket.length === 0) {
    res.status(403).json({ success: false, error: '未提供下载票据' });
    return;
  }

  if (!consumeDownloadTicket(ticket)) {
    res.status(403).json({ success: false, error: '票据无效或已过期' });
    return;
  }

  next();
}
