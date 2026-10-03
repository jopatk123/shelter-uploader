/**
 * 素材拖放选择区（图片 / 视频上传面板共用）
 *
 * 收敛两个面板原本各自重复实现的文件选择交互，避免长期漂移：
 * - 键盘可用：文件输入此前用 `hidden`（display:none），隐藏元素无法获得焦点，
 *   键盘用户完全无法触发选择。改为 `sr-only`（视觉隐藏但仍可聚焦），
 *   并让 label 通过 peer-focus-visible 显示焦点环。
 * - 支持拖放：dragenter / dragleave 用「进入深度」计数抵消子元素冒泡造成的闪烁。
 * - 未选择点位时渲染引导式空状态 + CTA，替代原先整块 opacity-50 的观感
 *   （降透明度既压低了对比度，也没有告诉用户下一步该做什么）。
 */
import { useRef, useState } from 'react';

interface Props {
  /** 关联 file input 与 label 的唯一 id（同一页面存在多个选择区，必须区分） */
  id: string;
  /** 原生 accept 属性 */
  accept: string;
  /** 未选择点位时为 true */
  disabled: boolean;
  /** 选择区主文案 */
  title: string;
  /** 辅助说明；不再重复格式限制，限制已由徽标区承担 */
  hint: string;
  /** 未选择点位时，CTA 按钮的回调（由页面聚焦到点位选择器） */
  onRequestPoint: () => void;
  /** 用户选中的一批文件：点击选择与拖放共用同一入口，校验逻辑只有一处 */
  onFiles: (files: File[]) => void;
}

export default function UploadDropzone({
  id,
  accept,
  disabled,
  title,
  hint,
  onRequestPoint,
  onFiles,
}: Props) {
  const [dragging, setDragging] = useState(false);
  // 拖放进入深度：dragenter/dragleave 会在子元素间成对冒泡，纯布尔值会闪烁
  const enterDepth = useRef(0);

  if (disabled) {
    return (
      <div className="rounded-lg border-2 border-dashed border-base-600 p-6 text-center">
        <p className="text-sm text-base-200">尚未选择点位</p>
        <p className="mt-1 text-xs text-base-400">先选点位，避免素材挂到别的点位上</p>
        <button
          type="button"
          onClick={onRequestPoint}
          className="mt-3 inline-flex min-h-[36px] items-center rounded border border-accent/50 px-3 py-2 text-xs font-mono text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          前往选择点位
        </button>
      </div>
    );
  }

  const resetDrag = () => {
    enterDepth.current = 0;
    setDragging(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // 立即清空，允许连续选择同一个文件（否则第二次不触发 change）
    e.target.value = '';
    if (files.length > 0) onFiles(files);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    enterDepth.current += 1;
    setDragging(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    // 不 preventDefault 浏览器会打开被拖入的文件，drop 事件根本不触发
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    enterDepth.current -= 1;
    if (enterDepth.current <= 0) resetDrag();
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    resetDrag();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) onFiles(files);
  };

  return (
    <>
      <input
        id={id}
        type="file"
        accept={accept}
        multiple
        onChange={handleChange}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`block cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? 'border-accent bg-accent/10'
            : 'border-base-500 hover:border-accent/60 hover:bg-base-600/30'
        } peer-focus-visible:border-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60`}
      >
        <p className="text-sm text-base-200">{dragging ? '松开鼠标即可加入队列' : title}</p>
        <p className="mt-1 text-xs text-base-400">{hint}</p>
      </label>
    </>
  );
}
