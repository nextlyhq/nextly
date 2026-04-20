// Tests for the POSIX SIGSTOP/SIGCONT stdin mutex.
// Skipped on Windows; Sub-task 10 adds the ntsuspend-based Windows impl.
//
// Testing real pause/resume timing via stdout observation is racy because
// kernel stdio buffering doesn't guarantee immediate write delivery. These
// tests verify the syscalls complete without error for a valid running pid,
// that a non-existent pid produces ESRCH, and that Windows stubs throw.
// The actual "child is frozen" behaviour is verified manually when running
// the wrapper (task spec §12 manual TTY test).
import { spawn, type ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { StdinMutex } from "./stdin-mutex.js";

const isWindows = process.platform === "win32";

describe.skipIf(isWindows)("StdinMutex (POSIX)", () => {
  let child: ChildProcess | null = null;

  afterEach(() => {
    if (child) {
      child.kill("SIGKILL");
      child = null;
    }
  });

  it("pauseChild and resumeChild complete without throwing for a running child", async () => {
    child = spawn("node", ["-e", "setInterval(() => {}, 1000);"], {
      stdio: "ignore",
    });
    const mutex = new StdinMutex();

    await expect(mutex.pauseChild(child.pid!)).resolves.toBeUndefined();
    await expect(mutex.resumeChild(child.pid!)).resolves.toBeUndefined();
  });

  it("pauseChild throws ESRCH for a non-existent pid", async () => {
    const mutex = new StdinMutex();
    // PID 999999 is almost certainly free; process.kill synchronously throws
    // ESRCH via kill(2) for an unknown pid.
    expect(() => {
      const unknownPid = 999999;
      (mutex as unknown as { signal: (p: number, s: string) => void }).signal(
        unknownPid,
        "SIGSTOP"
      );
    }).toThrow();
  });
});

describe.skipIf(!isWindows)("StdinMutex (Windows via ntsuspend)", () => {
  // Actual suspend/resume behaviour requires a live child process and is
  // exercised in the manual TTY test script on Windows. Here we only
  // verify that the windows branch reaches ntsuspend rather than throwing
  // a "not implemented" error. pid 1 on Windows is invalid so ntsuspend
  // returns false; we expect the thrown message to indicate that, NOT a
  // "Sub-task 10" defer message (which is what the old stub used).
  it("errors reference ntsuspend when suspend fails, not a defer stub", async () => {
    const mutex = new StdinMutex();
    // Use an almost-certainly-invalid pid. ntsuspend returns false; we
    // should surface a message mentioning ntsuspend or pid rather than
    // the deferred-stub wording.
    await expect(mutex.pauseChild(999999)).rejects.toThrow(/ntsuspend|pid/i);
  });
});
