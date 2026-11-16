import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'public/mockServiceWorker.js'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // 서버 호출은 src/api에서만 (CLAUDE.md)
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'fetch는 src/api에서만 사용합니다.' },
      ],
    },
  },
  {
    files: ['src/api/**/*.{ts,tsx}', 'src/mocks/**/*.{ts,tsx}'],
    rules: { 'no-restricted-globals': 'off' },
  },
);
