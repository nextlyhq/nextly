import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "@playwright/test";

import {
  pnpmInvocation,
  treeKillCommand,
} from "../../scripts/pnpm-invocation.mjs";

import { cleanUpNextWrites, stop } from "../support/playground-dev-server";

import { E2E_NEXTLY_SECRET } from "./support/preview-links";
import { test } from "./support/test";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.ownServer, LOCK.heavy] });

/**
 * A development server whose component map lacks a dashboard widget's
 * component, with automatic regeneration off, serves the admin: it warns,
 * naming the widget, its owner, the component and the switch, and only that
 * widget's card draws its error state, naming the widget, its owner and the
 * missing path.
 *
 * Regeneration off is the case under test because with it on, `next dev`
 * writes the map again and the widget draws, which a test run must not do to
 * the checkout. It is also how this suite's own server runs
 * (`NEXTLY_GENERATED_FILES_WRITE=0`).
 *
 * Its own `next dev`, with the fixture plugin that declares the widget switched
 * on, so the suite's server keeps its dashboard for the other specs. Its own
 * port, build directory and database, so it never shares `.next-e2e` or the
 * suite's database with that server.
 *
 * @module tests/component-map-dev
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NEXTLY_ROOT = path.resolve(HERE, "..", "..");
const PLAYGROUND = path.join(NEXTLY_ROOT, "apps", "playground");
const SUITE_PORT = Number(process.env.E2E_PORT) || 3100;
const FIXTURE_PORT = SUITE_PORT + 9;
const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`;
const MISSING = "missing-widget-fixture/never-built";
const COMPONENT = "@nextly-e2e/missing-widget-fixture/admin#NeverBuilt";
/** This spec's own build directory and database, removed when it ends. */
const DIST_DIR = ".next-e2e-component-map";
const DB_FILE = "./data/e2e-component-map.db";

let server: ChildProcess | undefined;
let output = "";
/** Removes the agent files `next dev` writes into the app root, if it wrote them. */
let cleanNextWrites: (() => void) | undefined;

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
  // Retried: a recursive removal of a build directory the server has only just
  // stopped writing can meet `ENOTEMPTY` while the tree settles, which Node's
  // `maxRetries` exists for. Seen on macOS with a second worker busy beside it.
  rmSync(path.join(PLAYGROUND, DIST_DIR), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
  rmSync(path.join(PLAYGROUND, DB_FILE), { force: true });
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  removeOwnFiles();
  cleanNextWrites = cleanUpNextWrites();
  const env = {
    ...process.env,
    PORT: String(FIXTURE_PORT),
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
      String(FIXTURE_PORT),
    ],
    process.platform,
    env
  );
  server = spawn(starting.command, starting.args, {
    cwd: NEXTLY_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: starting.shell,
    // Its own process group on POSIX, so `stop` reaches the server `next dev`
    // runs in a child of its own; Windows is stopped by a tree kill instead.
    detached: process.platform !== "win32",
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream?.on("data", chunk => {
      output += String(chunk);
    });
  }
  // A cold development boot compiles on first request, so the health route
  // can take as long as the suite's own server allows for its boot.
  await waitForHealth(FIXTURE_URL, 240_000);
});

test.afterAll(async () => {
  // Stopped and waited for before anything is removed, so nothing is still
  // writing into its build directory or database, or holding the port, when
  // the files go.
  if (server?.pid !== undefined) {
    // On Windows the handle is the shell the wrapper asked for, so killing it
    // alone would leave `next dev` holding the port; the tree kill reaches it,
    // and returns once the tree is gone.
    const treeKill = treeKillCommand(server.pid, process.platform);
    if (treeKill === null) await stop(server);
    else spawnSync(treeKill.command, treeKill.args, { stdio: "ignore" });
  }
  removeOwnFiles();
  cleanNextWrites?.();
});

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
}

/**
 * The message of the server's warning about an out-of-date map, or "" before it is logged. The
 * logger writes each entry as one line of JSON, so the message is read back rather than searched
 * for, its quotes and line breaks escaped.
 */
function staleMapWarning(log: string): string {
  for (const line of log.split("\n")) {
    if (!line.includes('"admin-component-map-stale"')) continue;
    try {
      const entry = JSON.parse(line.slice(line.indexOf("{"))) as {
        kind?: string;
        message?: string;
      };
      if (entry.kind === "admin-component-map-stale")
        return entry.message ?? "";
    } catch {
      // A line that only mentions the kind, not the entry itself.
    }
  }
  return "";
}

test.describe("a development server missing a widget's component, with regeneration off", () => {
  test("serves the admin, warning with the widget, its owner, the component and the switch", async ({
    request,
  }) => {
    test.setTimeout(240_000);
    const admin = await request.get(`${FIXTURE_URL}/admin`, {
      timeout: 200_000,
    });
    expect(admin.status()).toBe(200);
    await expect
      .poll(() => staleMapWarning(output), { timeout: 30_000 })
      .toContain(
        `- missing: plugin "missing-widget-fixture", widget "${MISSING}": ${COMPONENT}`
      );
    expect(staleMapWarning(output)).toContain(
      "automatic regeneration is off (NEXTLY_GENERATED_FILES_WRITE=0)"
    );
  });

  test("draws that card's error state, naming the widget, its owner and the path", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // Development signs the dev user in on its own.
    await page.goto(`${FIXTURE_URL}/admin`, { timeout: 200_000 });
    await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
    const read = await page.request.get(
      `${FIXTURE_URL}/admin/api/dashboard/layout`
    );
    const layout = (await read.json()) as Layout;
    const write = await page.request.put(
      `${FIXTURE_URL}/admin/api/dashboard/layout`,
      {
        data: {
          placements: [
            {
              id: "e2e-missing",
              widgetId: MISSING,
              w: 12,
              h: 4,
              removed: false,
            },
            ...layout.placements.filter(each => each.widgetId !== MISSING),
          ],
          version: layout.version,
          scope: layout.scope,
        },
      }
    );
    expect(write.ok(), await write.text()).toBe(true);

    await page.goto(`${FIXTURE_URL}/admin`);
    const card = page.getByRole("region", { name: "Never built" });
    await expect(card).toHaveAttribute("data-state", "error", {
      timeout: 60_000,
    });
    await expect(card).toContainText(
      `Widget "${MISSING}" of plugin "missing-widget-fixture" draws with ${COMPONENT}`
    );
    await expect(card).toContainText("npx nextly generate:types");
  });
});
