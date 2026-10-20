#!/usr/bin/env node
/**
 * Starts the playground under `next dev` with the given bundler and database,
 * and fails unless it serves its admin and its API.
 *
 * The playground worked under Turbopack while webpack bundled packages Next
 * should have kept external and answered every request with a 500, and
 * nothing ran it under webpack to notice. This is the check that does, on
 * each database the playground supports. It asks what a contributor's first
 * page loads ask: setup-status (the admin's first API call), the admin
 * itself, and every stylesheet and script the setup page links.
 *
 *   node scripts/playground-bundler-boot.mjs --bundler webpack --dialect sqlite
 *   node scripts/playground-bundler-boot.mjs --bundler turbopack --dialect postgresql --database-url postgres://…
 *
 * The server runs in a process group of its own and is stopped however this
 * ends; its log is written to `--log` (default: a temporary file) and its
 * first error printed on failure.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { isCliEntry } from "./cli-entry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "apps/playground");

/** How long a cold `next dev` may take to answer, compiling on first request. */
const BOOT_MS = 8 * 60 * 1000;
const REQUEST_MS = 4 * 60 * 1000;

/** The stylesheets and scripts a page's HTML links. */
export function linkedAssets(html) {
  return [
    ...html.matchAll(
      /<(?:link[^>]*rel="stylesheet"[^>]*href|script[^>]*src)="([^"]+)"/g
    ),
  ].map(m => m[1].replace(/&amp;/g, "&"));
}

/**
 * The first line of a server log that reports an error, with the line after
 * it, or `undefined`. Two lines, because Next prints a compile error's place
 * (`⨯ file:line:col`) on one and what went wrong on the next.
 */
export function firstError(log) {
  const lines = log.split("\n");
  const at = lines.findIndex(line =>
    /Module not found|Can't resolve|Error:|⨯/.test(line)
  );
  if (at === -1) return undefined;
  return lines
    .slice(at, at + 2)
    .map(line => line.trim())
    .filter(Boolean)
    .join(" ");
}

async function status(base, path) {
  try {
    const res = await fetch(new URL(path, base), {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    return { status: res.status, res };
  } catch (error) {
    return { status: `no answer (${error.cause?.code ?? error.name})` };
  }
}

/** The command line, or exit 2 when the bundler is not one `next dev` takes. */
function options() {
  const { values } = parseArgs({
    options: {
      bundler: { type: "string" },
      dialect: { type: "string", default: "sqlite" },
      "database-url": { type: "string" },
      port: { type: "string", default: "3150" },
      log: { type: "string" },
    },
  });
  if (!["webpack", "turbopack"].includes(values.bundler)) {
    console.error("--bundler must be webpack or turbopack");
    process.exit(2);
  }
  return values;
}

/**
 * Starts `next dev` in a process group of its own, writing to `log`, and
 * stops the whole group when this process exits, or is interrupted or
 * cancelled: a signal ends the process without its `exit` event, and the
 * group would keep the port, build directory and database.
 */
function startServer(values, { base, log, databaseUrl }) {
  const out = openSync(log, "w");
  const server = spawn(
    join(app, "node_modules/.bin/next"),
    ["dev", `--${values.bundler}`, "-p", values.port],
    {
      cwd: app,
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        NODE_ENV: "development",
        DB_DIALECT: values.dialect,
        DATABASE_URL: databaseUrl,
        NEXT_PUBLIC_APP_URL: base,
        PORT: values.port,
        // Its own build directory, apart from a contributor's `.next`.
        NEXT_DIST_DIR: `.next-boot-${values.bundler}`,
      },
    }
  );
  const stop = () => {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  };
  process.on("exit", stop);
  // The usual shell codes for the two, 128 plus the signal's number.
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));
  return server;
}

/**
 * Exits 2 unless `port` is free: a server already there would answer for the
 * one this starts, which would then fail to listen and go unnoticed.
 */
async function requireFreePort(port) {
  const free = await new Promise(resolve => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(Number(port), () => probe.close(() => resolve(true)));
  });
  if (free) return;
  console.error(`Port ${port} is in use: another server would answer there.`);
  process.exit(2);
}

/**
 * Removes the run's scratch folder as this process exits, unless the run
 * failed: a failure keeps its log and database to read.
 */
function removeOnExit(scratch) {
  process.on("exit", code => {
    if (code !== 1) rmSync(scratch, { recursive: true, force: true });
  });
}

/** How the server ended, or `null` while it runs. */
function ended(server) {
  if (server.exitCode !== null) return `exited with ${server.exitCode}`;
  return server.signalCode === null
    ? null
    : `was ended by ${server.signalCode}`;
}

/**
 * setup-status's first answer, whatever its status, or the last failure;
 * no answer at all once the server has ended, since anything still answering
 * on its port is another process.
 */
async function firstAnswer(base, server) {
  const deadline = Date.now() + BOOT_MS;
  let setup;
  do {
    const gone = ended(server);
    if (gone) return { status: `no answer (next dev ${gone})` };
    setup = await status(base, "/admin/api/auth/setup-status");
    if (typeof setup.status === "number") return setup;
    await new Promise(r => setTimeout(r, 3000));
  } while (Date.now() < deadline);
  return setup;
}

/** The problems with the stylesheets and scripts the setup page links. */
async function assetProblems(base, html) {
  const assets = linkedAssets(html);
  if (assets.length === 0) return ["/admin/setup linked no assets"];
  const problems = [];
  for (const asset of assets) {
    const answer = await status(base, asset);
    if (answer.status !== 200)
      problems.push(`${asset} answered ${answer.status}`);
  }
  return problems;
}

/** Everything a first visit to the admin asks for that did not answer 200. */
async function servingProblems(base, setup) {
  const problems = [];
  if (setup.status !== 200)
    problems.push(`setup-status answered ${setup.status}`);
  const admin = await status(base, "/admin");
  if (admin.status !== 200) problems.push(`/admin answered ${admin.status}`);
  const page = await status(base, "/admin/setup");
  if (page.status !== 200)
    return [...problems, `/admin/setup answered ${page.status}`];
  return [...problems, ...(await assetProblems(base, await page.res.text()))];
}

async function main() {
  const values = options();
  await requireFreePort(values.port);
  const scratch = mkdtempSync(join(tmpdir(), "playground-boot-"));
  removeOnExit(scratch);
  const log = values.log ?? join(scratch, "next-dev.log");
  const databaseUrl =
    values["database-url"] ?? `file:${join(scratch, "playground.db")}`;
  const base = `http://localhost:${values.port}`;
  const server = startServer(values, { base, log, databaseUrl });
  const problems = await servingProblems(base, await firstAnswer(base, server));
  // Answers that outlived the server came from another process.
  const gone = ended(server);
  if (gone) problems.push(`next dev ${gone} during the check`);
  report(`${values.bundler} on ${values.dialect}`, problems, log);
}

/** Prints the outcome and exits: 1, with the server's first error, on a problem. */
function report(label, problems, log) {
  if (problems.length > 0) {
    console.error(
      `The playground under ${label} does not serve its admin and API:`
    );
    for (const problem of problems) console.error(`  ${problem}`);
    const error = firstError(readFileSync(log, "utf8"));
    if (error)
      console.error(`First error in the server log: ${error.slice(0, 400)}`);
    console.error(`Server log: ${log}`);
    process.exit(1);
  }
  console.log(
    `The playground under ${label} serves its admin, its API and its assets.`
  );
  process.exit(0);
}

if (isCliEntry(import.meta.url)) await main();
