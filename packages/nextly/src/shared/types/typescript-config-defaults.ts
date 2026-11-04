import type { TypeScriptConfig } from "./config";

/**
 * Default TypeScript configuration values. A module of its own that imports
 * nothing at run time, so a command's help can name the default output file
 * without loading the configuration types' module, which re-exports it.
 */
export const DEFAULT_TYPESCRIPT_CONFIG: Required<TypeScriptConfig> = {
  outputFile: "./src/types/generated/nextly-types.ts",
  declare: true,
};
