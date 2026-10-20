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
import { mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

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

/** The first line of a server log that reports an error, if any. */
export function firstError(log) {
  return log
    .split("\n")
    .find(line => /Module not found|Can't resolve|Error:|⨯/.test(line));
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

async function main() {
  const { values } = parseArgs({
    options: {
      bundler: { type: "string" },
      dialect: { type: "string", default: "sqlite" },
      "database-url": { type: "string" },
      port: { type: "string", default: "3150" },
      log: { type: "string" },
    },
  });
  if (values.bundler !== "webpack" && values.bundler !== "turbopack") {
    console.error("--bundler must be webpack or turbopack");
    process.exit(2);
  }
  const scratch = mkdtempSync(join(tmpdir(), "playground-boot-"));
  const log = values.log ?? join(scratch, "next-dev.log");
  const databaseUrl =
    values["database-url"] ?? `file:${join(scratch, "playground.db")}`;
  const base = `http://localhost:${values.port}`;
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

  const problems = [];
  const deadline = Date.now() + BOOT_MS;
  let setup;
  do {
    setup = await status(base, "/admin/api/auth/setup-status");
    if (typeof setup.status === "number") break;
    await new Promise(r => setTimeout(r, 3000));
  } while (Date.now() < deadline);
  if (setup.status !== 200)
    problems.push(`setup-status answered ${setup.status}`);

  const admin = await status(base, "/admin");
  if (admin.status !== 200) problems.push(`/admin answered ${admin.status}`);

  const page = await status(base, "/admin/setup");
  if (page.status !== 200) {
    problems.push(`/admin/setup answered ${page.status}`);
  } else {
    const assets = linkedAssets(await page.res.text());
    if (assets.length === 0) problems.push("/admin/setup linked no assets");
    for (const asset of assets) {
      const answer = await status(base, asset);
      if (answer.status !== 200)
        problems.push(`${asset} answered ${answer.status}`);
    }
  }

  const label = `${values.bundler} on ${values.dialect}`;
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
