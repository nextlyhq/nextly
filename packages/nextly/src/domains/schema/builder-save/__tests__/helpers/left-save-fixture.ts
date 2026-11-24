/**
 * What the files of cases over a Builder save the process left part-way share: the site, the kill,
 * and the other process that writes and reads.
 *
 * While such a save stands unsettled with a schema step committed and its registry update not run,
 * every write any Nextly process makes that sets the field that step changed is refused, naming the
 * field; writes that set no such field go on; and a read is answered from the tables, one that needs
 * a column they no longer have under the registry's name getting the same message, never a database
 * error. Only the settle lifts it.
 *
 * Only MySQL commits a step of a file on its own, so only there can a step stand committed without
 * its registry update. On PostgreSQL and SQLite a kill finds none or all of the change, and no
 * write is refused.
 *
 * The save is killed in this process: the step at the kill point runs, then the save never returns.
 * The writes come from another process (`left-save-writer.ts`), through REST as the signed-in editor
 * and through the Direct API.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { superAdminUser } from "../../../../../__tests__/fixtures/permission-holders";
import { createScratchDatabase } from "../../../../../__tests__/helpers/fresh-database";
import { childLayoutArgs } from "../../../../../__tests__/storage-layout";
import { buildClaims } from "../../../../../auth/jwt/claims";
import { signAccessToken } from "../../../../../auth/jwt/sign";
import { createAdapter } from "../../../../../database/factory";
import { clearRegistryRowCache } from "../../../../dynamic-collections/services/collection-row-cache";
import { resolveVersionsConfig } from "../../../../versions/resolve-config";
import { dispatchCollections } from "../../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../../dispatcher/handlers/component-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../../services";
import { _resetEnvCache } from "../../../../../shared/lib/env";
import { namedCollectionLockNames } from "../../../../dynamic-collections/services/dynamic-collection-registry-service";
import { MIGRATION_LOCK_TABLE } from "../../../../field-groups/migration/session";
import { splitSqlStatements } from "../../../migrate/split-sql";
import { parseSqlSections } from "../../../migrate/sql-sections";
import { withStopPoints } from "../../../migrate/stop-points";
import { WRITER_LOCK_FILE } from "../../../migrate-create/writer-hold";
import { introspectLiveSnapshot } from "../../../pipeline/diff/introspect-live";
import {
  EARLIER_MIGRATE_LOCK_TABLE,
  MYSQL_MIGRATE_LOCK_NAME,
  SCHEMA_LOCK_TABLE,
} from "../../../pipeline/schema-lock";

import { kill, stopHere } from "./stop-at-kill";

const run = promisify(execFile);
const WRITER = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "route-handler",
  "__tests__",
  "helpers",
  "left-save-writer.ts"
);
export const MIGRATIONS = "./database/history";
const DEFINITION = "./schema/builder.json";
const EDITOR = "left-save-editor";

export type Field = Record<string, unknown>;
export const text = (name: string): Field => ({ name, type: "text" });

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
export type Outcome = {
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

export let basePath: string;
let current: TestNextly | undefined;
let stopped: Promise<unknown> | undefined;
/** The point the last save was killed at, for a case to name when it finds another state. */
export let killedAt: string | undefined;
let drops: Array<() => Promise<void>> = [];

/** Each case's own folder and database, let go after it: called once by each file of cases. */
export function leftSaveHooks(): void {
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
}

/**
 * The two layouts a database keeps translatable values in: on the main tables, as databases made
 * before per-language storage do, and per language in translations tables, as every installation
 * keeps them now. The other process runs on the same one (`childLayoutArgs`).
 */
const LAYOUTS = [
  { layout: "translatable values on the main table", perLanguage: false },
  { layout: "translatable values per language", perLanguage: true },
] as const;

export const LEFT_SAVE_SUITES = getConfiguredTestDialects().flatMap(dialect =>
  LAYOUTS.map(layout => ({ dialect, ...layout }))
);

/** What the cases of one database and layout share: the names they use, the site, and the kill. */
export function leftSaveSuite({
  dialect,
  perLanguage,
}: {
  dialect: TestDialect;
  perLanguage: boolean;
}) {
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

  /**
   * Every row of the database that names `id`, its table before it: an entry's own row, and what
   * its writes leave in any other table.
   */
  async function rowsNaming(t: TestNextly, id: string): Promise<string[]> {
    const tables = (await t.adapter.executeQuery(
      "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE()"
    )) as unknown as Array<{ name: unknown }>;
    const found: string[] = [];
    for (const { name } of tables) {
      const rows = (await t.adapter.executeQuery(
        `SELECT * FROM \`${String(name)}\``
      )) as unknown as Array<Record<string, unknown>>;
      for (const row of rows) {
        const said = JSON.stringify(row, (_, value: unknown) =>
          typeof value === "bigint" ? String(value) : value
        );
        if (said.includes(id)) found.push(`${String(name)} ${said}`);
      }
    }
    return found.sort();
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
    for (const earlier of [MIGRATION_LOCK_TABLE, EARLIER_MIGRATE_LOCK_TABLE]) {
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
        cwd: join(__dirname, "..", "..", "..", "..", "..", ".."),
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

  return {
    slug,
    field,
    table,
    hero,
    card,
    boot,
    liveColumns,
    rowsNaming,
    versionOf,
    dropHeading,
    renameHeading,
    killRename,
    killSave,
    fromAnotherProcess,
    operations,
    afterStatement,
    renames,
    dropsColumn,
    databaseError,
  };
}
