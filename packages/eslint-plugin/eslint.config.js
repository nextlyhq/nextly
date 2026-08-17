import js from "@eslint/js";

// This package is plain Node ESM tooling with no tsconfig, so it is linted with
// the non-type-aware rule set (the shared config's `projectService` requires a
// TS project and would fail to parse these `.js` files) — the same posture the
// repo takes for its other build-tooling packages.
export default [
  { ignores: ["node_modules/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { console: "readonly", process: "readonly" },
    },
  },
];
