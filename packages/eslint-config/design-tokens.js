import nextlyPlugin from "@nextlyhq/eslint-plugin";

/**
 * The design-token rules, as this repository mounts them.
 *
 * The rules themselves live in the published `@nextlyhq/eslint-plugin` so that
 * plugin authors outside this repository get the same checks. This module is
 * only the mounting: it exists because ESLint resolves a flat config from the
 * CWD rather than from the linted file, so a rule written into one package's
 * config is absent from every invocation that reads a different one — including
 * lint-staged, which runs from the repository root.
 *
 * `files` is supplied by the caller rather than fixed here, because the same
 * rules apply at different scopes: the root config scopes them by glob, and a
 * package config that mounts them wants its own tree.
 *
 * @param {string[]} files - globs the rules apply to.
 * @returns {import("eslint").Linter.Config[]}
 */
export function designTokensConfig(files) {
  return [
    {
      name: "@nextlyhq/design-tokens",
      files,
      // Tests are excluded, matching `scripts/lint-design.mjs`, which has
      // filtered them since it was written. A fixture writing `color: red` is
      // modelling arbitrary user data, not styling a surface that ships — and
      // the two guards enforce one contract, so they must agree on which files
      // it governs as well as on what it means.
      ignores: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/*.d.ts"],
      plugins: { "@nextlyhq": nextlyPlugin },
      rules: {
        "@nextlyhq/no-palette-classes": "error",
        "@nextlyhq/no-hardcoded-colors": "error",
        "@nextlyhq/no-static-inline-style": "error",
      },
    },
  ];
}
