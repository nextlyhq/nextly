import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

import { config as baseConfig } from "./base.js";

/**
 * React-specific rule set without the base layer.
 *
 * Exported separately so the monorepo-root ESLint config can compose
 * these rules under a `files: [...]` predicate for React-bearing
 * paths. Without this, lint-staged invocations from the repo root
 * (which pick up the root config, not per-package configs) fail with
 * "Definition for rule 'react-hooks/exhaustive-deps' was not found"
 * on any file that uses an inline `// eslint-disable-next-line
 * react-hooks/...` directive.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const reactRules = [
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  pluginReact.configs.flat["jsx-runtime"],
  {
    plugins: { "react-hooks": pluginReactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "warn",
      "react/display-name": "warn",
    },
  },
];

/**
 * Shared ESLint configuration — React internal (library) layer.
 *
 * Extends base.js with React + react-hooks rules and browser globals.
 * Does NOT re-apply js.configs.recommended or typescript-eslint configs —
 * those already come from ...baseConfig (removing the prior triple-apply bug).
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [...baseConfig, ...reactRules];
