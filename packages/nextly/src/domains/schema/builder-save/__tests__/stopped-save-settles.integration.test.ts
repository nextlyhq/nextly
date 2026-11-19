/**
 * A Builder save that stops at a step on MySQL, where each schema statement commits as it runs,
 * settles to what applied: the steps before the failing one stay applied, the save's migration
 * file and snapshot hold exactly those steps and are recorded applied, the definition and the
 * registry row describe that shape, and the failure names each change the save asked for as
 * applied or not applied. The next save of the entity is an ordinary change from there, and the
 * folder replayed on an empty database gives the tables the development database has.
 *
 * Each Builder save path in turn. Through its file: a collection's Builder apply, a Single's
 * Builder apply, a field group's Builder apply and the Single schema save. Through the
 * development push: a collection's update. The failure is injected at one statement, by its
 * text, after an earlier statement of the same change has committed; each case first checks that
 * the earlier one did.
 *
 * On PostgreSQL and SQLite the file runs in one transaction, and so does PostgreSQL's push, so the
 * same failure leaves nothing applied and no file: those legs guard that settling never records a
 * step that rolled back. SQLite's push keeps the statements before the one that fails and so
 * settles as MySQL's does, until it runs in one transaction as the spec asks:
 * `SQLITE_PUSH_KEEPS_PART_WAY` says which, and moves its cases between the two. A save that rolled
 * back whole never reaches the judgement of what applied at all.
 *
 * A collection's update through the push does not hand the writer its registry write yet (the
 * collection metadata service writes the row after the writer returns), so its stop keeps its files
 * for `nextly migrate:resolve` as before: its cases are expected to fail until it does.
 *
 * Where what the settle writes fails, the save is left as it stopped, its record that it is in
 * progress kept, and the failure that stopped it is still the one reported, the settle's after it.
 *
 * Not covered here: a translated field's rename stopped between its two tables; on the push a stop
 * after a drop, since the push drops a column holding data only on the dialog's answer for it;
 * and a translated collection's Builder apply, whose push sends its statements on a connection
 * none of these seams reaches.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { MetaService } from "../../../meta/services/meta-service";
import { consoleLogger } from "../../../../shared/types";
import { NO_CONSENT } from "../../migrate/data-loss-consent";
import { parseSnapshotFile } from "../../migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { judgeStoppedSave } from "../stopped-save";

// The judgement of what a stopped save applied, watched as it runs: a save that rolled back whole
// must never reach it.
vi.mock("../stopped-save", async importOriginal => {
  const actual = await importOriginal<typeof import("../stopped-save")>();
  return { ...actual, judgeStoppedSave: vi.fn(actual.judgeStoppedSave) };
});

const HISTORY = "./database/history";
const DEFINITION = "./schema/builder.json";

let current: TestNextly | undefined;
let basePath: string;

beforeEach(() => {
  // The folder outlives each instance, so a second one, on an empty database, can replay it.
  basePath = mkdtempSync(join(tmpdir(), "nextly-stopped-save-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await current?.destroy();
  current = undefined;
  rmSync(basePath, { recursive: true, force: true });
});

/** A field as the Builder sends it. */
type BuilderField = Record<string, unknown>;

const text = (name: string): BuilderField => ({ name, type: "text" });
// A field of another type than `text`, so a save dropping it while adding a text field is a drop and an
// addition: one field leaving and one of the same type arriving is taken as a rename of it.
const number = (name: string): BuilderField => ({ name, type: "number" });

/** One of the Builder's save paths, and the road it applies its change by. */
interface SavePath {
  name: string;
  /** The kind of entity saved, as its record that a save is in progress names it. */
  kind: "collection" | "single" | "fieldGroup";
  slug: string;
  table: string;
  registry: string;
  /** The development push applies the change, rather than the save's file. */
  push?: boolean;
  create(t: TestNextly, fields: BuilderField[]): Promise<void>;
  save(t: TestNextly, fields: BuilderField[]): Promise<unknown>;
  /** Store an entry holding `values`, where the entity has entries of its own. */
  store?(t: TestNextly, values: Record<string, string | number>): Promise<void>;
  /** Read the entry back through the Direct API. */
  read?(t: TestNextly): Promise<Record<string, unknown>>;
}

/** The registry row's schema version, which a Builder apply sends back. */
async function versionOf(
  t: TestNextly,
  registry: string,
  slug: string
): Promise<number> {
  const [row] = await t.adapter.select<{ schemaVersion: unknown }>(registry, {
    where: { and: [{ column: "slug", op: "=", value: slug }] },
  });
  return Number(row?.schemaVersion ?? 1);
}

/**
 * Whether SQLite's push keeps the statements that ran before one that fails, as it does today,
 * rather than running in one transaction as the spec asks. Undecided: this one value follows the
 * ruling, and each case below then runs on the side it belongs to.
 */
const SQLITE_PUSH_KEEPS_PART_WAY = true;

/** Whether `path`'s save on `dialect` keeps the steps that ran before a failing one. */
function keepsPartWay(dialect: TestDialect, path: SavePath): boolean {
  if (dialect === "mysql") return true;
  return (
    dialect === "sqlite" && path.push === true && SQLITE_PUSH_KEEPS_PART_WAY
  );
}

const PATHS: readonly SavePath[] = [
  {
    name: "a collection's Builder apply",
    kind: "collection",
    slug: "sts_posts",
    table: "dc_sts_posts",
    registry: "dynamic_collections",
    create: async (_t, fields) => {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "sts_posts", label: "sts_posts", fields }
      );
    },
    save: async (t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "sts_posts" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_collections", "sts_posts"),
        }
      ),
    store: async (t, values) => {
      await t.nextly.create({ collection: "sts_posts", data: values } as never);
    },
    read: async t => {
      const found = await t.nextly.find({ collection: "sts_posts" } as never);
      return (found.items[0] ?? {}) as Record<string, unknown>;
    },
  },
  {
    name: "a Single's Builder apply",
    kind: "single",
    slug: "sts_hero",
    table: "single_sts_hero",
    registry: "dynamic_singles",
    create: async (_t, fields) => {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "sts_hero", label: "sts_hero", fields }
      );
    },
    save: async (t, fields) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "sts_hero" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_singles", "sts_hero"),
        }
      ),
    store: async (t, values) => {
      // A Single's first write replaces whatever is stored, so it names no version.
      await t.nextly.updateSingle({
        slug: "sts_hero",
        data: { ...values, _overwrite: true },
      } as never);
    },
    read: async t =>
      (await t.nextly.findSingle({ slug: "sts_hero" } as never)) as Record<
        string,
        unknown
      >,
  },
  {
    name: "a field group's Builder apply",
    kind: "fieldGroup",
    slug: "sts_card",
    table: "comp_sts_card",
    registry: "dynamic_components",
    create: async (_t, fields) => {
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "sts_card", label: "sts_card", fields }
      );
    },
    save: async (t, fields) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "sts_card" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_components", "sts_card"),
        }
      ),
  },
  {
    name: "the Single schema save",
    kind: "single",
    slug: "sts_banner",
    table: "single_sts_banner",
    registry: "dynamic_singles",
    create: async (_t, fields) => {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "sts_banner", label: "sts_banner", fields }
      );
    },
    save: (_t, fields) =>
      dispatchSingles("updateSingleSchema", { slug: "sts_banner" }, { fields }),
    store: async (t, values) => {
      // A Single's first write replaces whatever is stored, so it names no version.
      await t.nextly.updateSingle({
        slug: "sts_banner",
        data: { ...values, _overwrite: true },
      } as never);
    },
    read: async t =>
      (await t.nextly.findSingle({ slug: "sts_banner" } as never)) as Record<
        string,
        unknown
      >,
  },
  {
    // The admin's update of a collection, which the development push applies.
    name: "a collection's update (the push)",
    kind: "collection",
    slug: "sts_notes",
    table: "dc_sts_notes",
    registry: "dynamic_collections",
    push: true,
    create: async (_t, fields) => {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "sts_notes", label: "sts_notes", fields }
      );
    },
    save: (_t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "sts_notes" },
        { fields }
      ),
    store: async (t, values) => {
      await t.nextly.create({ collection: "sts_notes", data: values } as never);
    },
    read: async t => {
      const found = await t.nextly.find({ collection: "sts_notes" } as never);
      return (found.items[0] ?? {}) as Record<string, unknown>;
    },
  },
];

/**
 * Fail the first statement matching `pattern`, on the adapter, on a transaction, or among those
 * the development push sends, before it runs. Returns how many statements it failed.
 */
function failStatement(
  t: TestNextly,
  pattern: RegExp,
  /** Which matching statement to fail: the first by default, or a later one. */
  nth = 1,
  /**
   * Commit what the connection holds before failing, as MySQL does before it runs any schema
   * statement, so row changes before a failing one stay.
   */
  commitFirst = false
): () => number {
  let failed = 0;
  let met = 0;
  /** Whether `statement` is the one to fail, counting it as failed. */
  const failsHere = (statement: string): boolean => {
    if (failed > 0 || !pattern.test(statement)) return false;
    met += 1;
    if (met < nth) return false;
    failed += 1;
    return true;
  };
  const refuse = async (
    statement: string,
    run: (sql: string) => Promise<unknown>
  ): Promise<void> => {
    if (!failsHere(statement)) return;
    if (commitFirst) await run("COMMIT");
    throw new Error(`injected failure: ${statement}`);
  };
  const adapter = t.adapter;
  const executeQuery = adapter.executeQuery.bind(adapter);
  vi.spyOn(adapter, "executeQuery").mockImplementation(
    async (statement, params) => {
      await refuse(statement, sql => executeQuery(sql));
      return executeQuery(statement, params);
    }
  );
  const transaction = adapter.transaction.bind(adapter);
  vi.spyOn(adapter, "transaction").mockImplementation((work, options) =>
    transaction(
      tx =>
        work(
          new Proxy(tx, {
            get(target, key) {
              if (key === "execute") {
                return async (
                  statement: string,
                  params?: Parameters<TransactionContext["execute"]>[1]
                ) => {
                  await refuse(statement, sql => target.execute(sql));
                  return target.execute(statement, params);
                };
              }
              const value: unknown = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          })
        ),
      options
    )
  );
  // The push runs its statements through its own executor on a Drizzle transaction the adapter
  // does not see: each is sent alone, so the ones before a failing statement run as they would.
  const run = DrizzleStatementExecutor.prototype.executeStatements;
  vi.spyOn(
    DrizzleStatementExecutor.prototype,
    "executeStatements"
  ).mockImplementation(async function (
    this: DrizzleStatementExecutor,
    tx: unknown,
    statements: string[]
  ) {
    for (const statement of statements) {
      await refuse(statement, sql => run.call(this, tx, [sql]));
      await run.call(this, tx, [statement]);
    }
  });
  return () => failed;
}

/** A statement of the file that adds `column` to `table`, in any dialect's quoting. */
const adding = (table: string, column: string) =>
  new RegExp(`${table}["\`]?\\s.*ADD (COLUMN )?["\`]${column}["\`]`);

/** What a save answered: the error it was refused with, or that it went through. */
async function outcomeOf(
  attempt: Promise<unknown>
): Promise<{ failed: true; error: unknown } | { failed: false }> {
  try {
    const answer = await attempt;
    // A dispatcher may answer a failure as a response rather than throw it.
    if (answer instanceof Response && !answer.ok) {
      return { failed: true, error: await answer.json() };
    }
    return { failed: false };
  } catch (error) {
    return { failed: true, error };
  }
}

/** One change a stopped save's failure names: the field, what the save asked of it, and whether it applied. */
interface NamedChange {
  field: string;
  change: "add" | "drop" | "rename" | "retype" | "settings";
  applied: boolean;
  /** A rename's old name. */
  from?: string;
}

/**
 * The changes the failure names, from a thrown `NextlyError`'s public data or the error envelope a
 * response carries, each kept to what the report promises and ordered by field, so a change named
 * twice, missing or extra fails the comparison; undefined where the failure names none.
 */
function namedChanges(error: unknown): NamedChange[] | undefined {
  const changes = NextlyError.is(error)
    ? (error.publicData as { changes?: unknown } | undefined)?.changes
    : (error as { error?: { data?: { changes?: unknown } } }).error?.data
        ?.changes;
  if (!Array.isArray(changes)) return undefined;
  return (changes as NamedChange[])
    .map(({ field, change, applied, from }) => ({
      field,
      change,
      applied,
      ...(from === undefined ? {} : { from }),
    }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

/** The message a failure is told with: a thrown `NextlyError`'s, or a response's error envelope's. */
function messageOf(error: unknown): string {
  if (NextlyError.is(error)) return error.publicMessage;
  return String(
    (error as { error?: { message?: unknown } }).error?.message ?? error
  );
}

/** Every file below `dir`, relative to it. */
function filesBelow(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string, prefix: string) => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory())
        walk(join(at, entry.name), `${prefix}${entry.name}/`);
      else found.push(`${prefix}${entry.name}`);
    }
  };
  walk(dir, "");
  return found.sort();
}

describe.each(getConfiguredTestDialects())(
  "a Builder save that stops at a step (%s)",
  (dialect: TestDialect) => {
    const history = () => join(basePath, HISTORY);

    /** Boot in development, as the Builder runs, over the shared folder. */
    async function boot(): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        basePath,
        db: { migrationsDir: HISTORY, uiSchemaFile: DEFINITION },
      });
      return current;
    }

    /** The columns `table` has in the database `t` runs on. */
    async function liveColumns(
      t: TestNextly,
      table: string
    ): Promise<string[]> {
      const live = await introspectLiveSnapshot(
        t.adapter.getDrizzle(),
        t.adapter.dialect,
        [table]
      );
      return (live.tables.find(each => each.name === table)?.columns ?? [])
        .map(column => column.name)
        .sort();
    }

    /** The field names the registry row records for the entity. */
    async function registryFields(
      t: TestNextly,
      path: SavePath
    ): Promise<string[]> {
      clearRegistryRowCache();
      const [row] = await t.adapter.select<{ fields: unknown }>(path.registry, {
        columns: ["fields"],
        where: { and: [{ column: "slug", op: "=", value: path.slug }] },
      });
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name?: string }[] | undefined;
      return (fields ?? []).map(field => String(field.name)).sort();
    }

    /** The field names the definition file records for the entity. */
    function definedFields(path: SavePath): string[] {
      const file = join(basePath, DEFINITION);
      if (!existsSync(file)) return [];
      type Entity = { slug: string; fields: { name?: string }[] };
      const definition = JSON.parse(readFileSync(file, "utf8")) as Record<
        string,
        unknown
      >;
      // Collections, Singles and field groups are each a list of entities by slug.
      const entity = Object.values(definition)
        .filter((each): each is Entity[] => Array.isArray(each))
        .flat()
        .find(each => each.slug === path.slug);
      return (entity?.fields ?? [])
        .map((field: { name?: string }) => String(field.name))
        .sort();
    }

    /** The files the ledger records applied. */
    async function appliedFiles(t: TestNextly): Promise<string[]> {
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle() as never,
        t.adapter.dialect
      );
      return (await repo.listFileApplies())
        .filter(row => row.status === "applied")
        .map(row => String(row.filename))
        .sort();
    }

    /** The columns the snapshot written beside `sqlFile` records for `table`. */
    function snapshotColumns(sqlFile: string, table: string): string[] {
      const name = sqlFile.replace(/\.sql$/, ".snapshot.json");
      const content = readFileSync(join(history(), "meta", name), "utf8");
      const { snapshot } = parseSnapshotFile(content, name);
      return (snapshot.tables.find(each => each.name === table)?.columns ?? [])
        .map(column => column.name)
        .sort();
    }

    /** `nextly migrate` over the folder, on the database `t` runs on. */
    function migrated(t: TestNextly) {
      const adapter = t.adapter as unknown as DrizzleAdapter;
      return migrateCore({
        extensionSchema: undefined,
        dialect: adapter.getCapabilities().dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir: history(),
        logger: createLogger({ quiet: true }),
        lockMode: "fail-fast",
        consent: NO_CONSENT,
        interactive: false,
      } as never);
    }

    /**
     * Replay the folder on an empty database and compare `table` with the development
     * database's, which `expected` holds.
     */
    async function expectReplayGives(
      path: SavePath,
      expected: string[]
    ): Promise<void> {
      await current?.destroy();
      current = undefined;
      vi.unstubAllEnvs();
      const fresh = await boot();
      await migrated(fresh);
      expect(
        await liveColumns(fresh, path.table),
        "the folder replayed on an empty database"
      ).toEqual(expected);
    }

    describe.each(PATHS)("$name", path => {
      beforeEach(() => {
        vi.mocked(judgeStoppedSave).mockClear();
      });
      // The collection update's push writes its registry row after the writer returns, so the
      // writer has no registry write to settle it with: it keeps its files, as before.
      const settles = path.push === true ? it.fails : it;

      (keepsPartWay(dialect, path) ? settles : it.skip)(
        "stopped at its second addition, keeps the first: one file for it, recorded applied, the definition and the registry at that shape",
        async () => {
          const t = await boot();
          await path.create(t, [text("heading")]);
          await path.store?.(t, { heading: "Hello" });
          const folderBefore = filesBelow(history());
          const appliedBefore = await appliedFiles(t);
          const failed = failStatement(t, adding(path.table, "beta"));

          const outcome = await outcomeOf(
            path.save(t, [text("heading"), text("alpha"), text("beta")])
          );

          expect(failed(), "no statement adding `beta` was met").toBe(1);
          expect(
            vi.mocked(judgeStoppedSave),
            "the stop was never judged"
          ).toHaveBeenCalled();
          vi.restoreAllMocks();
          vi.stubEnv("NODE_ENV", "development");
          // The staging: `alpha`'s statement committed before `beta`'s failed.
          const live = await liveColumns(t, path.table);
          expect(live, "`alpha` was not added before `beta` failed").toContain(
            "alpha"
          );
          expect(live).not.toContain("beta");

          expect(outcome.failed, "the save was reported as going through").toBe(
            true
          );
          if (!outcome.failed) return;

          // Each property of the settled save is checked on its own, so a failure lists them all.
          // One file and its snapshot, holding `alpha`'s addition alone.
          const written = filesBelow(history()).filter(
            f => !folderBefore.includes(f)
          );
          const sql = written.filter(f => f.endsWith(".sql"));
          expect(sql, "the save's files").toHaveLength(1);
          expect(
            written.filter(f => f.endsWith(".snapshot.json")),
            "the save's snapshots"
          ).toHaveLength(1);
          const up = readFileSync(join(history(), sql[0]!), "utf8").split(
            "-- DOWN"
          )[0]!;
          expect.soft(up, "the file's UP").toMatch(adding(path.table, "alpha"));
          expect.soft(up, "the file's UP").not.toMatch(/["`]beta["`]/);
          expect
            .soft(snapshotColumns(sql[0]!, path.table), "the snapshot")
            .toEqual(live);
          expect
            .soft(await appliedFiles(t), "the ledger")
            .toEqual([...appliedBefore, sql[0]!].sort());

          // The definition and the registry describe the tables as they are.
          expect
            .soft(definedFields(path), "the definition")
            .toEqual(["alpha", "heading"]);
          expect
            .soft(await registryFields(t, path), "the registry row")
            .toEqual(["alpha", "heading"]);
          if (path.read !== undefined) {
            expect.soft(await path.read(t)).toMatchObject({ heading: "Hello" });
          }
          // The failure names each change the save asked for, as applied or not.
          expect(namedChanges(outcome.error), "the report").toEqual([
            { field: "alpha", change: "add", applied: true },
            { field: "beta", change: "add", applied: false },
          ]);

          // `nextly migrate` finds nothing to run, and the next save adds the rest.
          await migrated(t);
          expect(await appliedFiles(t)).toEqual(
            [...appliedBefore, sql[0]!].sort()
          );
          await path.save(t, [text("heading"), text("alpha"), text("beta")]);
          expect(await registryFields(t, path)).toEqual([
            "alpha",
            "beta",
            "heading",
          ]);
          const after = await liveColumns(t, path.table);
          expect(after).toContain("beta");
          // Two files now, the stopped save's and the next one's, each recorded applied.
          const saved = filesBelow(history()).filter(
            f => f.endsWith(".sql") && !folderBefore.includes(f)
          );
          expect(saved).toHaveLength(2);
          const appliedNow = await appliedFiles(t);
          expect(saved.filter(f => !appliedNow.includes(f))).toEqual([]);

          await expectReplayGives(path, after);
        },
        300_000
      );

      // The push drops a column holding data only on the dialog's answer for it, which these
      // saves do not send: on the push its drops are judged by the push's own tests.
      it.runIf(keepsPartWay(dialect, path) && path.push !== true)(
        "stopped at an addition after a drop committed, stops naming the dropped field and keeps reading the rest",
        async () => {
          const t = await boot();
          await path.create(t, [text("heading"), number("old_note")]);
          await path.store?.(t, { heading: "Hello", old_note: 7 });
          const folderBefore = filesBelow(history());
          const failed = failStatement(t, adding(path.table, "beta"));

          const outcome = await outcomeOf(
            path.save(t, [text("heading"), text("beta")])
          );

          expect(failed(), "no statement adding `beta` was met").toBe(1);
          vi.restoreAllMocks();
          vi.stubEnv("NODE_ENV", "development");
          const live = await liveColumns(t, path.table);
          // The staging: the drop ran before the addition that failed.
          expect(
            live,
            "`old_note` was not dropped before `beta` failed"
          ).not.toContain("old_note");

          expect(outcome.failed).toBe(true);
          if (!outcome.failed) return;
          const sql = filesBelow(history()).filter(
            f => f.endsWith(".sql") && !folderBefore.includes(f)
          );
          expect(sql, "the save's files").toHaveLength(1);
          expect
            .soft(snapshotColumns(sql[0]!, path.table), "the snapshot")
            .toEqual(live);
          expect
            .soft(definedFields(path), "the definition")
            .toEqual(["heading"]);
          expect
            .soft(await registryFields(t, path), "the registry row")
            .toEqual(["heading"]);
          if (path.read !== undefined) {
            const entry = await path.read(t);
            expect.soft(entry).toMatchObject({ heading: "Hello" });
            expect.soft(entry).not.toHaveProperty("old_note");
          }
          expect(namedChanges(outcome.error), "the report").toEqual([
            { field: "beta", change: "add", applied: false },
            { field: "old_note", change: "drop", applied: true },
          ]);

          await expectReplayGives(path, live);
        },
        300_000
      );

      // As above: the push drops a column holding data only on the dialog's answer for it.
      it.runIf(keepsPartWay(dialect, path) && path.push !== true)(
        "whose second drop fails after the first committed, names that column again with its values readable",
        async () => {
          const t = await boot();
          await path.create(t, [text("heading"), text("old_a"), text("old_b")]);
          await path.store?.(t, {
            heading: "Hello",
            old_a: "Kept a",
            old_b: "Kept b",
          });
          const folderBefore = filesBelow(history());
          // The file drops before it adds, so the step before a failing drop is another drop.
          const failed = failStatement(
            t,
            new RegExp(
              `${path.table}["\`]?\\s.*DROP (COLUMN )?["\`]old_[ab]["\`]`
            ),
            2
          );

          const outcome = await outcomeOf(path.save(t, [text("heading")]));

          expect(failed(), "no second drop was met").toBe(1);
          vi.restoreAllMocks();
          vi.stubEnv("NODE_ENV", "development");
          const live = await liveColumns(t, path.table);
          // The staging: one of the two drops committed before the other failed.
          const kept = ["old_a", "old_b"].filter(name => live.includes(name));
          expect(kept, "not exactly one drop committed").toHaveLength(1);
          const keptName = kept[0]!;
          const droppedName = keptName === "old_a" ? "old_b" : "old_a";

          expect(outcome.failed).toBe(true);
          if (!outcome.failed) return;
          const sql = filesBelow(history()).filter(
            f => f.endsWith(".sql") && !folderBefore.includes(f)
          );
          expect(sql, "the save's files").toHaveLength(1);
          expect
            .soft(snapshotColumns(sql[0]!, path.table), "the snapshot")
            .toEqual(live);
          expect
            .soft(definedFields(path), "the definition")
            .toEqual(["heading", keptName]);
          expect
            .soft(await registryFields(t, path), "the registry row")
            .toEqual(["heading", keptName]);
          if (path.read !== undefined) {
            const entry = await path.read(t);
            expect.soft(entry).toMatchObject({
              heading: "Hello",
              [keptName]: keptName === "old_a" ? "Kept a" : "Kept b",
            });
            expect.soft(entry).not.toHaveProperty(droppedName);
          }
          expect(namedChanges(outcome.error), "the report").toEqual(
            [
              { field: droppedName, change: "drop", applied: true },
              { field: keptName, change: "drop", applied: false },
            ].sort((a, b) => a.field.localeCompare(b.field))
          );

          await expectReplayGives(path, live);
        },
        300_000
      );

      it.runIf(!keepsPartWay(dialect, path))(
        "stopped at its second addition, rolls back whole and records no step",
        async () => {
          const t = await boot();
          await path.create(t, [text("heading")]);
          const folderBefore = filesBelow(history());
          const appliedBefore = await appliedFiles(t);
          const columnsBefore = await liveColumns(t, path.table);
          const failed = failStatement(t, adding(path.table, "beta"));

          const outcome = await outcomeOf(
            path.save(t, [text("heading"), text("alpha"), text("beta")])
          );

          expect(failed(), "no statement adding `beta` was met").toBe(1);
          expect(
            vi.mocked(judgeStoppedSave),
            "a save that rolled back whole was judged for what applied"
          ).not.toHaveBeenCalled();
          vi.restoreAllMocks();
          expect(outcome.failed).toBe(true);
          if (!outcome.failed) return;
          expect(namedChanges(outcome.error), "the report").toBeUndefined();
          expect(await liveColumns(t, path.table)).toEqual(columnsBefore);
          expect(filesBelow(history())).toEqual(folderBefore);
          expect(await appliedFiles(t)).toEqual(appliedBefore);
          expect(definedFields(path)).toEqual(["heading"]);
          expect(await registryFields(t, path)).toEqual(["heading"]);
        },
        300_000
      );

      (keepsPartWay(dialect, path) && path.push !== true ? it : it.skip)(
        "whose settle fails at its ledger write, is put back as it stopped, recorded in progress, and reports the stop first",
        async () => {
          const t = await boot();
          await path.create(t, [text("heading")]);
          const folderBefore = filesBelow(history());
          const failed = failStatement(t, adding(path.table, "beta"));
          // Once the save's own statement failed, the ledger refuses the settle's record of what
          // applied.
          const markApplied = SchemaEventsRepository.prototype.markApplied;
          vi.spyOn(
            SchemaEventsRepository.prototype,
            "markApplied"
          ).mockImplementation(async function (
            this: SchemaEventsRepository,
            ...args: Parameters<typeof markApplied>
          ) {
            if (failed() > 0) {
              throw new NextlyError({
                code: "NEXTLY_MIGRATION_CONCURRENT_RUN",
                publicMessage: "Another run recorded the file first.",
              });
            }
            return markApplied.apply(this, args);
          });

          const outcome = await outcomeOf(
            path.save(t, [text("heading"), text("alpha"), text("beta")])
          );

          expect(failed(), "no statement adding `beta` was met").toBe(1);
          expect(
            vi.mocked(judgeStoppedSave),
            "the stop was never judged"
          ).toHaveBeenCalled();
          vi.restoreAllMocks();
          vi.stubEnv("NODE_ENV", "development");
          expect(outcome.failed).toBe(true);
          if (!outcome.failed) return;
          // The stop's own failure first, then the settle's, never the settle's alone.
          expect(messageOf(outcome.error)).toMatch(
            /failed part-way, and the statements before the failure stayed applied: .*Recording what of it applied failed too, so the save stays recorded as in progress, to be settled again: Another run recorded the file first\.$/s
          );
          expect(namedChanges(outcome.error), "a report").toBeUndefined();
          // The stopped file, its snapshot and the definition as the save left them, and no
          // replacement: the stop stays as it was for `nextly migrate:resolve`.
          const written = filesBelow(history()).filter(
            f => !folderBefore.includes(f)
          );
          const sql = written.filter(f => f.endsWith(".sql"));
          expect(sql, "the save's files").toHaveLength(1);
          expect(
            written.filter(f => f.endsWith(".snapshot.json")),
            "the save's snapshots"
          ).toHaveLength(1);
          expect(
            readFileSync(join(history(), sql[0]!), "utf8").split("-- DOWN")[0]
          ).toMatch(/["`]beta["`]/);
          expect(definedFields(path), "the definition").toEqual([
            "alpha",
            "beta",
            "heading",
          ]);
          // Its record that it is in progress stays, for the next settle.
          const record = await new MetaService(
            t.adapter,
            consoleLogger
          ).getEntry(`builder-save-in-progress:${path.kind}:${path.slug}`);
          expect(record.present, "the record that it is in progress").toBe(
            true
          );
        },
        300_000
      );
    });

    // A fill runs as a row change on MySQL, which commits as it runs: rows it filled before a
    // later statement failed are changed whatever the table's shape reads as, so the save is not
    // judged from its shape. It keeps its files, as before, and names no report.
    it.runIf(dialect === "mysql")(
      "a collection save carrying a fill that stopped after the fill committed keeps its files and is not judged",
      async () => {
        const path = PATHS[0]!;
        const t = await boot();
        await path.create(t, [text("heading"), text("note")]);
        await path.store?.(t, { heading: "Hello" });
        const folderBefore = filesBelow(history());
        vi.mocked(judgeStoppedSave).mockClear();
        // The statement making `note` required, which runs after its fill: MySQL commits the
        // fill before it runs any schema statement, and the statement then fails.
        const failed = failStatement(t, /EXECUTE nextly_ddl/, 1, true);

        const outcome = await outcomeOf(
          dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: path.slug },
            {
              fields: [
                text("heading"),
                { name: "note", type: "text", required: true },
                text("beta"),
              ],
              confirmed: true,
              schemaVersion: await versionOf(t, path.registry, path.slug),
              resolutions: {
                note: { action: "provide_default", value: "Filled" },
              },
            }
          )
        );

        expect(failed(), "no statement making `note` required was met").toBe(
          1
        );
        expect(
          vi.mocked(judgeStoppedSave),
          "a save whose fill committed was judged from its shape"
        ).not.toHaveBeenCalled();
        vi.restoreAllMocks();
        vi.stubEnv("NODE_ENV", "development");
        // The staging: the fill committed before `beta`'s statement failed.
        expect(
          await path.read?.(t),
          "the fill did not commit before `note` was made required"
        ).toMatchObject({ note: "Filled" });
        expect(outcome.failed).toBe(true);
        if (!outcome.failed) return;
        expect(namedChanges(outcome.error), "a report").toBeUndefined();
        // Its file is kept as written, for `nextly migrate:resolve`.
        const sql = filesBelow(history()).filter(
          f => f.endsWith(".sql") && !folderBefore.includes(f)
        );
        expect(sql, "the save's files").toHaveLength(1);
        expect(readFileSync(join(history(), sql[0]!), "utf8")).toMatch(
          /Filled/
        );
      },
      300_000
    );
  }
);
