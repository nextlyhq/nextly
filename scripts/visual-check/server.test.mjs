import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { startDetached, stopperFor } from "./server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A promise that never settles: a server that never exits. */
const never = () => new Promise(() => {});

/** Records every call to the functions a stop may make. */
function recorder({ killThrows, taskkillStatus = 0 } = {}) {
  const calls = { kill: [], run: [], log: [] };
  return {
    calls,
    kill: (pid, signal) => {
      calls.kill.push([pid, signal]);
      if (killThrows)
        throw Object.assign(new Error(killThrows), { code: killThrows });
    },
    run: (command, args) => {
      calls.run.push([command, args]);
      return {
        status: taskkillStatus,
        stdout: "",
        stderr: taskkillStatus ? "Access is denied." : "",
      };
    },
    log: line => calls.log.push(line),
  };
}

describe("stopping the server's process tree", () => {
  it("ends the whole tree with taskkill on Windows, and signals nothing", async () => {
    const r = recorder();
    const stop = stopperFor({
      pid: 123,
      exited: Promise.resolve(),
      platform: "win32",
      ...r,
    });
    expect(await stop()).toBe(true);
    expect(r.calls.run).toEqual([["taskkill", ["/pid", "123", "/T", "/F"]]]);
    expect(r.calls.kill).toEqual([]);
  });

  it("signals the process group elsewhere, and runs no taskkill", async () => {
    const r = recorder();
    const stop = stopperFor({
      pid: 123,
      exited: Promise.resolve(),
      platform: "darwin",
      ...r,
    });
    expect(await stop()).toBe(true);
    expect(r.calls.kill).toEqual([[-123, "SIGTERM"]]);
    expect(r.calls.run).toEqual([]);
  });

  it("stops once, however often it is asked", async () => {
    const r = recorder();
    const stop = stopperFor({
      pid: 123,
      exited: Promise.resolve(),
      platform: "linux",
      ...r,
    });
    await Promise.all([stop(), stop()]);
    await stop();
    expect(r.calls.kill).toHaveLength(1);
  });

  it("reports a kill that failed, and a server that outlived the wait, with its pid", async () => {
    const r = recorder({ killThrows: "EPERM" });
    const stop = stopperFor({
      pid: 123,
      exited: never(),
      platform: "linux",
      graceMs: 20,
      ...r,
    });
    expect(await stop()).toBe(false);
    expect(r.calls.log.join("\n")).toMatch(/EPERM/);
    expect(r.calls.log.join("\n")).toMatch(/may still be running.*123/);
    // Asked to end, then forced, before giving up.
    expect(r.calls.kill.map(([, signal]) => signal)).toEqual([
      "SIGTERM",
      "SIGKILL",
    ]);
  });

  it("reports a taskkill that failed on Windows", async () => {
    const r = recorder({ taskkillStatus: 1 });
    const stop = stopperFor({
      pid: 123,
      exited: never(),
      platform: "win32",
      graceMs: 20,
      ...r,
    });
    expect(await stop()).toBe(false);
    expect(r.calls.log.join("\n")).toMatch(/taskkill/);
    expect(r.calls.log.join("\n")).toMatch(/may still be running.*123/);
  });

  it("says nothing of a group already gone", async () => {
    const r = recorder({ killThrows: "ESRCH" });
    const stop = stopperFor({
      pid: 123,
      exited: Promise.resolve(),
      platform: "linux",
      ...r,
    });
    expect(await stop()).toBe(true);
    expect(r.calls.log).toEqual([]);
  });
});

/** Whether any process of group `pid` is still alive. */
function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A real run of the detached server, interrupted. A separate node process
 * starts a stand-in server the way the visual check starts the playground,
 * says the server's pid, and is then sent SIGINT; whether the server's process
 * group outlives it is the question.
 */
function interruptedRun({ keep }) {
  const server = pathToFileURL(path.join(HERE, "server.mjs")).href;
  const standIn = `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`;
  const script = `
    import { startDetached } from ${JSON.stringify(server)};
    const handle = startDetached({ command: ${JSON.stringify(standIn)}, cwd: process.cwd(), env: process.env, keep: ${keep}, log: line => console.log(line) });
    console.log("ready " + handle.pid);
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    let out = "";
    let pid;
    // A run that never says its server's pid is ended here, so a broken start
    // fails this test on its pid rather than leaving a process behind.
    const deadline = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.on("exit", () => clearTimeout(deadline));
    child.stdout.on("data", chunk => {
      out += chunk;
      const ready = /ready (\d+)/.exec(out);
      if (ready && pid === undefined) {
        pid = Number(ready[1]);
        child.kill("SIGINT");
      }
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal, pid, out }));
  });
}

describe.runIf(process.platform !== "win32")(
  "a server started detached",
  () => {
    it("is stopped whole: its process group is gone once stop resolves", async () => {
      const lines = [];
      const server = startDetached({
        command: `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`,
        cwd: process.cwd(),
        env: process.env,
        keep: false,
        log: line => lines.push(line),
      });
      try {
        expect(groupAlive(server.pid)).toBe(true);
        expect(await server.stop()).toBe(true);
        expect(groupAlive(server.pid)).toBe(false);
        expect(lines).toEqual([]);
      } finally {
        if (groupAlive(server.pid)) process.kill(-server.pid, "SIGKILL");
      }
    });
  }
);

describe.runIf(process.platform !== "win32")("an interrupted run", () => {
  it("stops the server it started, and exits as interrupted", async () => {
    const { code, pid } = await interruptedRun({ keep: false });
    const aliveAfter = pid ? groupAlive(pid) : false;
    // Ended here whatever the outcome, so a run that failed to stop its server
    // fails this test instead of leaving the server holding the test runner.
    if (aliveAfter) process.kill(-pid, "SIGKILL");
    expect(pid).toBeGreaterThan(0);
    expect(code).toBe(130);
    expect(aliveAfter).toBe(false);
  });

  it("with --keep, leaves the server running and says how to stop it", async () => {
    const { code, pid, out } = await interruptedRun({ keep: true });
    try {
      expect(code).toBe(130);
      expect(groupAlive(pid)).toBe(true);
      expect(out).toContain(`kill -TERM -${pid}`);
    } finally {
      if (pid) process.kill(-pid, "SIGKILL");
    }
  });
});
