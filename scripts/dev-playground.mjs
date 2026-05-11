// Wrapper for `pnpm dev:app`. Runs doctor checks, optional auto-seed,
// then spawns `next dev` as a child process. Stays JS (.mjs) and
// dependency-free so the boot path doesn't have any failure modes
// of its own.

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { Socket } from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { runAllChecks } from "./dev-doctor.mjs";

// Minimal .env parser. Just enough for `KEY=value` and `KEY="quoted"`
// shapes; comments and empty lines are skipped. Stays dependency-free
// so the wrapper has zero install-time failure surface. Next.js loads
// .env itself for `next dev`, but we need the same vars in our seed
// sub-process which Next.js never sees.
async function loadEnvFile(envPath) {
  let raw;
  try {
    raw = await fs.readFile(envPath, "utf-8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NEXTLY_ROOT = path.resolve(HERE, "..");
const PLAYGROUND_DIR = path.join(NEXTLY_ROOT, "apps", "playground");

// Connection defaults from docker-compose.yml. Used by `pnpm dev:postgres`
// and `pnpm dev:mysql` so contributors don't have to remember the exact
// URL shape. Override either by exporting DATABASE_URL before invoking
// the script.
const POSTGRES_DEFAULT_URL =
  "postgres://postgres:dev_password_change_in_production@localhost:5432/nextly_dev";
const MYSQL_DEFAULT_URL = "mysql://root:dev_password@localhost:3306/nextly_dev";

// Quick TCP probe with a tight timeout. Returns true if a connection
// can be established, false on connect-refused / timeout / error.
function tcpReachable(host, port, timeoutMs = 800) {
  return new Promise(resolve => {
    const sock = new Socket();
    const finish = ok => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    sock.connect(port, host);
  });
}

async function ensureDbReachable(name, host, port, dockerArgs, waitSeconds) {
  if (await tcpReachable(host, port)) {
    console.log(
      `[nextly] ${name} reachable on ${host}:${port} (skipping docker)`
    );
    return;
  }
  console.log(`[nextly] Starting ${name} via docker compose...`);
  const code = await runChild("pnpm", dockerArgs, NEXTLY_ROOT);
  if (code !== 0) {
    console.error(
      `[nextly] ✗ docker:up exited ${code} while bringing up ${name}.`
    );
    process.exit(1);
  }
  for (let i = 0; i < waitSeconds; i++) {
    if (await tcpReachable(host, port)) return;
    await new Promise(r => setTimeout(r, 1000));
  }
  console.error(
    `[nextly] ✗ ${name} did not become reachable on ${host}:${port} ` +
      `within ${waitSeconds}s after docker:up.`
  );
  console.error(
    `         Try: pnpm docker:logs   (or docker compose logs ${name.toLowerCase()})`
  );
  process.exit(1);
}

// Apply dialect overrides BEFORE pre-flight runs. `pnpm dev:postgres`
// and `pnpm dev:mysql` set NEXTLY_DEV_DIALECT before invoking us so we
// can inject DB_DIALECT and DATABASE_URL without modifying .env.
async function applyDialectOverride() {
  const dialect = process.env.NEXTLY_DEV_DIALECT;
  if (!dialect) return;

  if (dialect === "postgres" || dialect === "postgresql") {
    process.env.DB_DIALECT = "postgresql";
    process.env.DATABASE_URL ??= POSTGRES_DEFAULT_URL;
    await ensureDbReachable(
      "Postgres",
      "localhost",
      5432,
      ["docker:up"],
      15
    );
  } else if (dialect === "mysql") {
    process.env.DB_DIALECT = "mysql";
    process.env.DATABASE_URL ??= MYSQL_DEFAULT_URL;
    // MySQL is behind the `mysql` compose profile, so it doesn't come
    // up with a plain `pnpm docker:up`. Pass the profile flag through.
    await ensureDbReachable(
      "MySQL",
      "localhost",
      3306,
      ["docker:up", "--", "--profile", "mysql"],
      30
    );
  } else {
    console.error(
      `[nextly] ✗ Unknown NEXTLY_DEV_DIALECT="${dialect}". ` +
        `Expected "postgres" or "mysql".`
    );
    process.exit(1);
  }
}

async function main() {
  const port = Number(process.env.PORT) || 3000;
  const envPath = path.join(PLAYGROUND_DIR, ".env");

  await applyDialectOverride();

  console.log("[nextly] Pre-flight checks...");
  let { ok, results } = await runAllChecks({
    nextlyRoot: NEXTLY_ROOT,
    envPath,
    port,
  });

  // Surface auto-fixed steps so the contributor knows what changed.
  if (results.envFile?.autoCreated) {
    console.log(
      `[nextly] ℹ auto-created .env from ${path.basename(results.envFile.copiedFrom)} ` +
        `(safe defaults: SQLite, dev secrets). Edit ${envPath} to customize.`
    );
  }

  // Auto-build workspace packages if the doctor flagged missing dist.
  // The seed sub-process (and the runtime itself) imports compiled dist
  // artifacts, so a fresh clone without `pnpm build` crashes seed and
  // produces HTTP 500s in /admin. Turbo's cache makes this a no-op on
  // subsequent runs once dist exists, so the cost is paid once.
  if (!results.buildArtifacts.ok) {
    console.log(
      "[nextly] First boot detected (no built dist outputs). " +
        "Running `pnpm turbo build --filter='./packages/*'`..."
    );
    const buildExit = await runChild(
      "pnpm",
      ["turbo", "build", "--filter=./packages/*"],
      NEXTLY_ROOT
    );
    if (buildExit !== 0) {
      console.error(
        `[nextly] ✗ build exited ${buildExit}. ` +
          `Aborting — fix the build first, then re-run \`pnpm dev:app\`.`
      );
      process.exit(buildExit);
    }
    // Re-run doctor to refresh the buildArtifacts result.
    ({ ok, results } = await runAllChecks({
      nextlyRoot: NEXTLY_ROOT,
      envPath,
      port,
    }));
  }

  if (!ok) {
    for (const [name, r] of Object.entries(results)) {
      if (!r.ok) {
        console.error(`[nextly] ✗ ${name}: ${r.reason}`);
        console.error(`         ${r.fix.replace(/\n/g, "\n         ")}`);
      }
    }
    process.exit(1);
  }
  console.log("[nextly] ✓ all checks passed");

  // Load .env into a merged env object that we pass explicitly to
  // children. `next dev` loads .env on its own and ignores ours - but
  // our seed sub-process doesn't have that lifting, so we do it here.
  const fileEnv = await loadEnvFile(envPath);
  const childEnv = { ...fileEnv, ...process.env };

  // Auto-seed step. Set NEXTLY_SKIP_SEED=1 to opt out (e.g. for CI
  // benchmarks or when intentionally testing a clean DB). seedIfEmpty
  // skips fast (one users.find call) when content already exists, so
  // the steady-state cost is negligible.
  if (process.env.NEXTLY_SKIP_SEED !== "1") {
    console.log("[nextly] Auto-seeding empty playground...");
    const seedExitCode = await runChild(
      "pnpm",
      ["tsx", path.join(PLAYGROUND_DIR, "scripts/seed.ts")],
      PLAYGROUND_DIR,
      childEnv
    );
    if (seedExitCode !== 0) {
      console.error(
        `[nextly] ✗ seed exited ${seedExitCode}. ` +
          `Continuing to start next dev anyway; data may be incomplete.`
      );
    }
  }

  // Register signal handlers BEFORE spawn so a Ctrl-C arriving between
  // spawn-issued and the listener-attached path doesn't bypass the
  // forwarding. The handlers null-check `child` so an early SIGINT
  // (before the spawn returns) just exits cleanly.
  let child = null;
  const forward = sig => () => {
    if (child) child.kill(sig);
    else process.exit(0);
  };
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));

  // Spawn `next dev` from the playground directory. Inherit stdio so
  // Next.js logs flow through unmodified.
  child = spawn("pnpm", ["next", "dev"], {
    cwd: PLAYGROUND_DIR,
    stdio: "inherit",
    env: childEnv,
  });

  child.on("exit", code => process.exit(code ?? 0));
}

// Helper: spawn a one-shot child, inherit stdio, resolve to its exit
// code (number; never rejects on exit-non-zero so callers can decide
// whether to bail).
function runChild(cmd, args, cwd, env) {
  return new Promise(resolve => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: env ?? { ...process.env },
    });
    proc.on("exit", code => resolve(code ?? 0));
  });
}

main().catch(err => {
  console.error("[nextly] wrapper crashed:", err);
  process.exit(1);
});
