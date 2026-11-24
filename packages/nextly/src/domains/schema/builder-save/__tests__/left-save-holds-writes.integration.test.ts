/**
 * While a Builder save the process left part-way stands unsettled with a schema step committed and
 * its registry update not run, every write any Nextly process makes that sets the field that step
 * changed is refused, naming the field; writes that set no such field go on; and a read is answered
 * from the tables, one that needs a column they no longer have under the registry's name getting
 * the same message, never a database error. Only the settle lifts it.
 *
 * Only MySQL commits a step of a file on its own, so only there can a step stand committed without
 * its registry update. On PostgreSQL and SQLite a kill finds none or all of the change, and no
 * write is refused.
 *
 * The save is killed in this process: the step at the kill point runs, then the save never returns.
 * The writes come from another process (`helpers/left-save-writer.ts`), through REST as the
 * signed-in editor and through the Direct API.
 */
import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { superAdminUser } from "../../../../__tests__/fixtures/permission-holders";
import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { childLayoutArgs } from "../../../../__tests__/storage-layout";
import { buildClaims } from "../../../../auth/jwt/claims";
import { signAccessToken } from "../../../../auth/jwt/sign";
import { createAdapter } from "../../../../database/factory";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { resolveVersionsConfig } from "../../../versions/resolve-config";
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
import { _resetEnvCache } from "../../../../shared/lib/env";
import { consoleLogger } from "../../../../shared/types";
import { namedCollectionLockNames } from "../../../dynamic-collections/services/dynamic-collection-registry-service";
import { MIGRATION_LOCK_TABLE } from "../../../field-groups/migration/session";
import { MetaService } from "../../../meta/services/meta-service";
import { splitSqlStatements } from "../../migrate/split-sql";
import { parseSqlSections } from "../../migrate/sql-sections";
import { withStopPoints } from "../../migrate/stop-points";
import { WRITER_LOCK_FILE } from "../../migrate-create/writer-hold";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import {
  EARLIER_MIGRATE_LOCK_TABLE,
  MYSQL_MIGRATE_LOCK_NAME,
  SCHEMA_LOCK_TABLE,
} from "../../pipeline/schema-lock";
import { refuseReadOverLeftSave } from "../left-save-fields";
import { settleLeftSaves } from "../settle-left-save";
import { settleRegistryWriter } from "../settle-registry";

/** Where the save is stopped, and how to let it go. Shared with the module mock below. */
const kill = vi.hoisted(() => ({
  at: undefined as undefined | ((point: string) => boolean),
  reached: undefined as undefined | (() => void),
  release: undefined as undefined | (() => void),
}));

/** Stop for good where `point` is the kill point; the case releases it once it has looked. */
const stopHere = vi.hoisted(() => async (point: string): Promise<void> => {
  if (kill.at === undefined || !kill.at(point)) return;
  kill.at = undefined;
  await new Promise<void>((_, reject) => {
    kill.release = () =>
      reject(new Error(`the process was killed at ${point}`));
    kill.reached?.();
  });
});

// Each file runs as a unit: stop before one starts, as a process killed between two files would.
vi.mock("../../busy-table/run-unit", async original => {
  const actual = await original<typeof import("../../busy-table/run-unit")>();
  return {
    ...actual,
    runUnitInTries: async (
      ...args: Parameters<typeof actual.runUnitInTries>
    ) => {
      await stopHere(`unit:${args[2].source}`);
      return actual.runUnitInTries(...args);
    },
  };
});

// A save brings a translations table in step after its file, through this function, whose statements
// the file's stop points do not name: the save may be stopped once it has run, as a process killed
// there, with the main file applied, the column gone and the registry row still to write.
vi.mock("../../../i18n/migration/held-leaving-drops", async original => {
  const actual =
    await original<
      typeof import("../../../i18n/migration/held-leaving-drops")
    >();
  return {
    ...actual,
    applyCompanionTransition: async (
      ...args: Parameters<typeof actual.applyCompanionTransition>
    ) => {
      const answer = await actual.applyCompanionTransition(...args);
      await stopHere("companion: after");
      return answer;
    },
  };
});

// A save that pushes its change runs the push's statements through the statement executor: one at
// a time here, each followed by a point a process may be killed at, the statement kept, as MySQL
// keeps each schema statement as it runs.
vi.mock("../../services/drizzle-statement-executor", async original => {
  const actual =
    await original<
      typeof import("../../services/drizzle-statement-executor")
    >();
  class StoppingExecutor extends actual.DrizzleStatementExecutor {
    override async executeStatements(
      tx: unknown,
      statements: string[]
    ): Promise<void> {
      for (const statement of statements) {
        await super.executeStatements(tx, [statement]);
        await stopHere(`push: ${statement}`);
      }
    }
  }
  return { ...actual, DrizzleStatementExecutor: StoppingExecutor };
});

const run = promisify(execFile);
const WRITER = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "route-handler",
  "__tests__",
  "helpers",
  "left-save-writer.ts"
);
const MIGRATIONS = "./database/history";
const DEFINITION = "./schema/builder.json";
const EDITOR = "left-save-editor";

type Field = Record<string, unknown>;
const text = (name: string): Field => ({ name, type: "text" });

/** What a save that ended before its kill point answered, with each cause it carries. */
function causesOf(answer: unknown): string {
  const chain: string[] = [];
  let cause: unknown = answer;
  for (let depth = 0; depth < 6 && cause !== undefined; depth++) {
    chain.push(cause instanceof Error ? cause.message : String(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return chain.join(" <- ");
}

/** The same for a save's answer, a response by its status and body. */
const saidBy = async (answer: unknown): Promise<string> =>
  answer instanceof Response
    ? `${answer.status} ${await answer.clone().text()}`
    : causesOf(answer);

/** What one of the other process's operations came to (`helpers/left-save-writer.ts`). */
type Outcome = {
  kind:
    | "write"
    | "read"
    | "update"
    | "single-write"
    | "single-read"
    | "delete"
    | "registry-moved"
    | "pause"
    | "request";
  via: "rest" | "api";
  data?: Record<string, unknown>;
  /** A pause's files: the one it writes once reached, and the one it waits for. */
  reached?: string;
  until?: string;
  /** What a request does, one after the other, all in the one request. */
  within?: Array<Omit<Outcome, "ok">>;
  /** The entry an update changes. */
  id?: string;
  /** The collection, or the Single, sent to, where not the suite's collection. */
  slug?: string;
  /** How far a read populates relationships. */
  depth?: number;
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
  /** A thrown error's message with each cause it carries. */
  detail?: string;
  items?: Array<Record<string, unknown>>;
  item?: Record<string, unknown>;
};

let basePath: string;
let current: TestNextly | undefined;
let stopped: Promise<unknown> | undefined;
/** The point the last save was killed at, for a case to name when it finds another state. */
let killedAt: string | undefined;
let drops: Array<() => Promise<void>> = [];

beforeEach(() => {
  basePath = mkdtempSync(join(tmpdir(), "nextly-left-save-holds-"));
  drops = [];
});

afterEach(async () => {
  kill.at = undefined;
  kill.reached = undefined;
  kill.release?.();
  kill.release = undefined;
  await stopped;
  stopped = undefined;
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
  vi.unstubAllEnvs();
  _resetEnvCache();
  for (const drop of drops) await drop().catch(() => undefined);
  rmSync(basePath, { recursive: true, force: true });
}, 60_000);

/**
 * The two layouts a database keeps translatable values in: on the main tables, as databases made
 * before per-language storage do, and per language in translations tables, as every installation
 * keeps them now. The other process runs on the same one (`childLayoutArgs`).
 */
const LAYOUTS = [
  { layout: "translatable values on the main table", perLanguage: false },
  { layout: "translatable values per language", perLanguage: true },
] as const;

describe.each(
  getConfiguredTestDialects().flatMap(dialect =>
    LAYOUTS.map(layout => ({ dialect, ...layout }))
  )
)(
  "writes and reads while a Builder save is left part-way ($dialect, $layout)",
  ({
    dialect,
    perLanguage,
  }: {
    dialect: TestDialect;
    perLanguage: boolean;
  }) => {
    const slug = `held_notes_${dialect.slice(0, 2)}`;
    /**
     * A text field kept on the main table in either layout: shared where values are kept per
     * language (`localized: false`), as the rename this suite kills is a main-table rename there
     * too, made by the collection's push.
     */
    const field = (name: string): Field =>
      perLanguage ? { ...text(name), localized: false } : text(name);
    const table = `dc_${slug}`;
    let url: string;
    let cookie: string;

    /** A Single of the suite's, and the field group its collection may embed. */
    const hero = `held_hero_${dialect.slice(0, 2)}`;
    const card = `held_card_${dialect.slice(0, 2)}`;

    /**
     * A new database of this dialect, the instance on it, an editor, and the collection: with
     * `drafts`, Draft/Published and keeping each live entry's edits as a draft until published,
     * as a collection demoted from code does; with `status`, the Draft/Published switch alone;
     * with `headingDefault`, `heading` given that default; with `card`, a field `card` holding
     * the field group `card`; with `translatable`, `heading` translatable and left empty, so its
     * column is the translations table's where values are kept per language.
     */
    async function boot(
      options: {
        drafts?: boolean;
        status?: boolean;
        headingDefault?: string;
        card?: boolean;
        translatable?: boolean;
      } = {}
    ): Promise<TestNextly> {
      if (dialect === "sqlite") {
        url = `file:${join(basePath, "site.db")}`;
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_held");
        drops.push(scratch.drop);
        url = scratch.url;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("NODE_ENV", "development");
      _resetEnvCache();
      current = await createTestNextly({
        adapter: (await createAdapter({ type: dialect, url } as Parameters<
          typeof createAdapter
        >[0])) as never,
        basePath,
        db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
        perLanguageStorage: perLanguage,
      });
      await superAdminUser(current, EDITOR);
      cookie = `nextly_session=${await signAccessToken(
        buildClaims({
          userId: EDITOR,
          email: `${EDITOR}@example.test`,
          name: EDITOR,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      )}`;
      if (options.card === true) {
        await dispatchComponents(
          "createComponent",
          {},
          { slug: card, label: card, fields: [field("label")] }
        );
      }
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: slug,
          label: slug,
          fields: [
            options.headingDefault === undefined
              ? options.translatable === true
                ? text("heading")
                : field("heading")
              : { ...field("heading"), defaultValue: options.headingDefault },
            field("note"),
            ...(options.card === true
              ? [{ name: "card", type: "component", component: card }]
              : []),
          ],
          ...(options.drafts === true || options.status === true
            ? { status: true }
            : {}),
        }
      );
      if (options.drafts === true) {
        // Kept as a collection demoted from code keeps its code-first versions, drafts included
        // (`db:sync --demote`): the Builder's own switch keeps history alone, never a draft.
        const kept = JSON.stringify(resolveVersionsConfig({ drafts: true }));
        await current.adapter.executeQuery(
          `UPDATE dynamic_collections SET versions = '${kept}' WHERE slug = '${slug}'`
        );
        clearRegistryRowCache();
      }
      await current.nextly.create({
        collection: slug,
        data: {
          title: "First",
          slug: "first",
          note: "n",
          ...(options.translatable === true ? {} : { heading: "h" }),
        },
      } as never);
      return current;
    }

    /**
     * The columns of an entity's tables, the collection's unless named: its main table and its
     * translations table, where a translatable field's column is kept.
     */
    async function liveColumns(t: TestNextly, of = table): Promise<string[]> {
      const tables = [of, `${of}_locales`];
      const live = await introspectLiveSnapshot(
        t.adapter.getDrizzle(),
        t.adapter.dialect,
        tables
      );
      return live.tables
        .filter(each => tables.includes(each.name))
        .flatMap(each => each.columns.map(column => column.name));
    }

    /** The schema version a save of the entity `entity` in `registry` names. */
    async function versionOf(
      t: TestNextly,
      registry = "dynamic_collections",
      entity = slug
    ): Promise<number> {
      const row = await t.adapter.selectOne<{ schemaVersion?: unknown }>(
        registry,
        { where: { and: [{ column: "slug", op: "=", value: entity }] } }
      );
      return Number(row?.schemaVersion ?? 1);
    }

    /** What a save removing `heading` sends to have its drop confirmed, with its count of values. */
    const dropHeading = (count: number) => ({
      resolutions: { heading: { action: "confirm_drop" } },
      confirmedDeletions: [{ field: "heading", count }],
    });

    /** What a save renaming `heading` to `headline` in the table `inTable` sends beside its fields. */
    const renameHeading = (inTable: string) => ({
      renameResolutions: [
        {
          tableName: inTable,
          fromColumn: "heading",
          toColumn: "headline",
          choice: "rename",
        },
      ],
    });

    /** Start the save renaming `heading` to `headline` and kill it where `at` says. */
    async function killRename(
      t: TestNextly,
      at: (point: string) => Promise<boolean> | boolean
    ): Promise<void> {
      const schemaVersion = await versionOf(t);
      await killSave(t, at, () =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: slug },
          {
            fields: [field("headline"), field("note")],
            confirmed: true,
            schemaVersion,
            ...renameHeading(table),
          }
        )
      );
    }

    /**
     * Start `save` and kill it where `at` says; resolves once it has stopped there. With `live`, it
     * is not killed but paused there, holding what a running save holds.
     */
    async function killSave(
      t: TestNextly,
      at: (point: string) => Promise<boolean> | boolean,
      save: () => Promise<unknown>,
      { live = false }: { live?: boolean } = {}
    ): Promise<void> {
      const reached = new Promise<void>(resolve => {
        kill.reached = resolve;
      });
      let armed = true;
      // The points the save reached, so one that ended before its kill point says where it went.
      const passed: string[] = [];
      kill.at = point => {
        passed.push(point);
        const here =
          (point.startsWith("unit:") ||
            point.startsWith("push:") ||
            point.startsWith("companion:")) &&
          armed &&
          at(point) === true;
        if (here) killedAt = point;
        return here;
      };
      stopped = withStopPoints(async point => {
        passed.push(point);
        if (!armed || !(await at(point))) return;
        armed = false;
        killedAt = point;
        kill.at = () => true;
        await stopHere(point);
      }, save).catch((error: unknown) => error);
      const outcome = await Promise.race([
        reached.then(() => "reached"),
        stopped.then(
          async answer =>
            `the save ended first: ${await saidBy(answer)}; it passed ${passed.join(" | ")}`
        ),
      ]);
      expect(outcome, "the save never reached the kill point").toBe("reached");
      if (!live) await clearStoppedHolds(t);
    }

    /** What the killed process held, cleared as its lapse would clear it. */
    async function clearStoppedHolds(t: TestNextly): Promise<void> {
      await t.adapter.executeQuery(`DELETE FROM ${SCHEMA_LOCK_TABLE}`);
      for (const earlier of [
        MIGRATION_LOCK_TABLE,
        EARLIER_MIGRATE_LOCK_TABLE,
      ]) {
        if (await t.adapter.tableExists(earlier)) {
          await t.adapter.executeQuery(`DELETE FROM ${earlier}`);
        }
      }
      rmSync(join(basePath, MIGRATIONS, WRITER_LOCK_FILE), { force: true });
      if (dialect !== "mysql") return;
      const db = t.adapter.getDrizzle<{
        execute: (q: unknown) => Promise<unknown>;
      }>();
      const first = async (query: ReturnType<typeof sql>) => {
        const result = await db.execute(query);
        const rows = (
          Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
        ) as Array<Record<string, unknown>>;
        return rows[0] ?? {};
      };
      // The migrate lock, and the collection's own, which a save that removes a field's values
      // holds: each kept by its connection, which a killed process would have ended.
      const { db: database } = await first(sql`SELECT DATABASE() AS db`);
      const names = [
        MYSQL_MIGRATE_LOCK_NAME,
        ...namedCollectionLockNames(
          typeof database === "string" ? database : null,
          [slug]
        ),
      ];
      for (const name of names) {
        const { holder } = await first(
          sql`SELECT IS_USED_LOCK(${name}) AS holder`
        );
        if (holder !== null && holder !== undefined) {
          await t.adapter.executeQuery(`KILL ${Number(holder)}`);
        }
      }
    }

    /** `operations` sent from another process of the site, through REST and the Direct API. */
    async function fromAnotherProcess(
      operations: Array<Omit<Outcome, "ok">>
    ): Promise<Outcome[]> {
      const { stdout } = await run(
        process.execPath,
        [
          "--import",
          "tsx",
          ...childLayoutArgs(),
          WRITER,
          dialect,
          url,
          basePath,
          slug,
          JSON.stringify(operations),
        ],
        {
          cwd: join(__dirname, "..", "..", "..", "..", ".."),
          env: {
            ...process.env,
            NODE_ENV: "development",
            DB_DIALECT: dialect,
            DATABASE_URL: url,
            NEXTLY_TEST_COOKIE: cookie,
          },
          timeout: 150_000,
          maxBuffer: 64 * 1024 * 1024,
        }
      );
      const last = stdout.trim().split("\n").at(-1) ?? "[]";
      return JSON.parse(last) as Outcome[];
    }

    /** What each of `operations` came to, one line each, as the output prints them. */
    const outcomesOf = (outcomes: Outcome[]) =>
      outcomes
        .map(o =>
          JSON.stringify({
            kind: o.kind,
            via: o.via,
            ok: o.ok,
            code: o.code,
            message: o.message?.slice(0, 200),
            detail: o.detail?.slice(0, 300),
            items: o.items?.length,
            item:
              o.item === undefined
                ? undefined
                : Object.keys(o.item).slice(0, 12),
          })
        )
        .join("\n");

    /** Writes setting the field under each name, one setting another field, and reads, both ways. */
    const operations = (field: string, n: number) => [
      {
        kind: "write" as const,
        via: "rest" as const,
        data: { title: `R${n}`, slug: `r${n}`, [field]: "x" },
      },
      {
        kind: "write" as const,
        via: "api" as const,
        data: { title: `A${n}`, slug: `a${n}`, [field]: "y" },
      },
      {
        kind: "write" as const,
        via: "rest" as const,
        data: { title: `RN${n}`, slug: `rn${n}`, note: "only the note" },
      },
      {
        kind: "write" as const,
        via: "api" as const,
        data: { title: `AN${n}`, slug: `an${n}`, note: "only the note" },
      },
      { kind: "read" as const, via: "rest" as const },
      { kind: "read" as const, via: "api" as const },
    ];

    /** A migration file's statements in run order, for the runner's `unit` name, from disk. */
    function statementsOf(unit: string): string[] {
      const folder = join(basePath, MIGRATIONS);
      const file = readdirSync(folder).find(
        name => name === unit || name === `${unit}.sql`
      );
      if (file === undefined) return [];
      const content = readFileSync(join(folder, file), "utf-8");
      return splitSqlStatements(parseSqlSections(content).upSql, "mysql");
    }

    /**
     * A kill point just after the save's statement `which` picks: one its push makes, or one of its
     * migration files', read from disk.
     */
    const afterStatement =
      (which: (statement: string) => boolean) =>
      (point: string): boolean => {
        if (point.startsWith("push: ")) {
          return which(point.slice("push: ".length));
        }
        const after = /^([^:]+): after statement (\d+)$/.exec(point);
        if (after === null) return false;
        const statement = statementsOf(after[1]!)[Number(after[2]) - 1];
        return statement !== undefined && which(statement);
      };
    /**
     * The statement that renames `column`: a push's own ALTER TABLE, or the EXECUTE of a file's
     * restatement, which renames on MySQL as the one prepared statement its file runs. The SET
     * before it holds the rename's text and runs nothing.
     */
    const renames = (column: string) => (statement: string) =>
      /^\s*EXECUTE\b/i.test(statement) ||
      new RegExp(
        `^\\s*ALTER\\s+TABLE\\b.*RENAME\\s+COLUMN\\s+\`?${column}\`?`,
        "is"
      ).test(statement);
    /** The statement that drops `column`. */
    const dropsColumn = (column: string) => (statement: string) =>
      new RegExp(
        `^\\s*ALTER\\s+TABLE\\b.*DROP\\s+(COLUMN\\s+)?\`?${column}\`?`,
        "is"
      ).test(statement);

    /** Whether an outcome is a database error rather than an answer of Nextly's own. */
    const databaseError = (o: Outcome) =>
      /unknown column|no such column|does not exist|ER_BAD_FIELD/i.test(
        o.message ?? ""
      ) ||
      o.status === 500 ||
      o.code === "INTERNAL_ERROR";

    it.runIf(dialect === "mysql")(
      "refuses a write setting a field a committed rename changed, naming it, from another process; lets the rest through; and answers reads without a database error",
      async () => {
        const t = await boot();
        // Killed once the rename has committed, before its registry update: after the statement
        // that renames, read from the file the save runs or the push it makes, as no query may run
        // beside the save. A collection that keeps values per language pushes its change.
        await killRename(t, afterStatement(renames("heading")));
        const columns = await liveColumns(t);
        expect(columns, `killed at ${killedAt}`).toContain("headline");
        expect(columns, `killed at ${killedAt}`).not.toContain("heading");
        // Each layout by the road its save takes: its file, or the push.
        expect(killedAt).toMatch(
          perLanguage ? /^push: / : /_update\.sql: after statement/
        );

        const held = await fromAnotherProcess(operations("heading", 1));

        const [restSets, apiSets, restOther, apiOther, restRead, apiRead] =
          held;
        for (const refused of [restSets!, apiSets!]) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(databaseError(refused), JSON.stringify(refused)).toBe(false);
          expect(refused.message, JSON.stringify(refused)).toMatch(/heading/);
          // Its own code, apart from any other conflict: a release run stops on it, naming the field.
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
        }
        expect(restSets!.status).toBe(409);
        for (const through of [restOther!, apiOther!]) {
          expect(through.ok, JSON.stringify(through)).toBe(true);
        }
        for (const read of [restRead!, apiRead!]) {
          expect(databaseError(read), JSON.stringify(read)).toBe(false);
        }

        // The next development start settles the save: both writes go through again.
        await settleLeftSaves({
          adapter: t.adapter,
          projectRoot: basePath,
          migrationsDir: join(basePath, MIGRATIONS),
          logger: { info: () => undefined, warn: () => undefined },
          writeRegistry: settleRegistryWriter(t.adapter),
        });
        const settled = await fromAnotherProcess(operations("headline", 2));
        for (const outcome of settled) {
          expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
        }
      },
      600_000
    );

    // A publish writes the entry's held draft into the live row, whatever the request itself sets:
    // here only the status, with the draft holding the field the rename changed. A release run
    // publishes the same way.
    it.runIf(dialect === "mysql")(
      "refuses publishing a held draft that sets a field a committed rename changed, naming it, with the live entry unchanged",
      async () => {
        const t = await boot({ drafts: true });
        const created = (await t.nextly.create({
          collection: slug,
          data: {
            title: "Live",
            slug: "live",
            heading: "live heading",
            note: "n",
            status: "published",
          },
        } as never)) as { item?: { id?: unknown } };
        const id = String(created.item?.id);
        // The edit is held as the entry's draft, the live row as it was.
        await t.nextly.update({
          collection: slug,
          id,
          data: { heading: "held heading", _overwrite: true },
        } as never);
        const [before] = (await t.adapter.executeQuery(
          `SELECT heading FROM ${table} WHERE id = '${id}'`
        )) as unknown as Array<{ heading: unknown }>;
        expect(before?.heading, "the edit is held, not live").toBe(
          "live heading"
        );
        await killRename(t, afterStatement(renames("heading")));
        expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
          "headline"
        );

        const published = { status: "published", _overwrite: true };
        const outcomes = await fromAnotherProcess([
          { kind: "update", via: "rest", id, data: published },
          { kind: "update", via: "api", id, data: published },
        ]);

        for (const refused of outcomes) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
          expect(refused.message, JSON.stringify(refused)).toMatch(/heading/);
        }
        // Nothing of either publish was written: the live value is the one before the draft.
        const [live] = (await t.adapter.executeQuery(
          `SELECT headline FROM ${table} WHERE id = '${id}'`
        )) as unknown as Array<{ headline: unknown }>;
        expect(live?.headline).toBe("live heading");
      },
      600_000
    );

    // A create's defaults are written with it: one for a field a committed rename holds sets that
    // field, though the request names only another.
    it.runIf(dialect === "mysql")(
      "refuses a create whose default sets a field a committed rename changed, writing nothing",
      async () => {
        const t = await boot({ headingDefault: "a default" });
        await killRename(t, afterStatement(renames("heading")));
        expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
          "headline"
        );

        const outcomes = await fromAnotherProcess([
          {
            kind: "write",
            via: "rest",
            data: { title: "D1", slug: "d1", note: "only the note" },
          },
          {
            kind: "write",
            via: "api",
            data: { title: "D2", slug: "d2", note: "only the note" },
          },
        ]);

        for (const refused of outcomes) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
          expect(refused.message, JSON.stringify(refused)).toMatch(/heading/);
        }
        const rows = (await t.adapter.executeQuery(
          `SELECT slug FROM ${table}`
        )) as unknown as Array<{ slug: unknown }>;
        expect(rows.map(row => row.slug)).toEqual(["first"]);
      },
      600_000
    );

    // A read of another collection populates its relationship to this one: the related rows are
    // read as this collection's tables hold them, never dropped for a database error.
    it.runIf(dialect === "mysql")(
      "populates a relationship to a collection a committed rename changed, on a read of another collection",
      async () => {
        const t = await boot();
        const refs = `held_refs_${dialect.slice(0, 2)}`;
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name: refs,
            label: refs,
            fields: [
              { name: "target", type: "relationship", relationTo: slug },
            ],
          }
        );
        const [first] = (await t.adapter.executeQuery(
          `SELECT id FROM ${table} WHERE slug = 'first'`
        )) as unknown as Array<{ id: unknown }>;
        const firstId = String(first?.id);
        await t.nextly.create({
          collection: refs,
          data: { title: "Ref", slug: "ref", target: firstId },
        } as never);
        await killRename(t, afterStatement(renames("heading")));
        expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
          "headline"
        );

        const outcomes = await fromAnotherProcess([
          { kind: "read", via: "rest", slug: refs, depth: 1 },
          { kind: "read", via: "api", slug: refs, depth: 1 },
        ]);

        for (const read of outcomes) {
          expect(read.ok, JSON.stringify(read)).toBe(true);
          expect(read.items?.[0]?.target, JSON.stringify(read)).toMatchObject({
            id: firstId,
            note: "n",
          });
        }
      },
      600_000
    );

    // Turning Draft/Published off drops the status column the registry row still declares: no
    // read can leave it out, so the whole collection is held, its reads included.
    it.runIf(dialect === "mysql")(
      "refuses every write and read of a collection whose committed change dropped its status column",
      async () => {
        const t = await boot({ status: true });
        // The settings save turns it off; the schema save only ever turns it on.
        await killSave(t, afterStatement(dropsColumn("status")), () =>
          dispatchCollections(
            {} as ServiceContainer,
            "updateCollection",
            { collectionName: slug },
            { fields: [field("heading"), field("note")], status: false }
          )
        );
        expect(await liveColumns(t), `killed at ${killedAt}`).not.toContain(
          "status"
        );

        const outcomes = await fromAnotherProcess([
          {
            kind: "write",
            via: "rest",
            data: { title: "S1", slug: "s1", note: "only the note" },
          },
          {
            kind: "write",
            via: "api",
            data: { title: "S2", slug: "s2", note: "only the note" },
          },
          { kind: "read", via: "rest" },
          { kind: "read", via: "api" },
        ]);

        for (const refused of outcomes) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(databaseError(refused), JSON.stringify(refused)).toBe(false);
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
        }
      },
      600_000
    );

    // The hold is the whole entity's, so a write naming no field of it, the status alone, is held
    // too. Kept to the earlier layout: on per-language storage the save that drops the column has
    // not reached a kill point here.
    it.runIf(dialect === "mysql" && !perLanguage)(
      "refuses an update naming only the status of a collection whose committed change dropped its status column",
      async () => {
        const t = await boot({ status: true });
        const [first] = (await t.adapter.executeQuery(
          `SELECT id FROM ${table} WHERE slug = 'first'`
        )) as unknown as Array<{ id: unknown }>;
        const id = String(first?.id);
        await killSave(t, afterStatement(dropsColumn("status")), () =>
          dispatchCollections(
            {} as ServiceContainer,
            "updateCollection",
            { collectionName: slug },
            { fields: [field("heading"), field("note")], status: false }
          )
        );
        expect(await liveColumns(t), `killed at ${killedAt}`).not.toContain(
          "status"
        );

        const outcomes = await fromAnotherProcess([
          {
            kind: "update",
            via: "rest",
            id,
            data: { status: "published", _overwrite: true },
          },
          {
            kind: "update",
            via: "api",
            id,
            data: { status: "published", _overwrite: true },
          },
        ]);

        for (const refused of outcomes) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
        }
      },
      600_000
    );

    // A field group's rows are kept in its own table, which its save changed: each field of the
    // collection holding the group is held, and the collection's reads, which reach that table.
    it.runIf(dialect === "mysql")(
      "refuses a write setting a field that holds a field group a committed rename changed, and the collection's reads, naming the field group",
      async () => {
        const t = await boot({ card: true });
        const schemaVersion = await versionOf(t, "dynamic_components", card);
        await killSave(t, afterStatement(renames("label")), () =>
          dispatchComponents(
            "applyComponentSchemaChanges",
            { slug: card },
            {
              fields: [field("caption")],
              confirmed: true,
              schemaVersion,
              renameResolutions: [
                {
                  tableName: `comp_${card}`,
                  fromColumn: "label",
                  toColumn: "caption",
                  choice: "rename",
                },
              ],
            }
          )
        );

        expect(
          await liveColumns(t, `comp_${card}`),
          `killed at ${killedAt}`
        ).toContain("caption");

        const [restSets, apiSets, apiOther, restRead, apiRead] =
          await fromAnotherProcess([
            {
              kind: "write",
              via: "rest",
              data: { title: "C1", slug: "c1", card: { label: "x" } },
            },
            {
              kind: "write",
              via: "api",
              data: { title: "C2", slug: "c2", card: { label: "y" } },
            },
            {
              kind: "write",
              via: "api",
              data: { title: "C3", slug: "c3", note: "only the note" },
            },
            { kind: "read", via: "rest" },
            { kind: "read", via: "api" },
          ]);

        for (const refused of [restSets!, apiSets!, restRead!, apiRead!]) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
          expect(refused.message, JSON.stringify(refused)).toContain(
            `field group "${card}"`
          );
          expect(refused.message, JSON.stringify(refused)).toMatch(/"card"/);
        }
        // What each write left, read past the guard: a refused write nothing, the other its row.
        const rows = (await t.adapter.executeQuery(
          `SELECT slug FROM ${table} ORDER BY slug`
        )) as unknown as Array<{ slug: unknown }>;
        const left = rows.map(row => row.slug);
        expect(apiOther!.ok, JSON.stringify({ apiOther, left })).toBe(true);
        expect(left).toEqual(["c3", "first"]);
      },
      600_000
    );

    // A Single's first write, and its first read, insert its document with each field's default:
    // where a committed rename holds a field that has one, both are refused, with nothing written.
    it.runIf(dialect === "mysql")(
      "refuses a Single's first write and first read where a field with a default is one a committed rename changed",
      async () => {
        const t = await boot();
        const withDefault = (name: string): Field => ({
          ...field(name),
          defaultValue: "a default",
        });
        await dispatchSingles(
          "createSingle",
          {},
          {
            slug: hero,
            label: hero,
            fields: [withDefault("heading"), field("note")],
          }
        );
        const schemaVersion = await versionOf(t, "dynamic_singles", hero);
        await killSave(t, afterStatement(renames("heading")), () =>
          dispatchSingles(
            "applySingleSchemaChanges",
            { slug: hero },
            {
              fields: [withDefault("headline"), field("note")],
              confirmed: true,
              schemaVersion,
              ...renameHeading(`single_${hero}`),
            }
          )
        );

        expect(
          await liveColumns(t, `single_${hero}`),
          `killed at ${killedAt}`
        ).toContain("headline");

        const outcomes = await fromAnotherProcess([
          {
            kind: "single-write",
            via: "rest",
            slug: hero,
            data: { note: "only the note", _overwrite: true },
          },
          {
            kind: "single-write",
            via: "api",
            slug: hero,
            data: { note: "only the note", _overwrite: true },
          },
          { kind: "single-read", via: "rest", slug: hero },
          { kind: "single-read", via: "api", slug: hero },
        ]);

        for (const refused of outcomes) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
          expect(refused.message, JSON.stringify(refused)).toMatch(/heading/);
        }
        expect(
          await t.adapter.executeQuery(`SELECT id FROM single_${hero}`),
          "no document inserted"
        ).toEqual([]);
      },
      600_000
    );

    // A check inside a transaction it was not handed joins it: the refusal comes back as itself,
    // and the transaction it joined goes on, what it wrote kept.
    it.runIf(dialect === "mysql")(
      "refuses a read inside an open transaction with its own code, the transaction going on",
      async () => {
        const t = await boot();
        // A record that cannot be read holds every field, compared with nothing.
        await new MetaService(t.adapter, consoleLogger).set(
          `builder-save-in-progress:collection:${slug}`,
          { unreadable: true }
        );

        await t.adapter.transaction(async tx => {
          await expect(
            refuseReadOverLeftSave({
              adapter: t.adapter,
              kind: "collection",
              slug,
            })
          ).rejects.toMatchObject({ code: "BUILDER_SAVE_FIELD_UNSETTLED" });
          await tx.update(
            table,
            { note: "written after the refusal" },
            { and: [{ column: "slug", op: "=", value: "first" }] }
          );
        });

        const [row] = (await t.adapter.executeQuery(
          `SELECT note FROM ${table} WHERE slug = 'first'`
        )) as unknown as Array<{ note: unknown }>;
        expect(row?.note).toBe("written after the refusal");
      },
      600_000
    );

    /**
     * A request in another process making one write, then `second`, with `between` run while it is
     * paused between the two: what each of its operations came to.
     */
    async function aroundASecondWrite(
      second: Record<string, unknown>,
      between: () => Promise<void>
    ): Promise<Outcome[]> {
      const reached = join(basePath, "request-paused");
      const until = join(basePath, "request-goes-on");
      const sent = fromAnotherProcess([
        {
          kind: "request",
          via: "api",
          within: [
            {
              kind: "write",
              via: "api",
              data: { title: "R1", slug: "r1", note: "before the save" },
            },
            { kind: "pause", via: "api", reached, until },
            { kind: "write", via: "api", data: second },
          ],
        },
      ]);
      await vi.waitFor(() => expect(existsSync(reached)).toBe(true), {
        timeout: 120_000,
        interval: 200,
      });
      await between();
      writeFileSync(until, "go on");
      return sent;
    }

    // A read of the records that fails inside the join is thrown as it is. A nested transaction
    // joins flat on MySQL, so the failure ends the transaction it joined, whatever its caller does
    // with it: nothing of it is written.
    it.runIf(dialect === "mysql")(
      "ends a transaction the guard joined where its own read fails there, with that failure, nothing written",
      async () => {
        const t = await boot();
        // A column the read names is gone: a failure that is not a missing table's.
        const renameValue = (from: string, to: string) =>
          t.adapter.executeQuery(
            `ALTER TABLE nextly_meta RENAME COLUMN \`${from}\` TO \`${to}\``
          );
        await renameValue("value", "value_gone");
        try {
          await expect(
            t.adapter.transaction(async tx => {
              await tx.update(
                table,
                { note: "written before the failure" },
                { and: [{ column: "slug", op: "=", value: "first" }] }
              );
              // The caller carries on over it.
              await refuseReadOverLeftSave({
                adapter: t.adapter,
                kind: "collection",
                slug,
              }).catch(() => undefined);
            })
          ).rejects.toThrow(/value/);
        } finally {
          await renameValue("value_gone", "value");
        }
        const [row] = (await t.adapter.executeQuery(
          `SELECT note FROM ${table} WHERE slug = 'first'`
        )) as unknown as Array<{ note: unknown }>;
        expect(row?.note).toBe("n");
      },
      600_000
    );

    // A save running in another process, its record written and its lock held, is not one left
    // part-way: a request that began before it writes on, refused nothing.
    it.runIf(dialect === "mysql")(
      "lets a request's write through while a save that began within the request runs",
      async () => {
        const t = await boot();
        const schemaVersion = await versionOf(t);

        const [first, paused, second] = await aroundASecondWrite(
          { title: "R2", slug: "r2", note: "while it runs" },
          () =>
            // Paused before its first statement, so nothing of the tables has changed.
            killSave(
              t,
              point => point.startsWith("unit:"),
              () =>
                dispatchCollections(
                  {} as ServiceContainer,
                  "applySchemaChanges",
                  { collectionName: slug },
                  {
                    fields: [field("headline"), field("note")],
                    confirmed: true,
                    schemaVersion,
                    ...renameHeading(table),
                  }
                ),
              { live: true }
            )
        );

        expect(first!.ok, JSON.stringify(first)).toBe(true);
        expect(paused!.ok, JSON.stringify(paused)).toBe(true);
        expect(second!.ok, JSON.stringify(second)).toBe(true);
        expect(await liveColumns(t), `paused at ${killedAt}`).toContain(
          "heading"
        );
      },
      600_000
    );

    // The refusal is for every process: a save that starts while a request runs, and is killed
    // before the request's next write, holds that write too.
    it.runIf(dialect === "mysql")(
      "refuses a request's second write over a save another process began and left within the request",
      async () => {
        const t = await boot();

        const [first, paused, second] = await aroundASecondWrite(
          { title: "R2", slug: "r2", heading: "x" },
          async () => {
            await killRename(t, afterStatement(renames("heading")));
            expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
              "headline"
            );
          }
        );

        expect(first!.ok, JSON.stringify(first)).toBe(true);
        expect(paused!.ok, JSON.stringify(paused)).toBe(true);
        expect(second!.code, JSON.stringify(second)).toBe(
          "BUILDER_SAVE_FIELD_UNSETTLED"
        );
        // Only the field it changed is named.
        expect(second!.message, JSON.stringify(second)).toMatch(/"heading"/);
        expect(second!.message, JSON.stringify(second)).not.toMatch(/"note"/);
      },
      600_000
    );

    // Only the field the save changed is held: the request's write of another field goes on.
    it.runIf(dialect === "mysql")(
      "lets a request's second write of another field through over a save another process began and left within the request",
      async () => {
        const t = await boot();

        const [first, paused, second] = await aroundASecondWrite(
          { title: "R2", slug: "r2", note: "only the note" },
          async () => {
            await killRename(t, afterStatement(renames("heading")));
            expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
              "headline"
            );
          }
        );

        expect(first!.ok, JSON.stringify(first)).toBe(true);
        expect(paused!.ok, JSON.stringify(paused)).toBe(true);
        expect(second!.ok, JSON.stringify(second)).toBe(true);
      },
      600_000
    );

    // A delete reads the row it removes, through this process's tables, and answers as a write that
    // sets no field: the save's own change is not in its way, and neither is a process that has
    // read nothing of the collection before it. Each case deletes an entry first thing.
    for (const change of ["rename", "drop"] as const) {
      it.runIf(dialect === "mysql")(
        `deletes an entry of a collection a committed ${change} changed, first thing in another process`,
        async () => {
          const t = await boot();
          const rows = (await t.adapter.executeQuery(
            `SELECT id FROM ${table} WHERE slug = 'first'`
          )) as unknown as Array<{ id: unknown }>;
          const id = String(rows[0]?.id);
          if (change === "rename") {
            await killRename(t, afterStatement(renames("heading")));
          } else {
            const schemaVersion = await versionOf(t);
            await killSave(t, afterStatement(dropsColumn("heading")), () =>
              dispatchCollections(
                {} as ServiceContainer,
                "applySchemaChanges",
                { collectionName: slug },
                {
                  fields: [field("note")],
                  confirmed: true,
                  schemaVersion,
                  ...dropHeading(1),
                }
              )
            );
          }
          expect(await liveColumns(t), `killed at ${killedAt}`).not.toContain(
            "heading"
          );

          const [deleted] = await fromAnotherProcess([
            { kind: "delete", via: "api", id },
          ]);

          expect(deleted!.ok, JSON.stringify(deleted)).toBe(true);
          expect(
            await t.adapter.executeQuery(
              `SELECT id FROM ${table} WHERE slug = 'first'`
            ),
            "the entry is gone"
          ).toEqual([]);
        },
        600_000
      );
    }

    // The same, over REST as the signed-in editor.
    it.runIf(dialect === "mysql")(
      "deletes an entry of a collection a committed rename changed, over REST, first thing in another process",
      async () => {
        const t = await boot();
        const rows = (await t.adapter.executeQuery(
          `SELECT id FROM ${table} WHERE slug = 'first'`
        )) as unknown as Array<{ id: unknown }>;
        const id = String(rows[0]?.id);
        await killRename(t, afterStatement(renames("heading")));

        const [deleted] = await fromAnotherProcess([
          { kind: "delete", via: "rest", id },
        ]);

        expect(deleted!.ok, JSON.stringify(deleted)).toBe(true);
      },
      600_000
    );

    // A registry write anywhere moves the stored schema version, and the next request loads every
    // entity's tables again from the registry rows: what the guard left out of this process's
    // tables is left out again, so no read names the column the save moved.
    it.runIf(dialect === "mysql")(
      "answers reads and lets other writes through after the definitions are loaded again while the save stands",
      async () => {
        const t = await boot();
        await killRename(t, afterStatement(renames("heading")));
        expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
          "headline"
        );
        const other = (n: number) => ({
          title: `M${n}`,
          slug: `m${n}`,
          note: "only the note",
        });

        const outcomes = await fromAnotherProcess([
          { kind: "read", via: "api" },
          { kind: "write", via: "api", data: other(1) },
          { kind: "registry-moved", via: "api" },
          { kind: "read", via: "api" },
          { kind: "read", via: "rest" },
          { kind: "write", via: "api", data: other(2) },
          { kind: "write", via: "rest", data: other(3) },
        ]);

        for (const outcome of outcomes) {
          expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
        }
      },
      600_000
    );

    // A translatable field's column is the translations table's. A save dropping it, killed once
    // that column is gone, holds the field the same way: refused by name, other writes let through,
    // and no read naming the column.
    it.runIf(dialect === "mysql" && perLanguage)(
      "holds a translatable field a committed drop took from the translations table, in a collection",
      async () => {
        const t = await boot({ translatable: true });
        const schemaVersion = await versionOf(t);
        await killSave(
          t,
          point => point === "companion: after",
          () =>
            dispatchCollections(
              {} as ServiceContainer,
              "applySchemaChanges",
              { collectionName: slug },
              {
                fields: [field("note")],
                confirmed: true,
                schemaVersion,
                ...dropHeading(0),
              }
            )
        );
        expect(await liveColumns(t), `killed at ${killedAt}`).not.toContain(
          "heading"
        );

        const [sets, other, rest, api] = await fromAnotherProcess([
          {
            kind: "write",
            via: "api",
            data: { title: "T1", slug: "t1", heading: "x" },
          },
          {
            kind: "write",
            via: "api",
            data: { title: "T2", slug: "t2", note: "only the note" },
          },
          { kind: "read", via: "rest" },
          { kind: "read", via: "api" },
        ]);

        if (process.env.KILLED_OUT) {
          appendFileSync(
            process.env.KILLED_OUT,
            `${expect.getState().currentTestName?.slice(-110) ?? "?"} | killed at ${killedAt}\n` +
              outcomesOf([sets!, other!, rest!, api!]) +
              "\n"
          );
          return;
        }

        expect(sets!.code, JSON.stringify(sets)).toBe(
          "BUILDER_SAVE_FIELD_UNSETTLED"
        );
        expect(other!.ok, JSON.stringify(other)).toBe(true);
        for (const read of [rest!, api!]) {
          expect(read.ok, JSON.stringify(read)).toBe(true);
          expect(
            read.items?.some(item => item.note === "n"),
            JSON.stringify(read)
          ).toBe(true);
        }
      },
      600_000
    );

    it.runIf(dialect === "mysql" && perLanguage)(
      "holds a translatable field a committed drop took from the translations table, in a Single",
      async () => {
        const t = await boot();
        await dispatchSingles(
          "createSingle",
          {},
          { slug: hero, label: hero, fields: [text("heading"), field("note")] }
        );
        await t.nextly.updateSingle({
          slug: hero,
          data: { note: "n", _overwrite: true },
        } as never);
        const schemaVersion = await versionOf(t, "dynamic_singles", hero);
        await killSave(
          t,
          point => point === "companion: after",
          () =>
            dispatchSingles(
              "applySingleSchemaChanges",
              { slug: hero },
              {
                fields: [field("note")],
                confirmed: true,
                schemaVersion,
                ...dropHeading(0),
              }
            )
        );
        expect(
          await liveColumns(t, `single_${hero}`),
          `killed at ${killedAt}`
        ).not.toContain("heading");

        const [sets, other, rest, api] = await fromAnotherProcess([
          {
            kind: "single-write",
            via: "api",
            slug: hero,
            data: { heading: "x", _overwrite: true },
          },
          {
            kind: "single-write",
            via: "api",
            slug: hero,
            data: { note: "other", _overwrite: true },
          },
          { kind: "single-read", via: "rest", slug: hero },
          { kind: "single-read", via: "api", slug: hero },
        ]);

        if (process.env.KILLED_OUT) {
          appendFileSync(
            process.env.KILLED_OUT,
            `${expect.getState().currentTestName?.slice(-110) ?? "?"} | killed at ${killedAt}\n` +
              outcomesOf([sets!, other!, rest!, api!]) +
              "\n"
          );
          return;
        }

        expect(sets!.code, JSON.stringify(sets)).toBe(
          "BUILDER_SAVE_FIELD_UNSETTLED"
        );
        expect(other!.ok, JSON.stringify(other)).toBe(true);
        for (const read of [rest!, api!]) {
          expect(read.ok, JSON.stringify(read)).toBe(true);
          expect(read.item?.note, JSON.stringify(read)).toBe("other");
        }
      },
      600_000
    );

    // Killed before its file starts: a save that runs its file has a point there. One that pushes
    // (values kept per language) has none before its first statement; the comparison the hold
    // makes is the same on both, nothing changed and nothing held.
    it.runIf(!perLanguage)(
      "refuses no write where the save was killed before its file ran",
      async () => {
        const t = await boot();
        // Before the save's first file runs, whichever file that is.
        await killRename(t, point => point.startsWith("unit:"));
        expect(await liveColumns(t)).toContain("heading");

        const outcomes = await fromAnotherProcess(operations("heading", 1));

        for (const outcome of outcomes) {
          expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
        }
      },
      600_000
    );
  }
);
