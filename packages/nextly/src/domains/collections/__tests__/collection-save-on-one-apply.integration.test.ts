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
 * - **Never beside another schema change.** A save while a migration holds the schema lock is
 *   refused at once, with nothing written.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import { withSchemaLock } from "../../schema/pipeline/schema-lock";

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

/** Every statement a schema change writes with, by its leading keyword. */
const WRITES = /^\s*(ALTER|CREATE|DROP|UPDATE|INSERT|DELETE|RENAME)\b/i;

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
   * Count every writing statement the adapter's Drizzle handle runs, and fail the `failAt`-th
   * one when given: on the handle and on any transaction opened from it.
   */
  function watchStatements(failAt?: number): { count: () => number } {
    let seen = 0;
    const adapter = current.adapter as unknown as {
      getDrizzle(...args: unknown[]): unknown;
    };
    const real = adapter.getDrizzle.bind(adapter);
    const textOf = (statement: unknown) =>
      typeof statement === "string"
        ? statement
        : (
            (statement as { queryChunks?: { value?: unknown }[] })
              .queryChunks ?? []
          )
            .map(chunk =>
              Array.isArray(chunk.value) ? chunk.value.join("") : ""
            )
            .join("");
    const wrap = (db: object): object =>
      new Proxy(db, {
        get(target, property, receiver) {
          const value: unknown = Reflect.get(target, property, receiver);
          if (typeof value !== "function") return value;
          if (property === "execute" || property === "run") {
            return (statement: unknown, ...rest: unknown[]) => {
              if (WRITES.test(textOf(statement))) {
                seen += 1;
                if (seen === failAt) {
                  throw new Error(`injected failure at statement ${seen}`);
                }
              }
              return Reflect.apply(value, target, [statement, ...rest]);
            };
          }
          if (property === "transaction") {
            return (run: (tx: object) => unknown, ...rest: unknown[]) =>
              Reflect.apply(value, target, [
                (tx: object) => run(wrap(tx)),
                ...rest,
              ]);
          }
          return value.bind(target);
        },
      });
    vi.spyOn(adapter, "getDrizzle").mockImplementation((...args: unknown[]) =>
      wrap(real(...args) as object)
    );
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

  it("is refused at once, writing nothing, while a migration holds the schema lock", async () => {
    await seeded();
    const before = await liveItems();
    const recordedBefore = await recordedFields();
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
      const saved = await save();

      expect(saved).toMatchObject({
        success: false,
        message:
          "A migration is running on this database, so this change was not saved. " +
          "Save it again once the migration ends.",
      });
    } finally {
      release();
      await holder;
    }

    expect(await liveItems()).toBe(before);
    expect(await recordedFields()).toEqual(recordedBefore);
  }, 120_000);
});
