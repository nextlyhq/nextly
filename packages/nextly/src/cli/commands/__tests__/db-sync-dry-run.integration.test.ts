/**
 * `nextly db:sync --dry-run`, in every mode, run as a shell runs it, on every dialect this run can
 * reach. Each property is asserted against the whole database (every table's columns and rows,
 * the schema lock's tables aside, which the process holding the lock writes) and the
 * configuration file:
 *
 * - a dry run of each mode changes nothing, waits for no lock (another process holds it the whole
 *   time), asks nothing (no terminal is attached, where promote and demote would refuse their
 *   confirmation), exits 0, and names the changes;
 * - where the real run would refuse, the dry run names that refusal and still exits 0;
 * - the real runs afterwards make exactly the changes the dry runs named: the push's tables and
 *   columns, the orphan tables dropped, the snippet appended and the registry row removed, the
 *   registry record written;
 * - a real `db:sync` prints and changes what it did before the dry run shared its code.
 */
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashManifest } from "../../../domains/field-groups/migration/manifest";
import { beginMigration } from "../../../domains/field-groups/migration/state";
import { MetaService } from "../../../domains/meta/services/meta-service";
import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import {
  LOCK_DIALECTS,
  lockWorld,
  startHolder,
  type Holder,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import type { CollectionRegistryService } from "../../../services/collections/collection-registry-service";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";
import { createLogger } from "../../utils/logger";
import { collectionRegistryOn } from "../db-sync-registry";
import { migrateCore } from "../migrate";

/** A collection in code throughout; the second configuration adds a column to it. */
const POSTS = "dsd_posts";
/** In code in the first configuration only, so an orphan in the second. */
const OLD = "dsd_old";
/** In code in the second configuration only, never synced: what a demote registers. */
const MOVED = "dsd_moved";
/** Built in the Schema Builder: what a promote moves to code. */
const BUILT = "dsd_built";
/** A second Builder collection, for the refusals after the first is promoted. */
const BUILT_LATER = "dsd_built_later";

const TITLE = `{ name: "title", type: "text" }`;
const SUMMARY = `{ name: "summary", type: "text" }`;

/** The first configuration: what the database is synced to before the dry runs. */
const CONFIG_V1 = `export default {
  collections: [
    { slug: "${POSTS}", fields: [${TITLE}] },
    { slug: "${OLD}", fields: [${TITLE}] },
  ],
};
`;
/** The second: a column added, a collection removed, one added. */
const CONFIG_V2 = `export default {
  collections: [
    { slug: "${POSTS}", fields: [${TITLE}, ${SUMMARY}] },
    { slug: "${MOVED}", fields: [${TITLE}] },
  ],
};
`;

/** The tables the schema lock keeps its row in; the process holding it writes them. */
const LOCK_TABLES = new Set([
  "nextly_schema_lock",
  "nextly_field_group_lock",
  "nextly_migrate_lock",
]);

const logger = createLogger({ quiet: true });

const quote = (dialect: SupportedDialect, name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** Every table but the lock's, with its columns as the pipeline reads them and all its rows. */
async function databaseState(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<{ shape: unknown; rows: Record<string, string[]> }> {
  const tables = (await adapter.listTables())
    .filter(name => !LOCK_TABLES.has(name))
    .sort();
  const shape = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    dialect,
    tables
  );
  const rows: Record<string, string[]> = {};
  for (const table of tables) {
    const read = await adapter.executeQuery<Record<string, unknown>>(
      `SELECT * FROM ${quote(dialect, table)}`
    );
    rows[table] = read.map(row => JSON.stringify(row)).sort();
  }
  return { shape, rows };
}

/** Each table's columns, by name, from the same reading. */
async function columnsByTable(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<Map<string, Set<string>>> {
  const tables = (await adapter.listTables()).filter(
    name => !LOCK_TABLES.has(name)
  );
  const shape = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    dialect,
    tables
  );
  return new Map(
    shape.tables.map(table => [
      table.name,
      new Set(table.columns.map(column => column.name)),
    ])
  );
}

/** What changed between two readings: the tables added and dropped, and the columns added. */
function schemaChanges(
  before: Map<string, Set<string>>,
  after: Map<string, Set<string>>
): { addedTables: string[]; droppedTables: string[]; addedColumns: string[] } {
  const addedTables = [...after.keys()].filter(name => !before.has(name));
  const droppedTables = [...before.keys()].filter(name => !after.has(name));
  const addedColumns: string[] = [];
  for (const [table, columns] of after) {
    const had = before.get(table);
    if (had === undefined) continue;
    for (const column of columns) {
      if (!had.has(column)) addedColumns.push(`${table}.${column}`);
    }
  }
  return {
    addedTables: addedTables.sort(),
    droppedTables: droppedTables.sort(),
    addedColumns: addedColumns.sort(),
  };
}

/** What a dry run's lines name the push doing to tables and columns. */
function plannedSchemaChanges(stdout: string): {
  addedTables: string[];
  addedColumns: string[];
} {
  const addedTables = [...stdout.matchAll(/^ℹ Would run add_table (\S+)$/gm)]
    .map(match => match[1])
    .sort();
  const addedColumns = [
    ...stdout.matchAll(/^ℹ Would run add_column (\S+?)\.(\S+) \(/gm),
  ]
    .map(match => `${match[1]}.${match[2]}`)
    .sort();
  return { addedTables, addedColumns };
}

/** The tables a dry run's lines name as deleted, in the consent listing's words. */
function plannedDrops(stdout: string): string[] {
  return [...stdout.matchAll(/^ℹ Would remove table ([^\s,(]+)/gm)]
    .map(match => match[1])
    .sort();
}

/** A run's output, its paths, database name and timings made the same on every run. */
function normalised(text: string, project: string, url: string): string[] {
  const database = new URL(url.startsWith("/") ? `file://${url}` : url)
    .pathname;
  return text
    .split("\n")
    .map(line =>
      line
        .split(project)
        .join("<project>")
        .split(database)
        .join("<database>")
        .replace(/\b\d+(\.\d+)?\s?(ms|s)\b/g, "<time>")
        // The system permissions are the core's own and grow as it does; the collection count is
        // this test's, and stays pinned.
        .replace(
          /\d+ system \+ (\d+) collection permission\(s\) created \(\d+ total\)/,
          "<n> system + $1 collection permission(s) created (<n> total)"
        )
        // A later sync creates only the collection's own, but its total still counts the core's.
        .replace(
          /(Permissions: \d+ collection permission\(s\) created) \(\d+ total\)/,
          "$1 (<n> total)"
        )
        // A box's padding follows the width of the timing it frames.
        .replace(/ {2,}\|$/, " |")
        .trimEnd()
    )
    .filter(line => line.length > 0);
}

/** A world of its own on `dialect`, its system tables made by the production core reconcile. */
async function syncedWorld(dialect: SupportedDialect): Promise<{
  world: LockWorld;
  adapter: DrizzleAdapter;
  project: string;
}> {
  const world = await lockWorld(dialect, { fresh: true });
  const adapter = await world.connect();
  // By its real path: the CLI prints the config it loaded by that, and on
  // macOS the temporary directory is reached through a symbolic link.
  const project = realpathSync(
    mkdtempSync(join(tmpdir(), "nextly-db-sync-dry-"))
  );
  writeFileSync(join(project, "nextly.config.ts"), CONFIG_V1);
  await migrateCore({
    extensionSchema: undefined,
    dialect,
    db: adapter.getDrizzle(),
    adapter: adapter as never,
    migrationsDir: mkdtempSync(join(project, "migrations-")),
    logger,
    lockMode: "wait",
    lockWaitMs: 1_000,
    ensureLedger: () => ensureSchemaEventsTable(adapter),
  });
  return { world, adapter, project };
}

/** `nextly <args>` in `project`, against `world`'s database. */
function nextlyIn(world: LockWorld, project: string) {
  return (args: string[], env: Record<string, string | undefined> = {}) =>
    runNextly(args, project, {
      NODE_ENV: undefined,
      CI: undefined,
      NEXTLY_ACCEPT_DATA_LOSS: undefined,
      DB_DIALECT: world.dialect,
      DATABASE_URL:
        world.dialect === "sqlite" ? `file:${world.url}` : world.url,
      NEXTLY_SECRET: randomBytes(32).toString("hex"),
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      ...env,
    });
}

/** Every file under `dir`, relative to it, sorted. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry =>
      relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/")
    )
    .sort();
}

/** The files a dry run's lines name as written. */
function plannedWrites(stdout: string): string[] {
  return [...stdout.matchAll(/^ℹ Would write (\S+)$/gm)]
    .map(match => match[1])
    .sort();
}

/**
 * The columns of this test's own tables (its `dsd_…` collections, stored as `dc_dsd_…`, and the `dsd_…` table it creates itself), each sorted. The core's tables
 * are left out: they grow whenever the core adds one, which says nothing about what db:sync does
 * with the collections the test declares.
 */
function ownTableShapes(
  shapes: Iterable<[string, Iterable<string>]>
): [string, string[]][] {
  return [...shapes]
    .filter(([table]) => /(^|_)dsd_/.test(table))
    .map(([table, columns]): [string, string[]] => [
      table,
      [...columns].sort(),
    ]);
}

/**
 * Every dialect the snapshots below are recorded for. A dialect this run cannot reach is
 * declared and skipped rather than left out: a skipped test keeps its snapshots, while one never
 * declared leaves them unchecked, which Vitest fails as obsolete wherever snapshots are not being
 * updated, as on CI, where each leg reaches only some of the dialects.
 */
const SNAPSHOT_DIALECTS: readonly SupportedDialect[] = [
  "sqlite",
  "postgresql",
  "mysql",
];

/** The snapshot test's name, which its snapshots are keyed by, skipped or run. */
const REAL_SYNC_TEST =
  "prints and changes what it did before the dry run shared its code";

describe.each(SNAPSHOT_DIALECTS)("a real db:sync on %s", dialect => {
  if (!LOCK_DIALECTS.includes(dialect)) {
    it.skip(REAL_SYNC_TEST);
    return;
  }
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let project: string;

  beforeAll(async () => {
    ({ world, adapter, project } = await syncedWorld(dialect));
  }, 120_000);

  afterAll(async () => {
    await adapter?.disconnect();
    if (project !== undefined)
      rmSync(project, { recursive: true, force: true });
    await world?.dispose();
  }, 60_000);

  it(
    REAL_SYNC_TEST,
    async () => {
      const nextly = nextlyIn(world, project);
      const first = await nextly(["db:sync"]);
      expect(first.status, first.stdout + first.stderr).toBe(0);
      expect(normalised(first.stdout, project, world.url)).toMatchSnapshot(
        "first sync output"
      );
      const shapeAfterFirst = ownTableShapes(
        await columnsByTable(adapter, dialect)
      );
      expect(shapeAfterFirst.sort()).toMatchSnapshot("tables after first sync");

      writeFileSync(join(project, "nextly.config.ts"), CONFIG_V2);
      const second = await nextly(["db:sync"]);
      expect(second.status, second.stdout + second.stderr).toBe(0);
      expect(normalised(second.stdout, project, world.url)).toMatchSnapshot(
        "second sync output"
      );
      const shapeAfterSecond = ownTableShapes(
        await columnsByTable(adapter, dialect)
      );
      expect(shapeAfterSecond.sort()).toMatchSnapshot(
        "tables after second sync"
      );
    },
    3 * NEXTLY_RUN_TIMEOUT
  );
});

describe.each(LOCK_DIALECTS)("db:sync --dry-run on %s", dialect => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let project: string;
  let registry: CollectionRegistryService;
  let nextly: ReturnType<typeof nextlyIn>;
  let holder: Holder | undefined;
  const configFile = () => join(project, "nextly.config.ts");

  /** What each dry run printed, for the real runs to be held to. */
  const printed: Record<string, string> = {};

  beforeAll(async () => {
    ({ world, adapter, project } = await syncedWorld(dialect));
    registry = collectionRegistryOn(adapter, logger);
    nextly = nextlyIn(world, project);
    // The database as the first configuration leaves it, then the second written over it.
    const setup = await nextly(["db:sync"]);
    expect(setup.status, setup.stdout + setup.stderr).toBe(0);
    writeFileSync(configFile(), CONFIG_V2);
    for (const slug of [BUILT, BUILT_LATER]) {
      await registry.registerCollection({
        slug,
        labels: { singular: slug, plural: slug },
        tableName: `dc_${slug}`,
        fields: [{ name: "title", type: "text" }] as never,
        source: "ui",
        schemaHash: `dsd-${slug}`,
        configPath: "dsd",
      });
    }
  }, 3 * NEXTLY_RUN_TIMEOUT);

  afterAll(async () => {
    if (holder !== undefined) {
      holder.kill("SIGKILL");
      await holder.exited;
    }
    await adapter?.disconnect();
    if (project !== undefined)
      rmSync(project, { recursive: true, force: true });
    await world?.dispose();
  }, 60_000);

  /** Runs a dry run, and asserts it exited 0 and said it changed nothing. */
  async function dryRun(
    name: string,
    args: string[],
    env: Record<string, string | undefined> = {}
  ): Promise<string> {
    const run = await nextly(["db:sync", ...args, "--dry-run"], env);
    expect(run.status, `${name}: ${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout, name).toContain("Dry run: nothing was changed.");
    printed[name] = run.stdout;
    return run.stdout;
  }

  it(
    "changes nothing in any mode, waits for no lock, asks nothing and names the changes",
    async () => {
      holder = startHolder(world, {
        command: "nextly migrate",
        leaseSeconds: 60,
        prefix: "dsd_holder",
      });
      await holder.printed("held");
      const before = await databaseState(adapter, dialect);
      const config = readFileSync(configFile(), "utf8");

      const plain = await dryRun("plain", []);
      expect(plain).toMatch(
        /^ℹ Would run add_column dc_dsd_posts\.summary \(/m
      );
      expect(plain).toMatch(/^ℹ Would run add_table dc_dsd_moved$/m);
      expect(plain).toMatch(/^ℹ Would run add_table dc_dsd_built$/m);
      // The orphan is left out of the push, as the real run leaves it.
      expect(plain).not.toMatch(/dc_dsd_old/);
      expect(plain).toContain(
        "made against the registry as it stands before the sync rewrites it"
      );

      const orphans = await dryRun("remove-orphaned", ["--remove-orphaned"]);
      expect(orphans).toMatch(/^ℹ Would remove table dc_dsd_old\b/m);
      expect(orphans).toMatch(
        /^ℹ Would run add_column dc_dsd_posts\.summary \(/m
      );

      const promote = await dryRun("promote", ["--promote", BUILT]);
      expect(promote).toContain(`Would edit ${configFile()}`);
      expect(promote).toContain("// Promoted from UI source on ");
      expect(promote).toContain(`//   slug: "${BUILT}",`);
      expect(promote).toContain(
        `Would remove the registry row of collection '${BUILT}' (its table dc_${BUILT} and its rows are kept)`
      );

      const demote = await dryRun("demote", ["--demote", MOVED]);
      expect(demote).toContain(
        `Would record collection '${MOVED}' in the collection registry, as:`
      );
      expect(demote).toContain(`"source": "ui"`);
      expect(demote).toContain(`"configPath": "demoted-from-code"`);

      // The refusals a real run would make, named, with exit 0.
      const missing = await dryRun("promote missing", [
        "--promote",
        "dsd_nowhere",
      ]);
      expect(missing).toContain(
        "A real run would refuse: Collection 'dsd_nowhere' not found in UI source (dynamic_collections)."
      );
      expect(missing).not.toMatch(/^ℹ Would /m);
      const promoteCoded = await dryRun("promote coded", ["--promote", POSTS]);
      expect(promoteCoded).toContain(
        "A real run would refuse: This collection is defined in code, so it can't be deleted here."
      );
      expect(promoteCoded).not.toMatch(/^ℹ Would /m);
      const demoteCoded = await dryRun("demote coded", ["--demote", POSTS]);
      expect(demoteCoded).toContain(
        "A real run would refuse: This collection is defined in code, so it can't be changed here."
      );
      expect(demoteCoded).not.toMatch(/^ℹ Would /m);
      const demoteMissing = await dryRun("demote missing", [
        "--demote",
        "dsd_nowhere",
      ]);
      expect(demoteMissing).toContain(
        "A real run would refuse: Collection 'dsd_nowhere' not found in nextly.config.ts collections."
      );

      expect(await databaseState(adapter, dialect)).toEqual(before);
      expect(readFileSync(configFile(), "utf8")).toBe(config);
      // The holder held the lock throughout: a dry run that waited for it would have waited a
      // minute and been refused, exit 1. Released now, so the real runs below need not wait.
      holder.send("release");
      await holder.printed("released");
      await holder.exited;
      holder = undefined;
    },
    12 * NEXTLY_RUN_TIMEOUT
  );

  it(
    "names the production refusal a real sync makes on collections it would change, exit 0",
    async () => {
      const before = await databaseState(adapter, dialect);
      const out = await dryRun("production", [], { NODE_ENV: "production" });
      // The registry step creates dsd_moved and rewrites dsd_posts' fields.
      expect(out).toContain(
        "A real run would refuse: Cannot auto-sync schema in production mode. `NODE_ENV` is `production`, and 2 collections would change: dsd_moved, dsd_posts."
      );
      expect(out).not.toMatch(/^ℹ Would run /m);
      // A real production run still creates and updates Single and field-group tables, so the
      // note must not claim it changes no schema.
      expect(out).toContain(
        "NODE_ENV is production: a real run pushes no collection schema change, but still creates or updates Single and field-group tables, which are not shown here (use nextly migrate:create and nextly migrate for collections)."
      );
      expect(out).not.toContain("a real run applies no schema change");
      expect(await databaseState(adapter, dialect)).toEqual(before);
    },
    2 * NEXTLY_RUN_TIMEOUT
  );

  it(
    "real runs afterwards make exactly the changes the dry runs named",
    async () => {
      // The demote first: a sync registers every collection the configuration declares as
      // defined in code, which a demote is then refused on. The record the dry run showed is the
      // record registered.
      const demote = await nextly(["db:sync", "--demote", MOVED, "--yes"]);
      expect(demote.status, demote.stdout + demote.stderr).toBe(0);
      const shownRecord = JSON.parse(
        printed.demote.slice(
          printed.demote.indexOf("{"),
          printed.demote.lastIndexOf("}") + 1
        )
      ) as Record<string, unknown>;
      const stored = await registry.getCollectionBySlug(MOVED);
      expect(stored).not.toBeNull();
      expect({
        slug: stored!.slug,
        labels: stored!.labels,
        tableName: stored!.tableName,
        fields: stored!.fields,
        source: stored!.source,
        schemaHash: stored!.schemaHash,
        configPath: stored!.configPath,
      }).toEqual({
        slug: shownRecord.slug,
        labels: shownRecord.labels,
        tableName: shownRecord.tableName,
        fields: shownRecord.fields,
        source: shownRecord.source,
        schemaHash: shownRecord.schemaHash,
        configPath: shownRecord.configPath,
      });

      // The sync with --remove-orphaned: the push the plain dry run named, and the drops.
      const before = await columnsByTable(adapter, dialect);
      const sync = await nextly([
        "db:sync",
        "--remove-orphaned",
        "--accept-data-loss",
      ]);
      expect(sync.status, sync.stdout + sync.stderr).toBe(0);
      const changed = schemaChanges(
        before,
        await columnsByTable(adapter, dialect)
      );
      const planned = plannedSchemaChanges(printed.plain);
      expect(planned.addedTables.length).toBeGreaterThan(0);
      expect(changed.addedTables).toEqual(planned.addedTables);
      expect(changed.addedColumns).toEqual(planned.addedColumns);
      expect(plannedSchemaChanges(printed["remove-orphaned"])).toEqual(planned);
      expect(changed.droppedTables).toEqual(
        plannedDrops(printed["remove-orphaned"])
      );

      // The promote: the snippet the dry run showed appended, the registry row gone, the table kept.
      const configBefore = readFileSync(configFile(), "utf8");
      const promote = await nextly(["db:sync", "--promote", BUILT, "--yes"]);
      expect(promote.status, promote.stdout + promote.stderr).toBe(0);
      const appended = readFileSync(configFile(), "utf8").slice(
        configBefore.length
      );
      const withoutTime = (text: string) =>
        text.replace(/Promoted from UI source on \S+\./, "Promoted <at>.");
      const shown = printed.promote
        .split("\n")
        .filter(line => line.startsWith("//"))
        .join("\n");
      expect(withoutTime(appended).trim()).toBe(withoutTime(shown).trim());
      expect(await registry.getCollectionBySlug(BUILT)).toBeNull();
      expect(await adapter.tableExists(`dc_${BUILT}`)).toBe(true);
    },
    6 * NEXTLY_RUN_TIMEOUT
  );

  it(
    "refuses a real promote of a collection defined in code before it appends anything",
    async () => {
      const config = readFileSync(configFile(), "utf8");
      const record = JSON.stringify(await registry.getCollectionBySlug(POSTS));
      const run = await nextly(["db:sync", "--promote", POSTS, "--yes"]);
      expect(run.status, run.stdout + run.stderr).toBe(1);
      expect(run.stdout + run.stderr).toContain(
        "This collection is defined in code, so it can't be deleted here."
      );
      expect(readFileSync(configFile(), "utf8")).toBe(config);
      expect(JSON.stringify(await registry.getCollectionBySlug(POSTS))).toBe(
        record
      );
    },
    2 * NEXTLY_RUN_TIMEOUT
  );

  it(
    "names the files --types and --schemas write, writes none; a real run writes exactly those",
    async () => {
      const before = await databaseState(adapter, dialect);
      const filesBefore = filesUnder(project);
      const out = await dryRun("files", ["--types", "--schemas"]);
      const named = plannedWrites(out);
      expect(named).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/dsd_posts\.zod\.ts$/),
          expect.stringMatching(/dsd_moved\.zod\.ts$/),
        ])
      );
      expect(named.some(file => !file.endsWith(".zod.ts"))).toBe(true);
      expect(filesUnder(project)).toEqual(filesBefore);
      expect(await databaseState(adapter, dialect)).toEqual(before);

      const real = await nextly(["db:sync", "--types", "--schemas"]);
      expect(real.status, real.stdout + real.stderr).toBe(0);
      const written = filesUnder(project).filter(
        file => !filesBefore.includes(file)
      );
      expect(written).toEqual(named);
    },
    3 * NEXTLY_RUN_TIMEOUT
  );

  it(
    "names a field-group storage migration in flight as the real run's refusal, exit 0",
    async () => {
      const entries = [
        { kind: "table" as const, from: "comp_hero", to: "fg_hero" },
        {
          kind: "registry" as const,
          from: "dynamic_components",
          to: "dynamic_field_groups",
        },
      ];
      await beginMigration(new MetaService(adapter, logger), {
        direction: "up",
        migrationId: "dsd-stalled",
        plan: { registryHash: "dsd", manifestHash: hashManifest(entries) },
        appliedManifest: entries,
      });
      const before = await databaseState(adapter, dialect);
      const config = readFileSync(configFile(), "utf8");
      const refusal =
        "A real run would refuse: The command did not run: a field-group storage migration is in flight on this database.";
      for (const [name, args] of [
        ["stalled plain", []],
        ["stalled remove-orphaned", ["--remove-orphaned"]],
        ["stalled promote", ["--promote", BUILT_LATER]],
        ["stalled demote", ["--demote", POSTS]],
      ] as const) {
        const out = await dryRun(name, [...args]);
        expect(out, name).toContain(refusal);
        expect(out, name).not.toMatch(/^ℹ Would /m);
      }
      expect(await databaseState(adapter, dialect)).toEqual(before);
      expect(readFileSync(configFile(), "utf8")).toBe(config);
    },
    5 * NEXTLY_RUN_TIMEOUT
  );
});

describe.each(LOCK_DIALECTS)(
  "db:sync --dry-run on %s with no core tables",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let project: string;

    beforeAll(async () => {
      // A database of its own that nothing has set up: no core tables, no registries.
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      project = realpathSync(
        mkdtempSync(join(tmpdir(), "nextly-db-sync-dry-fresh-"))
      );
      writeFileSync(join(project, "nextly.config.ts"), CONFIG_V2);
    }, 120_000);

    afterAll(async () => {
      await adapter?.disconnect();
      if (project !== undefined)
        rmSync(project, { recursive: true, force: true });
      await world?.dispose();
    }, 60_000);

    it(
      "plans the core tables and the configured schema, with no orphans, exit 0",
      async () => {
        const before = await databaseState(adapter, dialect);
        const run = await nextlyIn(
          world,
          project
        )(["db:sync", "--remove-orphaned", "--dry-run"]);
        expect(run.status, run.stdout + run.stderr).toBe(0);
        expect(run.stdout).toContain(
          "Would write the core tables (users, roles, permissions, the registries)"
        );
        expect(run.stdout).toMatch(/^ℹ Would run add_table dc_dsd_posts$/m);
        expect(run.stdout).toMatch(/^ℹ Would run add_table dc_dsd_moved$/m);
        expect(run.stdout).not.toMatch(/^ℹ Would remove /m);
        expect(run.stdout).not.toContain("A real run would refuse");
        expect(run.stdout).toContain("Dry run: nothing was changed.");
        expect(await databaseState(adapter, dialect)).toEqual(before);
      },
      2 * NEXTLY_RUN_TIMEOUT
    );
  }
);
