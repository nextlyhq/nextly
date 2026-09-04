import { config } from "@nextlyhq/eslint-config/base";
import { designTokensConfig } from "@nextlyhq/eslint-config/design-tokens";

export default [
  ...designTokensConfig(["src/**/*.{ts,tsx}"]),
  ...config,
  {
    ignores: [
      ".tsup/**",
      "dist/**",
      ".turbo/**",
      "node_modules/**",
      "tsup.config.{ts,js,mjs}",
      "vitest.config.{ts,js,mjs}",
    ],
  },
];
