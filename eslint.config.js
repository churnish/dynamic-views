import { defineConfig } from 'eslint/config';
import globals from 'globals';
import obsidianmd from 'eslint-plugin-obsidianmd';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';

export default defineConfig([
  {
    ignores: ['**', '!src/**', '!main.ts', '!tests/**', '!package.json'],
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

  // tests/ keeps unused-import/unused-variable checks (the two rules that catch
  // real test-tree rot) but relaxes everything that only fires because mocks and
  // fixtures deliberately use patterns production code should not.
  {
    files: ['tests/**/*.ts'],
    rules: {
      // obsidianmd/* encodes plugin-runtime constraints (no innerHTML, deferred
      // views, etc.) that don't apply to test fixtures and mocks.
      ...Object.fromEntries(
        Object.keys(obsidianmd.rules).map((rule) => [
          `obsidianmd/${rule}`,
          'off',
        ])
      ),
      // `any` is how the mocks model Obsidian's API surface without reimplementing
      // its types, which cascades into "unsafe" findings on every access of one.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // `expect(mock.method).toHaveBeenCalledWith(...)` passes a method reference
      // without calling it — the idiomatic Vitest assertion pattern, not a `this`
      // scoping bug.
      '@typescript-eslint/unbound-method': 'off',
      // Fires on casts that are redundant only because the surrounding mock/plugin
      // value is already typed `any`; no behavioral signal in a fixture-heavy file.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Awaiting a synchronous helper is harmless and common when a test suite
      // covers both sync and async call sites with the same `await` pattern.
      '@typescript-eslint/await-thenable': 'off',
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
