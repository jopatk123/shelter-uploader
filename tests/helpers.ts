/**
 * 测试辅助工具
 * 生成合法的 PNG 图片 buffer 和 MP4 视频缓冲，供 API 测试使用
 */
import zlib from 'zlib';

/**
 * 生成合法的 PNG buffer（灰度图，color type 0, bit depth 8）
 *
 * @param width     图片宽度（像素）
 * @param height    图片高度（像素）
 * @param pixelFn   可选：自定义像素值函数 (x, y) => 0~255；默认 (x+y)%256 渐变灰度
 * @returns 合法的 PNG 文件 buffer
 */
export function makePngBuffer(
  width: number,
  height: number,
  pixelFn: (x: number, y: number) => number = (x, y) => (x + y) % 256,
): Buffer {
  // PNG 签名
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR 数据：width(4) + height(4) + bitDepth(1) + colorType(1) + compression(1) + filter(1) + interlace(1)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 0; // color type: grayscale
  ihdrData[10] = 0; // compression: deflate
  ihdrData[11] = 0; // filter: adaptive
  ihdrData[12] = 0; // interlace: none

  // 图像原始数据：每行 = 1 字节 filter(0) + width 字节像素
  const rowLength = 1 + width;
  const rawData = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowLength;
    rawData[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      rawData[rowStart + 1 + x] = pixelFn(x, y) & 0xff;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdrData),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 生成宽幅（2:1）合法 PNG buffer（仅作为一种合法图片样例，不限定上传比例）
 */
export function makeWidePng(baseSize = 200): Buffer {
  return makePngBuffer(baseSize * 2, baseSize);
}

/**
 * 生成正方形（1:1）合法 PNG buffer
 */
export function makeSquarePng(size = 100): Buffer {
  return makePngBuffer(size, size);
}

/**
 * 构造 PNG chunk: length(4) + type(4) + data + CRC(4)
 */
function makeChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = zlib.crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

// ────────────────── MP4 视频 ──────────────────

/**
 * 生成包含 moov/mvhd 的最小 MP4 buffer
 * 仅包含 ftyp + moov(mvhd)，不含实际媒体数据，
 * 但足以让后端 videoDuration 解析器读取时长
 *
 * @param durationSeconds 视频时长（秒）
 * @returns 最小合法 MP4 buffer
 */
export function makeMp4Buffer(durationSeconds: number): Buffer {
  const timescale = 1000; // 1 tick = 1ms
  const duration = Math.round(durationSeconds * timescale);

  // mvhd box (version 0): 100 bytes data
  const mvhdData = Buffer.alloc(100);
  mvhdData[0] = 0; // version
  mvhdData.writeUInt32BE(0, 1); // flags
  mvhdData.writeUInt32BE(0, 4); // creation_time
  mvhdData.writeUInt32BE(0, 8); // modification_time
  mvhdData.writeUInt32BE(timescale, 12); // timescale
  mvhdData.writeUInt32BE(duration, 16); // duration
  mvhdData.writeUInt32BE(0x00010000, 20); // rate = 1.0
  mvhdData.writeUInt16BE(0x0100, 24); // volume = 1.0
  // reserved(10) + matrix(36) + pre_defined(24) 已为 0
  mvhdData.writeUInt32BE(1, 96); // next_track_ID

  const mvhdBox = makeMp4Box('mvhd', mvhdData);
  const moovBox = makeMp4Box('moov', mvhdBox);

  // ftyp box
  const ftypData = Buffer.alloc(8);
  ftypData.write('isom', 0, 'ascii'); // major brand
  ftypData.writeUInt32BE(0x0200, 4); // minor version
  const ftypBox = makeMp4Box('ftyp', Buffer.concat([ftypData, Buffer.from('isom', 'ascii')]));

  return Buffer.concat([ftypBox, moovBox]);
}

/**
 * 生成符合时长要求（≥ 10 秒）的 MP4 buffer
 */
export function makeValidMp4(durationSeconds = 15): Buffer {
  return makeMp4Buffer(durationSeconds);
}

/**
 * 生成不符合时长要求（< 10 秒）的 MP4 buffer
 */
export function makeShortMp4(durationSeconds = 5): Buffer {
  return makeMp4Buffer(durationSeconds);
}

/**
 * 生成带填充数据的合法 MP4 buffer（用于测试单文件大小上限）
 * 在 moov box 之后追加一个 free box，不影响时长解析
 *
 * @param paddingBytes   追加填充字节数
 * @param durationSeconds 视频时长（秒）
 */
export function makeValidMp4WithPadding(paddingBytes: number, durationSeconds = 15): Buffer {
  const base = makeMp4Buffer(durationSeconds);
  if (paddingBytes <= 0) return base;
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(8 + paddingBytes, 0);
  const padding = Buffer.alloc(paddingBytes, 0x00);
  return Buffer.concat([base, sizeBuf, Buffer.from('free', 'ascii'), padding]);
}

/**
 * 构造 MP4 box: size(4) + type(4) + data
 */
function makeMp4Box(type: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  return Buffer.concat([size, typeBuf, data]);
}

// ────────────────── JPEG + EXIF ──────────────────
//
// 构造最小 JPEG 文件用于 EXIF GPS 检测测试。
// JPEG 结构：FF D8 [APP1 段] FF D9
// APP1 EXIF 段：FF E1 [length] "Exif\0\0" [TIFF data]
// TIFF data：byteOrder(2) + magic(2) + ifd0_offset(4) + IFD0 + ... + GPS IFD

/** EXIF TIFF 中 IFD 入口大小（字节）：tag(2) + type(2) + count(4) + value/offset(4) */
const TIFF_IFD_ENTRY_SIZE = 12;

/**
 * 构造一个 IFD 入口（12 字节）
 */
function makeTiffIfdEntry(
  tag: number,
  type: number,
  count: number,
  value: number,
  littleEndian: boolean,
): Buffer {
  const buf = Buffer.alloc(TIFF_IFD_ENTRY_SIZE);
  if (littleEndian) {
    buf.writeUInt16LE(tag, 0);
    buf.writeUInt16LE(type, 2);
    buf.writeUInt32LE(count, 4);
    buf.writeUInt32LE(value, 8);
  } else {
    buf.writeUInt16BE(tag, 0);
    buf.writeUInt16BE(type, 2);
    buf.writeUInt32BE(count, 4);
    buf.writeUInt32BE(value, 8);
  }
  return buf;
}

/**
 * 构造 TIFF 数据
 *
 * @param options.gpsTags  要写入 GPS IFD 的标签数组（如 [0x0002, 0x0004]）；为空数组表示无 GPS IFD
 * @param options.littleEndian  字节序，默认小端
 */
function makeTiffData(options: { gpsTags?: number[]; littleEndian?: boolean } = {}): Buffer {
  const { gpsTags, littleEndian = true } = options;
  const byteOrderMark = littleEndian ? Buffer.from('II', 'ascii') : Buffer.from('MM', 'ascii');
  const magic = Buffer.alloc(2);
  if (littleEndian) magic.writeUInt16LE(0x002a, 0);
  else magic.writeUInt16BE(0x002a, 0);

  // IFD0 紧跟 TIFF 头（偏移=8）
  const ifd0OffsetVal = 8;
  const ifd0OffsetBuf = Buffer.alloc(4);
  if (littleEndian) ifd0OffsetBuf.writeUInt32LE(ifd0OffsetVal, 0);
  else ifd0OffsetBuf.writeUInt32BE(ifd0OffsetVal, 0);

  const tiffHeader = Buffer.concat([byteOrderMark, magic, ifd0OffsetBuf]); // 8 bytes

  // 决定 IFD0 是否包含 GPS IFD 指针
  const includeGps = gpsTags !== undefined && gpsTags.length > 0;

  // IFD0 entries
  const ifd0Entries: Buffer[] = [];
  if (includeGps) {
    // 先占位 GPS IFD 偏移，后面回填
    // 占位值暂记 0
    ifd0Entries.push(makeTiffIfdEntry(0x8825, 4, 1, 0, littleEndian));
  }
  const ifd0Count = ifd0Entries.length;
  const ifd0CountBuf = Buffer.alloc(2);
  if (littleEndian) ifd0CountBuf.writeUInt16LE(ifd0Count, 0);
  else ifd0CountBuf.writeUInt16BE(ifd0Count, 0);

  // IFD0 内容：count(2) + entries + next_ifd_offset(4)
  const ifd0Body = Buffer.concat([
    ifd0CountBuf,
    ...ifd0Entries,
    Buffer.alloc(4), // next IFD offset = 0
  ]);

  // GPS IFD 紧跟 IFD0 之后
  const gpsIfdOffset = ifd0OffsetVal + ifd0Body.length;

  // 回填 GPS IFD 偏移到 IFD0 中的 0x8825 条目（位于 ifd0Body[2 + 8]）
  if (includeGps) {
    const entryValueOffset = 2 + 8; // count(2) + tag(2) + type(2) + count(4)
    if (littleEndian) ifd0Body.writeUInt32LE(gpsIfdOffset, entryValueOffset);
    else ifd0Body.writeUInt32BE(gpsIfdOffset, entryValueOffset);
  }

  // GPS IFD
  let gpsIfdBuf = Buffer.alloc(0);
  if (includeGps && gpsTags) {
    const gpsCountBuf = Buffer.alloc(2);
    if (littleEndian) gpsCountBuf.writeUInt16LE(gpsTags.length, 0);
    else gpsCountBuf.writeUInt16BE(gpsTags.length, 0);
    const gpsEntries = gpsTags.map((tag) => makeTiffIfdEntry(tag, 5, 1, 0, littleEndian)); // type=5 RATIONAL
    gpsIfdBuf = Buffer.concat([
      gpsCountBuf,
      ...gpsEntries,
      Buffer.alloc(4), // next IFD offset = 0
    ]);
  }

  return Buffer.concat([tiffHeader, ifd0Body, gpsIfdBuf]);
}

/**
 * 构造最小 JPEG 文件，EXIF APP1 段由 makeTiffData 生成
 */
function makeJpegWithExif(tiffData: Buffer): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const eoi = Buffer.from([0xff, 0xd9]);
  const exifId = Buffer.from('Exif\0\0', 'ascii'); // 6 bytes
  const payload = Buffer.concat([exifId, tiffData]);
  // segment length field 包含自身 2 字节，不含 marker
  const segLength = 2 + payload.length;
  const app1Header = Buffer.alloc(4);
  app1Header[0] = 0xff;
  app1Header[1] = 0xe1;
  app1Header.writeUInt16BE(segLength, 2);
  return Buffer.concat([soi, app1Header, payload, eoi]);
}

/**
 * 构造包含完整 EXIF GPS（经纬度）信息的 JPEG
 */
export function makeJpegWithGpsExif(): Buffer {
  const tiff = makeTiffData({ gpsTags: [0x0001, 0x0002, 0x0003, 0x0004] });
  return makeJpegWithExif(tiff);
}

/**
 * 构造含 EXIF 但无 GPS IFD 的 JPEG
 */
export function makeJpegWithoutGpsExif(): Buffer {
  const tiff = makeTiffData({ gpsTags: [] });
  return makeJpegWithExif(tiff);
}

/**
 * 构造含 GPS IFD 但仅有纬度（无经度）的 JPEG
 */
export function makeJpegWithGpsLatOnly(): Buffer {
  const tiff = makeTiffData({ gpsTags: [0x0001, 0x0002, 0x0003] });
  return makeJpegWithExif(tiff);
}

/**
 * 构造大端（MM）字节序、含完整 GPS 的 JPEG
 */
export function makeJpegWithGpsExifBigEndian(): Buffer {
  const tiff = makeTiffData({ gpsTags: [0x0002, 0x0004], littleEndian: false });
  return makeJpegWithExif(tiff);
}

/**
 * 构造无 APP1 段的最小 JPEG（仅 SOI + EOI）
 */
export function makeJpegWithoutApp1(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
}

/**
 * 构造 APP1 段但非 EXIF（如 XMP）的 JPEG
 */
export function makeJpegWithXmpOnly(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const eoi = Buffer.from([0xff, 0xd9]);
  const xmpNamespace = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii');
  const payload = xmpNamespace;
  const segLength = 2 + payload.length;
  const app1Header = Buffer.alloc(4);
  app1Header[0] = 0xff;
  app1Header[1] = 0xe1;
  app1Header.writeUInt16BE(segLength, 2);
  return Buffer.concat([soi, app1Header, payload, eoi]);
}
