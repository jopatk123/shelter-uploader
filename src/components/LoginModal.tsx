/**
 * 管理员登录弹窗
 */
import { useState } from 'react';

interface Props {
  onLogin: (password: string) => Promise<void>;
}

export default function LoginModal({ onLogin }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('请输入密码');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onLogin(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-base-900/90 flex items-center justify-center z-50">
      <div className="bg-base-700 border border-base-600 rounded-lg p-8 max-w-sm w-full mx-4 animate-slide-up">
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center mb-3">
            <span className="text-accent font-mono font-bold text-xl">A</span>
          </div>
          <h2 className="font-mono text-lg text-base-100">管理员登录</h2>
          <p className="text-xs text-base-400 mt-1">请输入管理密码</p>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="管理密码"
            autoFocus
            className="w-full bg-base-800 border border-base-600 rounded px-3 py-2.5 text-sm text-base-100 focus:border-accent focus:outline-none font-mono mb-3"
          />

          {error && <div className="text-sm text-status-red mb-3">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-accent text-base-900 rounded font-medium hover:bg-accent-dark transition-colors disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <a
          href="/"
          className="block text-center text-xs text-base-400 hover:text-accent mt-4 transition-colors"
        >
          ← 返回上传页面
        </a>
      </div>
    </div>
  );
}
