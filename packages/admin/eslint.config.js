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
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // reason: storybook stories legitimately redefine hooks outside component bodies
    files: ["**/*.stories.tsx", "**/*.stories.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      "react/no-unescaped-entities": "off",
      "react/prop-types": "off",
    },
  },
  {
    // reason: test files legitimately use mocks, fixtures, and loose types
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**/*",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-require-imports": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      "import/no-unresolved": "off",
    },
  },
  {
    // reason: build scripts use Node globals
    files: ["*.config.ts", "*.config.js", "scripts/**/*"],
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
