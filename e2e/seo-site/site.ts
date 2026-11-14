/**
 * The SEO site, built and served as a deployment is: a copy of the fixture
 * with a database of its own, readied by its scripts, its plugin installed,
 * then `next build` and `next start`. The build's log and each start's log
 * are kept, so a spec can read what the build and the first start said.
 *
 * Every wait is bounded, and a failure names the step and carries the tail of
 * its log.
 *
 * @module seo-site/site
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  cpSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stop, waitFor } from "../support/playground-dev-server";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E2E = path.resolve(HERE, "..");
const ROOT = path.resolve(E2E, "..");
const FIXTURE = path.join(HERE, "fixture");
/** The run's copy of the fixture, its database, its build and its logs. Ignored by git. */
const RUN = path.join(HERE, ".run");
const APP = path.join(RUN, "app");
const NEXT = path.join(E2E, "node_modules", ".bin", "next");
const NEXTLY = path.join(E2E, "node_modules", ".bin", "nextly");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

/** How long a step may take: a production build is the longest. */
const BUILD_MS = 8 * 60_000;
const STEP_MS = 2 * 60_000;
const START_MS = 90_000;

/** The account the scripts make, which a spec signs in as. */
export const SEO_SITE_ACCOUNT = {
  email: "owner@seo-site.test",
  password: "SeoSitePassword123!",
};

/** The site's own page for a Gone answer, as `gonePage` names it. */
const GONE_PAGE = "/gone";

export interface SeoSite {
  /** Where the site is served: its production address. */
  url: string;
  /** The app's directory, where `next build` wrote `.next`. */
  app: string;
  /** Everything `next build` printed. */
  buildLog: () => string;
  /** Everything the server printed since it started. */
  serverLog: () => string;
  /**
   * Stops the server and starts it again from the same build and database,
   * with `env` over the first start's environment; an `undefined` value
   * unsets a variable.
   */
  restart: (env: Record<string, string | undefined>) => Promise<void>;
  /** Stops the server, then removes the run's copy, unless `SEO_SITE_KEEP_RUN=1`. */
  stop: () => Promise<void>;
}

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
  env: NodeJS.ProcessEnv,
  log: string,
  timeout: number
): void {
  const fd = openSync(log, "w");
  try {
    const result = spawnSync(command, args, {
      cwd: APP,
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

/** Starts `next start` on `port`, its output in `logFile`, and waits for it to answer. */
async function startServer(
  port: number,
  env: NodeJS.ProcessEnv,
  logFile: string
): Promise<ChildProcess> {
  const fd = openSync(logFile, "w");
  const server = spawn(NEXT, ["start", "-p", String(port)], {
    cwd: APP,
    env,
    stdio: ["ignore", fd, fd],
    // Its own process group, so stopping it stops the server it starts.
    detached: true,
  });
  closeSync(fd);
  try {
    await waitFor(
      `the SEO site to answer on port ${String(port)}`,
      async () => {
        // A server killed by a signal has no exit code, only its signal.
        if (server.exitCode !== null || server.signalCode !== null) {
          throw new Error(`the SEO site exited:\n${tail(logFile)}`);
        }
        const res = await fetch(`http://localhost:${String(port)}/api/ready`)
          .then(answer => answer.ok)
          .catch(() => false);
        return res;
      },
      START_MS
    );
  } catch (error) {
    await stop(server);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${tail(logFile)}`
    );
  }
  return server;
}

/**
 * Builds the SEO site on a fresh database, with `settings` saved as its SEO
 * settings before the build, and starts it on `port`.
 */
export async function startSeoSite(
  port: number,
  settings: Record<string, unknown>
): Promise<SeoSite> {
  rmSync(RUN, { recursive: true, force: true });
  cpSync(FIXTURE, APP, { recursive: true });
  mkdirSync(path.join(APP, "data"), { recursive: true });
  const url = `http://localhost:${String(port)}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DB_DIALECT: "sqlite",
    DATABASE_URL: "file:./data/seo-site.db",
    // A literal test secret, so a failure never depends on which run made the database.
    NEXTLY_SECRET: "seo-site-fixture-secret-not-a-real-deployment-key",
    NEXT_PUBLIC_APP_URL: url,
    PORT: String(port),
    SEO_SITE_EMAIL: SEO_SITE_ACCOUNT.email,
    SEO_SITE_PASSWORD: SEO_SITE_ACCOUNT.password,
    SEO_SITE_SETTINGS: JSON.stringify(settings),
    SEO_SITE_GONE_PAGE: GONE_PAGE,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXTLY_TELEMETRY_DISABLED: "1",
  };
  // The suite's own server's build directory is not this app's.
  delete env.NEXT_DIST_DIR;
  const log = (step: string) => path.join(RUN, `${step}.log`);
  const steps: Array<[string, string, string[], number]> = [
    ["content", TSX, ["scripts/setup.ts", "content"], STEP_MS],
    ["plugins-install", NEXTLY, ["plugins", "install", "--all"], STEP_MS],
    ["settings", TSX, ["scripts/setup.ts", "settings"], STEP_MS],
    ["build", NEXT, ["build"], BUILD_MS],
  ];
  try {
    for (const [name, command, args, timeout] of steps) {
      run(name, command, args, env, log(name), timeout);
    }
  } catch (error) {
    removeRun();
    throw error;
  }

  let starts = 1;
  let serverEnv = env;
  let server = await startServer(port, serverEnv, log("start-1")).catch(
    (error: unknown) => {
      removeRun();
      throw error;
    }
  );
  return {
    url,
    app: APP,
    buildLog: () => readFileSync(log("build"), "utf8"),
    serverLog: () => readFileSync(log(`start-${String(starts)}`), "utf8"),
    restart: async overrides => {
      await stop(server);
      serverEnv = { ...serverEnv };
      for (const [name, value] of Object.entries(overrides)) {
        if (value === undefined) delete serverEnv[name];
        else serverEnv[name] = value;
      }
      starts++;
      server = await startServer(
        port,
        serverEnv,
        log(`start-${String(starts)}`)
      );
    },
    stop: async () => {
      await stop(server);
      removeRun();
    },
  };
}

/** Removes the run's copy, which holds a build, unless `SEO_SITE_KEEP_RUN=1`. */
function removeRun(): void {
  if (process.env.SEO_SITE_KEEP_RUN === "1") return;
  rmSync(RUN, { recursive: true, force: true });
}
