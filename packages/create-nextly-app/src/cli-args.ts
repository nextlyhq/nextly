/**
 * Pure argument-parsing helpers for the `create-nextly-app` CLI.
 *
 * Extracted out of cli.ts into its own module so unit tests can import the
 * helpers without triggering cli.ts's top-level `program.parse()` side
 * effect. cli.ts imports from here; tests import from here.
 */

import path from "path";

export interface ResolvedArg {
  /** Project name for the new directory. undefined = prompt or use default. */
  projectName: string | undefined;
  /** When true, user passed "." meaning install in current directory. */
  installInCwd: boolean;
}

/**
 * Derive the project name and installation mode from the CLI's positional
 * `[directory]` argument.
 *
 * Semantics:
 * - `undefined` or `""` -> prompt for name or use default "my-nextly-app"
 * - `"."` -> install in cwd (use basename of cwd as project name)
 * - Any other value -> create subdirectory with that name
 */
export function resolveProjectArg(directory: string | undefined): ResolvedArg {
  if (!directory || directory === "") {
    return { projectName: undefined, installInCwd: false };
  }

  if (directory === ".") {
    return { projectName: undefined, installInCwd: true };
  }

  return { projectName: path.basename(directory), installInCwd: false };
}

/**
 * @deprecated Use resolveProjectArg instead. Kept for backwards compatibility
 * with existing tests during migration.
 */
export function resolveProjectNameFromArg(
  directory: string | undefined
): string | undefined {
  if (!directory || directory === ".") {
    return undefined;
  }
  return path.basename(directory);
}
