/**
 * How many workers the integration suite runs on, and the guard that no two of
 * them ever share a database.
 *
 * A worker's database is keyed by its `VITEST_POOL_ID` (1 to `maxWorkers`): on
 * SQLite it is the worker process's own in-memory database, and a per-worker
 * server database is named after the id. So two live workers holding one id
 * would share a database, and files running at the same moment would drop and
 * recreate each other's tables. Each test file claims its worker's id, in a
 * directory the run creates, for as long as its tests run; a second file
 * claiming the same id while the first still holds it fails the run rather
 * than letting the two collide in silence.
 *
 * The default export is the run's global setup: it creates that directory and
 * removes it at the end.
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

/** The directory the run's workers claim their ids in, handed to them through the environment. */
export const CLAIMS_ENV = "NEXTLY_INTEGRATION_WORKER_CLAIMS";

/** How many workers to run the integration files on; one unless asked. */
export const WORKERS_ENV = "NEXTLY_INTEGRATION_WORKERS";

/**
 * The worker count a run asked for, refused when more than one would share a
 * database: a PostgreSQL or MySQL URL names one database every worker would
 * connect to, a SQLite URL names one file, and the older TEST_DATABASE_URL is
 * still read as a PostgreSQL URL by some suites. Without one, SQLite runs in
 * memory in each worker process.
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
  const shared = [
    "TEST_POSTGRES_URL",
    "TEST_MYSQL_URL",
    "TEST_SQLITE_URL",
    "TEST_DATABASE_URL",
  ].filter(name => env[name]);
  if (shared.length > 0) {
    throw new Error(
      `${WORKERS_ENV}=${workers} would put every worker on the one database ${shared.join(" and ")} names. ` +
        `Run more than one worker only on in-memory SQLite (no TEST_*_URL set) until each worker gets a database of its own.`
    );
  }
  return workers;
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

/** The run's global setup: the claims directory, removed when the run ends. */
export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "nextly-integration-workers-"));
  process.env[CLAIMS_ENV] = dir;
  return () => {
    const log = join(dir, CLAIMS_LOG);
    console.log(
      describeClaims(
        existsSync(log) ? readFileSync(log, "utf8") : "",
        integrationWorkers(process.env)
      )
    );
    rmSync(dir, { recursive: true, force: true });
  };
}
