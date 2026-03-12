import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  // Only lint src/ TypeScript files
  {
    ignores: ['**', '!src/**', '!main.ts'],
  },

  // Obsidian recommended rules (includes JS recommended, TS type-checked,
  // obsidianmd/*, @microsoft/sdl/*, import/*, depend/*)
  ...obsidianmd.configs.recommended,

  // Browser globals and TypeScript parser options
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

  // Project-specific overrides for TypeScript
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Keep varsIgnorePattern for underscore-prefixed variables
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { args: 'none', varsIgnorePattern: '^_' },
      ],
      // TypeScript handles undefined variable checking; no-undef false positives on JSX namespace
      'no-undef': 'off',
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
