import { config } from "@nextly/eslint-config/base";

export default [
  ...config,
  {
    ignores: [
      ".tsup/**",
      "dist/**",
      ".turbo/**",
      "node_modules/**",
      "test-*.ts",
      "tsup.config.js",
      "scripts/*.cjs",
      "scripts/*.js",
    ],
  },
  {
    // reason: build scripts and config files use Node globals + CJS requires
    files: ["tsup.config.{js,ts,mjs}", "*.config.{js,ts,mjs}", "scripts/**/*"],
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
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "import-x/no-unresolved": "off",
    },
  },
];
