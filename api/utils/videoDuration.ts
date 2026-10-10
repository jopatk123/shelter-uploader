/**
 * MP4 视频时长解析工具（后端防御性校验）
 * 通过遍历 MP4 box 结构查找 moov → mvhd，获取 timescale 与 duration，
 * 计算视频时长（秒）。使用 seek 随机读取，不加载整个文件到内存。
 *
 * 参考：ISO/IEC 14496-12 (ISO Base Media File Format)
 *
 * MP4 box 结构：
 *   size(4 bytes, big-endian) + type(4 bytes, ascii) + data(size-8 bytes)
 *   size==1: 实际 size 在后续 8 bytes（64位）
 *   size==0: box 延伸到文件末尾
 *
 * moov box 内的 mvhd box 包含：
 *   version(1) + flags(3) + creation_time + modification_time + timescale + duration
 *   version 0: 上述时间字段各 4 bytes
 *   version 1: 上述时间字段各 8 bytes
 */
import fs from 'fs';

/** 最小允许时长（秒） */
export const MIN_VIDEO_DURATION = 5;

/**
 * 判断视频时长是否满足要求（≥ 5 秒）
 */
export function isDurationValid(duration: number): boolean {
  return duration >= MIN_VIDEO_DURATION;
}

/**
 * 从文件路径读取 MP4 视频时长（秒）
 * 通过 seek 遍历顶层 box 查找 moov，仅读取必要的头部数据
 *
 * @returns 解析成功返回时长（秒）；无法解析返回 null
 */
export function getVideoDuration(filePath: string): number | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    const moov = findBox(fd, 0, fileSize, 'moov');
    if (!moov) return null;

    const mvhd = findBox(fd, moov.offset + moov.headerSize, moov.offset + moov.size, 'mvhd');
    if (!mvhd) return null;

    // version 1 的 mvhd 头部为 32 字节，按需读取，不把整个 moov 载入内存
    const payloadLen = Math.min(32, mvhd.size - mvhd.headerSize);
    if (payloadLen < 20) return null;
    const payload = Buffer.alloc(payloadLen);
    const read = fs.readSync(fd, payload, 0, payloadLen, mvhd.offset + mvhd.headerSize);
    if (read < payloadLen) return null;
    return parseMvhd(payload);
  } finally {
    fs.closeSync(fd);
  }
}

interface BoxHeader {
  type: string;
  /** 含头部在内的 box 总长度 */
  size: number;
  /** 8（32 位 size）或 16（64 位 largesize） */
  headerSize: number;
}

/**
 * 读取单个 box 头。size==0 表示延伸到 limit；size==1 表示后跟 8 字节 largesize。
 */
function readBoxHeader(fd: number, offset: number, limit: number): BoxHeader | null {
  if (offset < 0 || offset + 8 > limit) return null;
  const header = Buffer.alloc(16);
  if (fs.readSync(fd, header, 0, 8, offset) < 8) return null;

  let size = header.readUInt32BE(0);
  const type = header.toString('ascii', 4, 8);
  let headerSize = 8;

  if (size === 1) {
    if (offset + 16 > limit) return null;
    if (fs.readSync(fd, header, 8, 8, offset + 8) < 8) return null;
    const big = header.readBigUInt64BE(8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(big);
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }

  if (size < headerSize || offset + size > limit) return null;
  return { type, size, headerSize };
}

/**
 * 在 [start, end) 这一层顺序查找指定 box，通过 seek 跳过 box 内容
 */
function findBox(
  fd: number,
  start: number,
  end: number,
  targetType: string,
): (BoxHeader & { offset: number }) | null {
  let offset = start;
  while (offset + 8 <= end) {
    const header = readBoxHeader(fd, offset, end);
    if (!header) return null;
    if (header.type === targetType) return { ...header, offset };
    offset += header.size;
  }
  return null;
}

/**
 * 解析 mvhd box 数据，返回时长（秒）
 */
function parseMvhd(data: Buffer): number | null {
  if (data.length < 4) return null;

  const version = data[0];
  // version 0: creation(4) + modification(4) + timescale(4) + duration(4) = 16 bytes after version+flags
  // version 1: creation(8) + modification(8) + timescale(4) + duration(8) = 28 bytes after version+flags

  let timescale: number;
  let duration: number;

  if (version === 1) {
    // version+flags(4) + creation(8) + modification(8) + timescale(4) + duration(8)
    if (data.length < 4 + 8 + 8 + 4 + 8) return null;
    timescale = data.readUInt32BE(4 + 8 + 8);
    duration = Number(data.readBigUInt64BE(4 + 8 + 8 + 4));
  } else {
    // version 0: version+flags(4) + creation(4) + modification(4) + timescale(4) + duration(4)
    if (data.length < 4 + 4 + 4 + 4 + 4) return null;
    timescale = data.readUInt32BE(4 + 4 + 4);
    duration = data.readUInt32BE(4 + 4 + 4 + 4);
  }

  if (timescale === 0) return null;
  return duration / timescale;
}
