/**
 * How many workers the integration suite runs on, and the guard that no two of
 * them ever share a database.
 *
 * A worker's database is keyed by its `VITEST_POOL_ID` (1 to `maxWorkers`): on
 * SQLite it is the worker process's own in-memory database, and on PostgreSQL
 * or MySQL it is `<database>_pool<id>`, beside the database `TEST_POSTGRES_URL`
 * or `TEST_MYSQL_URL` names, which the run's global setup creates and drops. So two live workers holding one id
 * would share a database, and files running at the same moment would drop and
 * recreate each other's tables. Each test file claims its worker's id, in a
 * directory the run creates, for as long as its tests run; a second file
 * claiming the same id while the first still holds it fails the run rather
 * than letting the two collide in silence.
 *
 * The default export is the run's global setup: it creates that directory and
 * the per-worker server databases, and removes both at the end.
 */
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../database/test-database-ddl";

/** The directory the run's workers claim their ids in, handed to them through the environment. */
export const CLAIMS_ENV = "NEXTLY_INTEGRATION_WORKER_CLAIMS";

/** How many workers to run the integration files on; one unless asked. */
export const WORKERS_ENV = "NEXTLY_INTEGRATION_WORKERS";

/**
 * The server dialects whose workers each get a database of their own: the
 * variable naming the run's database, and the one the global setup keeps that
 * URL in, so each test file derives its worker's URL from the URL the run was
 * given rather than from one it already rewrote.
 */
export const SERVER_DIALECTS = [
  {
    dialect: "postgresql",
    urlEnv: "TEST_POSTGRES_URL",
    baseEnv: "NEXTLY_INTEGRATION_POSTGRES_URL",
  },
  {
    dialect: "mysql",
    urlEnv: "TEST_MYSQL_URL",
    baseEnv: "NEXTLY_INTEGRATION_MYSQL_URL",
  },
] as const;

type ServerDialect = (typeof SERVER_DIALECTS)[number];

/**
 * The worker count a run asked for, refused when more than one would share a
 * database: a SQLite URL names one file, and the older TEST_DATABASE_URL is
 * still read as a PostgreSQL URL by some suites. Without one, SQLite runs in
 * memory in each worker process; with `TEST_POSTGRES_URL` or `TEST_MYSQL_URL`,
 * each worker gets a database of its own on that server (`workerDatabaseUrl`).
 */
export function integrationWorkers(
  env: Readonly<Record<string, string | undefined>>
): number {
  const asked = env[WORKERS_ENV];
  if (asked === undefined || asked === "") return 1;
  const workers = Number(asked);
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(
      `${WORKERS_ENV} must be a whole number of at least 1, not "${asked}".`
    );
  }
  if (workers === 1) return 1;
  const shared = ["TEST_SQLITE_URL", "TEST_DATABASE_URL"].filter(
    name => env[name]
  );
  if (shared.length > 0) {
    throw new Error(
      `${WORKERS_ENV}=${workers} would put every worker on the one database ${shared.join(" and ")} names. ` +
        `Run more than one worker only on in-memory SQLite, TEST_POSTGRES_URL or TEST_MYSQL_URL, where each worker gets a database of its own.`
    );
  }
  return workers;
}

/**
 * A worker's pool id as a number, refused outside 1 to `workers`: the run's
 * global setup made a database for each of those ids and no other, so a
 * worker beyond them (a `--maxWorkers` above the asked-for count) has none.
 */
export function workerPoolId(
  poolId: string | undefined,
  workers: number
): number {
  const id = Number(poolId);
  if (!Number.isInteger(id) || id < 1 || id > workers) {
    throw new Error(
      `VITEST_POOL_ID ${poolId ?? "(unset)"} has no database of its own: ${WORKERS_ENV}=${workers} made one for each of ids 1 to ${workers}. ` +
        `Run Vitest with no more workers than ${WORKERS_ENV} asks for.`
    );
  }
  return id;
}

/** The PostgreSQL database a worker uses: the run's own, suffixed with its pool id. */
export function workerDatabaseName(base: string, poolId: number): string {
  return `${base}_pool${poolId}`;
}

/** `url` pointed at the worker's database on the same server. */
export function workerDatabaseUrl(url: string, poolId: number): string {
  const parsed = new URL(url);
  parsed.pathname = `/${workerDatabaseName(baseDatabase(parsed), poolId)}`;
  return parsed.toString();
}

/**
 * Point a test file's server URLs at its worker's databases, for each dialect
 * whose databases the run's global setup made. Every suite reads
 * TEST_POSTGRES_URL and TEST_MYSQL_URL, so this moves them all; a run with one
 * worker, or a unit run, has no kept URL and is left as it is.
 */
export function pointAtWorkerDatabases(
  env: Record<string, string | undefined>
): void {
  const made = SERVER_DIALECTS.filter(server => env[server.baseEnv]);
  if (made.length === 0) return;
  const poolId = workerPoolId(env.VITEST_POOL_ID, integrationWorkers(env));
  for (const server of made) {
    env[server.urlEnv] = workerDatabaseUrl(
      env[server.baseEnv] as string,
      poolId
    );
  }
}

function baseDatabase(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

/**
 * Create a fresh database for each of `workers` pool ids beside the one `url`
 * names, dropping any a stopped run left behind, and answer how to drop them.
 * The names go through the test-database DDL helpers, which refuse anything
 * but a plain lowercase identifier.
 */
interface AdminConnection {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

/** One connection to the server `url` names, for creating and dropping databases. */
async function openAdmin(
  dialect: ServerDialect["dialect"],
  url: string
): Promise<AdminConnection> {
  if (dialect === "postgresql") {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 1 });
    return { query: sql => pool.query(sql), end: () => pool.end() };
  }
  const { createConnection } = await import("mysql2/promise");
  const connection = await createConnection({ uri: url });
  // MySQL's metadata-lock wait defaults to a year, so a drop behind a session
  // still holding a lock would hang the run's end rather than fail and report.
  await connection.query("SET SESSION lock_wait_timeout = 10");
  return { query: sql => connection.query(sql), end: () => connection.end() };
}

async function createWorkerDatabases(
  dialect: ServerDialect["dialect"],
  url: string,
  workers: number
): Promise<() => Promise<void>> {
  const base = baseDatabase(new URL(url));
  const names = Array.from({ length: workers }, (_, i) =>
    workerDatabaseName(base, i + 1)
  );
  const admin = await openAdmin(dialect, url);
  try {
    for (const name of names) {
      await admin.query(dropDatabaseStatement(dialect, name));
      await admin.query(createDatabaseStatement(dialect, name));
    }
  } catch (error) {
    await admin.end();
    throw error;
  }
  // A worker's connection can outlive its process by a moment, and a database
  // with a session attached cannot be dropped. A drop that fails here is only
  // reported: the next run drops what this one left before creating its own.
  return async () => {
    for (const name of names) {
      await admin
        .query(dropDatabaseStatement(dialect, name))
        .catch((error: unknown) =>
          console.warn(
            `[integration workers] could not drop ${name}: ${String(error)}`
          )
        );
    }
    await admin.end();
  };
}

/** Whether a process is running, by the signal-0 probe. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists and belongs to someone else, which still means running.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Claim a worker's pool id for this process, or fail when another live process
 * holds it. A claim left by a process that has ended without giving it back (a
 * crashed file) is taken over.
 */
export function claimWorker(
  dir: string,
  poolId: string,
  pid: number = process.pid,
  running: (pid: number) => boolean = isRunning
): void {
  const claim = join(dir, `pool-${poolId}`);
  try {
    writeFileSync(claim, String(pid), { flag: "wx" });
    recordClaim(dir, poolId, pid);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const holder = Number(readFileSync(claim, "utf8"));
  if (holder === pid) return;
  if (running(holder)) {
    throw new Error(
      `Integration workers ${holder} and ${pid} both have VITEST_POOL_ID ${poolId}, so they would share its database. ` +
        `Key each worker's database by process id as well as pool id.`
    );
  }
  writeFileSync(claim, String(pid));
  recordClaim(dir, poolId, pid);
}

/** Every claim the run made, one line each, for the run's end to report what it saw. */
const CLAIMS_LOG = "claims.log";

function recordClaim(dir: string, poolId: string, pid: number): void {
  // One short line per append, so claims from parallel workers never interleave.
  appendFileSync(join(dir, CLAIMS_LOG), `${poolId} ${pid}\n`);
}

/**
 * What a run's claims show: how many files each pool id ran, and in how many
 * processes. Printed at the run's end, so a log shows how many workers the
 * files really ran on rather than how many were asked for.
 */
export function describeClaims(log: string, asked: number): string {
  const byPool = new Map<string, { files: number; pids: Set<string> }>();
  for (const line of log.split("\n").filter(Boolean)) {
    const [poolId, pid] = line.split(" ");
    const entry = byPool.get(poolId) ?? { files: 0, pids: new Set<string>() };
    entry.files += 1;
    entry.pids.add(pid);
    byPool.set(poolId, entry);
  }
  const pools = [...byPool].sort(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  const each = pools.map(
    ([poolId, { files, pids }]) =>
      `pool ${poolId}: ${files} file(s) in ${pids.size} process(es)`
  );
  return (
    `[integration workers] ${WORKERS_ENV}=${asked}; files ran on ${pools.length} worker(s), each on its own database: ` +
    (each.join("; ") || "no file claimed a worker")
  );
}

/**
 * Give a worker's pool id back when a file's tests end. Vitest may start the
 * slot's next process while this one is still exiting, so the claim cannot
 * wait for the exit. Only the holder's own claim is removed.
 */
export function releaseWorker(
  dir: string,
  poolId: string,
  pid: number = process.pid
): void {
  const claim = join(dir, `pool-${poolId}`);
  try {
    if (Number(readFileSync(claim, "utf8")) === pid) unlinkSync(claim);
  } catch (error) {
    // Already gone: the run's teardown removed the directory first.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * With more than one worker, a database per worker on each server `env` names,
 * keeping each server's URL as the base the workers derive theirs from.
 * Answers how to drop them all. When a later server fails, the earlier ones'
 * databases are dropped before the error goes on: a setup that throws returns
 * no teardown, so nothing else would drop them or close their connections.
 */
export async function provisionServers(
  env: Record<string, string | undefined>,
  workers: number,
  create: typeof createWorkerDatabases = createWorkerDatabases
): Promise<(() => Promise<void>)[]> {
  const drops: (() => Promise<void>)[] = [];
  try {
    for (const server of SERVER_DIALECTS) {
      const url = env[server.urlEnv];
      if (workers > 1 && url) {
        drops.push(await create(server.dialect, url, workers));
        env[server.baseEnv] = url;
      }
    }
  } catch (error) {
    for (const drop of drops) await drop();
    throw error;
  }
  return drops;
}

/**
 * The run's global setup: the claims directory and, on PostgreSQL or MySQL
 * with more than one worker, a database per worker on each server the run
 * names. Both are removed when the run ends.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const workers = integrationWorkers(process.env);
  const dir = mkdtempSync(join(tmpdir(), "nextly-integration-workers-"));
  process.env[CLAIMS_ENV] = dir;
  let drops: (() => Promise<void>)[];
  try {
    drops = await provisionServers(process.env, workers);
  } catch (error) {
    // No teardown runs after a failed setup, so the claims directory goes here.
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return async () => {
    const log = join(dir, CLAIMS_LOG);
    console.log(
      describeClaims(existsSync(log) ? readFileSync(log, "utf8") : "", workers)
    );
    rmSync(dir, { recursive: true, force: true });
    for (const drop of drops) await drop();
  };
}
