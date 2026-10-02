/**
 * 图片尺寸解析工具（后端防御性校验）
 * 仅读取文件头部少量字节即可获取 JPEG / PNG / WEBP 的像素尺寸，
 * 无需第三方依赖，不将完整文件读入内存。
 * 用于拒绝无法解析尺寸的损坏/伪造图片，不限制像素比例。
 *
 * 参考：
 * - PNG:  https://www.w3.org/TR/png/#11IHDR
 * - JPEG: SOF0~SOF15 标记段含 height/width（排除 DHT/JPG/DAC）
 * - WEBP: VP8 / VP8L / VP8X 三种子格式尺寸字段位置不同
 */
import fs from 'fs';

export interface ImageDimension {
  width: number;
  height: number;
}

/**
 * 从文件路径读取图片像素尺寸
 * 仅读取必要的头部字节（最多 512KB），不加载完整文件
 *
 * @returns 解析成功返回 { width, height }；无法识别格式或损坏返回 null
 */
export function getImageDimension(filePath: string): ImageDimension | null {
  // JPEG 的 SOF 标记可能被大量 EXIF / ICC 等元数据挤到 64KB 之后
  // （例如 browser-image-compression preserveExif 压缩后 SOF 可达 ~66KB）
  // 512KB 足以覆盖绝大多数场景，同时仍避免读取完整大文件
  const HEADER_MAX = 512 * 1024;
  const buf = Buffer.alloc(HEADER_MAX);
  const fd = fs.openSync(filePath, 'r');
  try {
    const bytesRead = fs.readSync(fd, buf, 0, HEADER_MAX, 0);
    const header = buf.subarray(0, bytesRead);
    return parseFromBuffer(header);
  } finally {
    fs.closeSync(fd);
  }
}

// ────────────────── 格式解析 ──────────────────

function parseFromBuffer(buf: Buffer): ImageDimension | null {
  if (buf.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return parsePng(buf);
  }

  // JPEG: FF D8
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    return parseJpeg(buf);
  }

  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50 // WEBP
  ) {
    return parseWebp(buf);
  }

  return null;
}

/**
 * PNG: IHDR chunk 中 width（offset 16-19）和 height（offset 20-23），大端
 */
function parsePng(buf: Buffer): ImageDimension | null {
  if (buf.length < 24) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

/**
 * JPEG: 扫描 SOF0~SOF15 标记（排除 0xC4 DHT、0xC8 JPG、0xCC DAC）
 * SOF 段结构：FF C0, length(2 bytes), precision(1), height(2), width(2)
 */
function parseJpeg(buf: Buffer): ImageDimension | null {
  let offset = 2; // 跳过 SOI (FF D8)

  while (offset + 1 < buf.length) {
    // 寻找标记起始 0xFF
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }

    // 跳过填充 0xFF
    let marker = buf[offset + 1];
    while (marker === 0xff && offset + 2 < buf.length) {
      offset++;
      marker = buf[offset + 1];
    }

    // SOS 表示已进入扫描数据，后续不再有 SOF
    if (marker === 0xda) break;

    // SOF 标记范围 C0~CF，排除 C4(DHT) C8(JPG) CC(DAC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // 需要至少读到 width 字段（offset + 9）
      if (offset + 9 >= buf.length) return null;
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }

    // 其他标记段：读取长度跳过
    if (offset + 3 >= buf.length) return null;
    const segLength = buf.readUInt16BE(offset + 2);
    offset += 2 + segLength;
  }

  return null;
}

/**
 * WEBP: 三种子格式尺寸解析
 * - VP8 (有损):   width/height 各 14 bit，offset 26-29
 * - VP8L (无损):  width/height 各 14 bit，offset 21-24
 * - VP8X (扩展):  width/height 各 24 bit（值-1），offset 24-29
 */
function parseWebp(buf: Buffer): ImageDimension | null {
  if (buf.length < 30) return null;

  const chunkType = buf.toString('ascii', 12, 16);

  if (chunkType === 'VP8 ') {
    // 有损 VP8
    // start_code 在 14-19，width 在 26-27 (14 bit LE)，height 在 28-29 (14 bit LE)
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { width: w, height: h };
  }

  if (chunkType === 'VP8L') {
    // 无损 VP8L
    // offset 20: signature(1 byte), offset 21-24: packed width/height
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }

  if (chunkType === 'VP8X') {
    // 扩展 VP8X
    // offset 24-26: width-1 (24 bit LE), offset 27-29: height-1 (24 bit LE)
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }

  return null;
}
