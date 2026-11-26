/**
 * Whether the project's Schema Builder definition file is among what the project commits: the
 * changes not yet in a migration are computed from committed inputs only (the configuration, the
 * Builder's definitions and the migration folder), so a file git ignores would make the same
 * project report one thing on one machine and another in CI.
 *
 * @module domains/schema/ui-schema/committed-definition
 */
import { execFile } from "node:child_process";

/**
 * Whether git ignores `file`, a path under `projectRoot`. A file git tracks is never ignored,
 * whatever `.gitignore` says. False where the project is no git repository, or git cannot be
 * asked: nothing then says the file is not committed.
 */
export function ignoredByGit(
  projectRoot: string,
  file: string
): Promise<boolean> {
  return new Promise(resolve => {
    // `git check-ignore` exits 0 for an ignored path, 1 for one it does not ignore, and 128
    // outside a repository; a git that cannot be run fails too.
    execFile(
      "git",
      ["check-ignore", "--quiet", "--", file],
      { cwd: projectRoot },
      error => resolve(error === null)
    );
  });
}
