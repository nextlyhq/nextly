/**
 * The playground's production server for a visual check: readied, built and
 * started exactly as the production browser suite does it, from the steps and
 * environment `e2e/production-server.ts` names.
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
} from "../../e2e/production-server.ts";

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

/** Sends `signal` to the server's whole process group: pnpm, and the Next process under it. */
function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone is what stopping it wanted.
  }
}

/**
 * Readies the database, builds the playground for production and starts it on
 * `port`, resolving once it answers, with a way to stop it or to leave it
 * running after this process exits.
 *
 * The preparation and build run under `scripts/bounded.mjs`, as every heavy
 * command here does, so a build in another checkout is waited for rather than
 * doubled. The server then runs in a process group of its own, so stopping it
 * stops Next as well as the pnpm that started it.
 *
 * A server already answering on the port is refused rather than reused: it
 * could be another build, or this checkout's from an older commit, and
 * capturing it would show a change that is not the one under review.
 */
export async function startProductionServer({ port, log }) {
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
    ["scripts/bounded.mjs", "sh", "-c", chain],
    {
      cwd: NEXTLY_ROOT,
      env,
      stdio: "inherit",
    }
  );
  if (built.status !== 0)
    throw new Error(
      `The production build failed (exit ${built.status ?? built.signal}).`
    );

  log(`Starting it on ${baseURL} …`);
  const child = spawn("sh", ["-c", START_COMMAND], {
    cwd: NEXTLY_ROOT,
    env,
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  const exited = new Promise(resolve =>
    child.once("exit", code => resolve(code))
  );
  const stop = async () => {
    signalGroup(child, "SIGTERM");
    const timer = setTimeout(
      () => signalGroup(child, "SIGKILL"),
      STOP_GRACE_MS
    );
    await exited;
    clearTimeout(timer);
  };

  const deadline = Date.now() + START_TIMEOUT_MS;
  let gone = false;
  exited.then(() => {
    gone = true;
  });
  while (!(await answers(baseURL))) {
    if (gone)
      throw new Error("The production server exited before it answered.");
    if (Date.now() > deadline) {
      await stop();
      throw new Error(
        `The production server did not answer on ${baseURL} within ${START_TIMEOUT_MS / 60_000} minutes.`
      );
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  // Left running: the process stops waiting on it, and the group's id is what stops it later.
  const release = () => child.unref();
  return { pid: child.pid, stop, release };
}
