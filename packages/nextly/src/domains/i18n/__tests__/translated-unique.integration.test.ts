/**
 * A translated field marked unique is unique within each language, on each dialect: the same value
 * is refused twice in one language and allowed in two, values left blank are never duplicates, and
 * what a read returns for a blank is exactly what it returned before the rule.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import type { FieldGroupMetadataService } from "../../field-groups/services/field-group-metadata-service";
import { companionUniqueIndexName } from "../migration/companion-unique-indexes";
import { readIndexUniqueness } from "../../schema/pipeline/live-table-facts";
import * as bootCheck from "../runtime/translated-unique-boot-check";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
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

  // The entity is translated already, but the field's values are still on the main table until
  // this save moves them into the default language, so that is where the duplicates are.
  it("refuses to make a shared field translated and unique over values it holds twice, and changes nothing", async () => {
    const created = await handler().createCollection({
      name: "pages",
      label: "Page",
      localized: true,
      fields: [
        { name: "handle", type: "text" },
        { name: "ref", type: "text", localized: false },
      ],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const a = idOf(await write("en", { handle: "a", ref: "same" }));
    const b = idOf(await write("en", { handle: "b", ref: "same" }));

    const refused = await handler().updateCollection(
      { collectionName: "pages" },
      {
        fields: [
          { name: "handle", type: "text" },
          { name: "ref", type: "text", unique: true },
        ],
      }
    );

    expect(refused.success).toBe(false);
    const said = JSON.stringify(refused);
    expect(said).toMatch(/TRANSLATED_UNIQUE_OVER_DUPLICATES/);
    expect(said).toContain(a);
    expect(said).toContain(b);
    expect(await columnsOf("dc_pages_locales")).not.toContain("ref");
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

  // A schema dialog pushes the entity's main table through the schema pipeline, which on SQLite and
  // MySQL reads every table in the database for any change that is not purely additive, the
  // companion's per-language unique index included. That index has to survive being read, and
  // still hold after the push.
  const TRANSLATED_UNIQUE_DIALOGS = [
    {
      entity: "a field group",
      change: "adds a shared field",
      companion: "comp_banner_locales",
      column: "heading",
      create: () =>
        dispatchComponents(
          "createComponent",
          {},
          {
            slug: "banner",
            label: "Banner",
            localized: true,
            fields: [
              { name: "heading", type: "text", unique: true },
              { name: "note", type: "text", localized: false },
            ],
          }
        ),
      apply: async () =>
        dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "banner" },
          {
            fields: [
              { name: "heading", type: "text", unique: true },
              { name: "note", type: "text", localized: false },
              { name: "subtitle", type: "text", localized: false },
            ],
            confirmed: true,
            localized: true,
            schemaVersion: await schemaVersionOf(
              "dynamic_components",
              "banner"
            ),
          }
        ),
    },
    {
      entity: "a field group",
      change: "makes a shared field Required",
      companion: "comp_banner_locales",
      column: "heading",
      create: () =>
        dispatchComponents(
          "createComponent",
          {},
          {
            slug: "banner",
            label: "Banner",
            localized: true,
            fields: [
              { name: "heading", type: "text", unique: true },
              { name: "note", type: "text", localized: false },
            ],
          }
        ),
      apply: async () =>
        dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "banner" },
          {
            fields: [
              { name: "heading", type: "text", unique: true },
              { name: "note", type: "text", localized: false, required: true },
            ],
            confirmed: true,
            localized: true,
            schemaVersion: await schemaVersionOf(
              "dynamic_components",
              "banner"
            ),
          }
        ),
    },
    {
      entity: "a collection",
      change: "makes a shared field Required",
      companion: "dc_pages_locales",
      column: "handle",
      create: async () => {
        const created = await handler().createCollection({
          name: "pages",
          label: "Page",
          localized: true,
          fields: [
            { name: "handle", type: "text", unique: true },
            { name: "note", type: "text", localized: false },
          ],
        });
        expect(created.success, JSON.stringify(created)).toBe(true);
      },
      apply: async () =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "pages" },
          {
            fields: [
              { name: "handle", type: "text", unique: true },
              { name: "note", type: "text", localized: false, required: true },
            ],
            confirmed: true,
            localized: true,
            schemaVersion: await schemaVersionOf(
              "dynamic_collections",
              "pages"
            ),
          }
        ),
    },
    {
      entity: "a field group",
      change: "removes a shared field",
      companion: "comp_banner_locales",
      column: "heading",
      create: () =>
        dispatchComponents(
          "createComponent",
          {},
          {
            slug: "banner",
            label: "Banner",
            localized: true,
            fields: [
              { name: "heading", type: "text", unique: true },
              { name: "note", type: "text", localized: false },
            ],
          }
        ),
      apply: async () =>
        dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "banner" },
          {
            fields: [{ name: "heading", type: "text", unique: true }],
            confirmed: true,
            localized: true,
            resolutions: { note: { action: "confirm_drop" } },
            schemaVersion: await schemaVersionOf(
              "dynamic_components",
              "banner"
            ),
          }
        ),
    },
    {
      entity: "a collection",
      change: "removes a shared field",
      companion: "dc_pages_locales",
      column: "handle",
      create: async () => {
        const created = await handler().createCollection({
          name: "pages",
          label: "Page",
          localized: true,
          fields: [
            { name: "handle", type: "text", unique: true },
            { name: "note", type: "text", localized: false },
          ],
        });
        expect(created.success, JSON.stringify(created)).toBe(true);
      },
      apply: async () =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "pages" },
          {
            fields: [{ name: "handle", type: "text", unique: true }],
            confirmed: true,
            localized: true,
            resolutions: { note: { action: "confirm_drop" } },
            schemaVersion: await schemaVersionOf(
              "dynamic_collections",
              "pages"
            ),
          }
        ),
    },
  ];

  it.each(TRANSLATED_UNIQUE_DIALOGS)(
    "keeps $entity's translated unique field indexed through a schema dialog that $change",
    async ({ companion, column, create, apply }) => {
      await create();
      const index = companionUniqueIndexName(companion, column);
      expect((await liveIndexes(companion)).get(index)?.unique).toBe(true);

      await apply();

      expect((await liveIndexes(companion)).get(index)?.unique).toBe(true);
      // On SQLite the index leaves blanks out by its WHERE; a push that rewrote it without one
      // would count every untranslated document as a duplicate of the others.
      // It still keys the field's column and the language, so it holds the field's values.
      if (dialect === "sqlite") {
        const [row] = await query<{ sql: string }>(
          `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = '${index}'`
        );
        expect(row?.sql).toContain(
          `WHERE "${column}" IS NOT NULL AND "${column}" <> ''`
        );
        const keyed = await query<{ name: string }>(
          `SELECT name FROM pragma_index_info('${index}') ORDER BY seqno`
        );
        expect(keyed.map(k => k.name)).toEqual([column, "_locale"]);
      }
    }
  );

  /** The registry's schema version of an entity, as a schema dialog sends it back. */
  async function schemaVersionOf(registry: string, slug: string) {
    const [row] = await query<{ version: number | string | null }>(
      `SELECT ${quoted("schema_version")} AS version FROM ${quoted(registry)} WHERE ${quoted("slug")} = '${slug}'`
    );
    return Number(row?.version ?? 1);
  }

  /** The indexes `table` holds now, read as the live reconcile reads them. */
  function liveIndexes(table: string) {
    return readIndexUniqueness(current.adapter.getDrizzle(), dialect, table);
  }

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

  /** Every column `table` has, as the database reports it. */
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

  // A number is a value like any other: zero and false are values, not blanks, and the index keys
  // the column as it is. Only text has a blank, ''.
  it("holds a translated unique number within each language, zero included", async () => {
    const created = await handler().createCollection({
      name: "ranks",
      label: "Rank",
      localized: true,
      // Translated explicitly: a number is shared unless it says otherwise.
      fields: [{ name: "rank", type: "number", unique: true, localized: true }],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entries = handler().getEntryService();
    const write = (
      locale: string,
      data: Record<string, unknown>,
      entryId?: string
    ) =>
      entryId
        ? entries.updateEntry(
            { collectionName: "ranks", entryId, overrideAccess: true, locale },
            data
          )
        : entries.createEntry(
            { collectionName: "ranks", overrideAccess: true, locale },
            data
          );

    const first = await write("en", { rank: 0 });
    expect(first.success, JSON.stringify(first)).toBe(true);
    expect(await write("en", { rank: 0 })).toMatchObject({
      statusCode: 409,
      code: "DUPLICATE",
    });
    const other = await write("en", { rank: 1 });
    const zeroInFrench = await write("fr", { rank: 0 }, idOf(other));
    expect(zeroInFrench.success, JSON.stringify(zeroInFrench)).toBe(true);
  });

  // MySQL's default collation compares text without case or accents, so a shared unique column
  // refuses "About" beside "about"; a translated one must judge "the same value" as it does.
  it.skipIf(dialect !== "mysql")(
    "judges the same value as MySQL's collation does, case aside",
    async () => {
      await seedCollection();
      const first = await write("en", { handle: "About" });
      expect(first.success, JSON.stringify(first)).toBe(true);

      expect(await write("en", { handle: "about" })).toMatchObject({
        statusCode: 409,
        code: "DUPLICATE",
      });
    }
  );

  it("refuses a field group's own update that makes a translated field unique over duplicates, and changes nothing", async () => {
    await dispatchComponents(
      "createComponent",
      {},
      {
        slug: "banner",
        label: "Banner",
        localized: true,
        fields: [{ name: "heading", type: "text" }],
      }
    );
    await writeBanner("b1", "en", "Sale");
    await writeBanner("b2", "en", "Sale");
    const service = current.getService(
      "fieldGroupMetadataService"
    ) as FieldGroupMetadataService;

    const refusal = await service
      .updateFieldGroup({
        slug: "banner",
        fields: [
          { name: "heading", type: "text", unique: true },
          { name: "subtitle", type: "text" },
        ],
      })
      .then(
        () => undefined,
        (error: { publicData?: unknown }) => error
      );

    expect(JSON.stringify(refusal?.publicData ?? null)).toMatch(
      /TRANSLATED_UNIQUE_OVER_DUPLICATES/
    );
    expect(await columnsOf("comp_banner_locales")).not.toContain("subtitle");
  });

  // An index under the per-language index's name proves nothing by its name: one left there that
  // is not unique holds nothing, so the save that finds it puts the real one in its place.
  it("replaces an index under the per-language index's name that is not unique", async () => {
    await seedCollection();
    const index = companionUniqueIndexName("dc_pages_locales", "handle");
    await query(
      dialect === "mysql"
        ? `DROP INDEX ${quoted(index)} ON ${quoted("dc_pages_locales")}`
        : `DROP INDEX ${quoted(index)}`
    );
    await query(
      `CREATE INDEX ${quoted(index)} ON ${quoted("dc_pages_locales")} (${dialect === "mysql" ? "`handle`(50)" : quoted("handle")}, ${quoted("_locale")})`
    );

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
    expect(saved.success, JSON.stringify(saved)).toBe(true);

    await write("en", { handle: "about" });
    expect(await write("en", { handle: "about" })).toMatchObject({
      statusCode: 409,
      code: "DUPLICATE",
    });
  });

  // An entity made in the Schema Builder before the rule was enforced has no index until it is
  // saved again, so the boot names it, as it names a configured one.
  it("names at boot a Schema Builder entity whose translated unique field has no index yet", async () => {
    await seedCollection();
    const index = companionUniqueIndexName("dc_pages_locales", "handle");
    await query(
      dialect === "mysql"
        ? `DROP INDEX ${quoted(index)} ON ${quoted("dc_pages_locales")}`
        : `DROP INDEX ${quoted(index)}`
    );
    const warnings: string[] = [];

    await bootCheck.warnAboutUnindexedTranslatedUnique(
      current.adapter,
      { collections: [] },
      message => warnings.push(message),
      await bootCheck.storedLocalizableEntities({
        collections: current.getService("collectionRegistryService"),
        singles: current.getService("singleRegistryService"),
        fieldGroups: current.getService("fieldGroupRegistryService"),
      })
    );

    expect(warnings.join("\n")).toMatch(
      /"pages": "handle" is translated and unique/
    );
  });
});
