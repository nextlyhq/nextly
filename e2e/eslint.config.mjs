import { config } from "@nextlyhq/eslint-config/base";

export default [
  ...config,
  {
    ignores: ["node_modules/**", ".playwright/**"],
  },
];
