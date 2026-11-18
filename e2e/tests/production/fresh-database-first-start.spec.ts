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

import { expect } from "@playwright/test";

import { test } from "../support/visible";

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
 * A site's first start over a database that has been seeded and had its
 * plugins installed, but never served, answers its public pages with 200 and
 * their content in the first HTML.
 *
 * That is a fresh deploy: the build was made against another database, so
 * the seed's writes come after it and expire every page the build stored.
 * Each page is then drawn again on its first visit. With Cache Components on
 * that draw is a prerender, which Next.js refuses when a read there is not
 * cached and no Suspense boundary is above it, so the visit used to answer
 * 500, on every visit. The playground's root layout holds its body in a
 * boundary, which React never sends hidden.
 *
 * The build under test's own: a second `next start` from the same build, over
 * a database of its own made just before it starts, so the suite's main
 * server and its database are left as they are. Every page is asked for once
 * by a plain request before anything else asks for it.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/production/fresh-database-first-start
 */

// Inside the block of ports a worktree's slot owns, clear of the other specs'
// servers (`PORT + 4`, `PORT + 6` and `PORT + 7`).
const FRESH_PORT = PORT + 5;
const FRESH_URL = `http://localhost:${FRESH_PORT}`;

/** This spec's database, by exact name, and the two files SQLite keeps beside it. */
const DB_NAME = "e2e-prod-fresh.db";
const DB_FILES = [DB_NAME, `${DB_NAME}-shm`, `${DB_NAME}-wal`];
const removeDatabase = () => {
  for (const name of DB_FILES) {
    rmSync(join(PLAYGROUND, "data", name), { force: true });
  }
};

/** What React writes where it sends part of a page for its script to reveal. */
const HIDDEN_PART = /<div hidden id="S:\d+">/;

/**
 * The seed's public pages through each of the playground's cached routes,
 * with a text each must hold: `[...slug]` (`createPublicContentPage`),
 * `/site` and `/blocks` (`createPublicBlocksPage`).
 */
const PAGES: Array<[path: string, text: string]> = [
  ["/welcome", "Build pages, not pipelines"],
  ["/site/welcome", "Build pages, not pipelines"],
  ["/blocks/kitchen-sink", "Every block, at its defaults"],
];

let server: ChildProcess | undefined;
let logDir: string | undefined;
let logFile = "";

const env = {
  ...process.env,
  ...productionServerEnv(FRESH_PORT),
  DATABASE_URL: `file:./data/${DB_NAME}`,
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
  // Seeded and installed as a deployment's database is before its first
  // start: a production boot refuses a configured plugin no install has
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
  logDir = mkdtempSync(join(tmpdir(), "nextly-fresh-database-prod-"));
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
    `the fresh database's server to answer, its log:\n${logFile}`,
    async () =>
      (await fetch(`${FRESH_URL}/api/health`).catch(() => null))?.ok ?? false,
    120_000
  ).catch((error: unknown) => {
    throw new Error(`${String(error)}\n${readFileSync(logFile, "utf8")}`);
  });
});

test.afterAll(async () => {
  if (server?.pid !== undefined) {
    const treeKill = treeKillCommand(server.pid, process.platform);
    if (treeKill === null) await stop(server);
    else spawnSync(treeKill.command, treeKill.args, { stdio: "ignore" });
  }
  if (logDir !== undefined) rmSync(logDir, { recursive: true, force: true });
  removeDatabase();
});

test("each public page answers 200 with its content inline, on its first visit and after", async ({
  playwright,
}) => {
  const visitor = await playwright.request.newContext({ baseURL: FRESH_URL });
  try {
    for (const visit of ["first", "repeat"]) {
      for (const [path, text] of PAGES) {
        const response = await visitor.get(path, { headers: { cookie: "" } });
        const html = await response.text();
        expect(response.status(), `${path}, ${visit} visit`).toBe(200);
        expect(
          html,
          `${path}, ${visit} visit: a part is sent hidden`
        ).not.toMatch(HIDDEN_PART);
        expect(html, `${path}, ${visit} visit`).toContain(text);
      }
    }
    // The home page is the access-enforced Single, read per request beneath
    // its own boundary: it is answered, whatever it sends hidden.
    expect((await visitor.get("/", { headers: { cookie: "" } })).status()).toBe(
      200
    );
  } finally {
    await visitor.dispose();
  }
  expect(readFileSync(logFile, "utf8")).not.toContain(
    "uncached or runtime data during prerendering"
  );
});
