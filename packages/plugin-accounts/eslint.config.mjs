import { designTokensConfig } from "@nextlyhq/eslint-config/design-tokens";
import { config } from "@nextlyhq/eslint-config/react-internal";

// The React rules, for the admin screens under `src/admin`, and the
// design-token rules over every source file, so the admin screens use the
// theme's tokens alone and work in both of its modes. The config files use
// no Node globals that would need declaring.
export default [
  ...designTokensConfig(["src/**/*.{ts,tsx}"]),
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
