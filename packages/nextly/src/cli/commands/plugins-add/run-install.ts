/**
 * The install `nextly add` makes.
 *
 * @module cli/commands/plugins-add/run-install
 */
import { spawn } from "node:child_process";

import { exitStopped, stopWithCommand } from "../../utils/stop-with-command";

/**
 * Runs `pm <args>` in `cwd` at the terminal, where a package's scripts may ask
 * something, and answers its exit code. A command stopped while it runs passes
 * the signal on, waits for its end and ends too.
 */
export function runInstall(
  pm: string,
  args: readonly string[],
  cwd: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(pm, args, {
      cwd,
      stdio: "inherit",
      // Windows resolves package-manager shims via the shell.
      shell: process.platform === "win32",
    });
    const watched = stopWithCommand(child, { name: pm, group: false });
    const finish = async (code: number): Promise<void> => {
      if (await watched.ended()) {
        await exitStopped(
          () =>
            `${pm} was stopped, and may have done part of its work. Run the command again to finish it.`
        );
      }
      resolve(code);
    };
    child.on("error", () => {
      finish(1).catch(reject);
    });
    child.on("close", code => {
      finish(code ?? 1).catch(reject);
    });
  });
}
