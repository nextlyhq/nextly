import { config } from "@nextly/eslint-config/react-internal";

export default [
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
