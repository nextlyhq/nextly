import path from "path";

import * as p from "@clack/prompts";
import fs from "fs-extra";

import { resolveProjectArg, validateProjectName } from "../cli-args";
import type { ResolvedArg } from "../cli-args";

/**
 * Check if the current directory is a Next.js project.
 */
export async function isExistingNextProject(cwd: string): Promise<boolean> {
  const packageJsonPath = path.join(cwd, "package.json");

  if (!(await fs.pathExists(packageJsonPath))) return false;

  try {
    const packageJson = await fs.readJson(packageJsonPath);
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    return "next" in deps;
  } catch {
    return false;
  }
}

/**
 * Default project name suggested when the user just hits Enter at the prompt.
 * Mirrors the historical value used by --yes / `defaults` mode so behavior
 * is identical across all entry points.
 */
export const DEFAULT_PROJECT_NAME = "my-nextly-app";

/** Discriminated result of a successful project-name prompt. */
export type PromptForProjectNameResult =
  | { kind: "resolved"; value: ResolvedArg }
  | { kind: "cancelled" };

/**
 * Interactive prompt asking the user for the project folder name.
 *
 * The answer is fed back through `resolveProjectArg` so the prompt accepts
 * the same shapes as the CLI's positional argument:
 *   - bare name             -> create a subdirectory
 *   - "."  / "./"           -> install in the current directory
 *   - "./foo" / "path/foo"  -> create subdirectory `foo`
 *
 * Returns `{ kind: "cancelled" }` when the user hits Ctrl+C so the caller
 * can bail out cleanly without inspecting clack-specific symbols.
 */
export async function promptForProjectName(): Promise<PromptForProjectNameResult> {
  const answer = await p.text({
    message: "What should your project be called?",
    // `initialValue` pre-fills the buffer so Enter accepts the default. Using
    // `placeholder` alone (the previous behavior) returns an empty string on
    // Enter, which silently fell through to a cwd install — the root cause
    // of the original bug.
    initialValue: DEFAULT_PROJECT_NAME,
    placeholder: DEFAULT_PROJECT_NAME,
    validate: value => {
      if (!value || !value.trim()) {
        return "Please enter a folder name (or '.' to use the current directory)";
      }
      const trimmed = value.trim();
      if (trimmed === "." || trimmed === "./") return undefined;
      const projectName = path.basename(trimmed);
      return validateProjectName(projectName);
    },
  });

  if (p.isCancel(answer)) {
    return { kind: "cancelled" };
  }

  return { kind: "resolved", value: resolveProjectArg(answer) };
}

/** What the user chose when the target directory was non-empty. */
export type DirectoryConflictChoice = "cancel" | "remove" | "ignore";

/**
 * Ask the user how to proceed when the chosen target directory already
 * has files in it. Mirrors create-vite's three-option recovery prompt so
 * users have an in-CLI escape hatch instead of needing to `rm -rf` and
 * re-run.
 *
 * `targetLabel` is the human-readable directory identifier shown in the
 * prompt (typically the basename, or "the current directory" for cwd).
 */
export async function promptDirectoryConflict(
  targetLabel: string
): Promise<DirectoryConflictChoice> {
  const choice = await p.select({
    message: `Target directory ${targetLabel} is not empty. How would you like to proceed?`,
    options: [
      { value: "cancel" as const, label: "Cancel operation" },
      {
        value: "remove" as const,
        label: "Remove existing files and continue",
      },
      {
        value: "ignore" as const,
        label: "Ignore files and continue",
      },
    ],
  });

  if (p.isCancel(choice)) return "cancel";
  return choice;
}
