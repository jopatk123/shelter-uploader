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
export const MIN_VIDEO_DURATION = 10;

/**
 * 判断视频时长是否满足要求（≥ 10 秒）
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
    const moovOffset = findTopLevelBox(fd, fileSize, 'moov');
    if (moovOffset === -1) return null;

    // 读取 moov box 的前 512 字节（mvhd 通常是 moov 的第一个子 box）
    const moovHeaderSize = 8;
    const readSize = Math.min(512, fileSize - moovOffset - moovHeaderSize);
    if (readSize < 16) return null;
    const moovBuf = Buffer.alloc(readSize);
    fs.readSync(fd, moovBuf, 0, readSize, moovOffset + moovHeaderSize);

    // 在 moov 数据中查找 mvhd 子 box
    let offset = 0;
    while (offset + 8 <= moovBuf.length) {
      const subSize = moovBuf.readUInt32BE(offset);
      const subType = moovBuf.toString('ascii', offset + 4, offset + 8);

      if (subType === 'mvhd') {
        return parseMvhd(moovBuf.subarray(offset + 8));
      }

      if (subSize === 0) break;
      if (subSize < 8) break;
      offset += subSize;
    }

    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 遍历顶层 box 查找指定类型的 box，返回其起始偏移量
 * 仅读取每个 box 的 8 字节头（size + type），通过 seek 跳过 data
 */
function findTopLevelBox(fd: number, fileSize: number, targetType: string): number {
  let offset = 0;
  const header = Buffer.alloc(8);

  while (offset + 8 <= fileSize) {
    const bytesRead = fs.readSync(fd, header, 0, 8, offset);
    if (bytesRead < 8) break;

    let size = header.readUInt32BE(0);
    const type = header.toString('ascii', 4, 8);

    if (size === 0) {
      // box 延伸到文件末尾
      size = fileSize - offset;
    } else if (size === 1) {
      // 64 位 size
      const extBuf = Buffer.alloc(8);
      fs.readSync(fd, extBuf, 0, 8, offset + 8);
      size = Number(extBuf.readBigUInt64BE(0));
    }

    if (type === targetType) {
      return offset;
    }

    if (size < 8) break;
    offset += size;
  }

  return -1;
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
