import { config } from "@nextlyhq/eslint-config/base";

// The base rules alone: this package has no admin UI, so the design-token
// rules the UI plugins load do not apply, and its config files use no Node
// globals that would need declaring.
export default [
  ...config,
  {
    ignores: [
      "dist/**",
      ".turbo/**",
      "node_modules/**",
      "tsdown.config.ts",
    ],
  },
];
