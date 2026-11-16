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
  sleep,
} from "./config.mjs";

export function serverEnv(log) {
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

export function run(command, env) {
  const result = spawnSync(command, {
    cwd: ROOT,
    env,
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error(`"${command}" ended with ${String(result.status)}`);
}

export async function portOpen(port) {
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
export function prepareDatabase(env) {
  for (const suffix of ["", "-shm", "-wal"])
    fs.rmSync(DB_FILE + suffix, { force: true });
  run("pnpm --filter playground exec tsx scripts/seed.ts", env);
  run("pnpm --filter playground exec nextly plugins install --all", env);
  run("pnpm --filter playground exec tsx scripts/seed-speed-fixture.ts", env);
}

export async function startServer(env) {
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
  const until = Date.now() + 120_000;
  for (;;) {
    if (server.exitCode !== null)
      throw new Error(`the server exited:\n${output.slice(-2000)}`);
    if (await portOpen(PORT)) {
      const health = await fetch(`${BASE}/api/health`).catch(() => null);
      if (health?.ok) break;
    }
    if (Date.now() > until)
      throw new Error(`the server never answered:\n${output.slice(-2000)}`);
    await sleep(250);
  }
  return {
    pid: server.pid,
    stop: async () => {
      // The whole process group: `pnpm exec` and the Next.js server under it.
      if (server.pid !== undefined) {
        try {
          process.kill(-server.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
      await sleep(1000);
    },
  };
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
