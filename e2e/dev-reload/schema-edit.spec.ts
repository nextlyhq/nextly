/**
 * A schema edit saved while `next dev` runs reaches the database without a
 * restart, on a port given by `-p` or by `PORT`.
 *
 * Turbopack only: the playground's dev setup bundles the workspace packages
 * from source through Turbopack aliases, and does not run under
 * `next dev --webpack` at all. Nextly's trigger is a file save seen inside the
 * dev server, which does not depend on the bundler; the save-to-column path is
 * covered on every database by
 * packages/nextly/src/runtime/__tests__/config-edit-applies.integration.test.ts.
 *
 * Each case starts the playground's own dev server, with the dev-reload probe
 * collection switched on, its own build directory and its own SQLite file,
 * then adds a field to the probe's source file and waits for the column. That
 * is the whole path a developer takes: the save, Nextly noticing it inside the
 * dev server, and the schema pipeline applying it.
 *
 * Run by `pnpm --filter @nextlyhq/e2e test:e2e:dev-reload`, never beside the
 * main suite (see playwright.dev-reload.config.ts).
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYGROUND = path.resolve(HERE, "..", "..", "apps", "playground");
const PROBE_FILE = path.join(
  PLAYGROUND,
  "src",
  "collections",
  "dev-reload-probe.ts"
);
const PROBE_TABLE = "dc_dev_reload_probe";
const NEXT_BIN = path.join(PLAYGROUND, "node_modules", ".bin", "next");

type Case = {
  name: string;
  bundler: "--turbopack";
  portGivenBy: "flag" | "env";
};

const CASES: Case[] = [
  {
    name: "Turbopack, port from -p",
    bundler: "--turbopack",
    portGivenBy: "flag",
  },
  {
    name: "Turbopack, port from PORT",
    bundler: "--turbopack",
    portGivenBy: "env",
  },
];

// One case at a time: they all edit the same probe file.
test.describe.configure({ mode: "serial" });

/** A port no other process holds right now, chosen by the operating system. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** The playground's .env.example values: what a fresh checkout starts with. */
function exampleEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const raw = readFileSync(path.join(PLAYGROUND, ".env.example"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

/** The probe table's column names, or none while the table does not exist. */
function probeColumns(databaseFile: string): string[] {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(databaseFile, { readOnly: true });
    const rows = db
      .prepare(`SELECT name FROM pragma_table_info('${PROBE_TABLE}')`)
      .all() as { name: string }[];
    return rows.map(row => row.name);
  } catch {
    // The file is created by the server's boot; until then there is nothing.
    return [];
  } finally {
    db?.close();
  }
}

/** Polls until `check` holds, or fails naming what it waited for. */
async function waitFor(
  what: string,
  check: () => boolean | Promise<boolean>,
  ms: number
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 500));
  }
}

/** Sends `signal` to the dev server and everything it started. */
function signal(server: ChildProcess, name: NodeJS.Signals): void {
  if (server.pid === undefined) return;
  try {
    // Started detached, so the negative pid is its whole process group:
    // `next dev` runs its server in a child of its own.
    process.kill(-server.pid, name);
  } catch {
    server.kill(name);
  }
}

/**
 * Stops the dev server and waits for it to exit, so nothing is still writing
 * into its build directory when that is removed.
 */
async function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise<void>(resolve =>
    server.once("exit", () => resolve())
  );
  signal(server, "SIGTERM");
  const outcome = await Promise.race([
    exited.then(() => "exited" as const),
    new Promise<"slow">(resolve => setTimeout(() => resolve("slow"), 15_000)),
  ]);
  if (outcome === "slow") {
    signal(server, "SIGKILL");
    await exited;
  }
}

/**
 * Files `next dev` writes into an app root that lacks them (Next.js 16 adds
 * agent instructions there). Removed afterwards if this run created them.
 */
const NEXT_WRITES = ["AGENTS.md", "CLAUDE.md"].map(name =>
  path.join(PLAYGROUND, name)
);
const presentBefore = new Set(NEXT_WRITES.filter(file => existsSync(file)));

test.afterAll(() => {
  for (const file of NEXT_WRITES) {
    if (!presentBefore.has(file)) rmSync(file, { force: true });
  }
});

const originalProbe = readFileSync(PROBE_FILE, "utf8");

for (const testCase of CASES) {
  test(`a field saved under ${testCase.name} reaches the database`, async () => {
    const port = await freePort();
    const work = mkdtempSync(path.join(tmpdir(), "nextly-dev-reload-"));
    const databaseFile = path.join(work, "dev-reload.db");
    const distDir = `.next-dev-reload-${testCase.bundler.slice(2)}-${testCase.portGivenBy}`;
    const args = ["dev", testCase.bundler];
    if (testCase.portGivenBy === "flag") args.push("-p", String(port));

    const env: NodeJS.ProcessEnv = {
      ...exampleEnv(),
      ...process.env,
      DB_DIALECT: "sqlite",
      DATABASE_URL: `file:${databaseFile}`,
      // Its own build directory, so it never fights another dev server of
      // this app over `.next`.
      NEXT_DIST_DIR: distDir,
      NEXTLY_E2E_DEV_RELOAD: "1",
      NODE_ENV: "development",
    };
    if (testCase.portGivenBy === "env") env.PORT = String(port);
    else delete env.PORT;

    let log = "";
    const server = spawn(NEXT_BIN, args, {
      cwd: PLAYGROUND,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", chunk => (log += String(chunk)));
    server.stderr?.on("data", chunk => (log += String(chunk)));

    try {
      const base = `http://localhost:${port}`;
      // Booting Nextly is what applies the schema the first time and starts
      // watching the config's files; the auth route does both.
      await waitFor(
        "the dev server to answer",
        async () =>
          (await fetch(`${base}/admin/api/auth/setup-status`).catch(() => null))
            ?.ok === true,
        4 * 60 * 1000
      );
      await waitFor(
        "the probe table from the boot",
        () => probeColumns(databaseFile).includes("title"),
        2 * 60 * 1000
      );
      expect(probeColumns(databaseFile)).not.toContain("summary");

      // What a developer does: add a field to the collection's file and save.
      writeFileSync(
        PROBE_FILE,
        originalProbe.replace(
          'fields: [text({ name: "title" })],',
          'fields: [text({ name: "title" }), text({ name: "summary" })],'
        )
      );

      await waitFor(
        "the saved field's column",
        () => probeColumns(databaseFile).includes("summary"),
        60 * 1000
      );
    } catch (error) {
      // The server's own output is what explains a failure here.
      console.log(
        `--- next dev output (${testCase.name}) ---\n${log.slice(-6000)}`
      );
      throw error;
    } finally {
      await stop(server);
      writeFileSync(PROBE_FILE, originalProbe);
      const rmOptions = {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500,
      };
      rmSync(path.join(PLAYGROUND, distDir), rmOptions);
      rmSync(work, rmOptions);
    }
  });
}
