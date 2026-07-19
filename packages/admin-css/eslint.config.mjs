import js from "@eslint/js";

// This package is plain Node ESM tooling with no tsconfig, so it is linted with
// the non-type-aware rule set (the shared config's `projectService` requires a
// TS project and would fail to parse these `.mjs` files) — the same posture the
// repo takes for other build-tooling packages.
export default [
  { ignores: ["node_modules/**", "__fixtures__/**"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
      },
    },
  },
];
