/**
 * 从原 JPEG 取出 EXIF（APP1）并嵌回压缩结果。
 * 画布编码不会带上 GPS / 拍摄时间，需要把原 APP1 插回 SOI 之后。
 * Orientation 会改成 1：像素已经按拍摄方向画正，保留旧标记会在查看时再转一次。
 */

const ORIENTATION_TAG = 0x0112;
const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

interface ExifSegment {
  start: number;
  length: number;
  tiffOffset: number;
}

/** 读取 JPEG 的 EXIF Orientation（1–8），没有或无法解析时按 1（不旋转） */
export function readJpegOrientation(jpeg: Uint8Array): number {
  const seg = findExifSegment(jpeg);
  if (!seg) return 1;
  const view = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
  const value = readOrientation(view, seg.tiffOffset);
  return value >= 1 && value <= 8 ? value : 1;
}

/**
 * 复制第一段 EXIF APP1（含 FF E1 与长度），并把 Orientation 写成 1。
 * 不是 JPEG 或没有 EXIF 时返回 null。
 */
export function takeExifApp1(jpeg: Uint8Array): Uint8Array | null {
  const seg = findExifSegment(jpeg);
  if (!seg) return null;
  const copy = jpeg.slice(seg.start, seg.start + seg.length);
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  writeOrientation(view, seg.tiffOffset - seg.start, 1);
  return copy;
}

/** 把 APP1 段插到 JPEG SOI（FF D8）之后 */
export function insertApp1(jpeg: Uint8Array, app1: Uint8Array): Uint8Array {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error('不是有效的 JPEG');
  }
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}

function findExifSegment(jpeg: Uint8Array): ExifSegment | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= jpeg.length) {
    if (jpeg[offset] !== 0xff) break;

    let marker = jpeg[offset + 1];
    while (marker === 0xff && offset + 2 < jpeg.length) {
      offset += 1;
      marker = jpeg[offset + 1];
    }

    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd9) {
      offset += 2;
      continue;
    }

    const segLength = (jpeg[offset + 2] << 8) | jpeg[offset + 3];
    if (segLength < 2 || offset + 2 + segLength > jpeg.length) break;

    if (marker === 0xe1 && segLength >= 8 && isExifId(jpeg, offset + 4)) {
      return { start: offset, length: 2 + segLength, tiffOffset: offset + 10 };
    }

    offset += 2 + segLength;
  }
  return null;
}

function isExifId(bytes: Uint8Array, offset: number): boolean {
  if (offset + EXIF_ID.length > bytes.length) return false;
  for (let i = 0; i < EXIF_ID.length; i++) {
    if (bytes[offset + i] !== EXIF_ID[i]) return false;
  }
  return true;
}

function endianOf(view: DataView, tiffOffset: number): boolean | null {
  if (tiffOffset + 8 > view.byteLength) return null;
  const order = view.getUint16(tiffOffset);
  if (order === 0x4949) return true;
  if (order === 0x4d4d) return false;
  return null;
}

function readOrientation(view: DataView, tiffOffset: number): number {
  const found = walkIfd0Orientation(view, tiffOffset, () => undefined);
  return found ?? 1;
}

function writeOrientation(view: DataView, tiffOffset: number, value: number): void {
  walkIfd0Orientation(view, tiffOffset, (entry, littleEndian) => {
    view.setUint16(entry + 8, value, littleEndian);
  });
}

/**
 * 在 IFD0 中查找 Orientation。
 * onFound 省略时只返回当前值；传入时改写并返回原值。
 */
function walkIfd0Orientation(
  view: DataView,
  tiffOffset: number,
  onFound?: (entryOffset: number, littleEndian: boolean) => void,
): number | null {
  const littleEndian = endianOf(view, tiffOffset);
  if (littleEndian === null) return null;
  if (view.getUint16(tiffOffset + 2, littleEndian) !== 0x002a) return null;

  const ifd0 = tiffOffset + view.getUint32(tiffOffset + 4, littleEndian);
  if (ifd0 + 2 > view.byteLength) return null;
  const count = view.getUint16(ifd0, littleEndian);

  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;
    const tag = view.getUint16(entry, littleEndian);
    if (tag !== ORIENTATION_TAG) continue;
    const type = view.getUint16(entry + 2, littleEndian);
    const n = view.getUint32(entry + 4, littleEndian);
    if (type !== 3 || n !== 1) return null;
    const current = view.getUint16(entry + 8, littleEndian);
    onFound?.(entry, littleEndian);
    return current;
  }
  return null;
}
