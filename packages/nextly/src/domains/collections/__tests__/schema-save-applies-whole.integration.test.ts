/**
 * A Schema Builder save applies whole or fails whole, and says why.
 *
 * A new Required, Unique field on a collection that already has entries gives every existing entry
 * the same placeholder, so the unique index cannot be built. The save used to report "applied
 * successfully" over that failure: the column was there, the index was not, and the registry
 * recorded the field as unique. It now fails with the database's reason, the table keeps its shape,
 * and the registry keeps the fields it had.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { uniqueIndexNameForColumn } from "../../schema/services/index-name";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

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

describeEachDialect("a schema save whose migration fails", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    // The Builder's save runs its migration in development only.
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({ dialect, collections: [] });
  });

  afterEach(async () => {
    await current.destroy();
    vi.unstubAllEnvs();
  });

  const handler = () =>
    current.getService("collectionsHandler") as unknown as CollectionsHandler;

  async function query<T>(sql: string): Promise<T[]> {
    return (
      current.adapter as unknown as {
        executeQuery<R>(statement: string): Promise<R[]>;
      }
    ).executeQuery<T>(sql);
  }

  async function columnsOf(table: string): Promise<string[]> {
    const rows = await query<{ name: string }>(
      dialect === "mysql"
        ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
        : dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
    );
    return rows.map(row => row.name);
  }

  async function registeredFields(slug: string): Promise<string[]> {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const [row] = await query<{ fields: unknown }>(
      `SELECT ${q("fields")} AS fields FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${slug}'`
    );
    const fields = (
      typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
    ) as { name: string }[];
    return fields.map(f => f.name);
  }

  it("fails with the reason, and leaves the table and the registry as they were", async () => {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      fields: [{ name: "heading", type: "text" }],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    for (const heading of ["One", "Two"]) {
      const entry = await handler()
        .getEntryService()
        .createEntry(
          { collectionName: "posts", overrideAccess: true },
          { heading }
        );
      expect(entry.success, JSON.stringify(entry)).toBe(true);
    }
    const fieldsBefore = await registeredFields("posts");

    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      {
        fields: [
          { name: "heading", type: "text" },
          {
            name: "code",
            type: "text",
            length: 64,
            required: true,
            unique: true,
          },
        ],
      }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(false);
    // Refused before any statement runs, with the same reason on every dialect.
    expect(refusalOf(saved)).toMatch(
      /^2 entries would share the value '' for code, which must be unique\./
    );
    expect(await columnsOf("dc_posts")).not.toContain("code");
    expect(await registeredFields("posts")).toEqual(fieldsBefore);
  });

  /** The first field refusal a failed save carries. */
  function refusalOf(saved: unknown): string | undefined {
    return (saved as { publicData?: { errors?: { message: string }[] } })
      .publicData?.errors?.[0]?.message;
  }

  function createPost(data: Record<string, unknown>) {
    return handler()
      .getEntryService()
      .createEntry({ collectionName: "posts", overrideAccess: true }, data);
  }

  async function postsWith(
    fields: Record<string, unknown>[],
    entries: Record<string, unknown>[]
  ): Promise<void> {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      fields,
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    for (const data of entries) {
      const entry = await handler()
        .getEntryService()
        .createEntry({ collectionName: "posts", overrideAccess: true }, data);
      expect(entry.success, JSON.stringify(entry)).toBe(true);
    }
  }

  it("refuses making a field unique while entries share a value, naming it", async () => {
    await postsWith(
      [{ name: "heading", type: "text" }],
      [{ heading: "Same" }, { heading: "Same" }, { heading: "Other" }]
    );

    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: [{ name: "heading", type: "text", unique: true }] }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(false);
    expect(refusalOf(saved)).toMatch(
      /^2 entries share the value 'Same' for heading, which must be unique\./
    );
  });

  it("makes a field unique when its entries' values already differ", async () => {
    // Short, so MySQL can index it: an unbounded text column is refused as unkeyable there.
    const heading = {
      name: "heading",
      type: "text",
      options: { variant: "short" },
    };
    await postsWith([heading], [{ heading: "One" }, { heading: "Two" }]);

    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: [{ ...heading, unique: true }] }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(true);
    // Enforced, not only recorded: a repeated value is refused.
    expect((await createPost({ heading: "One" })).success).toBe(false);
    expect((await createPost({ heading: "Three" })).success).toBe(true);
  });

  it("refuses a length shorter than a value an entry holds, naming it", async () => {
    const short = (maxLength: number) => ({
      name: "heading",
      type: "text",
      options: { variant: "short" },
      validation: { maxLength },
    });
    await postsWith(
      [short(20)],
      [{ heading: "Long enough" }, { heading: "Hi" }]
    );

    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: [short(5)] }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(false);
    expect(refusalOf(saved)).toMatch(
      /^1 entry holds a heading longer than 5 characters, the new length\./
    );
  });

  // Not on SQLite, whose unique index is created `IF NOT EXISTS`: a name already taken is skipped
  // there rather than refused, so this save cannot be made to fail part-way the same way.
  it.skipIf(dialect === "sqlite")(
    "finishes a change the database refused part-way when it is saved again",
    async () => {
      // Something no precondition foresees: an index already holding the name the new unique
      // index takes. PostgreSQL rolls the whole save back; MySQL has added the column by then,
      // since it commits each schema statement, and the next save has to finish from there.
      await postsWith(
        [{ name: "heading", type: "text" }],
        [{ heading: "One" }, { heading: "Two" }]
      );
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const blocking = uniqueIndexNameForColumn("dc_posts", "code");
      await query(
        `CREATE INDEX ${q(blocking)} ON ${q("dc_posts")} (${q("id")})`
      );
      const fields = [
        { name: "heading", type: "text" },
        // Short, so MySQL can index it.
        {
          name: "code",
          type: "text",
          unique: true,
          options: { variant: "short" },
          validation: { maxLength: 64 },
        },
      ];

      const refused = await handler().updateCollection(
        { collectionName: "posts" },
        { fields }
      );

      expect(refused.success, JSON.stringify(refused)).toBe(false);
      expect(refused.message).toMatch(
        dialect === "mysql"
          ? /^The database refused statement \d+ of \d+ of this schema change\./
          : /^The database refused this schema change, so nothing was changed\./
      );
      expect(await registeredFields("posts")).not.toContain("code");

      await query(
        dialect === "mysql"
          ? `DROP INDEX ${q(blocking)} ON ${q("dc_posts")}`
          : `DROP INDEX ${q(blocking)}`
      );
      const saved = await handler().updateCollection(
        { collectionName: "posts" },
        { fields }
      );

      expect(saved.success, JSON.stringify(saved)).toBe(true);
      expect(await columnsOf("dc_posts")).toContain("code");
      expect(await registeredFields("posts")).toContain("code");
      expect((await createPost({ heading: "Three", code: "X" })).success).toBe(
        true
      );
      expect((await createPost({ heading: "Four", code: "X" })).success).toBe(
        false
      );
    }
  );

  it.skipIf(dialect === "sqlite")(
    "refuses again, rather than recording a uniqueness it cannot enforce, while the name is taken",
    async () => {
      // A retry before the blocking index is gone finds the new column there and an index under
      // the unique index's name. The name proves nothing: that index stands on another column.
      await postsWith(
        [{ name: "heading", type: "text" }],
        [{ heading: "One" }, { heading: "Two" }]
      );
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      await query(
        `CREATE INDEX ${q(uniqueIndexNameForColumn("dc_posts", "code"))} ON ${q("dc_posts")} (${q("id")})`
      );
      const fields = [
        { name: "heading", type: "text" },
        {
          name: "code",
          type: "text",
          unique: true,
          options: { variant: "short" },
          validation: { maxLength: 64 },
        },
      ];

      for (const attempt of [1, 2]) {
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { fields }
        );
        expect(
          saved.success,
          `attempt ${attempt}: ${JSON.stringify(saved)}`
        ).toBe(false);
      }
      expect(await registeredFields("posts")).not.toContain("code");
    }
  );

  it("turns Draft/Published on when the status column is already there", async () => {
    // As a save MySQL refused part-way leaves it: the column added, the registry unchanged.
    await postsWith([{ name: "heading", type: "text" }], [{ heading: "One" }]);
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    await query(
      `ALTER TABLE ${q("dc_posts")} ADD COLUMN ${q("status")} VARCHAR(20) DEFAULT 'draft'`
    );

    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: [{ name: "heading", type: "text" }], status: true }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(true);
  });

  it("checks a field whose column is not deployed yet without reading it", async () => {
    // Outside development a save writes its migration and runs nothing, so the registry can name
    // a field the table does not have yet; a later save changing it plans the next migration.
    await postsWith([{ name: "heading", type: "text" }], [{ heading: "One" }]);
    vi.stubEnv("NODE_ENV", "production");
    const added = await handler().updateCollection(
      { collectionName: "posts" },
      {
        fields: [
          { name: "heading", type: "text" },
          {
            name: "code",
            type: "text",
            options: { variant: "short" },
            validation: { maxLength: 64 },
          },
        ],
      }
    );
    expect(added.success, JSON.stringify(added)).toBe(true);
    expect(await columnsOf("dc_posts")).not.toContain("code");

    const unique = await handler().updateCollection(
      { collectionName: "posts" },
      {
        fields: [
          { name: "heading", type: "text" },
          {
            name: "code",
            type: "text",
            unique: true,
            options: { variant: "short" },
            validation: { maxLength: 64 },
          },
        ],
      }
    );

    expect(unique.success, JSON.stringify(unique)).toBe(true);
  });
});

// A translated collection plans its main table apart from its companion, so a save MySQL refused
// part-way has to be finished from the live main table on that branch too.
describeEachDialect(
  "a translated collection's schema save refused part-way",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    // Not on SQLite, for the reason given above.
    it.skipIf(dialect === "sqlite")(
      "finishes the change when it is saved again",
      async () => {
        const h = current.getService(
          "collectionsHandler"
        ) as unknown as CollectionsHandler;
        const created = await h.createCollection({
          name: "posts",
          label: "Post",
          localized: true,
          fields: [{ name: "heading", type: "text" }],
        });
        expect(created.success, JSON.stringify(created)).toBe(true);
        for (const heading of ["One", "Two"]) {
          const entry = await h
            .getEntryService()
            .createEntry(
              { collectionName: "posts", overrideAccess: true },
              { heading }
            );
          expect(entry.success, JSON.stringify(entry)).toBe(true);
        }
        const q = (name: string) =>
          dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
        const blocking = uniqueIndexNameForColumn("dc_posts", "code");
        await query(
          `CREATE INDEX ${q(blocking)} ON ${q("dc_posts")} (${q("id")})`
        );
        // A shared field, so its column is the main table's.
        const fields = [
          { name: "heading", type: "text" },
          {
            name: "code",
            type: "text",
            localized: false,
            unique: true,
            options: { variant: "short" },
            validation: { maxLength: 64 },
          },
        ];

        const refused = await h.updateCollection(
          { collectionName: "posts" },
          { fields }
        );
        expect(refused.success, JSON.stringify(refused)).toBe(false);

        await query(
          dialect === "mysql"
            ? `DROP INDEX ${q(blocking)} ON ${q("dc_posts")}`
            : `DROP INDEX ${q(blocking)}`
        );
        const saved = await h.updateCollection(
          { collectionName: "posts" },
          { fields }
        );

        expect(saved.success, JSON.stringify(saved)).toBe(true);
        const columns = await query<{ name: string }>(
          dialect === "mysql"
            ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dc_posts'`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'dc_posts'`
        );
        expect(columns.map(c => c.name)).toContain("code");
      }
    );

    it("adds a translated field whose companion column is already there", async () => {
      // As a save MySQL refused part-way leaves it: the companion column added, the registry
      // unchanged.
      const h = current.getService(
        "collectionsHandler"
      ) as unknown as CollectionsHandler;
      const created = await h.createCollection({
        name: "posts",
        label: "Post",
        localized: true,
        fields: [{ name: "heading", type: "text" }],
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      await query(
        `ALTER TABLE ${q("dc_posts_locales")} ADD COLUMN ${q("subtitle")} TEXT`
      );

      const saved = await h.updateCollection(
        { collectionName: "posts" },
        {
          fields: [
            { name: "heading", type: "text" },
            { name: "subtitle", type: "text" },
          ],
        }
      );

      expect(saved.success, JSON.stringify(saved)).toBe(true);
      const entry = await h
        .getEntryService()
        .createEntry(
          { collectionName: "posts", overrideAccess: true },
          { heading: "One", subtitle: "Below" }
        );
      expect(entry.success, JSON.stringify(entry)).toBe(true);
    });
  }
);
