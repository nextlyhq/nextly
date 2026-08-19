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
import { pnpmInvocation, treeKillCommand } from "./pnpm-invocation.mjs";

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
  const code = await runPnpm(dockerArgs, NEXTLY_ROOT);
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

  /*
   * Build the workspace before starting, every time.
   *
   * This used to run only when the doctor reported missing artifacts, and that
   * gate could not see the case it most needed to: the doctor checks ONE
   * sentinel directory — `packages/nextly/dist` — for being non-empty. A
   * `packages/builder/dist` that is stale, partial or absent entirely leaves
   * that sentinel untouched, so the build was skipped and `next dev` started
   * against whatever happened to be on disk.
   *
   * The failure that produces does not look like a missing build. The page
   * builder's stylesheet `@import`s `@nextlyhq/builder/styles.css`, which
   * resolves through that package's export map into `dist`; when the file is
   * not there the import throws a CssSyntaxError naming
   * `plugin-page-builder/dist/styles/editor.css`, and the WHOLE ADMIN renders
   * blank. Two sessions lost time to it in one day, neither of them looking at
   * the package that was actually unbuilt.
   *
   * Running unconditionally replaces a proxy — does one directory exist — with
   * the question that matters: is every package's output current for its
   * inputs. Turbo already answers that by hashing, so a workspace that is
   * already built costs a cache lookup: measured at ~430ms with 19 of 19 tasks
   * cached, against a blank admin whose error names the wrong package.
   */
  console.log("[nextly] Building workspace packages (cached when current)...");
  const buildExit = await runPnpm(
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
  // Re-run the checks against what the build produced, so anything downstream
  // of the artifacts is judged on the current ones.
  ({ ok, results } = await runAllChecks({
    nextlyRoot: NEXTLY_ROOT,
    envPath,
    port,
  }));

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
    const seedExitCode = await runPnpm(
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
  //
  // What the handler can REACH matters as much as when it is armed. On
  // Windows `child` is the cmd.exe that pnpmInvocation asks for, so killing
  // the handle would stop the shell and leave `next dev` running on the
  // port; treeKillCommand supplies the tree kill that reaches it, and
  // returns null on POSIX, where the handle is pnpm itself and the signal
  // is real. If the tree kill cannot run, fall back rather than hang.
  let child = null;
  const forward = sig => () => {
    if (!child) {
      process.exit(0);
      return;
    }
    const treeKill = treeKillCommand(child.pid);
    if (!treeKill) {
      child.kill(sig);
      return;
    }
    const killer = spawn(treeKill.command, treeKill.args, { stdio: "ignore" });
    killer.on("error", () => child.kill(sig));
    killer.on("exit", code => {
      if (code !== 0) child.kill(sig);
    });
  };
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));

  // Spawn `next dev` from the playground directory. Inherit stdio so
  // Next.js logs flow through unmodified.
  const dev = pnpmInvocation(["next", "dev"], process.platform, childEnv);
  child = spawn(dev.command, dev.args, {
    cwd: PLAYGROUND_DIR,
    stdio: "inherit",
    env: childEnv,
    shell: dev.shell,
  });

  child.on("exit", code => process.exit(code ?? 0));
}

// Helper: run a one-shot pnpm sub-command, inherit stdio, resolve to its exit
// code (number; never rejects on exit-non-zero so callers can decide
// whether to bail). Routes through pnpmInvocation so Windows gets the shell
// it needs and the quoting that shell then requires.
function runPnpm(args, cwd, env) {
  return new Promise(resolve => {
    // One env object for both, because pnpmInvocation checks the arguments
    // against the environment cmd.exe will actually expand against, and a
    // check run against a different one is no check.
    const childEnv = env ?? { ...process.env };
    const {
      command,
      args: argv,
      shell,
    } = pnpmInvocation(args, process.platform, childEnv);
    const proc = spawn(command, argv, {
      cwd,
      stdio: "inherit",
      env: childEnv,
      shell,
    });
    proc.on("exit", code => resolve(code ?? 0));
  });
}

main().catch(err => {
  console.error("[nextly] wrapper crashed:", err);
  process.exit(1);
});
