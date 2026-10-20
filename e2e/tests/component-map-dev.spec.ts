import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import {
  pnpmInvocation,
  treeKillCommand,
} from "../../scripts/pnpm-invocation.mjs";

import { E2E_NEXTLY_SECRET } from "./support/preview-links";

/**
 * A development server whose component map lacks a dashboard widget's
 * component, with automatic regeneration off, refuses the admin, naming the
 * plugin, the widget, the component and the fix.
 *
 * Regeneration off is the case under test because it is the only one in which
 * development refuses: with it on, `next dev` writes the map again and the
 * widget draws, which a test run must not do to the checkout. It is also how
 * this suite's own server runs (`NEXTLY_GENERATED_FILES_WRITE=0`).
 *
 * Its own `next dev`, with the fixture plugin that declares the widget switched
 * on, because a refused admin is the point and the suite's server keeps its
 * admin for the other specs. Its own port, build directory and database, so it
 * never shares `.next-e2e` or the suite's database with that server. The
 * suite's server, started without the fixture, is the control: the same app
 * with the map whole serves the admin.
 *
 * @module tests/component-map-dev
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NEXTLY_ROOT = path.resolve(HERE, "..", "..");
const PLAYGROUND = path.join(NEXTLY_ROOT, "apps", "playground");
const SUITE_PORT = Number(process.env.E2E_PORT) || 3100;
const SUITE_URL = `http://localhost:${SUITE_PORT}`;
const REFUSING_PORT = SUITE_PORT + 9;
const REFUSING_URL = `http://localhost:${REFUSING_PORT}`;
/** This spec's own build directory and database, removed when it ends. */
const DIST_DIR = ".next-e2e-component-map";
const DB_FILE = "./data/e2e-component-map.db";

let server: ChildProcess | undefined;
let output = "";

/** Waits for the server to answer its health route, or fails with its log. */
async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise(done => setTimeout(done, 1000));
  }
  throw new Error(`server at ${url} did not start:\n${output}`);
}

/** Removes what this spec's server wrote: its build directory and database. */
function removeOwnFiles(): void {
  rmSync(path.join(PLAYGROUND, DIST_DIR), { recursive: true, force: true });
  rmSync(path.join(PLAYGROUND, DB_FILE), { force: true });
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  removeOwnFiles();
  const env = {
    ...process.env,
    PORT: String(REFUSING_PORT),
    NEXTLY_SECRET: E2E_NEXTLY_SECRET,
    DB_DIALECT: "sqlite",
    DATABASE_URL: `file:${DB_FILE}`,
    NEXT_DIST_DIR: DIST_DIR,
    NEXTLY_GENERATED_FILES_WRITE: "0",
    NEXTLY_E2E_MISSING_WIDGET: "1",
  };
  // Through the repository's pnpm wrapper, as every spawn of pnpm is: on
  // Windows pnpm is a `.cmd` launcher, which Node runs only through a shell.
  const starting = pnpmInvocation(
    [
      "--filter",
      "playground",
      "exec",
      "next",
      "dev",
      "--port",
      String(REFUSING_PORT),
    ],
    process.platform,
    env
  );
  server = spawn(starting.command, starting.args, {
    cwd: NEXTLY_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: starting.shell,
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream?.on("data", chunk => {
      output += String(chunk);
    });
  }
  // A cold development boot compiles on first request, so the health route
  // can take as long as the suite's own server allows for its boot.
  await waitForHealth(REFUSING_URL, 240_000);
});

test.afterAll(() => {
  if (server?.pid !== undefined) {
    // On Windows the handle is the shell the wrapper asked for, so killing it
    // alone would leave `next dev` holding the port; the tree kill reaches it.
    const treeKill = treeKillCommand(server.pid, process.platform);
    if (treeKill === null) server.kill("SIGTERM");
    else spawnSync(treeKill.command, treeKill.args, { stdio: "ignore" });
  }
  removeOwnFiles();
});

test.describe("a development server missing a widget's component, with regeneration off", () => {
  test("refuses the admin, naming the plugin, the widget, the component and the fix", async ({
    request,
  }) => {
    test.setTimeout(240_000);
    const admin = await request.get(`${REFUSING_URL}/admin`, {
      timeout: 200_000,
    });
    expect(admin.status()).toBe(500);
    await expect
      .poll(() => output, { timeout: 30_000 })
      .toContain(
        'plugin "missing-widget-fixture", widget "missing-widget-fixture/never-built"'
      );
    expect(output).toContain(
      "@nextly-e2e/missing-widget-fixture/admin#NeverBuilt"
    );
    expect(output).toContain(
      "automatic regeneration is off (NEXTLY_GENERATED_FILES_WRITE=0)"
    );
    expect(output).toContain("Run `npx nextly generate:types`");
  });

  test("serves the admin when the map is whole", async ({ request }) => {
    // The control: the suite's own development server, the same app with
    // regeneration off and the fixture not configured.
    const admin = await request.get(`${SUITE_URL}/admin`, { timeout: 200_000 });
    expect(admin.status()).toBe(200);
  });
});
