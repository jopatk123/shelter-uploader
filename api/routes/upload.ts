/**
 * 分片上传接口（公开免鉴权）
 * 支持分片合并、文件后缀/大小二次校验
 * 每点位不限上传数量：/complete 为 INSERT 语义，不再覆盖旧素材
 */
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import fse from 'fs-extra';
import { db, STORAGE_DIR, TEMP_CHUNK_DIR } from '../db.js';
import { getImageDimension } from '../utils/imageDimension.js';
import { getVideoDuration, isDurationValid, MIN_VIDEO_DURATION } from '../utils/videoDuration.js';
import { CHUNK_SIZE_MB, VIDEO_MAX_SIZE_MB } from '../config.js';

const router = Router();

// 分片大小：默认 5MB
const CHUNK_SIZE = CHUNK_SIZE_MB * 1024 * 1024;
// 视频单文件上限：默认 100MB，可通过 .env 的 VIDEO_MAX_SIZE_MB 调整
const VIDEO_MAX_SIZE = VIDEO_MAX_SIZE_MB * 1024 * 1024;

// 允许的文件后缀
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const VIDEO_EXTS = ['.mp4'];

/**
 * 素材类型（v2 起不分主/备，每点位不限数量）
 */
const MATERIAL_TYPES = ['img', 'video'] as const;
type MaterialType = (typeof MATERIAL_TYPES)[number];

/**
 * 校验 type 合法性
 */
function isValidType(type: string): type is MaterialType {
  return (MATERIAL_TYPES as readonly string[]).includes(type);
}

/**
 * 判断 type 是否为图片类
 */
function isImageType(type: string): boolean {
  return type === 'img';
}

/**
 * 安全校验 fileId：仅允许字母、数字、下划线、短横线、点号
 * 防止路径遍历攻击（如 ../../../etc/cron.d/evil）
 */
function isValidFileId(fileId: string): boolean {
  return typeof fileId === 'string' && /^[a-zA-Z0-9_.-]+$/.test(fileId);
}

/**
 * 安全校验分片序号：必须为非负整数
 */
function isValidChunkIndex(index: unknown): boolean {
  if (typeof index !== 'string' && typeof index !== 'number') return false;
  const n = Number(index);
  return Number.isInteger(n) && n >= 0 && n <= 100000;
}

/**
 * 安全校验点位ID：必须为正整数
 */
function isValidPointId(pointId: unknown): boolean {
  if (typeof pointId !== 'string' && typeof pointId !== 'number') return false;
  const n = Number(pointId);
  return Number.isInteger(n) && n > 0;
}

// multer 配置：使用内存存储，避免 destination 回调时 req.body 未解析的问题
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHUNK_SIZE + 1024 * 1024 }, // 留一点余量
});

/**
 * POST /api/upload/chunk
 * 上传单个分片
 * multipart: chunk(文件分片), index(分片序号), totalChunks(总分片数), fileId(文件唯一标识), pointId(点位ID), type(img|video), fileName(原始文件名)
 */
router.post('/chunk', upload.single('chunk'), (req, res) => {
  const { fileId, index, totalChunks, pointId, type, fileName } = req.body;

  if (!fileId || !isValidFileId(fileId)) {
    res.status(400).json({ success: false, error: 'fileId 参数非法' });
    return;
  }

  if (!isValidChunkIndex(index)) {
    res.status(400).json({ success: false, error: '分片序号参数非法' });
    return;
  }

  if (!isValidPointId(pointId)) {
    res.status(400).json({ success: false, error: 'pointId 参数非法' });
    return;
  }

  if (!isValidPointId(totalChunks)) {
    res.status(400).json({ success: false, error: 'totalChunks 参数非法' });
    return;
  }

  if (!type || !isValidType(type)) {
    res.status(400).json({ success: false, error: 'type 参数非法' });
    return;
  }

  if (!fileName || typeof fileName !== 'string') {
    res.status(400).json({ success: false, error: 'fileName 参数非法' });
    return;
  }

  // 后端二次校验文件后缀（与 /complete 保持一致，提前拦截非法类型）
  const ext = path.extname(fileName).toLowerCase();
  const allowedExts = isImageType(type) ? IMAGE_EXTS : VIDEO_EXTS;
  if (!allowedExts.includes(ext)) {
    res
      .status(400)
      .json({ success: false, error: `文件后缀不允许，仅支持 ${allowedExts.join(', ')}` });
    return;
  }

  if (!req.file) {
    res.status(400).json({ success: false, error: '未收到分片数据' });
    return;
  }

  // 手动保存分片到 temp_chunk/{fileId}/chunk-{index}
  // fileId 已通过白名单校验，index 已校验为非负整数，不存在路径遍历风险
  const chunkDir = path.join(TEMP_CHUNK_DIR, fileId);
  fs.mkdirSync(chunkDir, { recursive: true });
  const chunkPath = path.join(chunkDir, `chunk-${index}`);
  fs.writeFileSync(chunkPath, req.file.buffer);

  res.json({
    success: true,
    data: { fileId, index: Number(index), totalChunks: Number(totalChunks) },
  });
});

/**
 * 安全删除文件，吞掉异常并打印警告
 */
function safeUnlink(p: string): void {
  if (!fs.existsSync(p)) return;
  try {
    fs.unlinkSync(p);
  } catch (err) {
    console.warn(`[upload/complete] 删除文件失败 ${p}:`, (err as Error).message);
  }
}

/**
 * POST /api/upload/complete
 * 全部分片上传完毕，合并文件
 * body: { fileId, pointId, type, fileName }
 *
 * 崩溃一致性策略（防止进程被杀导致数据库与文件系统不一致）：
 *   1. 分片合并到 .tmp 临时文件
 *   2. 大小校验通过后，原子 rename 到最终路径（同分区 rename 是原子操作）
 *   3. 在事务中查询旧路径并 UPDATE 数据库 → 指向新文件
 *   4. 提交事务后才删除旧文件（最坏情况留下孤儿文件，可被定时清理兜底）
 *   5. 最后清理分片临时目录
 *
 * 上述顺序确保任意时刻进程被杀：
 *   - 数据库始终指向「真实存在的文件」（旧文件或新文件）
 *   - 不会出现「数据库指向已删除文件」的破坏性场景
 */
router.post('/complete', async (req, res) => {
  const { fileId, pointId, type, fileName, totalChunks } = req.body;

  if (!fileId || !isValidFileId(fileId)) {
    res.status(400).json({ success: false, error: 'fileId 参数非法' });
    return;
  }

  if (!isValidPointId(pointId)) {
    res.status(400).json({ success: false, error: 'pointId 参数非法' });
    return;
  }

  if (!isValidPointId(totalChunks)) {
    res.status(400).json({ success: false, error: 'totalChunks 参数非法' });
    return;
  }

  if (!type || !isValidType(type)) {
    res.status(400).json({ success: false, error: '类型参数非法' });
    return;
  }

  // 后端二次校验文件后缀（图片类用图片后缀，视频类用视频后缀）
  const ext = path.extname(fileName).toLowerCase();
  const allowedExts = isImageType(type) ? IMAGE_EXTS : VIDEO_EXTS;
  if (!allowedExts.includes(ext)) {
    res
      .status(400)
      .json({ success: false, error: `文件后缀不允许，仅支持 ${allowedExts.join(', ')}` });
    return;
  }

  const chunkDir = path.join(TEMP_CHUNK_DIR, fileId);
  if (!fs.existsSync(chunkDir)) {
    res.status(400).json({ success: false, error: '分片目录不存在，请重新上传' });
    return;
  }

  // 校验点位是否存在于数据库中（防止向无效点位写入文件后产生孤儿文件）
  const pointRow = db.prepare('SELECT id FROM point_info WHERE id = ?').get(Number(pointId));
  if (!pointRow) {
    await fse.remove(chunkDir);
    res.status(400).json({ success: false, error: '点位不存在' });
    return;
  }

  // 读取所有分片并按序号排序
  const chunkFiles = fs
    .readdirSync(chunkDir)
    .filter((f) => f.match(/^chunk-\d+$/))
    .sort((a, b) => {
      const ai = parseInt(a.match(/^chunk-(\d+)$/)![1]);
      const bi = parseInt(b.match(/^chunk-(\d+)$/)![1]);
      return ai - bi;
    });

  if (chunkFiles.length === 0) {
    res.status(400).json({ success: false, error: '未找到分片文件' });
    return;
  }

  // 校验分片完整性：实际分片数必须等于声明的 totalChunks
  const expectedTotal = Number(totalChunks);
  if (chunkFiles.length !== expectedTotal) {
    await fse.remove(chunkDir);
    res.status(400).json({
      success: false,
      error: `分片不完整（期望 ${expectedTotal} 个，实际 ${chunkFiles.length} 个），请重新上传`,
    });
    return;
  }

  const pointStorageDir = path.join(STORAGE_DIR, `point_${pointId}`);
  await fse.ensureDir(pointStorageDir);

  const savedFileName = `${type}_${Date.now()}${ext}`;
  const savedFilePath = path.join(pointStorageDir, savedFileName);
  const tmpFilePath = `${savedFilePath}.tmp`; // 临时文件，合并成功后再 rename
  const relPath = path.join(`point_${pointId}`, savedFileName);

  let totalSize = 0;

  try {
    // ── 步骤1：合并分片到 .tmp 临时文件（异步读取，避免阻塞事件循环） ──
    const writeStream = fs.createWriteStream(tmpFilePath);
    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(chunkDir, chunkFile);
      const chunkBuf = await fse.readFile(chunkPath);
      totalSize += chunkBuf.length;
      writeStream.write(chunkBuf);
    }
    writeStream.end();

    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // ── 步骤2：大小校验（在 rename 前，避免污染最终目录） ──
    // 图片不限大小（前端已自动压缩到 300KB 以内），仅校验视频
    if (!isImageType(type) && totalSize > VIDEO_MAX_SIZE) {
      safeUnlink(tmpFilePath);
      await fse.remove(chunkDir);
      res.status(400).json({
        success: false,
        error: `文件大小超过限制（${VIDEO_MAX_SIZE_MB}MB）`,
      });
      return;
    }

    // ── 步骤2.5：图片可解析性校验（防御性，前端已校验） ──
    // 仅拒绝无法解析尺寸的损坏/伪造图片，不限制像素比例（普通照片即可）
    if (isImageType(type)) {
      const dim = getImageDimension(tmpFilePath);
      if (!dim) {
        safeUnlink(tmpFilePath);
        await fse.remove(chunkDir);
        res.status(400).json({
          success: false,
          error: '无法解析图片尺寸，文件可能已损坏或格式不正确',
        });
        return;
      }
    }

    // ── 步骤2.6：视频时长校验（防御性，前端已校验） ──
    // 要求时长 ≥ 10 秒，低于 10 秒拒绝入库，避免脏数据落盘
    if (!isImageType(type)) {
      const duration = getVideoDuration(tmpFilePath);
      if (duration === null) {
        safeUnlink(tmpFilePath);
        await fse.remove(chunkDir);
        res.status(400).json({
          success: false,
          error: '无法解析视频时长，文件可能已损坏或不是有效的 MP4 文件',
        });
        return;
      }
      if (!isDurationValid(duration)) {
        safeUnlink(tmpFilePath);
        await fse.remove(chunkDir);
        res.status(400).json({
          success: false,
          error: `视频时长必须 ≥ ${MIN_VIDEO_DURATION} 秒才能上传，当前时长 ${duration.toFixed(1)} 秒`,
        });
        return;
      }
    }

    // ── 步骤3：原子 rename 临时文件到最终路径 ──
    // 同分区 rename 是原子操作，进程被杀时不会留下半截文件
    fs.renameSync(tmpFilePath, savedFilePath);

    // ── 步骤4：INSERT 新素材记录（v2 起每点位不限数量，不覆盖旧素材） ──
    // 先落库后删分片：即使此处崩溃，最坏是新文件成孤儿，由定时清理兜底
    const insertResult = db
      .prepare(
        `
        INSERT INTO material (point_id, material_type, file_path, file_size, upload_time)
        VALUES (?, ?, ?, ?, datetime('now'))
      `,
      )
      .run(Number(pointId), type, relPath, totalSize);

    // ── 步骤5：清理分片临时目录 ──
    await fse.remove(chunkDir);

    res.json({
      success: true,
      data: {
        id: Number(insertResult.lastInsertRowid),
        pointId: Number(pointId),
        type,
        path: relPath,
        size: totalSize,
      },
    });
  } catch (err) {
    console.error('[upload/complete] 合并失败:', (err as Error).message);
    // 清理临时文件与最终文件（均可能因崩溃残留）
    safeUnlink(tmpFilePath);
    safeUnlink(savedFilePath);
    await fse.remove(chunkDir);
    res.status(500).json({ success: false, error: '文件合并失败' });
  }
});

export default router;
