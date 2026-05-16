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

  // path.basename("./") === "." (verified Node 20+), so leaving "./" to
  // fall through to the basename branch below would set projectName="."
  // and treat it as a normal subdirectory — wrong. Short-circuit "."
  // and "./" to the cwd-install path.
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
 * Validate a raw answer from the project-name prompt. Returns an error
 * string when invalid, or `undefined` when the value is acceptable.
 *
 * Unlike `validateProjectName`, this helper accepts the prompt's special
 * shapes — empty string (which the prompt will replace with the default
 * value), `"."` / `"./"` (cwd install), and `"./foo"` paths — applying
 * the strict name regex only to the basename of a free-form folder name.
 *
 * Extracted from the prompt's inline `validate` lambda so the logic can
 * be unit-tested without driving the interactive prompt.
 */
export function validateProjectNamePromptInput(
  value: string | undefined
): string | undefined {
  // Accept undefined / empty / whitespace-only so @clack/prompts can
  // substitute the prompt's initialValue. Rejecting them here would block
  // Enter-to-accept-default.
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return undefined;
  if (trimmed === "." || trimmed === "./") return undefined;
  const candidate = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
  return validateProjectName(path.basename(candidate));
}

