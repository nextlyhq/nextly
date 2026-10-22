/**
 * Where a site's config file is: the names and folders searched, in order.
 *
 * One answer for every reader: the config loader, and the admin's development check, which
 * writes the generated component map again and imports the config's type into it. Its own
 * module, so that check can find the file without loading the config loader and its bundler.
 *
 * @module shared/lib/config-file
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** The config file's names, in the order they are tried in each folder. */
export const CONFIG_FILE_NAMES = [
  "nextly.config.ts",
  "nextly.config.mts",
  "nextly.config.js",
  "nextly.config.mjs",
];

/** The folders searched for it, relative to the project's root, in order. */
export const CONFIG_SEARCH_DIRS = [".", "./src", "./config"];

/** The first config file found from `cwd`, as an absolute path, or none. */
export function findConfigFile(cwd: string): string | undefined {
  for (const dir of CONFIG_SEARCH_DIRS) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const filePath = resolve(cwd, dir, fileName);
      if (existsSync(filePath)) {
        return filePath;
      }
    }
  }
  return undefined;
}
