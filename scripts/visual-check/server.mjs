/**
 * The playground's production server for a visual check: readied, built and
 * started exactly as the production browser suite does it, from the steps and
 * environment `e2e/production-server.mjs` names.
 *
 * @module scripts/visual-check/server
 */
import { spawn, spawnSync } from "node:child_process";

import {
  BUILD_COMMAND,
  NEXTLY_ROOT,
  PREPARE_COMMANDS,
  productionServerEnv,
  START_COMMAND,
} from "../../e2e/production-server.mjs";

/** How long the built server may take to answer. The build itself is not counted. */
const START_TIMEOUT_MS = 3 * 60_000;

/** How long a stopped server gets to exit before it is killed. */
const STOP_GRACE_MS = 10_000;

/** Whether the server at `baseURL` answers its health check. */
async function answers(baseURL) {
  try {
    const response = await fetch(`${baseURL}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * A shell command line as the arguments that run it: `sh -c` here, and
 * `cmd.exe /d /s /c` on Windows, which has no `sh`.
 */
function shellArgs(line, platform = process.platform) {
  return platform === "win32"
    ? ["cmd.exe", "/d", "/s", "/c", line]
    : ["sh", "-c", line];
}

/**
 * Ends the tree rooted at `pid` with `taskkill /T /F`, as Windows has no
 * process groups. Answers what went wrong, or null.
 */
function taskkillTree(pid, run) {
  const result = run("taskkill", ["/pid", String(pid), "/T", "/F"], {
    encoding: "utf8",
  });
  // 128: no such process, which is what stopping it wanted.
  if (result.status === 0 || result.status === 128) return null;
  const said = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
  return `taskkill could not end process ${pid} (exit ${result.status}): ${said || "no reason given"}`;
}

/** Sends `signal` to process group `pid`. Answers what went wrong, or null. */
function signalGroup(pid, signal, kill) {
  try {
    kill(-pid, signal);
    return null;
  } catch (error) {
    // No such group is what stopping it wanted.
    if (error?.code === "ESRCH") return null;
    return `Could not send ${signal} to process group ${pid}: ${error?.code ?? error}.`;
  }
}

/**
 * Asks the server's whole process tree to end: the shell, pnpm and the Next
 * process under it. Windows ends the tree with taskkill, forcibly; elsewhere
 * the process group gets `signal`.
 */
function signalTree(pid, signal, { platform, kill, run }) {
  return platform === "win32"
    ? taskkillTree(pid, run)
    : signalGroup(pid, signal, kill);
}

/**
 * Whether process group `pid` still has a live process. A group that exists
 * but is not this user's to signal is alive all the same.
 */
function liveGroup(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * Whether the server has exited within `ms`: `exited` settled and no process
 * of its group is left. `exited` alone is the shell's exit, and a wrapper such
 * as pnpm can leave while the server under it is still writing; waiting for
 * the whole group is what keeps anything it writes from landing after the run
 * returns. No timer is left to hold the process open.
 */
async function exitsWithin(exited, ms, groupAlive) {
  const deadline = Date.now() + ms;
  let timer;
  const late = new Promise(resolve => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    if (!(await Promise.race([exited.then(() => true), late]))) return false;
  } finally {
    clearTimeout(timer);
  }
  while (groupAlive()) {
    if (Date.now() > deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return true;
}

/**
 * A way to stop the server's process tree, which stops it once however often
 * it is called (by the run as it ends, and by an interrupt meanwhile) and
 * answers whether it exited.
 *
 * Asked to end, then forced after `graceMs`; each wait is bounded, and a
 * server still there after both is reported with its pid rather than waited
 * on for good. A kill that fails is reported, not swallowed. The platform and
 * the functions that kill and look for the group are passed in so each
 * platform's path can be tested on any machine. Windows has no process group
 * to look for: `taskkill /T` has ended the tree when it returns.
 */
export function stopperFor({
  pid,
  exited,
  log,
  platform = process.platform,
  kill = process.kill,
  run = spawnSync,
  graceMs = STOP_GRACE_MS,
  groupAlive = platform === "win32" ? () => false : () => liveGroup(pid),
}) {
  let stopping;
  const attempt = async signal => {
    const failed = signalTree(pid, signal, { platform, kill, run });
    if (failed) log(failed);
    return exitsWithin(exited, graceMs, groupAlive);
  };
  const stop = async () => {
    // taskkill already forces, so there is no harder second attempt on Windows.
    let gone = await attempt("SIGTERM");
    if (!gone && platform !== "win32") gone = await attempt("SIGKILL");
    if (!gone) {
      log(
        `The server may still be running: process ${pid} had not exited ${(2 * graceMs) / 1000}s after it was stopped.`
      );
    }
    return gone;
  };
  return () => {
    stopping ??= stop();
    return stopping;
  };
}

/** The exit status of a process ended by `signal`, as a shell reports it. */
function interruptedStatus(signal) {
  return 128 + (signal === "SIGINT" ? 2 : 15);
}

/**
 * Starts `command` as a server in a process tree of its own, so stopping it
 * stops everything it started, and answers its pid, a promise of its exit, a
 * way to stop it and a way to leave it running.
 *
 * An interrupt (Ctrl-C) or a SIGTERM while it runs stops it before this
 * process exits with the status a shell gives an interrupted command, unless
 * `keep` asked for it to outlive the run, when the way to stop it is printed
 * instead. The handlers are installed the moment it is spawned, so an
 * interrupt while it is still starting is covered too, and are removed once
 * it is stopped or released.
 */
export function startDetached({ command, cwd, env, keep, log }) {
  const [shell, ...args] = shellArgs(command);
  // A server this run stops has its errors forwarded until the stop begins,
  // and none after: its wrapper reports the intended SIGTERM as a failure.
  // One left running with `keep` writes to this terminal directly, since a
  // pipe from it would break when this process exits.
  const child = spawn(shell, args, {
    cwd,
    env,
    stdio: ["ignore", "ignore", keep ? "inherit" : "pipe"],
    // Its own process group, which the group kill stops whole; on Windows a
    // detached child would get a console window of its own instead.
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  let stopping = false;
  child.stderr?.on("data", chunk => {
    if (!stopping) process.stderr.write(chunk);
  });
  // `close`, not `exit`: it waits for every process holding the pipe too.
  const exited = new Promise(resolve => child.once("close", () => resolve()));
  const stopper = stopperFor({ pid: child.pid, exited, log });
  const stopTree = () => {
    stopping = true;
    return stopper();
  };

  const onSignal = signal => {
    unhook();
    const status = interruptedStatus(signal);
    if (keep) {
      release();
      log(
        `The server is left running. Stop it with: ${stopCommand(child.pid)}`
      );
      process.exit(status);
    }
    stopTree().finally(() => process.exit(status));
  };
  const unhook = () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const stop = () => {
    unhook();
    return stopTree();
  };
  // Left running: this process stops waiting on it, and its pid is what stops it later.
  const release = () => {
    unhook();
    child.unref();
  };
  return { pid: child.pid, exited, stop, release };
}

/** The command that stops a server left running, on this platform. */
export function stopCommand(pid) {
  return process.platform === "win32"
    ? `taskkill /pid ${pid} /T /F`
    : `kill -TERM -${pid}`;
}

/**
 * Readies the database, builds the playground for production and starts it on
 * `port`, resolving once it answers, with a way to stop it or to leave it
 * running after this process exits.
 *
 * The preparation and build run under `scripts/bounded.mjs`, as every heavy
 * command here does, so a build in another checkout is waited for rather than
 * doubled. The server then runs as a process tree of its own (see
 * `startDetached`).
 *
 * A server already answering on the port is refused rather than reused: it
 * could be another build, or this checkout's from an older commit, and
 * capturing it would show a change that is not the one under review.
 */
export async function startProductionServer({ port, keep, log }) {
  const baseURL = `http://localhost:${port}`;
  if (await answers(baseURL)) {
    throw new Error(
      `A server already answers on ${baseURL}. Pass --reuse to capture from it, or stop it first.`
    );
  }
  const env = { ...process.env, ...productionServerEnv(port) };
  log(`Building the playground for production (this takes minutes) …`);
  const chain = [...PREPARE_COMMANDS, BUILD_COMMAND].join(" && ");
  const built = spawnSync(
    process.execPath,
    ["scripts/bounded.mjs", ...shellArgs(chain)],
    { cwd: NEXTLY_ROOT, env, stdio: "inherit" }
  );
  if (built.status !== 0) {
    throw new Error(
      `The production build failed (exit ${built.status ?? built.signal}).`
    );
  }

  log(`Starting it on ${baseURL} …`);
  const server = startDetached({
    command: START_COMMAND,
    cwd: NEXTLY_ROOT,
    env,
    keep,
    log,
  });
  let gone = false;
  server.exited.then(() => {
    gone = true;
  });
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (!(await answers(baseURL))) {
    if (gone) {
      server.stop();
      throw new Error("The production server exited before it answered.");
    }
    if (Date.now() > deadline) {
      await server.stop();
      throw new Error(
        `The production server did not answer on ${baseURL} within ${START_TIMEOUT_MS / 60_000} minutes.`
      );
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return server;
}
