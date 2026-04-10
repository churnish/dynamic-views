import { defineConfig } from 'eslint/config';
import globals from 'globals';
import obsidianmd from 'eslint-plugin-obsidianmd';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';

export default defineConfig([
  {
    ignores: ['**', '!src/**', '!main.ts'],
  },

  ...obsidianmd.configs.recommended,

  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { args: 'none', varsIgnorePattern: '^_' },
      ],
      'no-undef': 'off',
      // Enforce layer boundaries: utils/ (pure) → core/ (Obsidian-aware) → bases/ (views)
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/utils/**',
              from: './src/core/**',
              message: 'utils/ must be pure — no core/ imports',
            },
            {
              target: './src/utils/**',
              from: './src/bases/**',
              message: 'utils/ must be pure — no bases/ imports',
            },
            {
              target: './src/core/**',
              from: './src/bases/**',
              message: 'core/ cannot import from bases/',
            },
          ],
        },
      ],
    },
  },

  // Block eslint-disable for obsidianmd/* rules (bot strips all directives)
  comments.recommended,
  {
    rules: {
      '@eslint-community/eslint-comments/no-restricted-disable': [
        'error',
        'obsidianmd/*',
        '@eslint-community/eslint-comments/*',
      ],
    },
  },
]);
