/**
 * 图片上传面板
 * 支持 jpg/png/webp，不限大小与像素比例（普通照片即可）
 * 超过 10MB 的图片在前端自动压缩到 10MB 以内，尽量保留 EXIF 元数据。
 * 通过 type 区分主图（img）与备选图（img_alt）。
 */
import { useState, useRef, useEffect } from 'react';
import ProgressBar from '@/components/ProgressBar';
import { uploadFile, generateFileId, type UploadProgress } from '@/lib/upload';
import { compressImageIfNeeded, shouldCompress } from '@/lib/imageCompress';
import {
  checkImageReadable,
  hasGpsExif,
  checkBlackPixelRatio,
  MAX_BLACK_RATIO,
} from '@/lib/imageCheck';

interface Props {
  pointId: number | null;
  hasExisting: boolean;
  onUploadComplete: () => void;
  onNeedConfirm: (callback: () => void) => void;
  /**
   * 上传成功但图片不含 EXIF GPS 经纬度信息时触发
   * （仅对 JPEG 文件检测；用于提示用户上传相机/手机原图）
   */
  onMissingGps?: () => void;
  /** 素材类型：主图 img（默认）/ 备选图 img_alt */
  type?: 'img' | 'img_alt';
}

const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

export default function ImageUploadPanel({
  pointId,
  hasExisting,
  onUploadComplete,
  onNeedConfirm,
  onMissingGps,
  type = 'img',
}: Props) {
  const isAlt = type === 'img_alt';
  const inputId = isAlt ? 'image-input-alt' : 'image-input';

  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 切换点位时重置面板状态
  useEffect(() => {
    setFile(null);
    setUploadProgress(null);
    setError(null);
    setSuccess(false);
    if (inputRef.current) inputRef.current.value = '';
  }, [pointId]);

  const disabled = pointId === null;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setError(null);
    setSuccess(false);
    setUploadProgress(null);

    // 校验格式
    const ext = selected.name.substring(selected.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      setError(`不支持的图片格式，仅支持 ${ALLOWED_EXTS.join(', ')}`);
      return;
    }

    // 校验图片可解码（拒绝损坏/伪造文件）
    try {
      await checkImageReadable(selected);
    } catch {
      setError('无法读取图片，文件可能已损坏，请更换图片重试');
      return;
    }

    // 校验纯黑像素占比（防止上传全黑/损坏图）
    try {
      const { ok, ratio, sampledPixels } = await checkBlackPixelRatio(selected);
      if (!ok) {
        const percent = (ratio * 100).toFixed(2);
        const limitPercent = (MAX_BLACK_RATIO * 100).toFixed(0);
        setError(
          `图片纯黑像素占比 ${percent}% 超过 ${limitPercent}% 限制（采样 ${sampledPixels} 像素），可能为全黑/损坏图，请更换图片重试`,
        );
        return;
      }
    } catch {
      // 黑像素校验失败不阻塞上传（其他校验会兜底）
      console.warn('纯黑像素校验异常，跳过');
    }

    setFile(selected);

    // 如果点位已有图片，弹窗确认覆盖
    if (hasExisting) {
      onNeedConfirm(() => doUpload(selected));
    } else {
      doUpload(selected);
    }
  };

  const doUpload = async (originalFile: File) => {
    if (!pointId) return;

    try {
      setSuccess(false);
      setError(null);

      // 在压缩/上传之前并行检测 EXIF GPS（不阻塞流程）
      // 仅 JPEG 会被检测；PNG/WEBP 检测函数直接返回 false
      const gpsCheckPromise = hasGpsExif(originalFile).catch(() => false);

      // 超过 10MB 的图片先压缩，尽量保留 EXIF 元数据
      let fileToUpload = originalFile;
      if (shouldCompress(originalFile)) {
        setUploadProgress({
          phase: 'compressing',
          percent: 0,
          message: '正在压缩图片（保留EXIF）...',
        });
      }
      fileToUpload = await compressImageIfNeeded(originalFile);

      const fileId = generateFileId(fileToUpload);

      // 分片上传（type 区分主图/备选图）
      await uploadFile(fileToUpload, fileToUpload.name, pointId, type, fileId, (progress) =>
        setUploadProgress(progress),
      );

      setSuccess(true);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onUploadComplete();

      // 上传成功后，若图片不含 GPS，弹出提示
      const hasGps = await gpsCheckPromise;
      if (!hasGps) {
        onMissingGps?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    }
  };

  const handleRetry = () => {
    if (file) {
      doUpload(file);
    }
  };

  const isUploading =
    uploadProgress?.phase === 'compressing' ||
    uploadProgress?.phase === 'uploading' ||
    uploadProgress?.phase === 'merging';

  const title = isAlt ? '备选图片上传' : '图片上传';
  const accentColor = isAlt ? 'bg-status-yellow' : 'bg-accent';
  const borderColor = isAlt ? 'hover:border-status-yellow' : 'hover:border-accent';
  const hoverBg = isAlt ? 'hover:bg-base-600/30' : 'hover:bg-base-600/30';
  const successText = isAlt ? '备选图片上传成功' : '图片上传成功';

  return (
    <div
      className={`bg-base-700 border border-base-600 rounded-lg p-5 ${disabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-sm text-base-100 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${accentColor}`}></span>
          {title}
        </h3>
        {hasExisting && (
          <span className="text-xs text-status-yellow font-mono">已有图片，将覆盖</span>
        )}
      </div>

      <div className="text-xs text-base-400 mb-3 font-mono">
        格式: JPG / PNG / WEBP · 纯黑像素 ≤ 10%
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp"
        onChange={handleFileSelect}
        disabled={disabled || isUploading}
        className="hidden"
        id={inputId}
      />

      <label
        htmlFor={disabled || isUploading ? '' : inputId}
        className={`
          block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all
          ${
            disabled || isUploading
              ? 'border-base-600 cursor-not-allowed'
              : `border-base-500 ${borderColor} ${hoverBg}`
          }
        `}
      >
        {file ? (
          <div className="text-base-200">
            <p className="font-mono text-sm">{file.name}</p>
            <p className="text-xs text-base-400 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        ) : (
          <div className="text-base-300">
            <p className="text-sm">点击选择{isAlt ? '备选' : ''}图片</p>
            <p className="text-xs text-base-400 mt-1">JPG / PNG / WEBP · 纯黑 ≤ 10%</p>
          </div>
        )}
      </label>

      {/* 上传进度 */}
      {uploadProgress && (
        <div className="mt-4">
          <ProgressBar
            percent={uploadProgress.percent}
            label={uploadProgress.message}
            variant={uploadProgress.phase === 'compressing' ? 'compress' : 'default'}
          />
        </div>
      )}

      {/* 状态提示 */}
      {error && (
        <div className="mt-4 p-3 bg-status-red/10 border border-status-red/30 rounded text-sm text-status-red flex items-center justify-between">
          <span>{error}</span>
          {file && (
            <button
              onClick={handleRetry}
              className="ml-3 px-3 py-1 text-xs bg-status-red/20 rounded hover:bg-status-red/30 transition-colors"
            >
              重试
            </button>
          )}
        </div>
      )}

      {success && (
        <div className="mt-4 p-3 bg-status-green/10 border border-status-green/30 rounded text-sm text-status-green">
          {successText}
        </div>
      )}
    </div>
  );
}
