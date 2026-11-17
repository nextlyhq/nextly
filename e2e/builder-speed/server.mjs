/**
 * The playground server the speed check starts when it is given no
 * `--base-url`: its environment, its freshly seeded SQLite database, and the
 * statements it sends, counted by `../admin-speed/preload.mjs`.
 *
 * @module builder-speed/server
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

import {
  BASE,
  DB_FILE,
  DB_URL,
  DIST_DIR,
  PORT,
  PRELOAD,
  ROOT,
  SECRET,
  flag,
  sleep,
} from "./config.mjs";

function serverEnv(log) {
  const { NODE_ENV: _inherited, ...base } = process.env;
  return {
    ...base,
    PORT: String(PORT),
    DB_DIALECT: "sqlite",
    DATABASE_URL: DB_URL,
    NEXTLY_SECRET: SECRET,
    NEXT_PUBLIC_APP_URL: BASE,
    NEXT_DIST_DIR: DIST_DIR,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXTLY_GENERATED_FILES_WRITE: "0",
    // The playground's fixture collections and blocks, as the production
    // browser suite serves them; nothing here reads them.
    NEXTLY_E2E_STYLE_FIXTURE: "1",
    ...(log ? { NEXTLY_SPEED_STATEMENT_LOG: log } : {}),
  };
}

function run(command, env) {
  const result = spawnSync(command, {
    cwd: ROOT,
    env,
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error(`"${command}" ended with ${String(result.status)}`);
}

async function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

/**
 * A fresh database with the playground's seed, its plugins installed, and
 * the speed fixture, as a deployment migrates and seeds before it builds.
 */
function prepareDatabase(env) {
  for (const suffix of ["", "-shm", "-wal"])
    fs.rmSync(DB_FILE + suffix, { force: true });
  run("pnpm --filter playground exec tsx scripts/seed.ts", env);
  run("pnpm --filter playground exec nextly plugins install --all", env);
  run("pnpm --filter playground exec tsx scripts/seed-speed-fixture.ts", env);
}

/**
 * The server a run starts for itself: refused when its port is taken, then a
 * fresh database, the playground built when `--build` asks, and the
 * production server started, counting statements into `log` when given.
 */
export async function startOwnServer(log) {
  if (await portOpen(PORT))
    throw new Error(
      `port ${String(PORT)} is already in use; stop what listens there, set BUILDER_SPEED_PORT, or measure it with --base-url`
    );
  const env = serverEnv();
  prepareDatabase(env);
  if (flag("build")) run("pnpm --filter playground exec next build", env);
  if (log) fs.rmSync(log, { force: true });
  return startServer(serverEnv(log));
}

async function startServer(env) {
  const server = spawn(
    "pnpm",
    ["--filter", "playground", "exec", "next", "start", "-p", String(PORT)],
    {
      cwd: ROOT,
      env: {
        ...env,
        NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import ${PRELOAD}`.trim(),
      },
      detached: true,
    }
  );
  let output = "";
  server.stdout.on("data", chunk => (output += chunk));
  server.stderr.on("data", chunk => (output += chunk));
  const stop = async () => {
    // The whole process group: `pnpm exec` and the Next.js server under it.
    if (server.pid !== undefined) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
    await sleep(1000);
  };
  const until = Date.now() + 120_000;
  try {
    for (;;) {
      if (server.exitCode !== null)
        throw new Error(`the server exited:\n${output.slice(-2000)}`);
      if (await portOpen(PORT)) {
        // Each ask bounded, so a server that takes the request and never
        // answers cannot hold the start past its deadline.
        const health = await fetch(`${BASE}/api/health`, {
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(5000, until - Date.now()))
          ),
        }).catch(() => null);
        if (health?.ok) break;
      }
      if (Date.now() > until)
        throw new Error(`the server never answered:\n${output.slice(-2000)}`);
      await sleep(250);
    }
  } catch (error) {
    // A start that failed still leaves its processes running: stopped here,
    // since the caller never receives a handle to stop them with.
    await stop();
    throw error;
  }
  /**
   * Lets this process end while the server keeps running (`--keep`): the
   * child and its output pipes no longer hold the event loop open.
   */
  const release = () => {
    server.stdout.unref?.();
    server.stderr.unref?.();
    server.unref();
  };
  return { pid: server.pid, stop, release };
}

export function statementsBetween(log, from, to) {
  if (!log || !fs.existsSync(log)) return null;
  return fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(s => s.t >= from && s.t <= to).length;
}
