import { config } from "@nextlyhq/eslint-config/base";
import { designTokensConfig } from "@nextlyhq/eslint-config/design-tokens";

export default [...designTokensConfig(["src/**/*.{ts,tsx}"]), ...config];
