import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // The e2e run builds into its own directory; without this, linting after
      // an e2e run reports thousands of problems in generated chunks.
      ".next-e2e/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Plain JS shim used by Turbopack's resolveAlias for
      // optional-peer-dep handling (see next.config.ts). Not part of
      // the TypeScript project; trips eslint's project-aware parser
      // if linted.
      "src/stubs/**",
    ],
  },
];

export default eslintConfig;
