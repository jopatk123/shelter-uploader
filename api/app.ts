/**
 * Express 应用入口
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import fse from 'fs-extra';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { db, dbStatus, initDatabase, DATA_DIR, TEMP_CHUNK_DIR, STORAGE_DIR } from './db.js';
import pointsRoutes from './routes/points.js';
import uploadRoutes from './routes/upload.js';
import adminRoutes from './routes/admin.js';
import { authMiddleware } from './middleware/auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 初始化数据库（失败则退出，由 Docker 重启）
try {
  initDatabase();
} catch (err) {
  console.error('[app] 数据库初始化失败，进程退出:', err);
  process.exit(1);
}

const app: express.Application = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * API 路由
 */
app.use('/api/points', pointsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);

/**
 * 健康检查（Docker HEALTHCHECK 探针）
 * 返回 DB 可读性 + 磁盘空间 + 降级状态
 * - DB 不可读时返回 503，触发 Docker 重启容器 → 回到启动检查流程
 * - 降级模式下返回 200（应用可用，但数据可能不完整，需人工关注）
 */
app.get('/api/health', (_req: Request, res: Response) => {
  let dbOk = true;
  try {
    db.prepare('SELECT 1').get();
  } catch {
    dbOk = false;
  }

  // 磁盘空间（Node 18.15+ 支持 fs.statfsSync）
  let disk = { freeBytes: 0, totalBytes: 0 };
  try {
    const stat = fs.statfsSync(DATA_DIR);
    disk = {
      freeBytes: stat.bavail * stat.bsize,
      totalBytes: stat.blocks * stat.bsize,
    };
  } catch {
    // 忽略
  }

  const healthy = dbOk;
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      db: dbOk ? 'ok' : 'error',
      degraded: dbStatus.degraded,
      disk: {
        ...disk,
        freeMB: Math.round(disk.freeBytes / 1024 / 1024),
        totalMB: Math.round(disk.totalBytes / 1024 / 1024),
      },
    },
  });
});

/**
 * 静态文件服务：图片缩略图预览（需管理员鉴权）
 * /storage/point_xx/img_xxx.jpg
 * 前端通过 fetch + Authorization Header 获取图片并转为 blob URL 预览
 */
app.use('/storage', authMiddleware, express.static(STORAGE_DIR));

/**
 * 前端静态文件服务（生产环境，Vite build 后的 dist 目录）
 */
const clientDistPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  // SPA 回退：所有非 /api、非 /storage 的请求返回 index.html
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/storage/')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

/**
 * 定时清理7天前未合并的过期分片（每天凌晨3点执行）
 */
cron.schedule('0 3 * * *', async () => {
  try {
    if (!fs.existsSync(TEMP_CHUNK_DIR)) return;
    const dirs = fs.readdirSync(TEMP_CHUNK_DIR);
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const dir of dirs) {
      const dirPath = path.join(TEMP_CHUNK_DIR, dir);
      const stat = fs.statSync(dirPath);
      if (now - stat.mtimeMs > sevenDaysMs) {
        await fse.remove(dirPath);
        console.log(`[cron] 清理过期分片目录: ${dir}`);
      }
    }
  } catch (err) {
    console.error('[cron] 清理分片失败:', err);
  }
});

/**
 * 定时清理孤儿素材（每周日凌晨4点执行）
 * 孤儿定义：storage 中存在但 DB 无记录的素材文件
 * 保守策略：
 *   - 跳过 .tmp 文件（可能是正在合并的临时文件）
 *   - 跳过最近 1 小时修改的文件（可能是正在上传的文件）
 */
cron.schedule('0 4 * * 0', async () => {
  try {
    if (!fs.existsSync(STORAGE_DIR)) return;

    // 查询 DB 中所有素材路径
    const rows = db
      .prepare(`SELECT img_path, img_path_alt, video_path, video_path_alt FROM point_material`)
      .all() as Array<Record<string, string | null>>;

    const validPaths = new Set<string>();
    for (const row of rows) {
      for (const v of Object.values(row)) {
        if (v) validPaths.add(v);
      }
    }

    // 遍历 storage 目录
    const now = Date.now();
    const oneHourMs = 60 * 60 * 1000;
    let cleaned = 0;

    for (const dir of fs.readdirSync(STORAGE_DIR)) {
      const dirPath = path.join(STORAGE_DIR, dir);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(dirPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      for (const file of fs.readdirSync(dirPath)) {
        // 跳过临时文件
        if (file.endsWith('.tmp')) continue;

        const relPath = path.join(dir, file);
        if (validPaths.has(relPath)) continue;

        const fullPath = path.join(dirPath, file);
        try {
          const fileStat = fs.statSync(fullPath);
          // 跳过最近 1 小时修改的文件（可能正在上传）
          if (now - fileStat.mtimeMs < oneHourMs) continue;

          fs.unlinkSync(fullPath);
          cleaned++;
        } catch {
          // 忽略单个文件删除失败
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[cron] 清理孤儿素材 ${cleaned} 个`);
    }
  } catch (err) {
    console.error('[cron] 清理孤儿素材失败:', err);
  }
});

/**
 * 错误处理中间件
 * 区分 SQLite 错误类型，返回语义化的状态码与提示
 */
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', error.message);

  const code = (error as { code?: string }).code;

  // 磁盘空间不足
  if (code === 'SQLITE_FULL') {
    res.status(507).json({
      success: false,
      error: '磁盘空间不足，请联系管理员清理',
    });
    return;
  }

  // 数据库损坏（运行时发生，启动检查未拦截到）
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB') {
    res.status(503).json({
      success: false,
      error: '数据库异常，系统将自动恢复中，请稍后重试',
    });
    return;
  }

  // 数据库繁忙/锁定
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    res.status(503).json({
      success: false,
      error: '数据库繁忙，请稍后重试',
    });
    return;
  }

  // 磁盘 IO 错误
  if (code?.startsWith('SQLITE_IOERR')) {
    res.status(503).json({
      success: false,
      error: '存储 IO 异常，请检查服务器磁盘状态',
    });
    return;
  }

  res.status(500).json({ success: false, error: '服务器内部错误' });
});

/**
 * 404
 */
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: '接口不存在' });
});

export default app;
