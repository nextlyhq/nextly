import js from "@eslint/js";
import globals from "globals";

/*
 * The repository's dev-tooling scripts, which nothing else lints.
 *
 * 🔴 `packages/eslint-config/base.js` ignores `**\/scripts/**\/*`, and the reason
 * is sound: those files sit outside every package's tsconfig project, so
 * type-aware linting cannot resolve them and errors with "not found by the
 * project service". But the ignore removes the UNTYPED rules along with the
 * typed ones, and `no-undef` needs no type information at all.
 *
 * What that cost: `scripts/release/check-finalized.mjs` referenced a constant
 * that had been deleted. The whole scripts suite passed, 1200 tests, because
 * the reference is in the command-line block that no test enters. It was caught
 * by running the executable, which is not a control. These are the scripts that
 * decide whether a release ships.
 *
 * Untyped on purpose, and separate from the root config for the same reason the
 * ignore exists: this asks only the questions that can be answered without a
 * tsconfig project. `turbo run lint` is per-package and never reaches the
 * repository root, so `pnpm lint:scripts` runs it.
 */
export default [
  js.configs.recommended,
  {
    /*
     * ESM. `.mjs` says so regardless of the package `type`, which is why the
     * scripts here use it.
     */
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    /*
     * CommonJS. The root package declares no `type`, so `.js` here is CJS, and
     * `.cjs` is CJS anywhere. Getting this wrong is not a small mistake: with
     * the module parser these files reported `console`, `process` and
     * `__dirname` as undefined, 37 findings that were all the config's fault
     * and none of them the code's.
     */
    files: ["scripts/**/*.{cjs,js}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    files: ["scripts/**/*.{mjs,cjs,js}"],
    rules: {
      // An unused variable in a script is usually a rename that was not
      // finished, but an argument deliberately skipped is normal.
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      /*
       * ⚠️ Comments excluded, because a zero-width space in one is deliberate
       * here. Two scripts use U+200B to write `*` and `/` next to each other
       * inside a block comment without closing it, which is the only way to
       * put `*\u200b/` or a `**\u200b/*.md` glob in JSDoc. Flagging those is a
       * false positive on a correct file; the rule still refuses irregular
       * whitespace in code, where it is always a mistake.
       */
      "no-irregular-whitespace": ["error", { skipComments: true }],
    },
  },
  {
    // These run under vitest, which supplies describe/it/expect.
    files: ["scripts/**/*.test.mjs", "scripts/**/__tests__/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
];
