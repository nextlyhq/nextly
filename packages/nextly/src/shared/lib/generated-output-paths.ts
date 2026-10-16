/**
 * Where `nextly generate:types` and the other code generators write into the
 * app: the TypeScript types file and the folder of Zod schemas.
 *
 * The built-in defaults name a `src/` folder (`./src/types/generated/...`,
 * `./src/db/schemas/collections`), which suits an app under `src/` and creates
 * a stray one in an app without it. So a path still at its built-in default
 * follows the app's layout, and a path the project configured is used as
 * written: only the default was ever a guess. A project that writes the
 * default's exact text in its config is read as having left it at the default.
 *
 * Every writer of generated output resolves its paths here, so the generators
 * cannot disagree about where a file goes.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { DEFAULT_DB_CONFIG, DEFAULT_TYPESCRIPT_CONFIG } from "../types/config";

/**
 * Whether the app keeps its code under `src/`, decided as Next.js decides it:
 * an `app/` or `pages/` folder at the root wins, and `src/app` and `src/pages`
 * are then ignored; otherwise `src/` holds the app if it exists.
 */
export function projectUsesSrcLayout(cwd: string): boolean {
  const rootAppDir =
    existsSync(join(cwd, "app")) || existsSync(join(cwd, "pages"));
  return !rootAppDir && existsSync(join(cwd, "src"));
}

/** A built-in default without its leading `src/`, in an app that has none. */
function fitToLayout(
  configured: string,
  builtInDefault: string,
  cwd: string
): string {
  if (configured !== builtInDefault || projectUsesSrcLayout(cwd)) {
    return configured;
  }
  return configured.replace(/^(\.\/)?src\//, "$1");
}

/** The absolute path of the generated TypeScript types file. */
export function generatedTypesFile(cwd: string, configured: string): string {
  return resolve(
    cwd,
    fitToLayout(configured, DEFAULT_TYPESCRIPT_CONFIG.outputFile, cwd)
  );
}

/** The absolute path of the folder generated Zod schemas are written to. */
export function generatedZodDir(cwd: string, schemasDir: string): string {
  return resolve(
    cwd,
    fitToLayout(schemasDir, DEFAULT_DB_CONFIG.schemasDir, cwd),
    "zod"
  );
}
