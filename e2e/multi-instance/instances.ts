/**
 * Two production instances of the fixture app on one database, as two
 * containers of one site would be: one build, copied, so each instance has a
 * `.next` of its own and so a cache of its own, and a write reaches the other
 * instance only through what they share.
 *
 * Every wait is bounded, and a failure names the step and carries the tail of
 * its log.
 *
 * @module multi-instance/instances
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { freePort, stop, waitFor } from "../support/playground-dev-server";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E2E = path.resolve(HERE, "..");
const ROOT = path.resolve(E2E, "..");
const FIXTURE = path.join(HERE, "fixture");
/** Each leg's copies of the fixture, its build and its logs. Ignored by git. */
const RUN = path.join(HERE, ".run");
const NEXT = path.join(E2E, "node_modules", ".bin", "next");
const NEXTLY = path.join(E2E, "node_modules", ".bin", "nextly");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

/** How long a step may take before the leg fails: a production build is the longest. */
const BUILD_MS = 8 * 60_000;
const STEP_MS = 2 * 60_000;
const START_MS = 90_000;

/** The header the fixture's write route asks for, so only the driver writes. */
export const WRITE_SECRET = "multi-instance-fixture-write";

/** One way of building the site: Cache Components on or off, Nextly's handlers or Next.js's defaults. */
export interface Leg {
  name: string;
  cacheComponents: boolean;
  sharedHandlers: boolean;
}

export interface Instance {
  name: "A" | "B";
  url: string;
  logFile: string;
  server: ChildProcess;
}

export interface Running {
  a: Instance;
  b: Instance;
  /** Every log the leg wrote, for attaching to a failed test. */
  logs: () => { name: string; path: string }[];
  /** Writes the note outside any request, through the Direct API, or straight into the table with `raw`. */
  writeOutsideRequest: (value: string, raw?: boolean) => void;
  stop: () => Promise<void>;
}

/**
 * The database the instances share, from `MULTI_INSTANCE_DATABASE_URL`, or
 * undefined when it is unset. Each leg empties it, so a database whose name
 * does not say it is a test database is refused.
 */
export function databaseUrl(): string | undefined {
  const url = process.env.MULTI_INSTANCE_DATABASE_URL;
  if (!url) return undefined;
  const name = new URL(url).pathname.slice(1);
  if (!/^nextly_(test|multi_instance)/.test(name)) {
    throw new Error(
      `MULTI_INSTANCE_DATABASE_URL names "${name}"; each leg empties it, so only a database named nextly_test* or nextly_multi_instance* is used`
    );
  }
  return url;
}

/** The last lines of a log, for an error message. */
function tail(file: string, lines = 40): string {
  try {
    return readFileSync(file, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "(no log)";
  }
}

/** Runs one step to completion, its output in `log`, failing with the log's tail. */
function run(
  what: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  log: string,
  timeout: number
): void {
  const fd = openSync(log, "w");
  try {
    const result = spawnSync(command, args, {
      cwd,
      env,
      stdio: ["ignore", fd, fd],
      timeout,
    });
    if (result.status !== 0) {
      const why = result.error
        ? result.error.message
        : `exit ${String(result.status ?? result.signal)}`;
      throw new Error(`${what} failed (${why}):\n${tail(log)}`);
    }
  } finally {
    closeSync(fd);
  }
}

/** Empties the shared database, so each leg starts from the migration alone. */
async function resetDatabase(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
}

/** Starts `next start` on a free port in `dir`, and waits for it to answer. */
async function startInstance(
  name: "A" | "B",
  dir: string,
  env: NodeJS.ProcessEnv,
  logDir: string
): Promise<Instance> {
  const port = await freePort();
  const url = `http://localhost:${port}`;
  const logFile = path.join(logDir, `instance-${name}.log`);
  const fd = openSync(logFile, "w");
  const server = spawn(NEXT, ["start", "-p", String(port)], {
    cwd: dir,
    env: { ...env, PORT: String(port), NEXT_PUBLIC_APP_URL: url },
    stdio: ["ignore", fd, fd],
    // Its own process group, so stopping it stops the server it starts.
    detached: true,
  });
  closeSync(fd);
  try {
    await waitFor(
      `instance ${name} to answer on ${url}`,
      async () => {
        if (server.exitCode !== null) {
          throw new Error(`instance ${name} exited:\n${tail(logFile)}`);
        }
        const res = await fetch(`${url}/api/ready`).catch(() => null);
        return res?.ok === true;
      },
      START_MS
    );
  } catch (error) {
    await stop(server);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${tail(logFile)}`
    );
  }
  return { name, url, logFile, server };
}

/**
 * Builds the fixture for `leg` once, on a database emptied and migrated, with
 * the note seeded as `v0`, and starts instance A on that build and instance B
 * on a copy of it.
 */
export async function startLeg(leg: Leg, url: string): Promise<Running> {
  const dir = path.join(RUN, leg.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const appA = path.join(dir, "a");
  const appB = path.join(dir, "b");
  cpSync(FIXTURE, appA, { recursive: true });
  if (leg.cacheComponents) {
    // As the caching guide tells an app to: the read function in place of the stub.
    copyFileSync(
      path.join(appA, "nextly", "cached-read.cache-components.ts"),
      path.join(appA, "nextly", "cached-read.ts")
    );
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DB_DIALECT: "postgresql",
    DATABASE_URL: url,
    // A literal test secret, so a failure never depends on which run made the database.
    NEXTLY_SECRET: "multi-instance-fixture-secret-not-a-real-deployment-key",
    FIXTURE_WRITE_SECRET: WRITE_SECRET,
    FIXTURE_CACHE_COMPONENTS: leg.cacheComponents ? "1" : "0",
    FIXTURE_SHARED_HANDLERS: leg.sharedHandlers ? "1" : "0",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXTLY_TELEMETRY_DISABLED: "1",
  };
  const log = (step: string) => path.join(dir, `${step}.log`);

  await resetDatabase(url);
  run(
    "nextly migrate",
    NEXTLY,
    ["migrate"],
    appA,
    env,
    log("migrate"),
    STEP_MS
  );
  run(
    "seeding the note",
    TSX,
    ["scripts/write-note.ts", "v0"],
    appA,
    env,
    log("seed"),
    STEP_MS
  );
  run("next build", NEXT, ["build"], appA, env, log("build"), BUILD_MS);
  // Instance B gets the build but not A's `.next/cache`, as a second container
  // of the same image starts with no cache of its own yet.
  const cacheDir = path.join(appA, ".next", "cache");
  cpSync(appA, appB, {
    recursive: true,
    filter: source => source !== cacheDir,
  });

  const a = await startInstance("A", appA, env, dir);
  let b: Instance;
  try {
    b = await startInstance("B", appB, env, dir);
  } catch (error) {
    await stop(a.server);
    throw error;
  }

  let writes = 0;
  return {
    a,
    b,
    logs: () => [
      { name: "instance-A.log", path: a.logFile },
      { name: "instance-B.log", path: b.logFile },
      { name: "build.log", path: log("build") },
      ...Array.from({ length: writes }, (_, i) => ({
        name: `write-${String(i + 1)}.log`,
        path: log(`write-${String(i + 1)}`),
      })),
    ],
    writeOutsideRequest: (value, raw = false) => {
      writes++;
      run(
        `writing ${value} outside a request`,
        TSX,
        ["scripts/write-note.ts", value, ...(raw ? ["--raw"] : [])],
        appA,
        env,
        log(`write-${String(writes)}`),
        STEP_MS
      );
    },
    stop: async () => {
      await Promise.all([stop(a.server), stop(b.server)]);
    },
  };
}
