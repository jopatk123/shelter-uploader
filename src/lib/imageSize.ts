/**
 * 从文件头读取 JPEG / PNG / WEBP 像素尺寸。
 * 只解析头部，不解码像素，避免大图在压缩前先整图展开。
 */

export interface ImageSize {
  width: number;
  height: number;
}

const HEADER_BYTES = 512 * 1024;

/** 读取图片宽高；无法识别时返回 null */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 12) return null;

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return readPng(bytes);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return readJpeg(bytes);
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return readWebp(bytes);
  }
  return null;
}

/** 只读取文件开头，供上传前探测尺寸 */
export async function readImageSizeFromFile(file: Blob): Promise<ImageSize | null> {
  try {
    const buf = await file.slice(0, HEADER_BYTES).arrayBuffer();
    return readImageSize(new Uint8Array(buf));
  } catch {
    return null;
  }
}

function readPng(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null;
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

/**
 * JPEG SOF 在 APP 段之后。手机原图的 EXIF 可能把 SOF 推到 64KB 以后，
 * 因此调用方应提供足够长的头部（见 HEADER_BYTES）。
 */
function readJpeg(bytes: Uint8Array): ImageSize | null {
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1];
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1];
    }
    if (marker === 0xda) break;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (offset + 9 >= bytes.length) return null;
      const height = readU16BE(bytes, offset + 5);
      const width = readU16BE(bytes, offset + 7);
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    if (offset + 3 >= bytes.length) return null;
    const segLength = readU16BE(bytes, offset + 2);
    if (segLength < 2) return null;
    offset += 2 + segLength;
  }
  return null;
}

function readWebp(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (chunk === 'VP8 ') {
    const width = readU16LE(bytes, 26) & 0x3fff;
    const height = readU16LE(bytes, 28) & 0x3fff;
    if (width < 1 || height < 1) return null;
    return { width, height };
  }

  if (chunk === 'VP8L') {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    if (width < 1 || height < 1) return null;
    return { width, height };
  }

  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    if (width < 1 || height < 1) return null;
    return { width, height };
  }

  return null;
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>>
    0
  );
}
