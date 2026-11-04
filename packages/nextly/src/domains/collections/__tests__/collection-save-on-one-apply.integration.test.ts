/**
 * A Schema Builder save of a collection runs as one schema apply, under the schema lock.
 *
 * - **Retried from what the database holds.** A save the database refuses part-way leaves some
 *   of its work in place where the dialect commits statements on their own. The next save diffs
 *   the live table against the change and does only what is left, so every statement position a
 *   failure can come at ends, after one more save, in the table the change describes: its columns,
 *   indexes and foreign keys.
 * - **The whole database.** The apply diffs every table the Builder owns, as the schema dialog's
 *   does, so another table's drift refuses the save, naming that table.
 * - **Never beside another schema change.** A save, or the schema dialog's apply, while a
 *   migration holds the schema lock is refused at once, with nothing written.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import { withSchemaLock } from "../../schema/pipeline/schema-lock";
import { applyCollectionSchemaChange } from "../../schema/services/collection-schema-apply";
import { DrizzleStatementExecutor } from "../../schema/services/drizzle-statement-executor";

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
  updateCollection(
    params: { collectionName: string },
    body: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  getEntryService(): {
    createEntry(
      params: { collectionName: string; overrideAccess?: boolean },
      data: Record<string, unknown>
    ): Promise<{ success: boolean; message?: string }>;
  };
}

/** A Builder relationship to `target`, many to one. */
const relationTo = (name: string, target: string) => ({
  name,
  type: "relationship",
  options: { target, relationType: "manyToOne" },
});

/** The collection as it is before the save. */
const BEFORE = [
  { name: "title", type: "text" },
  { name: "code", type: "text" },
  { name: "count", type: "number" },
  { name: "rating", type: "number" },
  { name: "note", type: "text" },
  relationTo("owner", "people"),
];

/**
 * The save: a field made Unique, one renamed, one added, one removed, one retyped, one indexed,
 * a relationship re-keyed to another collection, and Draft/Published turned on.
 */
const AFTER = [
  { name: "title", type: "text", unique: true },
  { name: "sku", type: "text" },
  { name: "flag", type: "checkbox" },
  { name: "rating", type: "text" },
  { name: "note", type: "text", index: true },
  relationTo("owner", "teams"),
];

describeEachDialect("a collection's Builder save", dialect => {
  let current: TestNextly;

  beforeEach(() => {
    // The Builder's save applies its change in development only.
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await current?.destroy();
    vi.unstubAllEnvs();
  });

  const handler = () =>
    current.getService("collectionsHandler") as unknown as CollectionsHandler;

  async function query<T>(statement: string): Promise<T[]> {
    return (
      current.adapter as unknown as {
        executeQuery<R>(sql: string): Promise<R[]>;
      }
    ).executeQuery<T>(statement);
  }

  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  /** A fresh instance holding `items` as it is before the save, with two entries. */
  async function seeded(): Promise<void> {
    current = await createTestNextly({ dialect, collections: [] });
    for (const name of ["people", "teams"]) {
      const created = await handler().createCollection({
        name,
        label: name,
        fields: [{ name: "name", type: "text" }],
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
    }
    const created = await handler().createCollection({
      name: "items",
      label: "Item",
      fields: BEFORE,
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    for (const [title, code] of [
      ["One", "a-1"],
      ["Two", "b-2"],
    ]) {
      const entry = await handler()
        .getEntryService()
        .createEntry(
          { collectionName: "items", overrideAccess: true },
          { title, code, count: 1, rating: 4, note: "n" }
        );
      expect(entry.success, JSON.stringify(entry)).toBe(true);
    }
  }

  const save = () =>
    handler().updateCollection(
      { collectionName: "items" },
      { fields: AFTER, status: true }
    );

  /** The items table as the database holds it: columns, indexes and foreign keys, in name order. */
  async function liveItems(): Promise<string> {
    const snapshot = await introspectLiveSnapshot(
      current.adapter.getDrizzle(),
      dialect,
      ["dc_items"]
    );
    const [table] = snapshot.tables;
    const byName = <T extends { name: string }>(list: readonly T[] = []) =>
      [...list].sort((a, b) => a.name.localeCompare(b.name));
    return JSON.stringify({
      columns: byName(table?.columns).map(({ name, type, nullable }) => ({
        name,
        type,
        nullable,
      })),
      indexes: byName(table?.indexes),
      foreignKeys: byName(table?.foreignKeys),
    });
  }

  async function recordedFields(): Promise<string[]> {
    const [row] = await query<{ fields: unknown }>(
      `SELECT ${q("fields")} AS fields FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'items'`
    );
    const fields = (
      typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
    ) as { name: string }[];
    return fields.map(field => field.name);
  }

  /**
   * Count every schema statement the apply runs, and fail the `failAt`-th one when given, where
   * the apply's executor runs it: a failure there is the database refusing that statement, after
   * the ones before it ran. Watched at the executor rather than the connection, so the apply's
   * own transactions are opened where they always are.
   */
  function watchStatements(failAt?: number): { count: () => number } {
    let seen = 0;
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
        seen += 1;
        if (seen === failAt) {
          throw new Error(`injected failure at statement ${seen}`);
        }
        await run.call(this, tx, [statement]);
      }
    });
    return { count: () => seen };
  }

  it("ends in the table it describes, whichever statement the database refused, once saved again", async () => {
    // The table the save gives when nothing is refused, and how many statements it takes.
    await seeded();
    const watched = watchStatements();
    const clean = await save();
    expect(clean.success, JSON.stringify(clean)).toBe(true);
    const statements = watched.count();
    vi.restoreAllMocks();
    const described = await liveItems();
    const recorded = await recordedFields();
    expect(statements).toBeGreaterThan(0);
    await current.destroy();

    for (let k = 1; k <= statements; k += 1) {
      await seeded();
      watchStatements(k);
      await save();
      vi.restoreAllMocks();

      const retried = await save();

      expect([k, retried.success, retried.message]).toEqual([
        k,
        true,
        expect.any(String),
      ]);
      expect([k, await liveItems()]).toEqual([k, described]);
      expect([k, await recordedFields()]).toEqual([k, recorded]);
      await current.destroy();
    }
  }, 900_000);

  it("is refused, naming the table, when another table the Builder owns has drifted", async () => {
    await seeded();
    const recordedBefore = await recordedFields();
    // A column no save made, on another collection's table.
    await query(`ALTER TABLE ${q("dc_people")} ADD COLUMN ${q("stray")} TEXT`);

    const saved = await save();

    expect(saved.success).toBe(false);
    expect(saved.message).toContain("dc_people");
    expect(await recordedFields()).toEqual(recordedBefore);
  }, 120_000);

  /** Hold the schema lock as `nextly migrate` would, for as long as `during` runs. */
  async function whileMigrationHoldsLock(
    during: () => Promise<void>
  ): Promise<void> {
    let release = (): void => undefined;
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    let held = (): void => undefined;
    const isHeld = new Promise<void>(resolve => {
      held = resolve;
    });
    const holder = withSchemaLock(
      {
        adapter: current.adapter,
        command: "nextly migrate",
        whenHeld: "refuse",
        mayCreateTables: true,
        releaseOnInterrupt: false,
      },
      async () => {
        held();
        await released;
      }
    );
    await Promise.race([isHeld, holder]);
    try {
      await during();
    } finally {
      release();
      await holder;
    }
  }

  const LOCK_HELD =
    "A migration is running on this database, so this change was not saved. " +
    "Save it again once the migration ends.";

  it("is refused at once, writing nothing, while a migration holds the schema lock", async () => {
    await seeded();
    const before = await liveItems();
    const recordedBefore = await recordedFields();

    // The save is refused as unavailable, as every schema change is while the lock is held.
    await whileMigrationHoldsLock(async () => {
      await expect(save()).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        publicMessage: LOCK_HELD,
      });
    });

    expect(await liveItems()).toBe(before);
    expect(await recordedFields()).toEqual(recordedBefore);
  }, 120_000);

  it("refuses the schema dialog's apply at once, writing nothing, while another schema change holds the lock", async () => {
    // The dialog holds no lock of its own; the shared apply takes it. The change here would
    // apply cleanly unguarded, adding a column, so only the lock keeps the table as it was.
    await seeded();
    const before = await liveItems();
    const [row] = await query<{ fields: unknown }>(
      `SELECT ${q("fields")} AS fields FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'items'`
    );
    const recorded = (
      typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
    ) as FieldDefinition[];

    await whileMigrationHoldsLock(async () => {
      await expect(
        applyCollectionSchemaChange({
          slug: "items",
          collection: { tableName: "dc_items", fields: recorded },
          fields: [...recorded, { name: "extra", type: "text" }],
          wasLocalized: false,
          isLocalized: false,
          status: false,
          wasStatus: false,
          renameResolutions: [],
          eventResolutions: [],
        })
      ).rejects.toMatchObject({ publicMessage: LOCK_HELD });
    });

    expect(await liveItems()).toBe(before);
  }, 120_000);

  /** The items table's columns, by name. */
  async function itemColumns(): Promise<string[]> {
    const snapshot = await introspectLiveSnapshot(
      current.adapter.getDrizzle(),
      dialect,
      ["dc_items"]
    );
    return (snapshot.tables[0]?.columns ?? []).map(column => column.name);
  }

  /** A JSON column's value as stored, parsed where the driver hands back its text. */
  const parsedJson = (value: unknown): unknown =>
    typeof value === "string" ? JSON.parse(value) : value;

  it("fills the entries already there when Required checkbox, number and date fields are added", async () => {
    // Each type's empty value, in the encoding its column stores: camelCase names, whose
    // columns are snake_case, included.
    await seeded();

    const saved = await handler().updateCollection(
      { collectionName: "items" },
      {
        fields: [
          ...BEFORE,
          { name: "isFeatured", type: "checkbox", required: true },
          { name: "itemCount", type: "number", required: true },
          { name: "publishedOn", type: "date", required: true },
        ],
      }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const rows = await query<Record<string, unknown>>(
      `SELECT ${q("is_featured")} AS f, ${q("item_count")} AS n, ${q("published_on")} AS d FROM ${q("dc_items")}`
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Boolean(row.f)).toBe(false);
      expect(Number(row.n)).toBe(0);
      expect(row.d).not.toBeNull();
    }
  }, 120_000);

  it("fills the entries already there from a Required date field's stated default, as its column stores a date", async () => {
    // SQLite keeps a date as its epoch seconds, so the stated default is bound
    // as those, as the migration file writes it, not as the text it was typed as.
    await seeded();
    const stated = "2026-01-02T03:04:05.000Z";

    const saved = await handler().updateCollection(
      { collectionName: "items" },
      {
        fields: [
          ...BEFORE,
          { name: "launchedOn", type: "date", required: true, default: stated },
        ],
      }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const rows = await query<{ d: unknown }>(
      `SELECT ${q("launched_on")} AS d FROM ${q("dc_items")}`
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.d).not.toBeNull();
      if (dialect === "sqlite") {
        expect(row.d).toBe(Math.floor(Date.parse(stated) / 1000));
      }
    }
  }, 120_000);

  it("keeps a column it never made, rather than trading it for a field the save adds", async () => {
    // A column added outside the Builder looks to the pipeline like a rename
    // candidate for a column the save adds. Only the columns the save itself
    // removes are its to drop, so this one is left, and the save is refused.
    await seeded();
    await query(`ALTER TABLE ${q("dc_items")} ADD COLUMN ${q("stray")} TEXT`);
    const recordedBefore = await recordedFields();

    const saved = await handler().updateCollection(
      { collectionName: "items" },
      { fields: [...BEFORE, { name: "subtitle", type: "text" }] }
    );

    expect(saved.success).toBe(false);
    expect(saved.message).toMatch(
      /holds a column "stray" that no field describes/
    );
    expect(await itemColumns()).toContain("stray");
    expect(await recordedFields()).toEqual(recordedBefore);
  }, 120_000);

  it("fills the entries already there from an optional field's stated default, as the migration file does", async () => {
    // The file adds the column with its DEFAULT, so every database built from
    // it has the value in the rows already there; this database must too.
    await seeded();

    const saved = await handler().updateCollection(
      { collectionName: "items" },
      {
        fields: [
          ...BEFORE,
          {
            name: "badge",
            type: "text",
            default: "new",
            options: { variant: "short" },
          },
        ],
      }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const rows = await query<{ b: unknown }>(
      `SELECT ${q("badge")} AS b FROM ${q("dc_items")}`
    );
    expect(rows.map(row => row.b)).toEqual(["new", "new"]);
  }, 120_000);

  // Not on SQLite, which refuses taking a relationship's column off a table up front
  // (`FOREIGN_KEY_DROP_UNSUPPORTED`): its foreign key goes only with a rebuild of the table.
  it.skipIf(dialect === "sqlite")(
    "drops a relationship's column when it becomes many-to-many",
    async () => {
      // The field keeps its name and loses its column to a junction table, so the save answers the
      // column's drop itself, as it does a removed field's.
      await seeded();
      expect(await itemColumns()).toContain("owner");

      const saved = await handler().updateCollection(
        { collectionName: "items" },
        {
          fields: [
            ...BEFORE.filter(field => field.name !== "owner"),
            {
              name: "owner",
              type: "relationship",
              options: { target: "people", relationType: "manyToMany" },
            },
          ],
        }
      );

      expect(saved.success, JSON.stringify(saved)).toBe(true);
      expect(await itemColumns()).not.toContain("owner");
    },
    120_000
  );

  it("fills the entries already there from a Required JSON field's default", async () => {
    await seeded();

    const saved = await handler().updateCollection(
      { collectionName: "items" },
      {
        fields: [
          ...BEFORE,
          { name: "tags", type: "json", required: true, default: ["a"] },
        ],
      }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const rows = await query<{ tags: unknown }>(
      `SELECT ${q("tags")} AS tags FROM ${q("dc_items")}`
    );
    expect(rows.map(row => parsedJson(row.tags))).toEqual([["a"], ["a"]]);
  }, 120_000);

  it("keeps the table's own unique index on slug when a slug field stops being unique", async () => {
    // A table with a `slug` column keeps it unique whatever a field of that name says, so turning
    // the field's Unique off leaves the index the table has for its own reasons.
    current = await createTestNextly({ dialect, collections: [] });
    const slug = { name: "slug", type: "text" };
    const created = await handler().createCollection({
      name: "pages",
      label: "Page",
      fields: [
        { name: "title", type: "text" },
        { ...slug, unique: true },
      ],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);

    const saved = await handler().updateCollection(
      { collectionName: "pages" },
      { fields: [{ name: "title", type: "text" }, slug] }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const snapshot = await introspectLiveSnapshot(
      current.adapter.getDrizzle(),
      dialect,
      ["dc_pages"]
    );
    expect(
      (snapshot.tables[0]?.indexes ?? []).some(
        index =>
          index.unique &&
          index.columns.length === 1 &&
          index.columns[0] === "slug"
      )
    ).toBe(true);
  }, 120_000);
});
