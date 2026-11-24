/**
 * A field moved into or out of a group in a code-first config, stopped part-way on MySQL: a schema
 * statement commits as it runs, so a `nextly migrate` stopped after any one of the move's statements,
 * by a failure or by the process being killed, leaves what ran before it in place. Every entry's
 * value must still be stored in the place the field was moving from or the place it was moving to,
 * and the registry must place the field where its values are.
 *
 * The move's files are the code road's: `nextly migrate:create --accept-moves` over the config before
 * and after the move. Each stop replays the files into a fresh database, the entries written before
 * the move's files run, and stops them after statement N, for every N each reaches. The Schema
 * Builder's road is `move-stopped-part-way.integration.test.ts`.
 *
 * Reading an entry back through the app is not asked here: a code-first app runs the config's
 * definition, which is ahead of the database until `nextly migrate` finishes the file.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../../../cli/__tests__/helpers/run-nextly";
import { runMigrate } from "../../../../cli/commands/migrate";
import { runMigrateCreate } from "../../../../cli/commands/migrate-create";
import type { CommandContext } from "../../../../cli/program";
import { createLogger } from "../../../../cli/utils/logger";
import {
  defineCollection,
  defineConfig,
  group,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { clearServices, shutdownServices } from "../../../../di/register";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { setNonInteractive } from "../../migrate/can-prompt";
import { KILL_AT_VARIABLE, withStopPoints } from "../../migrate/stop-points";
import { forceUnlock } from "../../pipeline/locks";

// Written for per-language storage as every installation runs it (`storage-layout`). The moved fields
// are shared, kept on the entry's own row in every language: a translated field's move goes through
// its language table, which these statements do not cover.
perLanguageStorageSuite();

/** The configuration the commands load, set before each run. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SLUG = "cms_posts";
const TABLE = `dc_${SLUG}`;
const MOVED = ["summary", "subtitle"] as const;

type Where = "row" | "grouped";

/** The posts with the moved fields on the row or inside the `meta` group, Required where asked. */
function posts(where: Where, required = false) {
  const moved = MOVED.map(name =>
    text({ name, localized: false, ...(required ? { required } : {}) })
  );
  return [
    defineCollection({
      slug: SLUG,
      fields: [
        text({ name: "title" }),
        ...(where === "row" ? moved : []),
        group({
          name: "meta",
          fields: [
            text({ name: "note", localized: false }),
            ...(where === "grouped" ? moved : []),
          ],
        }),
      ],
    }),
  ];
}

/** Each scenario: where the fields stand before and after, and whether they end Required. */
const SCENARIOS: {
  name: string;
  before: Where;
  after: Where;
  required: boolean;
}[] = [
  { name: "into a group", before: "row", after: "grouped", required: false },
  { name: "out of a group", before: "grouped", after: "row", required: false },
  {
    name: "out of a group, into a required field",
    before: "grouped",
    after: "row",
    required: true,
  },
];

/** Entries holding a value in every moved field, characters JSON escapes among them. */
const ENTRIES = [
  { title: "One", slug: "one", summary: "First", subtitle: "a" },
  { title: "Two", slug: "two", summary: 'He said "hi" \\ — ü', subtitle: "b" },
  { title: "Three", slug: "three", summary: "Third", subtitle: "c" },
];

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-code-move-stopped-"));
  mkdirSync(join(dir, "migrations"));
});

afterEach(async () => {
  await shutdownServices().catch(() => {});
  for (const close of closers.splice(0)) await close();
  vi.unstubAllEnvs();
  _resetEnvCache();
  setNonInteractive(false);
  rmSync(dir, { recursive: true, force: true });
});

/** A fresh MySQL database, which the commands reach through `DATABASE_URL`. */
async function openDatabase(): Promise<string> {
  const scratch = await createScratchDatabase("mysql", "nextly_cms_moves");
  closers.push(() => scratch.drop());
  vi.stubEnv("DB_DIALECT", "mysql");
  vi.stubEnv("DATABASE_URL", scratch.url);
  _resetEnvCache();
  return scratch.url;
}

/** The app over the database at `url`, declaring the posts as given, if any. */
async function start(
  url: string,
  collections?: ReturnType<typeof posts>
): Promise<TestNextly> {
  await shutdownServices().catch(() => {});
  clearServices();
  const adapter = (await createAdapter({
    type: "mysql",
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return createTestNextly({
    adapter: adapter as never,
    ...(collections === undefined ? {} : { collections }),
  });
}

function command(): CommandContext {
  return {
    logger: createLogger({ quiet: true }),
    options: {},
    cwd: dir,
  } as CommandContext;
}

/** Run `fn`, turning `process.exit` into a thrown `exit <code>`. */
async function exiting(fn: () => Promise<void>): Promise<number | undefined> {
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await fn();
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    exit.mockRestore();
  }
}

/** `migrate:create` over `config`, non-interactively, carrying the moves and consenting to drops. */
async function create(name: string, config: unknown): Promise<void> {
  loaded.config = config;
  setNonInteractive(true);
  expect(
    await exiting(() =>
      runMigrateCreate(
        name,
        { cwd: dir, acceptDataLoss: true, acceptMoves: true },
        command()
      )
    )
  ).toBeUndefined();
}

/** `nextly migrate` over the folder, `step` files at most; a failure is what the stop is for. */
async function migrate(step?: number): Promise<void> {
  setNonInteractive(true);
  const quiet = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const logged = vi.spyOn(console, "error").mockReturnValue();
  try {
    await exiting(() =>
      runMigrate(
        {
          cwd: dir,
          acceptDataLoss: true,
          ...(step === undefined ? {} : { step }),
        },
        command()
      )
    );
  } finally {
    quiet.mockRestore();
    logged.mockRestore();
  }
}

function sqlFileNames(): string[] {
  return readdirSync(join(dir, "migrations"))
    .filter(f => f.endsWith(".sql"))
    .sort();
}

const sqlFiles = () => sqlFileNames().length;

/**
 * `nextly migrate` over the folder as a process of its own, at the database `url`, killing itself
 * after statement `n` of `file`; whether it was killed there, rather than running to its end.
 */
async function killedAfter(
  url: string,
  config: unknown,
  file: string,
  n: number
): Promise<boolean> {
  // The project's configuration as a deploy reads it: this process's commands load the mock's.
  writeFileSync(
    join(dir, "nextly.config.ts"),
    `export default ${JSON.stringify(config)};\n`
  );
  const ran = await runNextly(
    ["migrate", "--accept-data-loss", "--non-interactive", "--force-unlock"],
    dir,
    {
      DATABASE_URL: url,
      DB_DIALECT: "mysql",
      NODE_ENV: "test",
      [KILL_AT_VARIABLE]: `${file}: after statement ${String(n)}`,
    }
  );
  if (ran.status === 0) return false;
  expect(ran.stderr, `${ran.stdout}\n${ran.stderr}`).toContain(
    "stopped by SIGKILL"
  );
  await clearDeadLock(url);
  return true;
}

/**
 * The schema lock a killed process left is held until its lease lapses, which a start does not wait
 * out. With nothing else running it is cleared here, as an operator does after a crash, by what
 * `--force-unlock` runs.
 */
async function clearDeadLock(url: string): Promise<void> {
  const adapter = (await createAdapter({
    type: "mysql",
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  try {
    await forceUnlock(adapter.getDrizzle(), "mysql");
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

/**
 * Runs `work` failing it after the `n`th statement a migration file runs; "ran" where it ran fewer
 * statements than that, and so never stopped.
 */
async function stoppedAfter(
  n: number,
  work: () => Promise<unknown>
): Promise<"ran" | "stopped"> {
  let reached = 0;
  let stopped = false;
  await withStopPoints(
    point => {
      if (!/: after statement \d+$/.test(point)) return;
      reached += 1;
      if (reached === n) {
        stopped = true;
        throw new Error(`stopped after statement ${String(n)}`);
      }
    },
    () => work()
  ).catch(error => {
    if (!stopped) throw error;
  });
  return stopped ? "stopped" : "ran";
}

/** The entries, written through the app declaring the posts before the move, into `url`. */
async function writeEntries(
  url: string,
  before: Where,
  required: boolean
): Promise<void> {
  const writer = await start(url, posts(before, required));
  for (const { title, slug, ...values } of ENTRIES) {
    await writer.nextly.create({
      collection: SLUG as never,
      data: (before === "grouped"
        ? { title, slug, meta: { note: "n", ...values } }
        : { title, slug, ...values, meta: { note: "n" } }) as never,
    });
  }
  await shutdownServices().catch(() => {});
}

/** The config before the move and after it. */
const configs = (before: Where, after: Where, required: boolean) =>
  [posts(before, required), posts(after, required)].map(collections =>
    defineConfig({ collections, db: { migrationsDir: "./migrations" } })
  );

const run = <T>(t: TestNextly, statement: string) =>
  (t.adapter as unknown as DrizzleAdapter).executeQuery(
    statement
  ) as unknown as Promise<T[]>;

/**
 * After a stop: every entry's moved values sit in the column or the group's JSON, and where the
 * registry places the field. Soft, so a run names every stop and every field that breaks.
 */
async function expectEveryValueKept(
  t: TestNextly,
  label: string
): Promise<void> {
  const columns = (
    await run<{ name: string }>(
      t,
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}'`
    )
  ).map(row => row.name);
  const rows = await run<Record<string, unknown>>(
    t,
    `SELECT * FROM \`${TABLE}\``
  );
  const [registry] = await run<{ fields: unknown }>(
    t,
    `SELECT fields FROM dynamic_collections WHERE slug = '${SLUG}'`
  );
  const fields = (
    typeof registry?.fields === "string"
      ? JSON.parse(registry.fields)
      : registry?.fields
  ) as { name?: string }[] | undefined;
  for (const entry of ENTRIES) {
    // By slug: on per-language storage the title is translated, kept in the language table.
    const row = rows.find(r => r.slug === entry.slug);
    const meta = (
      typeof row?.meta === "string" ? JSON.parse(row.meta) : (row?.meta ?? {})
    ) as Record<string, unknown>;
    for (const name of MOVED) {
      const at = `${label}: ${entry.slug}.${name}`;
      const expected = entry[name];
      const inColumn = columns.includes(name) ? row?.[name] : undefined;
      const inGroup = meta[name];
      // In one of its two places.
      expect
        .soft(inColumn === expected || inGroup === expected, `${at} stored`)
        .toBe(true);
      // Where the registry places it.
      const placedOnRow = (fields ?? []).some(field => field.name === name);
      expect
        .soft(
          placedOnRow ? inColumn : inGroup,
          `${at} where the registry reads`
        )
        .toBe(expected);
    }
  }
}

describe.runIf(getConfiguredTestDialects().includes("mysql"))(
  "a field moved in code, stopped part-way on MySQL, leaves every value where the registry reads it",
  () => {
    it.each(SCENARIOS)(
      "$name: stopped after each statement of the move's file",
      async ({ before, after, required }) => {
        const [beforeConfig, afterConfig] = configs(before, after, required);
        // The files, written once over a first database: the collection, then the move.
        await openDatabase();
        await create("create_posts", beforeConfig);
        const created = sqlFiles();
        await create("move_fields", afterConfig);
        expect(sqlFiles()).toBeGreaterThan(created);

        let stops = 0;
        let ranToTheEnd = false;
        for (let n = 1; n < 60; n++) {
          // A database of its own for each stop, holding the entries before the move runs.
          const url = await openDatabase();
          await migrate(created);
          await writeEntries(url, before, required);
          if ((await stoppedAfter(n, () => migrate())) === "ran") {
            ranToTheEnd = true;
            break;
          }
          stops += 1;
          await expectEveryValueKept(
            await start(url),
            `after statement ${String(n)}`
          );
        }
        // The move's files ran statements, so the stops reached them, and every one was stopped after.
        expect(stops).toBeGreaterThan(0);
        expect(ranToTheEnd).toBe(true);
      },
      600_000
    );

    it.each(SCENARIOS)(
      "$name: the process killed after each statement of the move's files",
      async ({ before, after, required }) => {
        const [beforeConfig, afterConfig] = configs(before, after, required);
        await openDatabase();
        await create("create_posts", beforeConfig);
        const created = sqlFiles();
        await create("move_fields", afterConfig);

        const killed: string[] = [];
        for (const file of sqlFileNames().slice(created)) {
          let ranToTheEnd = false;
          for (let n = 1; n < 60; n++) {
            const url = await openDatabase();
            await migrate(created);
            await writeEntries(url, before, required);
            if (!(await killedAfter(url, afterConfig, file, n))) {
              ranToTheEnd = true;
              break;
            }
            killed.push(`${file}: ${String(n)}`);
            await expectEveryValueKept(
              await start(url),
              `killed in ${file} after statement ${String(n)}`
            );
          }
          expect(ranToTheEnd, `${file} ran to its end`).toBe(true);
        }
        // Each of the move's files was killed in.
        for (const file of sqlFileNames().slice(created)) {
          expect(killed.some(at => at.startsWith(file))).toBe(true);
        }
      },
      40 * NEXTLY_RUN_TIMEOUT
    );
  }
);
