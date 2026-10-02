/**
 * Vitest 全局 setup
 * - 后端 API 测试使用独立临时数据库，避免污染开发数据
 */
import { config } from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';

config();

// 测试环境使用独立的临时数据目录
const TEST_DATA_DIR = path.join(os.tmpdir(), `uploader-test-${process.pid}`);
fs.mkdirSync(path.join(TEST_DATA_DIR, 'storage'), { recursive: true });
fs.mkdirSync(path.join(TEST_DATA_DIR, 'temp_chunk'), { recursive: true });

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';

// 测试结束后清理临时目录
afterAll(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
});
