import { config } from "@nextlyhq/eslint-config/react-internal";

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
    // The admin registers keyboard shortcuts with the shared manager, which owns the panel's one
    // keydown listener. A second listener on `document` or `window` reintroduces the defect that
    // manager exists to remove: `stopPropagation()` does not stop a sibling listener on the same
    // node, so two owners of one key both run and mount order decides which appears to win.
    //
    // Enforced as a syntax restriction rather than a bespoke rule so there is no plugin to build
    // or version: the selector matches the call itself, which is the thing that must not appear.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name=/^(document|window)$/][callee.property.name='addEventListener'][arguments.0.value=/^key(down|up|press)$/]",
          message:
            "Register the shortcut with useKeyboardShortcuts (or useShortcuts from @nextlyhq/ui) instead of adding a keyboard listener. One owner decides who gets a key; a second listener makes that mount order.",
        },
      ],
    },
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
