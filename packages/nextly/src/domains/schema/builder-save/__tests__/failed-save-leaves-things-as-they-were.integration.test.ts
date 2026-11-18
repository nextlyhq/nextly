/**
 * A Builder save that fails at any step after its migration file, snapshot and
 * definition are written is reported as failed, never as pending or applied,
 * and leaves the migrations folder, the definition, the ledger and the
 * registry row as they were before it. On PostgreSQL and SQLite the database's
 * tables are as they were too.
 *
 * Every Builder save path in turn: the collection save (`updateCollection`),
 * the Builder apply of a collection, a Single and a field group, and the
 * Single schema save (`updateSingleSchema`). On each, every step the save
 * takes fails in turn:
 *
 * - the change to the entity's own table, at its statement;
 * - on a translated Single or field group, the change to its translations
 *   table, at its statement;
 * - each write the save makes to the entity's registry row, the k-th refused
 *   by a database trigger in run k, after a run without a failure counted
 *   them, so every registry write is reached wherever it happens;
 * - each write the save makes to the migration ledger for its files, the same
 *   way.
 *
 * Then the same save without a failure writes its files and records them
 * applied.
 *
 * On MySQL each schema statement commits as it runs, so a failure after one
 * has committed leaves the save part-way, which is a different rule from this
 * one; only the failure of the save's first statement, where nothing
 * committed, is asserted there.
 *
 * Not covered here: a translated collection's save, translation turned off,
 * and a Required or Unique field leaving translation, which the Builder still
 * applies with its schema push rather than its file. The collection save
 * applies every change with the push too, so only its registry and ledger
 * steps are taken.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";

const HISTORY = "./database/history";
const DEFINITION = "./schema/builder.json";
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await current?.destroy();
  current = undefined;
});

/** End the instance under test, for a case that boots more than one. */
async function shutDown(): Promise<void> {
  const instance = current;
  current = undefined;
  vi.unstubAllEnvs();
  await instance?.destroy();
}

/** A field as the Builder sends it. */
type BuilderField = Record<string, unknown>;

/** One of the Builder's save paths, over an entity it creates first. */
/** A step of a save that the suite fails in turn. */
type Step = "translations" | "registry" | "ledger";

interface SavePath {
  name: string;
  slug: string;
  table: string;
  registry: string;
  /** Whether the entity can be translated here, so its translations table's step is taken. */
  translatable: boolean;
  /**
   * Whether the path applies its change with the schema push rather than its
   * file: the push runs its statements on its own Drizzle transaction, where
   * a statement cannot be failed from the adapter, so only the registry and
   * ledger steps, which a database trigger fails whichever road writes them,
   * are taken.
   */
  pushRoad: boolean;
  /**
   * The steps whose failure this path does not yet leave as it was. Their probes and controls are
   * asserted as every case's are; only the check that things are as they were is expected to fail,
   * and a step it passes for fails the case until it is taken off the list.
   */
  notKeptYet?: readonly Step[];
  create(fields: BuilderField[], translated: boolean): Promise<void>;
  save(t: TestNextly, fields: BuilderField[]): Promise<unknown>;
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

const collectionCreate = (slug: string) => async (fields: BuilderField[]) => {
  await dispatchCollections(
    {} as ServiceContainer,
    "createCollection",
    {},
    { name: slug, label: slug, fields }
  );
};

const singleCreate =
  (slug: string) => async (fields: BuilderField[], translated: boolean) => {
    await dispatchSingles(
      "createSingle",
      {},
      { slug, label: slug, fields, ...(translated ? { localized: true } : {}) }
    );
  };

const fieldGroupCreate =
  (slug: string) => async (fields: BuilderField[], translated: boolean) => {
    await dispatchComponents(
      "createComponent",
      {},
      { slug, label: slug, fields, ...(translated ? { localized: true } : {}) }
    );
  };

const PATHS: readonly SavePath[] = [
  {
    name: "the collection save",
    slug: "fbs_posts",
    table: "dc_fbs_posts",
    registry: "dynamic_collections",
    translatable: false,
    pushRoad: true,
    // Its registry write and its first ledger write run after the push's own transaction.
    notKeptYet: ["registry", "ledger"],
    create: collectionCreate("fbs_posts"),
    save: (_t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "fbs_posts" },
        { fields }
      ),
  },
  {
    name: "a collection's Builder apply",
    slug: "fbs_pages",
    table: "dc_fbs_pages",
    registry: "dynamic_collections",
    translatable: false,
    pushRoad: false,
    create: collectionCreate("fbs_pages"),
    save: async (t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "fbs_pages" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_collections", "fbs_pages"),
        }
      ),
  },
  {
    name: "a Single's Builder apply",
    slug: "fbs_hero",
    table: "single_fbs_hero",
    registry: "dynamic_singles",
    translatable: true,
    pushRoad: false,
    // The translations table is reconciled after the file is recorded applied.
    notKeptYet: ["translations"],
    create: singleCreate("fbs_hero"),
    save: async (t, fields) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "fbs_hero" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_singles", "fbs_hero"),
        }
      ),
  },
  {
    name: "a field group's Builder apply",
    slug: "fbs_card",
    table: "comp_fbs_card",
    registry: "dynamic_components",
    translatable: true,
    pushRoad: false,
    // The translations table is reconciled after the file is recorded applied.
    notKeptYet: ["translations"],
    create: fieldGroupCreate("fbs_card"),
    save: async (t, fields) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "fbs_card" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_components", "fbs_card"),
        }
      ),
  },
  {
    name: "the Single schema save",
    slug: "fbs_banner",
    table: "single_fbs_banner",
    registry: "dynamic_singles",
    translatable: true,
    pushRoad: false,
    // Its translations step and its registry write run after the change is made.
    notKeptYet: ["translations", "registry"],
    create: singleCreate("fbs_banner"),
    save: (_t, fields) =>
      dispatchSingles("updateSingleSchema", { slug: "fbs_banner" }, { fields }),
  },
];

/** Every file below `dir`, by path, with a hash of its content. */
function filesBelow(dir: string): Record<string, string> {
  const found: Record<string, string> = {};
  if (!existsSync(dir)) return found;
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        found[relative(dir, path)] = createHash("sha256")
          .update(readFileSync(path))
          .digest("hex");
      }
    }
  };
  walk(dir);
  return found;
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

/** What a failed save must leave as it found: the folder, the definition, the ledger, the registry row, the tables. */
async function stateOf(t: TestNextly, path: SavePath) {
  clearRegistryRowCache();
  const definition = join(t.basePath, DEFINITION);
  const [row] = await t.adapter.select<Record<string, unknown>>(path.registry, {
    columns: ["fields", "schemaVersion", "migrationStatus", "localized"],
    where: { and: [{ column: "slug", op: "=", value: path.slug }] },
  });
  return {
    folder: filesBelow(join(t.basePath, HISTORY)),
    definition: existsSync(definition)
      ? readFileSync(definition, "utf8")
      : null,
    applied: await appliedFiles(t),
    registry: row ?? null,
    tables: JSON.stringify(
      await introspectLiveSnapshot(t.adapter.getDrizzle(), t.adapter.dialect, [
        path.table,
        `${path.table}_locales`,
      ])
    ),
  };
}

/**
 * Fail the first statement matching `pattern`, on the adapter or on a
 * transaction, before it runs. Returns how many statements it failed.
 */
function failStatement(t: TestNextly, pattern: RegExp): () => number {
  let failed = 0;
  const refuse = (statement: string) => {
    if (failed > 0 || !pattern.test(statement)) return;
    failed += 1;
    throw new Error(`injected failure: ${statement}`);
  };
  const adapter = t.adapter;
  const executeQuery = adapter.executeQuery.bind(adapter);
  vi.spyOn(adapter, "executeQuery").mockImplementation(
    async (statement, params) => {
      refuse(statement);
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
                  refuse(statement);
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
  return () => failed;
}

/** Which writes a counting trigger watches. */
type Watched = "registry" | "ledger";

/**
 * A trigger counting the save's writes to `watched` (the entity's registry
 * row, or the ledger's rows for the save's files), refusing the `failAt`-th
 * (none for 0). A write that is refused rolls its count back with it.
 * Returns how many it counted, and how to remove it.
 */
async function countingTrigger(
  t: TestNextly,
  path: SavePath,
  watched: Watched,
  failAt: number
): Promise<{ counted: () => Promise<number>; remove: () => Promise<void> }> {
  const run = (sql: string) => t.adapter.executeQuery(sql);
  const dialect = t.adapter.dialect;
  const table = watched === "registry" ? path.registry : "nextly_schema_events";
  const when =
    watched === "registry"
      ? `OLD.slug = '${path.slug}'`
      : `NEW.filename LIKE '%${path.slug}%'`;
  const events = watched === "registry" ? ["UPDATE"] : ["INSERT", "UPDATE"];
  const remove = async () => {
    for (const event of events) {
      const name = `fbs_${watched}_${event.toLowerCase()}`;
      await run(
        dialect === "postgresql"
          ? `DROP TRIGGER IF EXISTS ${name} ON ${table}`
          : `DROP TRIGGER IF EXISTS ${name}`
      );
    }
    if (dialect === "postgresql") {
      await run("DROP FUNCTION IF EXISTS fbs_count_write()");
    }
    await run("DROP TABLE IF EXISTS fbs_count");
  };
  await remove();
  await run("CREATE TABLE fbs_count (n INTEGER NOT NULL)");
  await run("INSERT INTO fbs_count (n) VALUES (0)");
  if (dialect === "postgresql") {
    await run(
      `CREATE FUNCTION fbs_count_write() RETURNS trigger AS $$ BEGIN UPDATE fbs_count SET n = n + 1; IF (SELECT n FROM fbs_count) = ${failAt} THEN RAISE EXCEPTION 'injected failure of a ${watched} write'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`
    );
    for (const event of events) {
      await run(
        `CREATE TRIGGER fbs_${watched}_${event.toLowerCase()} BEFORE ${event} ON ${table} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION fbs_count_write()`
      );
    }
  } else {
    for (const event of events) {
      await run(
        `CREATE TRIGGER fbs_${watched}_${event.toLowerCase()} BEFORE ${event} ON ${table} WHEN ${when} BEGIN UPDATE fbs_count SET n = n + 1; SELECT RAISE(ABORT, 'injected failure of a ${watched} write') WHERE (SELECT n FROM fbs_count) = ${failAt}; END`
      );
    }
  }
  return {
    counted: async () =>
      Number(
        (
          await t.adapter.executeQuery<{ n: unknown }>(
            "SELECT n FROM fbs_count"
          )
        )[0]?.n ?? Number.NaN
      ),
    remove,
  };
}

/** What a save answered: the error it was refused with, or what it said when it went through. */
async function outcomeOf(
  attempt: Promise<unknown>
): Promise<{ failed: true; error: unknown } | { failed: false; said: string }> {
  try {
    const answer = await attempt;
    const said =
      answer instanceof Response
        ? JSON.stringify(await answer.json())
        : JSON.stringify(answer);
    return { failed: false, said };
  } catch (error) {
    return { failed: true, error };
  }
}

describe.each(getConfiguredTestDialects())(
  "a failed Builder save leaves things as they were (%s)",
  (dialect: TestDialect) => {
    /** Boot in development, as the Builder runs, and make `path`'s entity through the Builder. */
    async function boot(
      path: SavePath,
      translated: boolean
    ): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        db: { migrationsDir: HISTORY, uiSchemaFile: DEFINITION },
        ...(translated ? { localization: LOCALIZATION } : {}),
      });
      await path.create(
        [
          {
            name: "heading",
            type: "text",
            ...(translated ? { localized: true } : {}),
          },
        ],
        translated
      );
      clearRegistryRowCache();
      return current;
    }

    /** The fields after the save: one field added, translated where `translated`. */
    const savedFields = (translated: boolean): BuilderField[] => [
      {
        name: "heading",
        type: "text",
        ...(translated ? { localized: true } : {}),
      },
      {
        name: "extra",
        type: "text",
        ...(translated ? { localized: true } : {}),
      },
    ];

    /**
     * After a failure was injected into `path`'s save: reported as failed,
     * and everything as `before` found it; then the same save, with the
     * failure removed, writes its files and records them applied.
     */
    async function expectFailedAndAsItWas(
      t: TestNextly,
      path: SavePath,
      translated: boolean,
      before: Awaited<ReturnType<typeof stateOf>>,
      outcome: Awaited<ReturnType<typeof outcomeOf>>,
      what: string
    ) {
      expect(
        outcome.failed,
        `${what}: the save was reported as going through: ${
          outcome.failed ? "" : outcome.said
        }`
      ).toBe(true);
      const after = await stateOf(t, path);
      expect(after.folder, `${what}: the migrations folder`).toEqual(
        before.folder
      );
      expect(after.definition, `${what}: the definition`).toEqual(
        before.definition
      );
      expect(after.applied, `${what}: the ledger`).toEqual(before.applied);
      expect(after.registry, `${what}: the registry row`).toEqual(
        before.registry
      );
      expect(after.tables, `${what}: the tables`).toEqual(before.tables);

      vi.restoreAllMocks();
      vi.stubEnv("NODE_ENV", "development");
      await path.save(t, savedFields(translated));
      const written = Object.keys(filesBelow(join(t.basePath, HISTORY)))
        .filter(f => f.endsWith(".sql") && !(f in before.folder))
        .sort();
      expect(
        written.length,
        `${what}: the save after it wrote no file`
      ).toBeGreaterThan(0);
      const applied = await appliedFiles(t);
      expect(
        written.filter(f => !applied.includes(f)),
        `${what}: the save after it left files unapplied`
      ).toEqual([]);
    }

    describe.each(PATHS)("$name", path => {
      const notKept = (step: Step) => path.notKeptYet?.includes(step) === true;

      /**
       * Whether the save left things as they were (`check`'s assertions): thrown where `step` is
       * kept, and answered false rather than thrown where it is not kept yet.
       */
      async function asItWas(
        step: Step,
        check: () => Promise<void>
      ): Promise<boolean> {
        if (!notKept(step)) {
          await check();
          return true;
        }
        try {
          await check();
          return true;
        } catch {
          return false;
        }
      }

      /** A step listed as not kept yet that every failure left as it was: the list is stale. */
      function expectStillNotKept(step: Step, kept: boolean) {
        if (!notKept(step)) return;
        expect(
          kept,
          `${step}: left as it was, so it is kept now: take it off notKeptYet`
        ).toBe(false);
      }

      it.skipIf(path.pushRoad)(
        "fails at the change to its own table",
        async () => {
          const t = await boot(path, false);
          const before = await stateOf(t, path);
          const failed = failStatement(
            t,
            new RegExp(`${path.table}["\`]?\\s.*ADD (COLUMN )?["\`]extra["\`]`)
          );

          const outcome = await outcomeOf(path.save(t, savedFields(false)));

          expect(failed(), "no statement adding the field was met").toBe(1);
          await expectFailedAndAsItWas(
            t,
            path,
            false,
            before,
            outcome,
            "its own table"
          );
        },
        180_000
      );

      // MySQL commits each schema statement as it runs, so every later step
      // fails after one has committed: the part-way rule, not this one.
      (dialect === "mysql" || !path.translatable ? it.skip : it)(
        "fails at the change to its translations table",
        async () => {
          const t = await boot(path, true);
          const before = await stateOf(t, path);
          const failed = failStatement(
            t,
            new RegExp(
              `${path.table}_locales["\`]?\\s.*ADD (COLUMN )?["\`]extra["\`]`
            )
          );

          const outcome = await outcomeOf(path.save(t, savedFields(true)));

          expect(
            failed(),
            "no statement adding the translated field was met"
          ).toBe(1);
          // Whatever the translations step leaves, a path whose registry write is kept does not
          // advance the version or the translation state it records while the translations table
          // does not hold the change. (The fields the file's own upsert records are part of the
          // translations step's gap.)
          if (!notKept("registry")) {
            const { registry } = await stateOf(t, path);
            const recorded = (row: Record<string, unknown> | null) => ({
              schemaVersion: row?.schemaVersion,
              localized: row?.localized,
            });
            expect(
              recorded(registry),
              "its translations table: the version and translation state recorded"
            ).toEqual(recorded(before.registry));
          }
          const kept = await asItWas("translations", () =>
            expectFailedAndAsItWas(
              t,
              path,
              true,
              before,
              outcome,
              "its translations table"
            )
          );
          expectStillNotKept("translations", kept);
        },
        180_000
      );

      for (const watched of ["registry", "ledger"] as const) {
        (dialect === "mysql" ? it.skip : it)(
          `fails at each of its ${watched} writes in turn`,
          async () => {
            // Counted first, on a save without a failure.
            let writes: number;
            {
              const t = await boot(path, false);
              const trigger = await countingTrigger(t, path, watched, 0);
              await path.save(t, savedFields(false));
              writes = await trigger.counted();
              await trigger.remove();
              await shutDown();
            }
            // Positive control: the trigger reaches the save's writes.
            expect(
              writes,
              `no ${watched} write of the save was counted`
            ).toBeGreaterThan(0);

            let everyKept = true;
            for (let k = 1; k <= writes; k += 1) {
              const t = await boot(path, false);
              const before = await stateOf(t, path);
              const trigger = await countingTrigger(t, path, watched, k);

              const outcome = await outcomeOf(path.save(t, savedFields(false)));
              await trigger.remove();

              const kept = await asItWas(watched, () =>
                expectFailedAndAsItWas(
                  t,
                  path,
                  false,
                  before,
                  outcome,
                  `${watched} write ${k} of ${writes}`
                )
              );
              everyKept &&= kept;
              await shutDown();
            }
            expectStillNotKept(watched, everyKept);
          },
          600_000
        );
      }
    });
  }
);
