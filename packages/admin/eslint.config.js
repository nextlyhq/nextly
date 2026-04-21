import { config } from "@nextly/eslint-config/react-internal";

export default [
  ...config,
  {
    ignores: [
      ".tsup/**",
      "dist/**",
      ".turbo/**",
      "node_modules/**",
      "tsup.config.ts",
      "scripts/*.cjs",
      "scripts/*.js",
    ],
  },
  {
    // reason: build scripts use Node globals
    files: ["*.config.{ts,js,mjs}", "scripts/**/*"],
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
