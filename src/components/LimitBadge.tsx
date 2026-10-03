interface Props {
  children: React.ReactNode;
  /** warn 用于「不理想但允许」的限制（如纯黑像素占比），default 用于常规格式/体积限制 */
  tone?: 'default' | 'warn';
}

/**
 * 上传限制徽标
 *
 * 取代原先散落在面板里的整行限制文案：把「JPG/PNG/WEBP」「≤500KB」「≥10 秒」
 * 这类短约束压缩成统一胶囊，便于横向排列扫读；详细解释交给失败提示与弹窗。
 */
export default function LimitBadge({ children, tone = 'default' }: Props) {
  const toneClass =
    tone === 'warn'
      ? 'border-status-yellow/40 bg-status-yellow/10 text-status-yellow'
      : 'border-base-600 bg-base-800 text-base-300';

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[11px] leading-relaxed ${toneClass}`}
    >
      {children}
    </span>
  );
}
