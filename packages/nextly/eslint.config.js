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
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "as",
          objectLiteralTypeAssertions: "allow",
        },
      ],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
          allowFunctionsWithoutTypeParameters: true,
        },
      ],
    },
  },
  {
    // reason: dynamic schemas legitimately need `any` for user-defined field types
    files: ["src/schemas/**/*.ts", "src/domains/dynamic-collections/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // reason: component data service operates on heterogeneous user-defined component payloads
    files: [
      "src/domains/components/**/*.ts",
      "src/services/components/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // reason: plugin/dispatch/di/cli/auth/adapter layers accept arbitrary user payloads
    files: [
      "src/plugins/**/*.ts",
      "src/dispatcher/**/*.ts",
      "src/di/**/*.ts",
      "src/direct-api/**/*.ts",
      "src/route-handler/**/*.ts",
      "src/cli/**/*.ts",
      "src/auth/**/*.ts",
      "src/storage/**/*.ts",
      "src/api/**/*.ts",
      "src/database/**/*.ts",
      "src/services/**/*.ts",
      "src/collections/**/*.ts",
      "src/hooks/**/*.ts",
      "src/lib/**/*.ts",
      "src/middleware/**/*.ts",
      "src/fields/**/*.ts",
      "src/init/**/*.ts",
      "src/errors/**/*.ts",
      "src/events/**/*.ts",
      "src/rbac/**/*.ts",
      "src/types/**/*.ts",
      "src/shared/**/*.ts",
      "src/validation/**/*.ts",
      "src/config/**/*.ts",
      "src/actions/**/*.ts",
      "src/singles/**/*.ts",
      "src/users/**/*.ts",
      "src/components/**/*.ts",
      "src/domains/**/*.ts",
      "src/scripts/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // reason: test files legitimately use `any` for mocks and fixtures
    files: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "src/__tests__/**/*.ts",
      "**/__tests__/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "import/no-unresolved": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-case-declarations": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-empty": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
  {
    // reason: build scripts use Node globals (console, process, __dirname)
    files: ["tsup.config.js", "tsup.config.ts", "*.config.js", "*.config.ts"],
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
    },
  },
  {
    // reason: test helper files legitimately use console
    files: ["test-*.ts", "src/__tests__/**/*"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "import/no-unresolved": "off",
    },
  },
];
