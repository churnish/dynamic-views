import js from "@eslint/js";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  // Ignore generated files and configs
  {
    ignores: [
      "main.js",
      "*.js.map",
      "*.map",
      "esbuild.config.mjs",
      "eslint.config.js"
    ]
  },

  // Base JavaScript recommended rules
  js.configs.recommended,

  // TypeScript type-checked recommended rules
  ...tseslint.configs.recommendedTypeChecked,

  // Language options for TypeScript
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      }
    }
  },

  // Obsidian plugin rules (manual config due to plugin bug)
  {
    plugins: {
      obsidianmd: obsidianmd
    },
    rules: {
      // Core Obsidian rules
      "obsidianmd/no-sample-code": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/no-tfile-tfolder-cast": "error",
      "obsidianmd/prefer-file-manager-trash-file": "warn",
      "obsidianmd/platform": "error",

      // TypeScript overrides
      "@typescript-eslint/no-unused-vars": ["warn", { "args": "none" }],
      "@typescript-eslint/ban-ts-comment": "off",
      "no-prototype-builtins": "off"
    }
  }
];
