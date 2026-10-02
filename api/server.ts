/**
 * local server entry file, for local development
 */
import app from './app.js';
import { db } from './db.js';

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

/**
 * 优雅关闭：先停止接收新连接，再关闭数据库（触发 WAL checkpoint 合并日志），最后退出
 * 即使 SIGKILL 无法执行此流程，WAL 模式下已提交事务仍可在下次启动时恢复
 */
function gracefulShutdown(signal: string): void {
  console.log(`${signal} signal received`);
  server.close((err) => {
    if (err) {
      console.error('[server] 关闭出错:', err.message);
    } else {
      console.log('[server] closed');
    }
    try {
      db.close();
      console.log('[db] closed (WAL checkpoint done)');
    } catch (e) {
      console.error('[db] 关闭失败:', (e as Error).message);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * 全局兜底：未捕获异常与未处理 Promise rejection
 * 记录日志后让进程崩溃（避免进入不确定状态），由 Docker / 进程管理器自动重启
 * 这两个钩子不能"吞掉"异常继续运行，否则可能导致数据库句柄、文件句柄泄漏
 */
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  process.exit(1);
});

export default app;
