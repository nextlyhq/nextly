// What: spawns and manages a long-running child process (next dev) with
// cross-platform signal handling and graceful respawn.
// Why: Task 11's wrapper CLI needs to kill the Next dev server on schema
// applies and start a fresh one so runtime picks up new Drizzle table
// objects. Windows does not propagate SIGTERM the same way POSIX does and a
// plain child.kill('SIGTERM') can leave orphaned grandchildren. tree-kill
// terminates the whole process tree. If the child ignores SIGTERM we
// escalate to SIGKILL after a timeout. onExit is invoked only for
// unexpected exits so the caller can distinguish crash-restart from
// intentional-restart.
//
// Contract: `command` is expected to be an absolute path to an executable
// (typically process.execPath — Node itself). shell: false is kept on
// every OS so args are not shell-parsed. Callers that need to run a
// package-manager-shim (npx, pnpm dlx) must pre-resolve the underlying
// JS entry themselves — see buildNextDevSupervisorOptions for the
// reference pattern. This avoids the Windows `spawn npx ENOENT` class
// of bug where Node's spawn cannot locate `.cmd`/`.bat` shims without
// shell lookup.

import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";

import treeKill from "tree-kill";

export interface SupervisorOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export class Supervisor {
  private child: ChildProcess | null = null;
  // Set to true right before we kill the child ourselves so the exit handler
  // knows not to fire onExit (which represents crash or user exit, not an
  // intentional respawn we are driving from the orchestrator).
  private intentionalShutdown = false;

  constructor(private opts: SupervisorOptions) {}

  get isRunning(): boolean {
    return (
      this.child !== null && this.child.exitCode === null && !this.child.killed
    );
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.intentionalShutdown = false;

    this.child = spawn(this.opts.command, this.opts.args, {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      // inherit: child writes directly to our terminal; user sees next dev logs.
      stdio: "inherit",
      // shell: false avoids cmd.exe / sh parsing of user-provided flags.
      shell: false,
    });

    this.child.on("exit", (code, signal) => {
      const wasIntentional = this.intentionalShutdown;
      this.child = null;
      if (!wasIntentional && this.opts.onExit) {
        this.opts.onExit(code, signal);
      }
    });
  }

  async stop(
    signal: NodeJS.Signals = "SIGTERM",
    timeoutMs = 5000
  ): Promise<void> {
    if (!this.isRunning || !this.child?.pid) return;
    this.intentionalShutdown = true;

    const pid = this.child.pid;
    const exitPromise = once(this.child, "exit");

    // tree-kill walks descendants so we don't orphan grandchildren on Windows.
    await new Promise<void>(resolve => {
      treeKill(pid, signal, err => {
        if (err) {
          // Fallback: try the direct kill. If the child already exited, that
          // is fine because we will observe the exit event anyway.
          try {
            this.child?.kill(signal);
          } catch {
            // ignore: child may already be dead.
          }
        }
        resolve();
      });
    });

    // If the child ignores SIGTERM we force termination. Scheduled via
    // setTimeout rather than awaited directly so stop() still returns promptly
    // in the happy path (child already exited before the timer fires).
    const killTimer = setTimeout(() => {
      if (this.child?.pid) {
        treeKill(this.child.pid, "SIGKILL", () => {
          // best effort: child may have already exited between setTimeout
          // scheduling and this callback running.
        });
      }
    }, timeoutMs);

    await exitPromise;
    clearTimeout(killTimer);
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}
