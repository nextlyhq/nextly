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
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  pnpmInvocation,
  treeKillCommand,
} from "../../../scripts/pnpm-invocation.mjs";
import {
  NEXTLY_ROOT,
  PORT,
  productionServerEnv,
} from "../../production-server";

/**
 * A production build whose committed component map lacks a dashboard widget's
 * component serves the admin, and only that widget's card draws its error
 * state, saying it could not be loaded without naming the component; the card
 * beside it draws. Nothing reads or checks the map at boot.
 *
 * The build under test's own: a second `next start` from the same build, with
 * the fixture plugin that declares the widget switched on. Its own server, so
 * the suite's main server keeps its dashboard for the other specs.
 *
 * @module tests/production/component-map
 */

const FIXTURE_PORT = PORT + 7;
const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`;
const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };
const MISSING = "missing-widget-fixture/never-built";

let server: ChildProcess | undefined;
/**
 * The server's log: its stdout and stderr written to ONE file, so the log is one stream in the
 * order the server wrote it, whichever of the two a line went to. Two pipes would each keep their
 * own order and none between them.
 */
let logDir: string | undefined;
let logFile = "";
const serverLog = () => readFileSync(logFile, "utf8");

/** A line the server writes on request, after anything an earlier request wrote. */
const SENTINEL = "refresh-token-not-found";

/**
 * The server's log up to a line it wrote after answering every earlier request, so anything those
 * requests wrote has arrived. The line is the warning core writes for a refresh token it does not
 * know, asked for with one that was never issued.
 */
async function logThroughNow(request: APIRequestContext): Promise<string> {
  const before = serverLog().split(SENTINEL).length;
  const refused = await request.post(`${FIXTURE_URL}/admin/api/auth/refresh`, {
    headers: { cookie: "nextly_refresh=never-issued" },
  });
  expect(refused.status()).toBe(401);
  await expect
    .poll(() => serverLog().split(SENTINEL).length, { timeout: 10_000 })
    .toBeGreaterThan(before);
  return serverLog();
}

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
  throw new Error(`server at ${url} did not start:\n${serverLog()}`);
}

test.beforeAll(async () => {
  const env = {
    ...process.env,
    ...productionServerEnv(FIXTURE_PORT),
    NEXTLY_E2E_MISSING_WIDGET: "1",
  };
  // A production boot refuses a configured plugin no install has recorded, so
  // the fixture is installed first, with the real command, as the suite's own
  // plugins are before its server starts. Only the configured plugins are
  // checked at boot, so the suite's server, which does not configure the
  // fixture, is unaffected by its record on the shared database.
  // Through the repository's pnpm wrapper, as every spawn of pnpm is: on
  // Windows pnpm is a `.cmd` launcher, which Node runs only through a shell.
  const installing = pnpmInvocation(
    [
      "--filter",
      "playground",
      "exec",
      "nextly",
      "plugins",
      "install",
      "missing-widget-fixture",
    ],
    process.platform,
    env
  );
  const install = spawnSync(installing.command, installing.args, {
    cwd: NEXTLY_ROOT,
    env,
    encoding: "utf8",
    shell: installing.shell,
  });
  if (install.status !== 0) {
    throw new Error(
      `installing the fixture plugin failed:\n${install.stdout}${install.stderr}`
    );
  }
  const starting = pnpmInvocation(
    ["--filter", "playground", "exec", "next", "start"],
    process.platform,
    env
  );
  logDir = mkdtempSync(join(tmpdir(), "nextly-component-map-prod-"));
  logFile = join(logDir, "server.log");
  const log = openSync(logFile, "a");
  try {
    server = spawn(starting.command, starting.args, {
      cwd: NEXTLY_ROOT,
      env,
      stdio: ["ignore", log, log],
      shell: starting.shell,
    });
  } finally {
    // The server holds its own copy of the descriptor.
    closeSync(log);
  }
  await waitForHealth(FIXTURE_URL, 120_000);
});

test.afterAll(() => {
  stopServer();
  if (logDir !== undefined) rmSync(logDir, { recursive: true, force: true });
});

function stopServer(): void {
  if (server?.pid === undefined) return;
  // On Windows the handle is the shell the wrapper asked for, so killing it
  // alone would leave `next start` holding the port; the tree kill reaches it.
  const treeKill = treeKillCommand(server.pid, process.platform);
  if (treeKill === null) {
    server.kill("SIGTERM");
    return;
  }
  spawnSync(treeKill.command, treeKill.args, { stdio: "ignore" });
}

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
}

/** Signs in through the real form, as dev auto-login is blocked in production. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${FIXTURE_URL}/admin`);
  await page.getByRole("textbox", { name: /email/i }).fill(DEV_USER.email);
  // By role, because a label match also finds the "Show password" toggle.
  await page
    .getByRole("textbox", { name: /password/i })
    .fill(DEV_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
}

/** Puts the fixture's card first on the reader's dashboard, beside the cards already there. */
async function placeMissingCard(page: Page): Promise<void> {
  const read = await page.request.get(
    `${FIXTURE_URL}/admin/api/dashboard/layout`
  );
  expect(read.ok()).toBe(true);
  const layout = (await read.json()) as Layout;
  const write = await page.request.put(
    `${FIXTURE_URL}/admin/api/dashboard/layout`,
    {
      data: {
        placements: [
          { id: "e2e-missing", widgetId: MISSING, w: 12, h: 4, removed: false },
          ...layout.placements.filter(each => each.widgetId !== MISSING),
        ],
        version: layout.version,
        scope: layout.scope,
      },
    }
  );
  expect(write.ok(), await write.text()).toBe(true);
}

test.describe("a production build missing a widget's component", () => {
  test("serves the admin, and nothing at boot reads or checks the map", async ({
    request,
  }) => {
    const admin = await request.get(`${FIXTURE_URL}/admin`);
    expect(admin.status()).toBe(200);
    // Read once a later line has arrived, so a marker the admin's answer wrote would be there.
    const log = await logThroughNow(request);
    expect(log).not.toContain("admin-component-map");
    expect(log).not.toContain("NEXTLY_ADMIN_COMPONENT_MAP");
  });

  test("draws that card's error state without naming its component, and the card beside it draws", async ({
    page,
  }) => {
    await signIn(page);
    await placeMissingCard(page);
    try {
      await page.goto(`${FIXTURE_URL}/admin`);
      const card = page.getByRole("region", { name: "Never built" });
      await expect(card).toHaveAttribute("data-state", "error", {
        timeout: 30_000,
      });
      await expect(card).toContainText("Its component could not be loaded.");
      await expect(card).not.toContainText("NeverBuilt");
      // The rest of the dashboard draws: some other card reaches an answer.
      await expect(
        page
          .getByRole("region")
          .filter({ hasNot: page.getByText("Never built") })
          .and(page.locator('[data-state="ready"], [data-state="empty"]'))
          .first()
      ).toBeVisible();
    } finally {
      // The database is the suite's: the reader's layout goes back to the default.
      const read = await page.request.get(
        `${FIXTURE_URL}/admin/api/dashboard/layout`
      );
      const { version, scope } = (await read.json()) as Layout;
      await page.request.delete(
        `${FIXTURE_URL}/admin/api/dashboard/layout?version=${version}&scope=${encodeURIComponent(scope)}`
      );
    }
  });
});
