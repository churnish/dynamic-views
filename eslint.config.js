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

  // tests/ relaxes only what fires because mocks and fixtures deliberately use patterns production code should not. Roughly 100 rules stay on, including no-unused-vars, which is inherited from the **/*.ts block above rather than set here.
  {
    // Matches the '!tests/**' un-ignore exactly. A narrower glob such as tests/**/*.ts leaves every other extension under tests/ linted as production code with no relaxation — the deleted styleMock.js was that case, and vitest.config.ts already includes tests/**/*.test.tsx.
    files: ['tests/**'],
    rules: {
      // The obsidianmd rules that fire here are popout-window and DOM-helper preferences jsdom fixtures cannot honour — prefer-active-doc, prefer-create-el, no-global-this, no-tfile-tfolder-cast, no-static-styles-assignment. Note innerHTML is NOT among them: it is policed by no-unsanitized/*, a separate plugin left enabled.
      ...Object.fromEntries(
        Object.keys(obsidianmd.rules).map((rule) => [
          `obsidianmd/${rule}`,
          'off',
        ])
      ),
      // `any` is how the mocks model Obsidian's API surface without reimplementing its types, which cascades into "unsafe" findings on every access of one.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // `expect(mock.method).toHaveBeenCalledWith(...)` passes a method reference without calling it — the idiomatic Vitest assertion pattern, not a `this` scoping bug.
      '@typescript-eslint/unbound-method': 'off',
      // Deliberate divergence from first-line-is-title, which also disables no-unnecessary-type-assertion and await-thenable here. Measured per repo: that tree has 8 and 17 violations respectively, this one has zero — and no-unnecessary-type-assertion is what surfaced the eight redundant casts removed alongside this block, so it earns its keep. Do not re-sync by re-adding them.
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
