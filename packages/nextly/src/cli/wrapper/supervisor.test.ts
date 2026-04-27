// Tests for the Supervisor child-process manager.
// These tests spawn real node subprocesses rather than mocking child_process
// because the whole point of Supervisor is the boundary interaction with the
// OS process model, which mocks would not exercise.
import { afterEach, describe, expect, it, vi } from "vitest";

import { Supervisor } from "./supervisor.js";

describe("Supervisor", () => {
  let sup: Supervisor | null = null;

  afterEach(async () => {
    if (sup?.isRunning) {
      // Force SIGKILL after 1s if the child under test ignores SIGTERM.
      await sup.stop("SIGTERM", 1000);
    }
    sup = null;
  });

  it("spawns a node child and reports isRunning + pid", async () => {
    sup = new Supervisor({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: process.cwd(),
    });
    await sup.start();
    expect(sup.isRunning).toBe(true);
    expect(sup.pid).toBeGreaterThan(0);
  });

  it("stop() terminates the child and isRunning flips to false", async () => {
    sup = new Supervisor({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: process.cwd(),
    });
    await sup.start();
    await sup.stop("SIGTERM", 2000);
    expect(sup.isRunning).toBe(false);
  });

  it("restart() stops and respawns with a different pid", async () => {
    sup = new Supervisor({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: process.cwd(),
    });
    await sup.start();
    const firstPid = sup.pid;
    await sup.restart();
    expect(sup.isRunning).toBe(true);
    expect(sup.pid).not.toBe(firstPid);
  });

  it("invokes onExit when the child exits unexpectedly (not via stop())", async () => {
    const onExit = vi.fn();
    sup = new Supervisor({
      command: process.execPath,
      args: ["-e", "process.exit(42);"],
      cwd: process.cwd(),
      onExit,
    });
    await sup.start();
    await new Promise(r => setTimeout(r, 300));
    expect(onExit).toHaveBeenCalled();
    // Exit code should flow through, signal should be null for a normal exit.
    expect(onExit.mock.calls[0]?.[0]).toBe(42);
  });

  it("does NOT invoke onExit when we stop() the child ourselves", async () => {
    const onExit = vi.fn();
    sup = new Supervisor({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: process.cwd(),
      onExit,
    });
    await sup.start();
    await sup.stop("SIGTERM", 2000);
    // Give the exit event a moment to propagate.
    await new Promise(r => setTimeout(r, 100));
    expect(onExit).not.toHaveBeenCalled();
  });
});
