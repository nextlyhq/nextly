/**
 * The localization archive keeps each row's entity kind, so a collection, a Single and a field
 * group that share a slug never read or remove each other's archived values.
 *
 * Collections and Singles share one namespace of slugs, but a field group's registry is its own, so
 * a collection and a field group may both be `hero`. Each makes a translated field shared, which
 * archives its other languages under the slug `hero`. Restoring one must bring back only its own
 * values, and deleting one must leave the other's. An archive written before the kind existed
 * reads its rows as collections once `nextly migrate` (or a Builder save) has added the column.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { reconcileCore } from "../../schema/migrate/core-reconcile";
import { restoreI18nArchive } from "../migration/restore-archive";
import { teardownEntityI18n } from "../migration/teardown-entity-i18n";

const LOCALES = ["en", "es"];
const TRANSLATED = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];
const SHARED = [
  { name: "heading", type: "text", localized: false },
  { name: "views", type: "number" },
];

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
      params: {
        collectionName: string;
        overrideAccess?: boolean;
        locale?: string;
      },
      data: Record<string, unknown>
    ): Promise<{ success: boolean; data: unknown }>;
    updateEntry(
      params: {
        collectionName: string;
        entryId: string;
        overrideAccess?: boolean;
        locale?: string;
      },
      data: Record<string, unknown>
    ): Promise<{ success: boolean }>;
  };
}

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect("the archive's entity kind", dialect => {
  let current: TestNextly;
  const q = (name: string) => quote(dialect, name);

  beforeEach(async () => {
    // The builder's update path runs its migration in development only.
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({
      dialect,
      collections: [],
      localization: { locales: LOCALES, defaultLocale: "en" },
    });
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

  const restoreAdapter = () =>
    current.adapter as unknown as Parameters<
      typeof restoreI18nArchive
    >[0]["adapter"];

  /** A translated collection `hero` with one entry, `heading` in English and Spanish. */
  async function seedCollection(): Promise<string> {
    const created = await handler().createCollection({
      name: "hero",
      label: "Hero",
      localized: true,
      fields: TRANSLATED,
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entries = handler().getEntryService();
    const entry = await entries.createEntry(
      { collectionName: "hero", overrideAccess: true, locale: "en" },
      { heading: "Collection", views: 1 }
    );
    expect(entry.success, JSON.stringify(entry)).toBe(true);
    const id = String((entry.data as { id: unknown }).id);
    const es = await entries.updateEntry(
      {
        collectionName: "hero",
        entryId: id,
        overrideAccess: true,
        locale: "es",
      },
      { heading: "Colección" }
    );
    expect(es.success, JSON.stringify(es)).toBe(true);
    return id;
  }

  async function schemaVersionOf(
    registry: string,
    slug: string
  ): Promise<number> {
    const [row] = await query<{ version: number | string | null }>(
      `SELECT ${q("schema_version")} AS version FROM ${q(registry)} WHERE ${q("slug")} = '${slug}'`
    );
    return Number(row?.version ?? 1);
  }

  /**
   * A translated field group, also `hero`, with one row holding `heading` in English and Spanish.
   * Its rows belong to the entries that embed it, so the row is written as an embedding entry
   * would write it.
   */
  async function seedFieldGroup(): Promise<string> {
    await dispatchComponents(
      "createComponent",
      {},
      { slug: "hero", label: "Hero", localized: true, fields: TRANSLATED }
    );
    const id = "hero-1";
    await query(
      `INSERT INTO ${q("comp_hero")} (${["id", "_parent_id", "_parent_table", "_parent_field", "views"].map(q).join(", ")}) ` +
        `VALUES ('${id}', 'entry-1', 'dc_pages', 'hero', 7)`
    );
    await query(
      `INSERT INTO ${q("comp_hero_locales")} (${["_parent", "_locale", "heading"].map(q).join(", ")}) ` +
        `VALUES ('${id}', 'en', 'Group'), ('${id}', 'es', 'Grupo')`
    );
    return id;
  }

  /** Both entities make `heading` shared through the Builder, which archives its Spanish. */
  async function makeShared(): Promise<void> {
    const fields = SHARED;
    const collection = await handler().updateCollection(
      { collectionName: "hero" },
      { fields }
    );
    expect(collection.success, JSON.stringify(collection)).toBe(true);
    await dispatchComponents(
      "applyComponentSchemaChanges",
      { slug: "hero" },
      {
        fields,
        confirmed: true,
        localized: true,
        schemaVersion: await schemaVersionOf("dynamic_components", "hero"),
      }
    );
  }
  /**
   * The collection's `heading` translated again, so its archived values have somewhere to go. The
   * field group stays shared: the restore under test must not need it.
   */
  async function makeCollectionTranslated(): Promise<void> {
    const collection = await handler().updateCollection(
      { collectionName: "hero" },
      { fields: TRANSLATED }
    );
    expect(collection.success, JSON.stringify(collection)).toBe(true);
  }

  /** The archived rows, by kind, entry and value. */
  async function archived(): Promise<
    { kind: string; entry: string; value: string }[]
  > {
    return query<{ kind: string; entry: string; value: string }>(
      `SELECT ${q("entity_kind")} AS kind, ${q("entry_id")} AS entry, ${q("value")} AS value FROM ${q("nextly_i18n_archive")} ` +
        `WHERE ${q("collection")} = 'hero' ORDER BY ${q("entity_kind")}`
    );
  }

  async function spanishOf(table: string, id: string): Promise<unknown> {
    const [row] = await query<{ heading: string | null }>(
      `SELECT ${q("heading")} AS heading FROM ${q(`${table}_locales`)} WHERE ${q("_parent")} = '${id}' AND ${q("_locale")} = 'es'`
    );
    return row?.heading ?? null;
  }

  it("records which entity archived each row", async () => {
    const collectionId = await seedCollection();
    const groupId = await seedFieldGroup();

    await makeShared();

    expect(await archived()).toEqual([
      { kind: "collection", entry: collectionId, value: "Colección" },
      { kind: "fieldGroup", entry: groupId, value: "Grupo" },
    ]);
  });

  it("restores each entity's values only to that entity", async () => {
    const collectionId = await seedCollection();
    const groupId = await seedFieldGroup();
    await makeShared();
    await makeCollectionTranslated();

    const collection = await restoreI18nArchive({
      adapter: restoreAdapter(),
      collection: "hero",
      kind: "collection",
      companionTableName: "dc_hero_locales",
    });

    expect(collection.rowsRead).toBe(1);
    expect(await spanishOf("dc_hero", collectionId)).toBe("Colección");
    // The field group's row stays where it was: nothing of it reaches the collection's companion.
    const strays = await query<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM ${q("dc_hero_locales")} WHERE ${q("_parent")} = '${groupId}'`
    );
    expect(Number(strays[0]?.n)).toBe(0);

    // The field group's row is still archived, for its own restore.
    expect(await archived()).toContainEqual({
      kind: "fieldGroup",
      entry: groupId,
      value: "Grupo",
    });
  });

  it("removes only the deleted entity's archived values", async () => {
    await seedCollection();
    const groupId = await seedFieldGroup();
    await makeShared();

    const purged = await teardownEntityI18n({
      adapter: current.adapter as unknown as Parameters<
        typeof teardownEntityI18n
      >[0]["adapter"],
      tableName: "dc_hero",
      slug: "hero",
      kind: "collection",
    });

    expect(purged.archiveRowsPurged).toBe(1);
    expect(await archived()).toEqual([
      { kind: "fieldGroup", entry: groupId, value: "Grupo" },
    ]);
  });

  /** The archive as an install from before the kind existed has it, with one row in it. */
  async function archiveFromBeforeTheKind(entry: string): Promise<void> {
    await query(
      `ALTER TABLE ${q("nextly_i18n_archive")} DROP COLUMN ${q("entity_kind")}`
    );
    await query(
      `INSERT INTO ${q("nextly_i18n_archive")} (${["collection", "entry_id", "locale", "field", "value"].map(q).join(", ")}) ` +
        `VALUES ('hero', '${entry}', 'es', 'heading', 'Antes')`
    );
  }

  it("reads an older install's rows as collections once `nextly migrate` adds the kind", async () => {
    const collectionId = await seedCollection();
    await archiveFromBeforeTheKind(collectionId);

    // What `nextly migrate` runs first.
    await reconcileCore({
      db: (
        current.adapter as unknown as { getDrizzle(): unknown }
      ).getDrizzle(),
      dialect: current.adapter.dialect,
      logger: { info: () => {}, warn: () => {} },
    });

    expect(await archived()).toEqual([
      { kind: "collection", entry: collectionId, value: "Antes" },
    ]);
    const restored = await restoreI18nArchive({
      adapter: restoreAdapter(),
      collection: "hero",
      kind: "collection",
      companionTableName: "dc_hero_locales",
    });
    expect(restored.rowsRead).toBe(1);
    expect(await spanishOf("dc_hero", collectionId)).toBe("Antes");
  });

  it("adds the kind when a Builder save archives before any migration has run", async () => {
    const collectionId = await seedCollection();
    const groupId = await seedFieldGroup();
    await archiveFromBeforeTheKind(collectionId);

    await makeShared();

    expect(await archived()).toEqual([
      { kind: "collection", entry: collectionId, value: "Antes" },
      { kind: "collection", entry: collectionId, value: "Colección" },
      { kind: "fieldGroup", entry: groupId, value: "Grupo" },
    ]);
  });
});
