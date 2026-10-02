import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * 自定义分级行数规则（AGENTS.md 约定）
 *
 * 核心 max-lines 只能设置单一阈值，无法表达「超 1000 警告、超 1200 报错」两级，
 * 因此自定义：有效行数 = 总行数 - 空行 - 注释所占行数。
 * 同一规则创建两个实例：告警实例用 cap 避免在超过强制上限时重复告警。
 */
function createMaxLinesRule(level) {
  const isBlock = level === 'error';
  return {
    meta: {
      type: 'suggestion',
      schema: [
        {
          type: 'object',
          properties: {
            max: { type: 'integer', minimum: 1 },
            cap: { type: 'integer', minimum: 1 },
          },
          additionalProperties: false,
        },
      ],
      messages: {
        exceed: `文件有效行数 {{count}} 行，超过${isBlock ? '强制上限' : '告警阈值'} {{max}} 行（AGENTS.md 约定）`,
      },
    },
    create(context) {
      const options = context.options[0] ?? {};
      const max = options.max ?? (isBlock ? 1200 : 1000);
      const cap = options.cap;
      return {
        Program(node) {
          const sourceCode = context.sourceCode ?? context.getSourceCode();
          const lines = sourceCode.lines;

          // 收集注释覆盖的行号（含块注释的每一行）
          const commentLines = new Set();
          for (const comment of sourceCode.getAllComments()) {
            for (let line = comment.loc.start.line; line <= comment.loc.end.line; line++) {
              commentLines.add(line);
            }
          }

          let count = 0;
          for (let line = 1; line <= lines.length; line++) {
            if (commentLines.has(line) || lines[line - 1].trim() === '') continue;
            count++;
          }

          if (count > max && (cap === undefined || count <= cap)) {
            context.report({ node, messageId: 'exceed', data: { count, max } });
          }
        },
      };
    },
  };
}

/** 项目自定义规则集 */
const projectPlugin = {
  rules: {
    'max-lines-warn': createMaxLinesRule('warn'),
    'max-lines-block': createMaxLinesRule('error'),
  },
};

/**
 * ESLint 配置
 * - 前端（src）：React + Hooks 规则
 * - 后端（api）：Node.js 环境
 */
export default tseslint.config(
  // /data 为运行时数据目录（sqlite/上传文件），api/data 为点位源码数据，需参与 lint
  { ignores: ['dist', '/data', 'node_modules', 'coverage'] },

  // ============ 前端代码（src） ============
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // ============ 后端代码（api） ============
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['api/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.node,
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-unused-vars': 'off',
    },
  },

  // ============ 测试代码 ============
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // ============ 文件行数上限（AGENTS.md 约定：超 1000 告警，超 1200 阻断） ============
  {
    files: ['src/**/*.{ts,tsx}', 'api/**/*.ts', 'tests/**/*.{ts,tsx}'],
    plugins: { project: projectPlugin },
    rules: {
      'project/max-lines-warn': ['warn', { max: 1000, cap: 1200 }],
      'project/max-lines-block': ['error', { max: 1200 }],
    },
  },

  // ============ 配置文件 ============
  {
    extends: [js.configs.recommended],
    files: ['*.config.{js,ts,mjs,cjs}', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
