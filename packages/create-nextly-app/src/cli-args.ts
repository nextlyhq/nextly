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
  /** When true, user passed "." (or "./") meaning install in current directory. */
  installInCwd: boolean;
}

/**
 * Derive the project name and installation mode from the CLI's positional
 * `[directory]` argument or from a follow-up prompt answer.
 *
 * Semantics:
 * - `undefined`, `""`, or whitespace-only -> prompt for name or use default
 * - `"."` or `"./"`                       -> install in cwd
 * - Any other value (incl. `./foo`, `foo/bar`) -> create subdirectory using
 *   the basename of the input
 */
export function resolveProjectArg(directory: string | undefined): ResolvedArg {
  // Treat whitespace-only input the same as an empty argument so that a
  // user fat-fingering the spacebar at the prompt doesn't fall through
  // into a cwd install.
  const trimmed = directory?.trim();
  if (!trimmed) {
    return { projectName: undefined, installInCwd: false };
  }

  // path.basename("./") === "" — normalize "./" the same way as "."
  if (trimmed === "." || trimmed === "./") {
    return { projectName: undefined, installInCwd: true };
  }

  return { projectName: path.basename(trimmed), installInCwd: false };
}

/**
 * Validate a project name (used for both the positional CLI argument and
 * the interactive prompt). Returns an error string when invalid, or
 * `undefined` when the name passes.
 *
 * Mirrors npm's "loose" package-name validation, plus the rules already
 * enforced by the existing prompt. The single dot (`"."`) is treated as
 * valid because the caller resolves it to a cwd-install before reaching
 * this helper.
 */
export function validateProjectName(name: string): string | undefined {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    return "Use lowercase letters, numbers, hyphens, dots, or underscores";
  }
  return undefined;
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
