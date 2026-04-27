// What: pauses and resumes a child process so the wrapper can take exclusive
// ownership of the terminal's stdin for @clack/prompts.
// Why: next dev maintains its own readline for keyboard shortcuts (r to
// restart, o to open browser, q to quit). If we run @clack/prompts while
// next dev's reader is active, keystrokes race across both and the user sees
// partially-consumed input.
//
// Cross-platform strategy:
// - POSIX (macOS / Linux): SIGSTOP / SIGCONT via process.kill freeze the
//   child's event loop completely. We use process.kill directly rather
//   than tree-kill because tree-kill is built for termination (SIGTERM /
//   SIGKILL). SIGSTOP sent via tree-kill has been unreliable in practice.
// - Windows: no SIGSTOP equivalent. We use ntsuspend (native addon that
//   wraps NtSuspendProcess / NtResumeProcess, the same Windows kernel APIs
//   the Task Manager uses to suspend processes). Listed as optionalDependency
//   so POSIX installs don't fail on the native build step.

export class StdinMutex {
  async pauseChild(childPid: number): Promise<void> {
    if (process.platform === "win32") {
      await this.windowsSuspend(childPid, "suspend");
      return;
    }
    this.posixSignal(childPid, "SIGSTOP");
  }

  async resumeChild(childPid: number): Promise<void> {
    if (process.platform === "win32") {
      await this.windowsSuspend(childPid, "resume");
      return;
    }
    this.posixSignal(childPid, "SIGCONT");
  }

  private posixSignal(pid: number, sig: "SIGSTOP" | "SIGCONT"): void {
    // Send to the process itself. The Supervisor does not use detached: true
    // so individual pid is correct. If we ever switch to detached, send to
    // -pid to hit the whole process group.
    process.kill(pid, sig);
  }

  private async windowsSuspend(
    pid: number,
    action: "suspend" | "resume"
  ): Promise<void> {
    // Lazy-require so non-Windows installs never try to load the native
    // module (it is marked optionalDependency so its install failure is
    // silent on POSIX). Dynamic import avoids bundler-time resolution.
    let nt: {
      suspend: (pid: number) => boolean;
      resume: (pid: number) => boolean;
    };
    try {
      // ntsuspend ships no bundled .d.ts, so TS can't resolve the module.
      // Dynamic import returns the native bindings shape we typed locally.
      // @ts-expect-error -- no types published for ntsuspend
      nt = (await import("ntsuspend")) as unknown as typeof nt;
    } catch (err) {
      throw new Error(
        `StdinMutex on Windows requires the 'ntsuspend' native module. ` +
          `Install with: pnpm add ntsuspend. ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const ok = action === "suspend" ? nt.suspend(pid) : nt.resume(pid);
    if (!ok) {
      throw new Error(
        `ntsuspend.${action} returned false for pid ${pid}. ` +
          `The child may have exited, or the current process lacks the privilege ` +
          `to suspend another process. Try running the dev terminal as the same user.`
      );
    }
  }
}
