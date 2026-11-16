/**
 * Records the upgrade gate's baseline: the database a published Nextly release
 * builds for this playground, on each dialect, and the app migrations it wrote.
 *
 *   pnpm --filter playground upgrade-gate:record [--release 0.0.2-alpha.76]
 *        [--work <dir>] [--pg-dump-container <name>]
 *
 * Run it after each release, with TEST_POSTGRES_URL and TEST_MYSQL_URL set to
 * servers it may make a scratch database on. It:
 *
 * 1. finds the commit that versioned the release (`--release`, by default
 *    npm's `alpha` tag) on `origin/main`, where releases are cut;
 * 2. takes the playground and the templates it imports from that commit, and
 *    installs the published packages of that release beside them from npm,
 *    so the install is built by the release itself, not by this checkout;
 * 3. on each dialect, runs that release's `nextly migrate:create` and
 *    `nextly migrate`, as a site's first deployment does;
 * 4. dumps each database whole, schema and rows, into `baseline/<dialect>/`
 *    with the migration folder the release wrote, and names the release in
 *    `baseline/meta.json`.
 *
 * Then run the gate (`upgrade-plan.integration.test.ts`) and make the
 * allowlist hold what it reports: after a refresh, an operation the release
 * now ships leaves the plan, and its entry goes.
 *
 * `pg_dump` must be the server's major version or newer. Where it is not on
 * the PATH, `--pg-dump-container` runs the one inside the server's container.
 */
import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

import { DIALECTS, type Dialect } from "./catalog";
import { dump, makeScratchDatabase } from "./database";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");

/** Where the baseline lives, and what `meta.json` records. */
export const BASELINE_DIR = join(here, "baseline");

export interface BaselineMeta {
  /** The published release that built the baseline. */
  release: string;
  /** The commit that versioned it. */
  commit: string;
  /** `NEXTLY_PLAYGROUND_PLUGINS` as the release's playground was run with it. */
  playgroundPlugins: string;
}

/**
 * The environment the playground's `nextly` runs in, when the baseline is
 * recorded and when the gate upgrades it: the playground as a site runs it,
 * with none of the browser suites' switches (each registers entities of its
 * own), the plugins the baseline was recorded with, and the dialect read from
 * the database's URL. One function for both, so the two runs build the same
 * site.
 */
export function siteEnvironment(
  base: NodeJS.ProcessEnv,
  site: { databaseUrl: string; playgroundPlugins: string }
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(base).filter(
        ([key]) =>
          key !== "DB_DIALECT" &&
          !key.startsWith("NEXTLY_E2E_") &&
          key !== "NEXTLY_SPEED_EXTRA_COLLECTIONS"
      )
    ),
    NODE_ENV: "development",
    DATABASE_URL: site.databaseUrl,
    NEXTLY_PLAYGROUND_PLUGINS: site.playgroundPlugins,
  };
}

async function git(...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repository, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/** The commit on `ref` whose `nextly` manifest first reads `version`. */
async function releaseCommit(version: string, ref: string): Promise<string> {
  const candidates = (
    await git(
      "log",
      "--format=%H",
      `-S"version": "${version}"`,
      ref,
      "--",
      "packages/nextly/package.json"
    )
  )
    .split("\n")
    .filter(Boolean);
  for (const commit of candidates) {
    const manifest = JSON.parse(
      await git("show", `${commit}:packages/nextly/package.json`)
    ) as { version: string };
    if (manifest.version === version) return commit;
  }
  throw new Error(
    `No commit on ${ref} versions nextly ${version}. Fetch it first: git fetch origin main.`
  );
}

/** Each workspace package's name and version at `commit`. */
async function workspaceVersions(commit: string): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  const files = (await git("ls-tree", "-r", "--name-only", commit, "packages"))
    .split("\n")
    .filter(file => /^packages\/[^/]+\/package\.json$/.test(file));
  for (const file of files) {
    const manifest = JSON.parse(await git("show", `${commit}:${file}`)) as {
      name: string;
      version: string;
    };
    versions.set(manifest.name, manifest.version);
  }
  return versions;
}

/**
 * The file holding the commit a finished install was made from. It is written
 * last, so a site from another release, or one whose install stopped
 * part-way, is never reused: it is made again.
 */
const RELEASE_MARKER = ".release-commit";

/** Whether `site` holds a finished install made from `commit`. */
export function isInstalledFrom(site: string, commit: string): boolean {
  const marker = join(site, RELEASE_MARKER);
  return (
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === commit &&
    existsSync(join(site, "apps/playground/node_modules/.bin/nextly"))
  );
}

/**
 * The release's playground, with its workspace dependencies pinned to the
 * versions that release published, installed from npm.
 */
async function prepareSite(commit: string, work: string): Promise<string> {
  const site = join(work, "site");
  const playground = join(site, "apps/playground");
  const marker = join(site, RELEASE_MARKER);
  if (isInstalledFrom(site, commit)) {
    console.log(`Using the release's site already installed at ${site}`);
    return playground;
  }
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  const archive = join(work, "site.tar");
  await git("archive", "-o", archive, commit, "apps/playground", "templates");
  await run("tar", ["-xf", archive, "-C", site]);
  rmSync(archive);

  const versions = await workspaceVersions(commit);
  const manifest = JSON.parse(
    readFileSync(join(playground, "package.json"), "utf8")
  ) as {
    type?: string;
    dependencies: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const pinned = (range: string, name: string) => {
    if (!range.startsWith("workspace:")) return range;
    const version = versions.get(name);
    if (!version) throw new Error(`${name} has no version at ${commit}.`);
    return version;
  };
  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies).map(([name, range]) => [
      name,
      pinned(range, name),
    ])
  );
  // The SQLite driver is a development dependency of the playground.
  const sqliteDriver = manifest.devDependencies?.["better-sqlite3"];
  if (sqliteDriver) dependencies["better-sqlite3"] = sqliteDriver;
  writeFileSync(
    join(playground, "package.json"),
    `${JSON.stringify({ name: "upgrade-gate-release-site", private: true, type: manifest.type, dependencies }, null, 2)}\n`
  );
  console.log(`Installing the release's packages from npm into ${playground}`);
  await run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: playground,
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(marker, `${commit}\n`);
  return playground;
}

/** Runs the release's `nextly` for one dialect's site, failing loudly. */
async function nextly(
  playground: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  ...args: string[]
): Promise<void> {
  try {
    await run(
      join(playground, "node_modules/.bin/nextly"),
      [...args, "--config", join(playground, "nextly.config.ts")],
      { cwd, env, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(
      `nextly ${args.join(" ")} failed:\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`
    );
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      release: { type: "string" },
      ref: { type: "string", default: "origin/main" },
      work: { type: "string" },
      "pg-dump-container": { type: "string" },
    },
  });
  const servers: Partial<Record<Dialect, string>> = {
    postgresql: process.env.TEST_POSTGRES_URL,
    mysql: process.env.TEST_MYSQL_URL,
  };
  if (!servers.postgresql || !servers.mysql) {
    throw new Error(
      "Set TEST_POSTGRES_URL and TEST_MYSQL_URL: the baseline is recorded on every dialect at once."
    );
  }

  const release =
    values.release ??
    (await run("npm", ["view", "nextly", "dist-tags.alpha"])).stdout.trim();
  const commit = await releaseCommit(release, values.ref);
  const work = resolve(
    values.work ?? join(tmpdir(), `nextly-upgrade-gate-${release}`)
  );
  mkdirSync(work, { recursive: true });
  console.log(`Recording the baseline of nextly ${release} (${commit})`);

  const playground = await prepareSite(commit, work);
  // The fixture plugin joins the baseline from the first release whose
  // playground can switch it on.
  const playgroundPlugins = readFileSync(
    join(playground, "nextly.config.ts"),
    "utf8"
  ).includes("reading-lists")
    ? "reading-lists"
    : "";

  for (const dialect of DIALECTS) {
    const cwd = join(work, dialect);
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(cwd, { recursive: true });
    const database = await makeScratchDatabase(
      dialect,
      { server: servers[dialect], file: join(cwd, "site.sqlite") },
      "_upgrade_record"
    );
    try {
      const env = siteEnvironment(process.env, {
        databaseUrl: database.url,
        playgroundPlugins,
      });
      await nextly(
        playground,
        cwd,
        env,
        "migrate:create",
        "--name",
        "baseline",
        "--non-interactive"
      );
      await nextly(playground, cwd, env, "migrate");

      const target = join(BASELINE_DIR, dialect);
      rmSync(target, { recursive: true, force: true });
      mkdirSync(target, { recursive: true });
      writeFileSync(
        join(target, "database.sql"),
        await dump(dialect, database.url, {
          pgDumpContainer: values["pg-dump-container"],
        })
      );
      cpSync(join(cwd, "src/db/migrations"), join(target, "migrations"), {
        recursive: true,
      });
      console.log(`  ${dialect}: recorded`);
    } finally {
      await database.drop();
    }
  }

  const meta: BaselineMeta = { release, commit, playgroundPlugins };
  writeFileSync(
    join(BASELINE_DIR, "meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`
  );
  console.log(
    `Recorded. Now run the gate (pnpm test:integration upgrade-gate, on each dialect) and bring upgrade-gate/allowlist.ts to what it reports. ${work} can be removed.`
  );
}

// Run only as the command, never when a test imports the baseline's location.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
