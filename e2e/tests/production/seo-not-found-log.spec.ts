import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

import { test } from "../support/visible";
import { CACHE_COMPONENTS } from "../support/cache-components";
import { answeredNotFound } from "../support/not-found";

import {
  pnpmInvocation,
  treeKillCommand,
} from "../../../scripts/pnpm-invocation.mjs";
import {
  NEXTLY_ROOT,
  PORT,
  productionServerEnv,
} from "../../production-server.mjs";
import { PLAYGROUND, stop, waitFor } from "../../support/playground-dev-server";

/**
 * The SEO plugin's log of addresses not found, on a production build, counts
 * the requests a route answered not found and nothing else: a page that is
 * found is never logged, whether visited, navigated to or prefetched; a
 * missing address the page builder's content route answers is logged once,
 * though its page and its head both answer it; a miss Nextly's own content
 * route decides (`/preview/blocks`) is logged once; a public route's miss is
 * logged where it is answered per request and never turns into an error
 * where it is not; and a prefetch of a missing address is never logged.
 *
 * Next.js renders the root `not-found` page's element on every request, so a
 * log written from it counts every page view. The playground hands its
 * content routes `notFoundLogged` instead, and this is what proves the
 * difference on the build a visitor is served.
 *
 * The build under test's own: a second `next start` from the same build, with
 * the SEO plugin switched on over a database of its own, so the suite's main
 * server and its database are left as they are.
 *
 * @module tests/production/seo-not-found-log
 */

// Inside the block of ports a worktree's slot owns, beside the component-map
// spec's server (`PORT + 7`).
const SEO_PORT = PORT + 6;
const SEO_URL = `http://localhost:${SEO_PORT}`;
const SEO_API = `${SEO_URL}/admin/api/plugins/@nextlyhq/plugin-seo`;
const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

/** This spec's database, by exact name, and the two files SQLite keeps beside it. */
const DB_NAME = "e2e-prod-seo.db";
const DB_FILES = [DB_NAME, `${DB_NAME}-shm`, `${DB_NAME}-wal`];
const removeDatabase = () => {
  for (const name of DB_FILES) {
    rmSync(join(PLAYGROUND, "data", name), { force: true });
  }
};

/** A tag of this run's own, so addresses from an earlier run never count. */
const run = Date.now().toString(36);

let server: ChildProcess | undefined;
let logDir: string | undefined;
let logFile = "";
let admin: APIRequestContext | undefined;

const env = {
  ...process.env,
  ...productionServerEnv(SEO_PORT),
  DATABASE_URL: `file:./data/${DB_NAME}`,
  NEXTLY_PLAYGROUND_PLUGINS: "seo",
};

/** Runs `pnpm <args>` from the repository root, failing with its output. */
function pnpm(args: string[]): void {
  const invocation = pnpmInvocation(args, process.platform, env);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: NEXTLY_ROOT,
    env,
    encoding: "utf8",
    shell: invocation.shell,
  });
  if (result.status !== 0) {
    throw new Error(
      `pnpm ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`
    );
  }
}

test.beforeAll(async () => {
  test.setTimeout(5 * 60 * 1000);
  removeDatabase();
  // Seeded and installed as the suite's own database is, with the SEO plugin
  // configured: a production boot refuses a configured plugin no install has
  // recorded.
  pnpm(["--filter", "playground", "exec", "tsx", "scripts/seed.ts"]);
  pnpm([
    "--filter",
    "playground",
    "exec",
    "nextly",
    "plugins",
    "install",
    "--all",
  ]);
  const starting = pnpmInvocation(
    ["--filter", "playground", "exec", "next", "start"],
    process.platform,
    env
  );
  logDir = mkdtempSync(join(tmpdir(), "nextly-seo-not-found-prod-"));
  logFile = join(logDir, "server.log");
  const log = openSync(logFile, "a");
  try {
    server = spawn(starting.command, starting.args, {
      cwd: NEXTLY_ROOT,
      env,
      stdio: ["ignore", log, log],
      shell: starting.shell,
      // Its own process group on POSIX, so `stop` ends pnpm and `next start`
      // together.
      detached: process.platform !== "win32",
    });
  } finally {
    closeSync(log);
  }
  await waitFor(
    `the SEO server to answer, its log:\n${logFile}`,
    async () =>
      (await fetch(`${SEO_URL}/api/health`).catch(() => null))?.ok ?? false,
    120_000
  ).catch((error: unknown) => {
    throw new Error(`${String(error)}\n${readFileSync(logFile, "utf8")}`);
  });

  // The log is read as the admin reads it, signed in as the seeded user.
  admin = await playwrightRequest.newContext({ baseURL: SEO_URL });
  const csrf = (await (await admin.get("/admin/api/auth/csrf")).json()) as {
    token: string;
  };
  const login = await admin.post("/admin/api/auth/login", {
    headers: { Origin: SEO_URL },
    data: { ...DEV_USER, csrfToken: csrf.token },
  });
  expect(login.status(), await login.text()).toBe(200);
});

test.afterAll(async () => {
  await admin?.dispose();
  if (server?.pid !== undefined) {
    const treeKill = treeKillCommand(server.pid, process.platform);
    if (treeKill === null) await stop(server);
    else spawnSync(treeKill.command, treeKill.args, { stdio: "ignore" });
  }
  if (logDir !== undefined) rmSync(logDir, { recursive: true, force: true });
  removeDatabase();
});

interface Logged {
  path: string;
  hits: number;
}

/** The log as the Not found tab reads it. */
async function logged(): Promise<Logged[]> {
  if (admin === undefined) throw new Error("not signed in");
  const response = await admin.get(`${SEO_API}/not-found`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { items: Logged[] }).items;
}

/** The logged row for `path`, as visitors open it (any language prefix). */
async function rowFor(path: string): Promise<Logged | undefined> {
  return (await logged()).find(row => row.path.endsWith(path));
}

/**
 * Asks for a missing address of its own and waits for it to be logged: the
 * log is written after each response, so once this one is there, what the
 * requests before it would have written is there too.
 */
async function settle(request: APIRequestContext, tag: string): Promise<void> {
  const marker = `/seo-settle-${tag}-${run}`;
  await request.get(`${SEO_URL}${marker}`);
  await expect.poll(() => rowFor(marker), { timeout: 20_000 }).toBeDefined();
}

/** Asks for `path` as a visitor's browser does, and answers how it was answered. */
async function visit(request: APIRequestContext, path: string) {
  const response = await request.get(`${SEO_URL}${path}`, {
    headers: { cookie: "" },
  });
  return { status: response.status(), html: await response.text() };
}

test.describe("the SEO plugin's log of addresses not found, on a production build", () => {
  test("never logs a page that is found, visited, navigated to or prefetched", async ({
    request,
  }) => {
    for (const path of ["/", "/welcome", "/site/welcome"]) {
      expect((await visit(request, path)).status, path).toBe(200);
    }
    // A client-side navigation and a prefetch of a page that exists, which
    // Next.js answers as it chooses: only what they log is read.
    const asked: Array<Record<string, string>> = [
      { RSC: "1" },
      { RSC: "1", "Next-Router-Prefetch": "1" },
    ];
    for (const headers of asked) {
      await request.get(`${SEO_URL}/welcome`, { headers });
    }
    await settle(request, "found");
    const paths = (await logged()).map(row => row.path);
    for (const path of ["/welcome", "/site/welcome"]) {
      expect(
        paths.filter(each => each.endsWith(path)),
        path
      ).toEqual([]);
    }
    expect(
      paths.filter(each => each === "/" || /^\/[a-z]{2}$/.test(each))
    ).toEqual([]);
  });

  test("logs a missing address once, though its page and its head both answer it", async ({
    request,
  }) => {
    const missing = `/seo-missing-${run}`;
    expect(answeredNotFound(await visit(request, missing))).toBe(true);
    await expect.poll(() => rowFor(missing), { timeout: 20_000 }).toBeDefined();
    await settle(request, "missing");
    expect((await rowFor(missing))?.hits).toBe(1);
  });

  test("logs a miss a route's own notFound decides once", async ({
    request,
  }) => {
    // Nextly's own content route under `createBlocksPage`, read per request.
    const missing = `/preview/blocks/seo-route-missing-${run}`;
    expect(answeredNotFound(await visit(request, missing))).toBe(true);
    await expect.poll(() => rowFor(missing), { timeout: 20_000 }).toBeDefined();
    await settle(request, "route");
    expect((await rowFor(missing))?.hits).toBe(1);
  });

  test("answers a public route's miss not found, logged only where it is answered per request", async ({
    request,
  }) => {
    // `/blocks` is public: under Cache Components its miss is answered per
    // request and logged; without them the answer is rendered once and
    // kept, so it is answered by Next's notFound() and never a 500.
    const missing = `/blocks/seo-public-missing-${run}`;
    expect(answeredNotFound(await visit(request, missing))).toBe(true);
    await settle(request, "public");
    expect((await rowFor(missing))?.hits).toBe(
      CACHE_COMPONENTS ? 1 : undefined
    );
  });

  test("never logs a prefetch of a missing address", async ({ request }) => {
    const missing = `/seo-prefetched-${run}`;
    await request.get(`${SEO_URL}${missing}`, {
      headers: { RSC: "1", "Next-Router-Prefetch": "1" },
    });
    await settle(request, "prefetch");
    expect(await rowFor(missing)).toBeUndefined();
  });
});
