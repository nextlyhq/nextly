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
    ],
  },
  {
    // reason: build scripts use Node globals
    files: ["*.config.{ts,js,mjs}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
        Buffer: "readonly",
      },
    },
  },
];
