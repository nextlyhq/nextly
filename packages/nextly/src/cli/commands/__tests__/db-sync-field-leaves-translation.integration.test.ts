/**
 * `nextly db:sync` applying a config in which a translated field becomes shared: the field's
 * values move as a `next dev` reload moves them, the default language's onto the main table and
 * every other language into the archive, before its translations column is dropped.
 *
 * Each sync runs the command's own schema steps (`syncSchemaInOrder`) on a SQLite file of its own,
 * on a connection of its own, as two runs of the command would.
 *
 * @module cli/commands/__tests__/db-sync-field-leaves-translation.integration.test
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../../config";
import { ensureI18nArchive } from "../../../domains/i18n/migration/ensure-archive";
import { readRecordedEntities } from "../../../domains/i18n/migration/recorded-before";
import { defineFieldGroup } from "../../../field-groups/config/define-field-group";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import type { LoadConfigResult } from "../../utils/config-loader";
import { syncSchemaInOrder } from "../sync-schema";

import {
  openSqliteSyncTarget,
  type SqliteSyncTarget,
} from "./helpers/sqlite-sync-target";

const SLUG = "dbsleaves";
const TABLE = `dc_${SLUG}`;
const COMPANION = `${TABLE}_locales`;

/** A translated collection whose `body` is translated, or shared and perhaps Required. */
const configWith = (body: {
  localized: boolean;
  required?: boolean;
}): LoadConfigResult["config"] =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          { name: "title", type: "text", localized: false },
          { name: "body", type: "text", ...body },
        ] as never,
      }),
    ],
  });

let dir: string;
let target: SqliteSyncTarget | undefined;
let previousDialect: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-leaves-"));
  previousDialect = process.env.DB_DIALECT;
  told = [];
  clearCachedSnapshot();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await target?.adapter.disconnect();
  target = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  rmSync(dir, { recursive: true, force: true });
});

/** What the syncs logged as errors, in order. */
let told: string[] = [];

/** One `db:sync` of `config`, on a connection of its own. */
async function sync(config: LoadConfigResult["config"]): Promise<void> {
  process.env.DB_DIALECT = "sqlite";
  await target?.adapter.disconnect();
  clearCachedSnapshot();
  target = await openSqliteSyncTarget(dir);
  const { cli, options, context } = target;
  vi.spyOn(context.logger, "error").mockImplementation(message => {
    told.push(String(message));
  });
  await syncSchemaInOrder(
    { config } as LoadConfigResult,
    cli,
    options,
    context
  );
}

const query = async <T>(sql: string): Promise<T[]> =>
  (await target!.adapter.executeQuery(sql)) as T[];

const columnsOf = async (table: string): Promise<string[]> =>
  (await query<{ name: string }>(`PRAGMA table_info("${table}")`)).map(
    c => c.name
  );

/** The collection, translated, with an entry per key and its body in each language given. */
async function seed(
  entries: Record<string, Record<string, string>>
): Promise<void> {
  await sync(configWith({ localized: true }));
  for (const [id, bodies] of Object.entries(entries)) {
    await query(
      `INSERT INTO "${TABLE}" ("id", "title", "slug", "created_at", "updated_at") VALUES ('${id}', '${id}', '${id}', 0, 0)`
    );
    for (const [locale, body] of Object.entries(bodies)) {
      await query(
        `INSERT INTO "${COMPANION}" ("_parent", "_locale", "body") VALUES ('${id}', '${locale}', '${body}')`
      );
    }
  }
}

const mainBodies = async (): Promise<Record<string, unknown>> =>
  Object.fromEntries(
    (
      await query<{ id: string; body: unknown }>(
        `SELECT "id", "body" FROM "${TABLE}" ORDER BY "id"`
      )
    ).map(row => [row.id, row.body])
  );

const archived = async (): Promise<{ locale: string; value: string }[]> =>
  (await columnsOf("nextly_i18n_archive")).length === 0
    ? []
    : query(
        `SELECT "locale", "value" FROM "nextly_i18n_archive" ORDER BY "locale"`
      );

const OTHER = "dbsleaves2";
const OTHER_TABLE = `dc_${OTHER}`;

/** Two translated collections, each with `body` translated or shared. */
const twoConfigWith = (localized: boolean): LoadConfigResult["config"] =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [SLUG, OTHER].map(slug =>
      defineCollection({
        slug,
        localized: true,
        fields: [
          { name: "title", type: "text", localized: false },
          { name: "body", type: "text", localized },
        ] as never,
      })
    ),
  });

/** Whether the registry records `slug`'s `body` as translated. */
async function recordedTranslated(
  config: LoadConfigResult["config"],
  slug: string
): Promise<boolean | undefined> {
  const recorded = await readRecordedEntities(target!.adapter as never, config);
  const body = recorded
    ?.get(`collection:${slug}`)
    ?.fields.find(f => f.name === "body");
  return body?.localized === true;
}

const GROUP = "dbsleavegrp";
const GROUP_TABLE = `comp_${GROUP}`;

/** A translated field group whose `body` is translated, or shared and Required. */
const groupConfigWith = (localized: boolean): LoadConfigResult["config"] =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    fieldGroups: [
      defineFieldGroup({
        slug: GROUP,
        localized: true,
        fields: [
          { name: "body", type: "text", localized, required: !localized },
        ] as never,
      }),
    ],
  });

/** A row of `table` with `values`, every other required column given a placeholder. */
async function insertRow(
  table: string,
  values: Record<string, string>
): Promise<void> {
  const columns = await query<{
    name: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }>(`PRAGMA table_info("${table}")`);
  const row: Record<string, string | number> = { ...values };
  for (const c of columns) {
    if (c.name in row || c.notnull !== 1 || c.dflt_value !== null) continue;
    row[c.name] = c.name.endsWith("_at") || c.name === "_order" ? 0 : "x";
  }
  const names = Object.keys(row);
  const literal = (v: string | number) =>
    typeof v === "number" ? String(v) : `'${v}'`;
  await query(
    `INSERT INTO "${table}" (${names.map(n => `"${n}"`).join(", ")}) VALUES (${names.map(n => literal(row[n])).join(", ")})`
  );
}

describe("db:sync making a translated field shared (sqlite)", () => {
  it("keeps the default language's value on the main table, and archives the others", async () => {
    await seed({ a: { en: "Hello", es: "Hola" } });

    await sync(configWith({ localized: false }));

    expect(await mainBodies()).toEqual({ a: "Hello" });
    expect(await archived()).toEqual([{ locale: "es", value: "Hola" }]);
    expect(await columnsOf(COMPANION)).not.toContain("body");
  });

  it("changes nothing more when the same config is synced again", async () => {
    await seed({ a: { en: "Hello", es: "Hola" } });
    await sync(configWith({ localized: false }));

    await sync(configWith({ localized: false }));

    expect(await mainBodies()).toEqual({ a: "Hello" });
    expect(await archived()).toEqual([{ locale: "es", value: "Hola" }]);
  });

  it("makes a Required field required once its values are copied", async () => {
    await seed({ a: { en: "Hello", es: "Hola" }, b: { en: "Bye" } });

    await sync(configWith({ localized: false, required: true }));

    expect(await mainBodies()).toEqual({ a: "Hello", b: "Bye" });
    expect(await columnsOf(COMPANION)).not.toContain("body");
    // NOT NULL, with no default to fill it.
    await expect(
      query(
        `INSERT INTO "${TABLE}" ("id", "title", "slug", "created_at", "updated_at") VALUES ('c', 'c', 'c', 0, 0)`
      )
    ).rejects.toThrow();
  });

  // An entry with a value in another language keeps that one, so only an entry with none in any
  // language is left without a value.
  it("refuses a Required field while an entry has no value in any language, changing nothing", async () => {
    await seed({ a: { en: "Hello", es: "Hola" }, b: {} });
    const before = {
      main: await columnsOf(TABLE),
      companion: await columnsOf(COMPANION),
    };

    await expect(
      sync(configWith({ localized: false, required: true }))
    ).rejects.toThrow(/were not moved, and nothing was changed/);

    expect(told.join("\n")).toMatch(/would have no body once it is shared/);
    expect({
      main: await columnsOf(TABLE),
      companion: await columnsOf(COMPANION),
    }).toEqual(before);
    expect(before.companion).toContain("body");
    expect(await mainBodies()).toEqual({ a: null, b: null });
    expect(await archived()).toEqual([]);
  });
  // A stop after the first push leaves the registry saying the field is still translated, so the
  // values stay readable through the translations table and running the sync again moves them.
  it("moves the values on a rerun after a move that stopped part-way", async () => {
    await seed({ a: { en: "Hello", es: "Hola" } });
    await ensureI18nArchive(target!.adapter, "sqlite");
    await query(
      `CREATE TRIGGER "refuse_archive" BEFORE INSERT ON "nextly_i18n_archive" BEGIN SELECT RAISE(ABORT, 'archive refused'); END`
    );

    await expect(sync(configWith({ localized: false }))).rejects.toThrow(
      /were not moved \(see above\)/
    );
    expect(await columnsOf(COMPANION)).toContain("body");

    await query(`DROP TRIGGER "refuse_archive"`);
    await sync(configWith({ localized: false }));

    expect(await mainBodies()).toEqual({ a: "Hello" });
    expect(await archived()).toEqual([{ locale: "es", value: "Hola" }]);
    expect(await columnsOf(COMPANION)).not.toContain("body");
  });

  it("makes a field group's Required field required once its values are copied", async () => {
    await sync(groupConfigWith(true));
    await insertRow(GROUP_TABLE, { id: "g1" });
    await query(
      `INSERT INTO "${GROUP_TABLE}_locales" ("_parent", "_locale", "body") VALUES ('g1', 'en', 'Hello'), ('g1', 'es', 'Hola')`
    );

    await sync(groupConfigWith(false));

    expect(
      await query(`SELECT "body" FROM "${GROUP_TABLE}" WHERE "id" = 'g1'`)
    ).toEqual([{ body: "Hello" }]);
    expect(await columnsOf(`${GROUP_TABLE}_locales`)).not.toContain("body");
    const body = (
      await query<{ name: string; notnull: number }>(
        `PRAGMA table_info("${GROUP_TABLE}")`
      )
    ).find(c => c.name === "body");
    expect(body?.notnull).toBe(1);
  });
  // Each entity's translations column is dropped on its own: one whose drop went through has
  // moved, and stays recorded shared; only the one whose drop failed is written back translated.
  it("writes back only the entity whose drop failed, and a rerun moves it", async () => {
    await sync(twoConfigWith(true));
    for (const table of [TABLE, OTHER_TABLE]) {
      await query(
        `INSERT INTO "${table}" ("id", "title", "slug", "created_at", "updated_at") VALUES ('a', 'a', 'a', 0, 0)`
      );
      await query(
        `INSERT INTO "${table}_locales" ("_parent", "_locale", "body") VALUES ('a', 'en', 'Hello'), ('a', 'es', 'Hola')`
      );
    }
    // A view reading the second collection's translated column: SQLite refuses to drop a column
    // a view names, so that entity's drop fails after the first one's went through.
    await query(
      `CREATE VIEW "dbsleaves_hold" AS SELECT "body" FROM "${OTHER_TABLE}_locales"`
    );

    const shared = twoConfigWith(false);
    await expect(sync(shared)).rejects.toThrow(/were not moved \(see above\)/);
    expect(await columnsOf(COMPANION)).not.toContain("body");
    expect(await columnsOf(`${OTHER_TABLE}_locales`)).toContain("body");
    expect(await recordedTranslated(shared, SLUG)).toBe(false);
    expect(await recordedTranslated(shared, OTHER)).toBe(true);

    await query(`DROP VIEW "dbsleaves_hold"`);
    await sync(shared);

    expect(await columnsOf(`${OTHER_TABLE}_locales`)).not.toContain("body");
    for (const table of [TABLE, OTHER_TABLE]) {
      expect(
        await query(`SELECT "body" FROM "${table}" WHERE "id" = 'a'`)
      ).toEqual([{ body: "Hello" }]);
    }
  });
});
