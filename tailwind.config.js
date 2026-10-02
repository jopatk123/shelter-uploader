/** @type {import('tailwindcss').Config} */

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        // 工业实用风配色
        base: {
          900: '#0f1820', // 最深背景
          800: '#1a2332', // 主背景
          700: '#243044', // 卡片背景
          600: '#2d3a52', // 边框/悬浮
          500: '#3a4862', // 分隔线
          400: '#4a5874', // 次要文字
          300: '#6b7a96', // 辅助文字
          200: '#9eabc4', // 主文字
          100: '#d4dae8', // 高亮文字
        },
        accent: {
          DEFAULT: '#00d4ff', // 亮青色强调
          dark: '#0099cc',
          glow: '#00d4ff33',
        },
        status: {
          green: '#22c55e',
          red: '#ef4444',
          yellow: '#f59e0b',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.4s ease-out',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 8px currentColor' },
          '50%': { opacity: '0.7', boxShadow: '0 0 16px currentColor' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
