import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import { expect, test } from "@playwright/test";

import {
  pnpmInvocation,
  treeKillCommand,
} from "../../../scripts/pnpm-invocation.mjs";
import {
  BASE_URL,
  NEXTLY_ROOT,
  PORT,
  productionServerEnv,
} from "../../production-server";

/**
 * A production build whose committed component map lacks a dashboard widget's
 * component refuses the admin, naming the plugin, the widget and the fix, and
 * keeps the public site serving.
 *
 * The refusal is the build under test's own: a second `next start` from the
 * same build, with the fixture plugin that declares the widget switched on.
 * Its own server, because a refused admin is the point, and the suite's main
 * server keeps its admin for the other specs. The main server is the control:
 * the same build with the map whole serves the admin.
 *
 * @module tests/production/component-map
 */

const REFUSING_PORT = PORT + 7;
const REFUSING_URL = `http://localhost:${REFUSING_PORT}`;

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

test.beforeAll(async () => {
  const env = {
    ...process.env,
    ...productionServerEnv(REFUSING_PORT),
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
  await waitForHealth(REFUSING_URL, 120_000);
});

test.afterAll(() => {
  if (server?.pid === undefined) return;
  // On Windows the handle is the shell the wrapper asked for, so killing it
  // alone would leave `next start` holding the port; the tree kill reaches it.
  const treeKill = treeKillCommand(server.pid, process.platform);
  if (treeKill === null) {
    server.kill("SIGTERM");
    return;
  }
  spawnSync(treeKill.command, treeKill.args, { stdio: "ignore" });
});

test.describe("a production build missing a widget's component", () => {
  test("refuses the admin, and logs the plugin, the widget and the fix", async ({
    request,
  }) => {
    const admin = await request.get(`${REFUSING_URL}/admin`);
    expect(admin.status()).toBe(500);
    await expect
      .poll(() => output, { timeout: 10_000 })
      .toContain(
        'plugin "missing-widget-fixture", widget "missing-widget-fixture/never-built"'
      );
    expect(output).toContain(
      "@nextly-e2e/missing-widget-fixture/admin#NeverBuilt"
    );
    expect(output).toContain("Run `npx nextly generate:types`");
  });

  test("keeps the public site serving", async ({ request }) => {
    // Only the admin is refused: the check runs in the admin's layout. The
    // home page answers as it does on the suite's own server, whatever that
    // is for this seed, and never with a server error.
    const home = await request.get(`${REFUSING_URL}/`);
    const control = await request.get(`${BASE_URL}/`);
    expect(home.status()).toBeLessThan(500);
    expect(home.status()).toBe(control.status());
  });

  test("serves the admin from the same build when the map is whole", async ({
    request,
  }) => {
    // The control: the suite's own server, started without the fixture.
    const admin = await request.get(`${BASE_URL}/admin`);
    expect(admin.status()).toBe(200);
  });
});
