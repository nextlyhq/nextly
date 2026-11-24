/**
 * On MySQL a schema statement commits as it runs, so a field move that stops part-way, by a failure
 * after any one of its statements, leaves what ran before it in place. Every entry's value must
 * still be readable from the place the field was moving from or the place it was moving to, the
 * registry must place the field where its values are, and reading the entry through the API must
 * return them.
 *
 * Proved for a move into a group, out of one, and out of one into a required field, through the
 * Builder's schema dialog and through `nextly migrate` replaying the dialog's files into a second
 * database: each stop after statement N, for every N the move's file reaches.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import type { CollectionService } from "../../../collections/services/collection-service";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { resolveDataLossConsent } from "../../migrate/data-loss-consent";
import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { withStopPoints } from "../../migrate/stop-points";

// Written for per-language storage as every installation runs it (`storage-layout`). The moved fields
// are shared, kept on the entry's own row in every language: a translated field's move goes through
// its language table, which these statements do not cover.
perLanguageStorageSuite();

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "msp_posts";
const TABLE = "dc_msp_posts";

type Field = Record<string, unknown>;
type Move = { from: string[]; to: string[] };

const MOVED = ["summary", "subtitle"] as const;
const NOTE: Field = { name: "note", type: "text" };
const group = (fields: Field[]): Field => ({
  name: "meta",
  type: "group",
  fields,
});
const moved = (required: boolean): Field[] =>
  MOVED.map(name => ({
    name,
    type: "text",
    localized: false,
    ...(required ? { required } : {}),
  }));

/** A field the save adds beside its moves. */
const EXTRA: Field = { name: "extra", type: "text", localized: false };

/**
 * Each scenario: the fields before and after, the moves the Builder sends, and how many files the
 * save writes: the moves' own, and one more where the save has anything else to change.
 */
const SCENARIOS: {
  name: string;
  before: Field[];
  after: Field[];
  moves: Move[];
  files: number;
}[] = [
  {
    name: "into a group",
    before: [...moved(false), group([NOTE])],
    after: [group([NOTE, ...moved(false)])],
    moves: MOVED.map(name => ({ from: [name], to: ["meta", name] })),
    // The second drops the columns they left.
    files: 2,
  },
  {
    name: "into a group, beside a field added",
    before: [...moved(false), group([NOTE])],
    after: [EXTRA, group([NOTE, ...moved(false)])],
    moves: MOVED.map(name => ({ from: [name], to: ["meta", name] })),
    files: 2,
  },
  {
    name: "out of a group",
    before: [group([NOTE, ...moved(false)])],
    after: [...moved(false), group([NOTE])],
    moves: MOVED.map(name => ({ from: ["meta", name], to: [name] })),
    // Nothing is left to change once the values are out.
    files: 1,
  },
  {
    name: "out of a group, beside a field added",
    before: [group([NOTE, ...moved(false)])],
    after: [...moved(false), EXTRA, group([NOTE])],
    moves: MOVED.map(name => ({ from: ["meta", name], to: [name] })),
    files: 2,
  },
  {
    name: "out of a group, into a required field",
    before: [group([NOTE, ...moved(false)])],
    after: [...moved(true), group([NOTE])],
    moves: MOVED.map(name => ({ from: ["meta", name], to: [name] })),
    // The second makes them required.
    files: 2,
  },
];

/** Entries holding a value in every moved field, characters JSON escapes among them. */
const ENTRIES = [
  { title: "One", slug: "one", summary: "First", subtitle: "a" },
  { title: "Two", slug: "two", summary: 'He said "hi" \\ — ü', subtitle: "b" },
  { title: "Three", slug: "three", summary: "Third", subtitle: "c" },
];

let instance: TestNextly | undefined;
let basePath: string;
/** Every folder a case made, removed after it. */
let folders: string[] = [];

/** A fresh folder for the definition and migration files, so a stop starts from nothing written. */
async function freshFolder(): Promise<void> {
  basePath = await mkdtemp(join(tmpdir(), "nextly-move-stopped-"));
  folders.push(basePath);
}

beforeEach(async () => {
  folders = [];
  await freshFolder();
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
    for (const folder of folders) {
      await rm(folder, { recursive: true, force: true });
    }
  }
});

async function boot(): Promise<TestNextly> {
  await instance?.destroy();
  instance = await createTestNextly({ dialect: "mysql", basePath, db: DB });
  return instance;
}

const run = <T>(t: TestNextly, statement: string) =>
  (t.adapter as unknown as DrizzleAdapter).executeQuery(
    statement
  ) as unknown as Promise<T[]>;

async function createPosts(t: TestNextly, fields: Field[]): Promise<void> {
  await t.getService("collectionService").createCollection(
    {
      name: SLUG,
      label: "Post",
      localized: false,
      fields,
    } as Parameters<CollectionService["createCollection"]>[0],
    {}
  );
}

/** The entries, each moved value written where `fields` places it. */
async function seed(t: TestNextly, fields: Field[]): Promise<void> {
  const inGroup = !fields.some(field => field.name === MOVED[0]);
  for (const { title, slug, ...values } of ENTRIES) {
    const data = inGroup
      ? { title, slug, meta: { note: "n", ...values } }
      : { title, slug, ...values, meta: { note: "n" } };
    await t.nextly.create({ collection: SLUG, data });
  }
}

async function versionOf(t: TestNextly): Promise<number> {
  const [row] = await run<{ version: number | string | null }>(
    t,
    `SELECT schema_version AS version FROM dynamic_collections WHERE slug = '${SLUG}'`
  );
  return Number(row?.version ?? 1);
}

/** The schema dialog's save of `fields`, with the moves the Builder sends. */
async function save(t: TestNextly, fields: Field[], moves: Move[]) {
  await dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: SLUG },
    {
      fields,
      confirmed: true,
      schemaVersion: await versionOf(t),
      hints: { moves },
    }
  );
  clearRegistryRowCache();
}

/** `nextly migrate` on `t`'s database over the folder the dialog wrote. */
async function migrateFolder(t: TestNextly, step?: number): Promise<void> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  await migrateCore({
    ...(step === undefined ? {} : { step }),
    extensionSchema: undefined,
    dialect: "mysql",
    db: adapter.getDrizzle(),
    adapter: adapter as never,
    migrationsDir: join(basePath, "migrations"),
    logger: createLogger({ quiet: true }),
    lockMode: "fail-fast",
    // An unattended run is asked consent for every column a file drops, a moved one included.
    consent: resolveDataLossConsent({
      flag: MOVED.map(name => `${TABLE}.${name}`).join(","),
      env: {},
    }),
    interactive: false,
  } as never);
  clearRegistryRowCache();
}

async function filesWritten(): Promise<number> {
  return (await readdir(join(basePath, "migrations"))).filter(f =>
    f.endsWith(".sql")
  ).length;
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

/**
 * After a stop: every entry's moved values read back through the API, sit in the column or the
 * group's JSON, and sit where the registry places the field. Soft, so a run names every stop and
 * every field that breaks.
 */
async function expectEveryValueReadable(
  t: TestNextly,
  label: string
): Promise<void> {
  clearRegistryRowCache();
  let read: Map<string, Record<string, unknown>> | undefined;
  try {
    const { items } = await t.nextly.find({ collection: SLUG, limit: 100 });
    read = new Map(
      (items as Record<string, unknown>[]).map(item => [
        String(item.slug),
        item,
      ])
    );
  } catch (error) {
    expect.soft(String(error), `${label}: reading the entries`).toBe("");
  }
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
  ) as Field[];
  for (const entry of ENTRIES) {
    const row = rows.find(r => r.slug === entry.slug);
    const meta = (
      typeof row?.meta === "string" ? JSON.parse(row.meta) : (row?.meta ?? {})
    ) as Record<string, unknown>;
    const item = read?.get(entry.slug);
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
      const placedOnRow = fields.some(field => field.name === name);
      expect
        .soft(
          placedOnRow ? inColumn : inGroup,
          `${at} where the registry reads`
        )
        .toBe(expected);
      // Returned by a read of the entry, at the field's place: a stray key left in the group's
      // value is not the field's value where the registry places it on the row.
      const returned = placedOnRow
        ? item?.[name]
        : (item?.meta as Record<string, unknown> | undefined)?.[name];
      expect.soft(returned, `${at} read back`).toBe(expected);
    }
  }
}

describe.runIf(getConfiguredTestDialects().includes("mysql"))(
  "a field move stopped part-way on MySQL leaves every value readable",
  () => {
    describe.each(SCENARIOS)("$name", ({ before, after, moves, files }) => {
      it("through the Builder's schema dialog, stopped after each statement", async () => {
        let stops = 0;
        let ranToTheEnd = false;
        for (let n = 1; n < 60; n++) {
          await instance?.destroy();
          instance = undefined;
          await freshFolder();
          const t = await boot();
          await createPosts(t, before);
          await seed(t, before);
          if ((await stoppedAfter(n, () => save(t, after, moves))) === "ran") {
            ranToTheEnd = true;
            break;
          }
          stops += 1;
          await expectEveryValueReadable(t, `after statement ${String(n)}`);
        }
        // The files ran statements, so the stops reached them, and every one was stopped after.
        expect(stops).toBeGreaterThan(0);
        expect(ranToTheEnd).toBe(true);
      }, 600_000);

      it("through nextly migrate, replaying the dialog's files, stopped after each statement", async () => {
        const first = await boot();
        await createPosts(first, before);
        const created = await filesWritten();
        await save(first, after, moves);
        expect((await filesWritten()) - created).toBe(files);

        let stops = 0;
        let ranToTheEnd = false;
        for (let n = 1; n < 60; n++) {
          const second = await boot();
          await migrateFolder(second, created);
          await seed(second, before);
          // Counted from the save's files alone: the earlier ones have run.
          if ((await stoppedAfter(n, () => migrateFolder(second))) === "ran") {
            ranToTheEnd = true;
            break;
          }
          stops += 1;
          await expectEveryValueReadable(
            second,
            `migrate, after statement ${String(n)}`
          );
        }
        expect(stops).toBeGreaterThan(0);
        expect(ranToTheEnd).toBe(true);
      }, 600_000);
    });
  }
);
