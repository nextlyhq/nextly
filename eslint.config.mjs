// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import { config } from "@nextly/eslint-config/base";

export default [...config, {
  ignores: [
    "packages/*/dist/**",
    "packages/*/.turbo/**",
    "node_modules/**",
    ".turbo/**",
    "**/*.d.ts",
    "packages/create-nextly-app/templates/**",
  ],
}, ...storybook.configs["flat/recommended"], {
  // Override import resolution for Storybook config files
  files: [".storybook/**/*.{ts,tsx,js,jsx}"],
  rules: {
    "import/no-unresolved": ["error", {
      ignore: ["^react$", "^@storybook/"]
    }]
  }
}];
