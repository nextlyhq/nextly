/**
 * A translated field marked unique is unique within each language, on each dialect: the same value
 * is refused twice in one language and allowed in two, values left blank are never duplicates, and
 * what a read returns for a blank is exactly what it returned before the rule.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { companionUniqueIndexName } from "../migration/companion-unique-indexes";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

describeEachDialect("a translated unique field", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    // The Builder applies a collection's migration in development only.
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({
      dialect,
      collections: [],
      localization: { locales: ["en", "fr"], defaultLocale: "en" },
    });
  });

  afterEach(async () => {
    await current.destroy();
    vi.unstubAllEnvs();
  });

  function handler(): CollectionsHandler {
    return current.getService(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;
  }

  async function seedCollection(): Promise<void> {
    const created = await handler().createCollection({
      name: "pages",
      label: "Page",
      localized: true,
      fields: [
        { name: "handle", type: "text", unique: true },
        { name: "note", type: "text" },
        // A number, not text: MySQL cannot key a shared unique TEXT column.
        { name: "code", type: "number", unique: true, localized: false },
      ],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
  }

  async function write(
    locale: string,
    data: Record<string, unknown>,
    entryId?: string
  ) {
    const entries = handler().getEntryService();
    return entryId
      ? entries.updateEntry(
          { collectionName: "pages", entryId, overrideAccess: true, locale },
          data
        )
      : entries.createEntry(
          { collectionName: "pages", overrideAccess: true, locale },
          data
        );
  }

  const idOf = (result: { data?: unknown }) =>
    String((result.data as { id: unknown }).id);

  it("refuses the same value twice in one language, and allows it in another", async () => {
    await seedCollection();
    const first = await write("en", { handle: "about" });
    expect(first.success, JSON.stringify(first)).toBe(true);

    const second = await write("en", { handle: "about" });
    expect(second.success).toBe(false);
    // Refused exactly as a duplicate of a shared unique field is.
    await write("en", { code: 1 });
    const shared = await write("en", { code: 1 });
    expect(second).toMatchObject({ statusCode: 409, code: "DUPLICATE" });
    expect({
      statusCode: second.statusCode,
      code: second.code,
      message: second.message,
    }).toEqual({
      statusCode: shared.statusCode,
      code: shared.code,
      message: shared.message,
    });

    const french = await write("en", { handle: "a-propos" });
    expect(french.success, JSON.stringify(french)).toBe(true);
    const sameInFrench = await write("fr", { handle: "about" }, idOf(french));
    expect(sameInFrench.success, JSON.stringify(sameInFrench)).toBe(true);
  });

  it("never treats values left blank as duplicates, and reads a blank as it read before", async () => {
    await seedCollection();
    const a = await write("en", { handle: "", note: "" });
    const b = await write("en", { handle: "", note: "" });
    expect(a.success, JSON.stringify(a)).toBe(true);
    expect(b.success, JSON.stringify(b)).toBe(true);

    // The unique field reads back exactly as the ordinary translated field beside it does.
    const read = await handler()
      .getEntryService()
      .getEntry({
        collectionName: "pages",
        entryId: idOf(b),
        overrideAccess: true,
        locale: "en",
      });
    const data = read.data as Record<string, unknown>;
    expect(data.handle).toEqual(data.note);
  });

  /** The collection as it is before `handle` is unique, holding two English "about"s. */
  async function seedNotYetUnique(): Promise<string[]> {
    const created = await handler().createCollection({
      name: "pages",
      label: "Page",
      localized: true,
      fields: [{ name: "handle", type: "text" }],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const a = await write("en", { handle: "about" });
    const b = await write("en", { handle: "about" });
    await write("en", { handle: "" });
    await write("en", { handle: "" });
    return [idOf(a), idOf(b)];
  }

  const makeUnique = (unique: boolean) =>
    handler().updateCollection(
      { collectionName: "pages" },
      { fields: [{ name: "handle", type: "text", unique }] }
    );

  it("refuses to make a field unique over values already held twice in a language, naming the documents", async () => {
    const [a, b] = await seedNotYetUnique();

    const refused = await makeUnique(true);

    expect(refused.success).toBe(false);
    const said = JSON.stringify(refused);
    expect(said).toMatch(/TRANSLATED_UNIQUE_OVER_DUPLICATES/);
    expect(said).toContain(a);
    expect(said).toContain(b);
    expect(said).not.toContain("about");
    // Nothing changed: the duplicate can still be written.
    expect((await write("en", { handle: "about" })).success).toBe(true);
  });

  it("makes the field unique once the duplicates are gone, and lets them back when the rule goes", async () => {
    const [, b] = await seedNotYetUnique();
    await write("en", { handle: "about-us" }, b);

    const made = await makeUnique(true);
    expect(made.success, JSON.stringify(made)).toBe(true);
    expect((await write("en", { handle: "about" })).success).toBe(false);

    const unmade = await makeUnique(false);
    expect(unmade.success, JSON.stringify(unmade)).toBe(true);
    expect((await write("en", { handle: "about" })).success).toBe(true);
  });

  it.each([
    {
      change: "leaves translation",
      fields: [
        { name: "handle", type: "text", localized: false },
        { name: "note", type: "text" },
      ],
    },
    { change: "is removed", fields: [{ name: "note", type: "text" }] },
  ] as const)(
    "lets a unique translated field that $change go, index and all",
    async ({ fields }) => {
      const created = await handler().createCollection({
        name: "pages",
        label: "Page",
        localized: true,
        fields: [
          { name: "handle", type: "text", unique: true },
          { name: "note", type: "text" },
        ],
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
      await write("en", { handle: "about", note: "n" });

      const changed = await handler().updateCollection(
        { collectionName: "pages" },
        { fields: [...fields] }
      );

      expect(changed.success, JSON.stringify(changed)).toBe(true);
    }
  );

  /** Runs a statement on the test database, for rows only an embedding entry's save would write. */
  async function query<T>(sql: string): Promise<T[]> {
    return (
      current.adapter as unknown as {
        executeQuery<R>(statement: string): Promise<R[]>;
      }
    ).executeQuery<T>(sql);
  }

  const quoted = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  /** A row of the field group, and its text in one language. */
  async function writeBanner(id: string, locale: string, heading: string) {
    const columns = (names: string[]) => names.map(quoted).join(", ");
    await query(
      `INSERT INTO ${quoted("comp_banner")} (${columns(["id", "_parent_id", "_parent_table", "_parent_field"])}) ` +
        `VALUES ('${id}', 'entry-${id}', 'dc_pages', 'banner')`
    );
    await query(
      `INSERT INTO ${quoted("comp_banner_locales")} (${columns(["_parent", "_locale", "heading"])}) ` +
        `VALUES ('${id}', '${locale}', '${heading}')`
    );
  }

  it("holds a field group's translated unique field within each language", async () => {
    await dispatchComponents(
      "createComponent",
      {},
      {
        slug: "banner",
        label: "Banner",
        localized: true,
        fields: [{ name: "heading", type: "text", unique: true }],
      }
    );
    await writeBanner("b1", "en", "Sale");
    await writeBanner("b2", "fr", "Sale");

    // Refused by the companion's index, on every dialect's own wording for it.
    await expect(writeBanner("b3", "en", "Sale")).rejects.toThrow(
      /unique|duplicate/i
    );
  });

  it("refuses the save that would index a field marked unique before the rule held, over duplicates", async () => {
    // As a database from before the rule was enforced: the field is unique and translated, its
    // companion has no index, and a language holds a value twice.
    await seedCollection();
    const index = companionUniqueIndexName("dc_pages_locales", "handle");
    await query(
      dialect === "mysql"
        ? `DROP INDEX ${quoted(index)} ON ${quoted("dc_pages_locales")}`
        : `DROP INDEX ${quoted(index)}`
    );
    const a = idOf(await write("en", { handle: "about" }));
    const b = idOf(await write("en", { handle: "about" }));

    const saved = await handler().updateCollection(
      { collectionName: "pages" },
      {
        fields: [
          { name: "handle", type: "text", unique: true },
          { name: "note", type: "text" },
          { name: "code", type: "number", unique: true, localized: false },
          { name: "summary", type: "text" },
        ],
      }
    );

    expect(saved.success).toBe(false);
    const said = JSON.stringify(saved);
    expect(said).toMatch(/TRANSLATED_UNIQUE_OVER_DUPLICATES/);
    expect(said).toContain(a);
    expect(said).toContain(b);
    expect(said).not.toContain("about");
  });

  const UNIQUE_HEADING = [
    { name: "heading", type: "text", unique: true },
  ] as const;

  /** Each Builder entity whose create provisions its companion after its main table. */
  const CREATES = [
    {
      entity: "field group",
      table: "comp_banner",
      create: () =>
        dispatchComponents(
          "createComponent",
          {},
          {
            slug: "banner",
            label: "Banner",
            localized: true,
            fields: [...UNIQUE_HEADING],
          }
        ),
    },
    {
      entity: "Single",
      table: "single_hero",
      create: () =>
        dispatchSingles(
          "createSingle",
          {},
          {
            slug: "hero",
            label: "Hero",
            localized: true,
            fields: [...UNIQUE_HEADING],
          }
        ),
    },
  ];

  it.skipIf(dialect !== "mysql").each(CREATES)(
    "refuses a $entity's translated unique field where the server cannot key its index, before any table",
    async ({ table, create }) => {
      // MariaDB answers as MySQL and has no functional key parts.
      const capabilities = current.adapter.getCapabilities();
      vi.spyOn(current.adapter, "getCapabilities").mockReturnValue({
        ...capabilities,
        functionalIndexes: false,
      });

      const said = await create().then(
        result => JSON.stringify(result),
        (error: { publicData?: unknown }) => JSON.stringify(error.publicData)
      );

      expect(said).toMatch(/UNIQUE_NOT_ENFORCEABLE_ON_DIALECT/);
      expect(await current.adapter.tableExists(table)).toBe(false);
      expect(await current.adapter.tableExists(`${table}_locales`)).toBe(false);
    }
  );
});
