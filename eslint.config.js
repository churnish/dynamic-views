import { defineConfig } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  // Only lint src/ TypeScript files
  {
    ignores: [
      "**",
      "!src/**",
      "!main.ts",
    ],
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
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Keep varsIgnorePattern for underscore-prefixed variables
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { args: "none", varsIgnorePattern: "^_" },
      ],
      // TypeScript handles undefined variable checking; no-undef false positives on JSX namespace
      "no-undef": "off",
    },
  },
]);
