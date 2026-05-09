import pluginNext from "@next/eslint-plugin-next";
import globals from "globals";

import { config as reactInternalConfig } from "./react-internal.js";

/**
 * Shared ESLint configuration — Next.js layer.
 *
 * Extends react-internal.js with Next.js-specific rules and Node globals
 * (for Server Components, Server Actions, and route handlers).
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const nextJsConfig = [
  ...reactInternalConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    plugins: { "@next/next": pluginNext },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
];
