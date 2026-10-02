/**
 * SQLite 数据库初始化与管理
 *
 * 崩溃/损坏防护策略：
 *   - 启动时执行 quick_check 完整性检查
 *   - 检查失败 → 降级恢复：重命名坏库为 .corrupt-{ts}（保留供人工分析）
 *     → 清理 WAL/SHM → 重建空库 → 重新初始化 141 个避风点点位
 *   - storage 目录中的素材文件保留，但 DB 记录已丢失，需人工合并
 *   - 运行时损坏由 HEALTHCHECK 检测并触发容器重启 → 回到启动检查流程
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { POINTS_DATA } from './points-data.js';
import { DATA_DIR as ENV_DATA_DIR } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据目录：优先使用 DATA_DIR 环境变量（Docker 挂载），否则使用项目下 data 目录
const DATA_DIR = ENV_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.sqlite');
const STORAGE_DIR = path.join(DATA_DIR, 'storage');
const TEMP_CHUNK_DIR = path.join(DATA_DIR, 'temp_chunk');

// 确保目录存在
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STORAGE_DIR, { recursive: true });
fs.mkdirSync(TEMP_CHUNK_DIR, { recursive: true });

/**
 * 数据库运行状态（供健康检查接口读取）
 * - degraded=true 表示当前库是从损坏恢复而来的空库，原数据已丢失
 */
export const dbStatus = {
  degraded: false,
};

/**
 * 应用 pragma 设置到数据库连接
 */
function applyPragmas(conn: Database.Database): void {
  // WAL 模式：崩溃恢复能力优于 DELETE 模式，提交的事务不会丢失
  conn.pragma('journal_mode = WAL');
  // 外键约束
  conn.pragma('foreign_keys = ON');
  // 写入忙等待 5s，避免并发写入时立即抛 SQLITE_BUSY
  conn.pragma('busy_timeout = 5000');
  // synchronous = FULL：WAL+NORMAL 在断电时可能丢最后一个事务，FULL 最安全
  // 本项目「上传数据珍贵」场景，牺牲少量写入性能换取最强持久化保证
  conn.pragma('synchronous = FULL');
}

/**
 * 完整性检查（quick_check 比 integrity_check 快，只验证 B-tree 结构）
 * 返回 true 表示健康
 */
function checkIntegrity(conn: Database.Database): boolean {
  try {
    const result = conn.pragma('quick_check', { simple: true });
    return result === 'ok';
  } catch (err) {
    console.error('[db] 完整性检查抛错:', (err as Error).message);
    return false;
  }
}

/**
 * 损坏降级恢复：
 *   1. 重命名坏库为 .corrupt-{ts}（保留以供人工分析，不直接删除）
 *   2. 清理残留的 WAL/SHM 文件
 *   3. 重新打开 + 应用 pragma + 再次完整性检查
 *   4. 失败则抛错（疑似磁盘硬件故障，无法软件层面恢复）
 *
 * 注意：storage 中的素材文件保留，但 DB 记录已丢失，需人工合并
 */
function recoverFromCorruption(): Database.Database {
  console.error('[db] ⚠️ 数据库完整性检查失败，启动降级恢复流程');

  // 重命名坏库（保留以供人工分析）
  const corruptBackupPath = `${DB_PATH}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(DB_PATH, corruptBackupPath);
    console.error(`[db] 损坏数据库已重命名为: ${corruptBackupPath}`);
  } catch (err) {
    console.error('[db] 重命名失败，尝试直接删除:', (err as Error).message);
    try {
      fs.unlinkSync(DB_PATH);
    } catch {
      // 忽略
    }
  }

  // 清理 WAL 和 SHM（重建时不需要旧的日志，否则可能再次损坏）
  for (const suffix of ['-wal', '-shm']) {
    const p = `${DB_PATH}${suffix}`;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        // 忽略
      }
    }
  }

  // 重新打开
  const newConn = new Database(DB_PATH);
  applyPragmas(newConn);

  // 新库必须健康
  if (!checkIntegrity(newConn)) {
    throw new Error('数据库降级恢复失败：新库仍不健康（疑似磁盘硬件故障，请检查服务器）');
  }

  console.warn('[db] 降级恢复完成，已重建空库。storage 中的素材文件保留但 DB 记录丢失，需人工合并');
  return newConn;
}

// ── 初始化数据库连接（含完整性检查与降级恢复） ──
let db: Database.Database = new Database(DB_PATH);
applyPragmas(db);

if (!checkIntegrity(db)) {
  // 损坏 → 关闭当前连接 → 降级恢复
  try {
    db.close();
  } catch {
    // 忽略
  }
  db = recoverFromCorruption();
  dbStatus.degraded = true;
}

/**
 * 素材类型：图片 / 视频（不限制每点位的素材数量）
 */
export type MaterialType = 'img' | 'video';

/**
 * 初始化表结构与固定点位数据
 *
 * 素材表（material）自 v2 起支持每点位不限数量的图片/视频：
 *   - 每行一条素材记录，material_type 区分 img / video
 *   - 旧的 point_material 表（每点位一行、img_path/img_path_alt/video_path/video_path_alt 四列）
 *     会在启动时自动迁移到新表，旧表重命名为 point_material_legacy_v1 保留
 */
export function initDatabase() {
  // 点位基础表
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_info (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      district TEXT NOT NULL,
      township TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      station TEXT NOT NULL DEFAULT '',
      capacity TEXT NOT NULL DEFAULT '',
      lon REAL NOT NULL,
      lat REAL NOT NULL,
      remark TEXT NOT NULL DEFAULT ''
    )
  `);

  // 点位素材记录表（v2：每行一条素材，不限每点位数量）
  db.exec(`
    CREATE TABLE IF NOT EXISTS material (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      point_id INTEGER NOT NULL,
      material_type TEXT NOT NULL CHECK (material_type IN ('img', 'video')),
      file_path TEXT NOT NULL UNIQUE,
      file_size INTEGER NOT NULL DEFAULT 0,
      upload_time DATETIME,
      FOREIGN KEY (point_id) REFERENCES point_info(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_material_point ON material(point_id)`);

  // 旧结构迁移：point_material（四列固定槽位）→ material（多行）
  migrateLegacyMaterials();

  // 导入141条固定点位数据（如不存在）
  const insertPoint = db.prepare(
    `INSERT OR IGNORE INTO point_info
       (id, name, city, district, township, location, station, capacity, lon, lat, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const importAll = db.transaction(() => {
    for (const p of POINTS_DATA) {
      insertPoint.run(
        p.id,
        p.name,
        p.city,
        p.district,
        p.township,
        p.location,
        p.station,
        p.capacity,
        p.lon,
        p.lat,
        p.remark,
      );
    }
  });
  importAll();
}

/**
 * 旧素材表结构迁移（v1 四列固定槽位 → v2 多行不限量）
 *
 * 触发条件：point_material 表存在且含 img_path 列（v1 结构）。
 * 策略：
 *   1. 读取旧表全部行，将 img_path / img_path_alt 转为 img 类型素材，
 *      video_path / video_path_alt 转为 video 类型素材，逐行 INSERT 到 material 表
 *   2. 文件已在磁盘上的（旧版上传路径保留），补查真实文件大小；缺失文件 size 记 0
 *   3. 旧表重命名为 point_material_legacy_v1 保留（便于人工核对），不删除
 *
 * 幂等：迁移完成后 point_material 已不存在，重复启动不会再次执行
 */
function migrateLegacyMaterials(): void {
  // 旧表不存在 → 无需迁移（全新库或已迁移过）
  const legacyExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='point_material'`)
    .get();
  if (!legacyExists) return;

  // 已是 v2 结构（无 img_path 列）→ 说明历史遗留的空表，直接跳过
  const cols = db.prepare(`PRAGMA table_info(point_material)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'img_path')) return;

  console.log('[db] 检测到旧版素材表结构，开始迁移到 material 多行结构...');

  interface LegacyRow {
    point_id: number;
    img_path: string | null;
    img_path_alt: string | null;
    video_path: string | null;
    video_path_alt: string | null;
    upload_time: string | null;
  }

  const legacyRows = db
    .prepare(
      `SELECT point_id, img_path, img_path_alt, video_path, video_path_alt, upload_time
       FROM point_material`,
    )
    .all() as LegacyRow[];

  const insert = db.prepare(
    `INSERT OR IGNORE INTO material (point_id, material_type, file_path, file_size, upload_time)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const migrate = db.transaction(() => {
    for (const row of legacyRows) {
      const entries: Array<{ type: MaterialType; path: string | null }> = [
        { type: 'img', path: row.img_path },
        { type: 'img', path: row.img_path_alt },
        { type: 'video', path: row.video_path },
        { type: 'video', path: row.video_path_alt },
      ];
      for (const entry of entries) {
        if (!entry.path) continue;
        let size = 0;
        try {
          size = fs.statSync(path.join(STORAGE_DIR, entry.path)).size;
        } catch {
          // 文件已丢失：仍保留记录，由批量下载/定时清理的缺失文件容错处理
        }
        insert.run(row.point_id, entry.type, entry.path, size, row.upload_time);
      }
    }
  });
  migrate();

  db.exec(`ALTER TABLE point_material RENAME TO point_material_legacy_v1`);
  console.log(
    `[db] 旧素材表迁移完成（${legacyRows.length} 个点位），旧表已重命名为 point_material_legacy_v1`,
  );
}

export { db, DATA_DIR, STORAGE_DIR, TEMP_CHUNK_DIR, DB_PATH };
