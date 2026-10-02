/**
 * 进度条组件
 */
interface Props {
  percent: number;
  label?: string;
  variant?: 'default' | 'compress';
}

export default function ProgressBar({ percent, label, variant = 'default' }: Props) {
  const fillColor =
    variant === 'compress'
      ? 'linear-gradient(90deg, #f59e0b, #d97706)'
      : 'linear-gradient(90deg, #00d4ff, #0099cc)';

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between text-xs text-base-300 mb-1.5 font-mono">
          <span>{label}</span>
          <span className="text-base-100">{percent}%</span>
        </div>
      )}
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{ width: `${percent}%`, background: fillColor }}
        />
      </div>
    </div>
  );
}
