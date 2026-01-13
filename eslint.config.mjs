import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import path from 'path';
import { fileURLToPath } from 'url';
import globals from 'globals';
import nextPlugin from '@next/eslint-plugin-next';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default tseslint.config(
  // Global Ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      'public/sw.js',
      'public/workbox-*.js',
    ],
  },

  // Base JS Config
  js.configs.recommended,

  // TypeScript Config
  ...tseslint.configs.recommended,

  // Prettier Config (via compat, as it's a config, not just a plugin)
  ...compat.extends("prettier"),

  // Main App Configuration
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    plugins: {
      '@next/next': nextPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
      next: {
        rootDir: __dirname,
      },
    },
    rules: {
      // --- React Rules ---
      ...reactPlugin.configs.recommended.rules,
      // Turn off React in JSX Scope for Next.js
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'off',
      'react/jsx-curly-brace-presence': [
        'warn',
        { props: 'never', children: 'never' },
      ],

      // --- React Hooks Rules ---
      ...reactHooksPlugin.configs.recommended.rules,
      // Disable strict set-state-in-effect rule as it requires major refactoring
      'react-hooks/set-state-in-effect': 'off',

      // --- Next.js Rules ---
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,

      // --- Custom General Rules ---
      'no-unused-vars': 'off',
      'no-console': 'off',

      // --- TypeScript Rules ---
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'error', // Enforce no explicit any (as requested by 'perfect fix')

      // --- Unused Imports Rules ---
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': 'off',

      // --- Simple Import Sort Rules ---
      'simple-import-sort/exports': 'warn',
      'simple-import-sort/imports': [
        'warn',
        {
          groups: [
            // ext library & side effect imports
            ['^@?\\w', '^\\u0000'],
            // {s}css files
            ['^.+\\.s?css$'],
            // Lib and hooks
            ['^@/lib', '^@/hooks'],
            // static data
            ['^@/data'],
            // components
            ['^@/components', '^@/container'],
            // zustand store
            ['^@/store'],
            // Other imports
            ['^@/'],
            // relative paths up until 3 level
            [
              '^\\./?$',
              '^\\.(?!/?$)',
              '^\\.\\./?$',
              '^\\.\\.(?!/?$)',
              '^\\.\\./\\.\\./?$',
              '^\\.\\./\\.\\.(?!/?$)',
              '^\\.\\./\\.\\./\\.\\./?$',
              '^\\.\\./\\.\\./\\.\\.(?!/?$)',
            ],
            ['^@/types'],
            // other
            ['^'],
          ],
        },
      ],
    },
  },

  // Node-oriented configs and scripts
  {
    files: [
      '*.config.*',
      'commitlint.config.js',
      'jest.config.js',
      'jest.setup.js',
      'postcss.config.js',
      'start.js',
      'tailwind.config.ts',
      '.prettierrc.js',
      'scripts/**/*.{js,ts}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        jest: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      'no-undef': 'off',
    },
  }
);
