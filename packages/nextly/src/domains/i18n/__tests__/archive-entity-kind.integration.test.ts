/**
 * The localization archive keeps each row's entity kind, so a collection, a Single and a field
 * group that share a slug never read or remove each other's archived values.
 *
 * Collections and Singles share one namespace of slugs, but a field group's registry is its own, so
 * a collection and a field group may both be `hero`. Each makes a translated field shared, which
 * archives its other languages under the slug `hero`. Restoring one must bring back only its own
 * values, and deleting one must leave the other's. An archive written before the kind existed
 * holds rows of all three kinds, so once `nextly migrate` (or a Builder save) has added the column
 * they are unknown, and each is labelled by the entity holding its slug, from that entity's
 * creation on. The rest stay unknown: kept, reported, and restored only when the kind is named.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
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

  /** The archive as an install from before the kind existed has it: no `entity_kind` column. */
  async function archiveWithoutTheKind(): Promise<void> {
    await query(
      `ALTER TABLE ${q("nextly_i18n_archive")} DROP COLUMN ${q("entity_kind")}`
    );
  }

  /** A long time ago, in each dialect's encoding of `archived_at`. */
  const LONG_AGO =
    dialect === "sqlite"
      ? "946684800"
      : dialect === "mysql"
        ? "'2000-01-01 00:00:00'"
        : "'2000-01-01 00:00:00+00'";

  /** Before `LONG_AGO`, in the registries' encoding of `created_at`. */
  const LONGER_AGO =
    dialect === "sqlite" ? "915148800" : "'1999-01-01 00:00:00'";

  /**
   * The entity as created long before its rows were archived. A row counts as an entity's own only
   * when archived well after its recorded creation, since that time can carry any zone offset.
   */
  async function createdLongAgo(
    registry: string,
    slug: string,
    at: string = LONGER_AGO
  ): Promise<void> {
    await query(
      `UPDATE ${q(registry)} SET ${q("created_at")} = ${at} WHERE ${q("slug")} = '${slug}'`
    );
  }

  /** After `LONG_AGO` and long before now, in the registries' encoding of `created_at`. */
  const BETWEEN = dialect === "sqlite" ? "978307200" : "'2001-01-01 00:00:00'";

  /** One row as an install from before the kind wrote it, archived now unless `archivedAt` says. */
  async function legacyRow(
    slug: string,
    entry: string,
    value: string,
    archivedAt?: string
  ): Promise<void> {
    const columns = ["collection", "entry_id", "locale", "field", "value"];
    const values = [
      `'${slug}'`,
      `'${entry}'`,
      "'es'",
      "'heading'",
      `'${value}'`,
    ];
    if (archivedAt !== undefined) {
      columns.push("archived_at");
      values.push(archivedAt);
    }
    await query(
      `INSERT INTO ${q("nextly_i18n_archive")} (${columns.map(q).join(", ")}) VALUES (${values.join(", ")})`
    );
  }

  /** What `nextly migrate` runs first, which adds the column to an older archive. */
  async function migrateCore(): Promise<void> {
    await reconcileCore({
      db: (
        current.adapter as unknown as { getDrizzle(): unknown }
      ).getDrizzle(),
      dialect: current.adapter.dialect,
      logger: { info: () => {}, warn: () => {} },
    });
  }

  /** Every archived row's slug, kind and value, ordered by value. */
  async function archivedBySlug(): Promise<
    { slug: string; kind: string; value: string }[]
  > {
    return query<{ slug: string; kind: string; value: string }>(
      `SELECT ${q("collection")} AS slug, ${q("entity_kind")} AS kind, ${q("value")} AS value FROM ${q("nextly_i18n_archive")} ` +
        `ORDER BY ${q("value")}`
    );
  }

  const restoreHero = (claimUnknown?: boolean) =>
    restoreI18nArchive({
      adapter: restoreAdapter(),
      collection: "hero",
      kind: "collection",
      companionTableName: "dc_hero_locales",
      claimUnknown,
    });

  it("leaves an older install's rows unknown when `nextly migrate` adds the kind", async () => {
    const collectionId = await seedCollection();
    await archiveWithoutTheKind();
    await legacyRow("hero", collectionId, "Antes");

    await migrateCore();

    // Collections, Singles and field groups all archived before the kind existed, so the column
    // alone cannot say whose a row is.
    expect(await archived()).toEqual([
      { kind: "unknown", entry: collectionId, value: "Antes" },
    ]);
  });

  it("labels each older row by the entity holding its slug, and restores it", async () => {
    const collectionId = await seedCollection();
    await dispatchComponents(
      "createComponent",
      {},
      { slug: "banner", label: "Banner", localized: true, fields: TRANSLATED }
    );
    await dispatchSingles(
      "createSingle",
      {},
      { slug: "notice", label: "Notice", localized: true, fields: TRANSLATED }
    );
    await createdLongAgo("dynamic_collections", "hero");
    await createdLongAgo("dynamic_components", "banner");
    await createdLongAgo("dynamic_singles", "notice");
    await archiveWithoutTheKind();
    await legacyRow("hero", collectionId, "Antes");
    await legacyRow("banner", "banner-1", "Bandera");
    await legacyRow("notice", "notice-1", "Aviso");
    await migrateCore();

    const restored = await restoreHero();

    expect(restored.rowsRead).toBe(1);
    expect(await spanishOf("dc_hero", collectionId)).toBe("Antes");
    expect(await archivedBySlug()).toEqual([
      { slug: "hero", kind: "collection", value: "Antes" },
      { slug: "notice", kind: "single", value: "Aviso" },
      { slug: "banner", kind: "fieldGroup", value: "Bandera" },
    ]);
  });

  it("keeps a row archived before its slug's entity existed unresolved, and reports it", async () => {
    // A slug can be reused: a row archived before today's `hero` was created belongs to whatever
    // held `hero` then, such as a collection since deleted.
    const collectionId = await seedCollection();
    await archiveWithoutTheKind();
    await legacyRow("hero", collectionId, "Antiguo", LONG_AGO);
    await migrateCore();

    const restored = await restoreHero();

    expect(restored.rowsRead).toBe(0);
    expect(restored.rowsUnattributed).toBe(1);
    expect(await spanishOf("dc_hero", collectionId)).toBe("Colección");
    expect(await archived()).toEqual([
      { kind: "unresolved", entry: collectionId, value: "Antiguo" },
    ]);
  });

  it("restores an unknown row when the restore names the kind, and records it as that kind's", async () => {
    const collectionId = await seedCollection();
    await archiveWithoutTheKind();
    await legacyRow("hero", collectionId, "Antiguo", LONG_AGO);
    await migrateCore();

    const restored = await restoreHero(true);

    expect(restored.rowsRead).toBe(1);
    expect(restored.rowsClaimed).toBe(1);
    expect(restored.rowsUnattributed).toBe(0);
    expect(await spanishOf("dc_hero", collectionId)).toBe("Antiguo");
    expect(await archived()).toEqual([
      { kind: "collection", entry: collectionId, value: "Antiguo" },
    ]);
  });

  it("keeps an unresolved row when the entity holding its slug is deleted", async () => {
    const collectionId = await seedCollection();
    // Created after the older row was archived, and long before the newer one.
    await createdLongAgo("dynamic_collections", "hero", BETWEEN);
    await archiveWithoutTheKind();
    await legacyRow("hero", collectionId, "Antiguo", LONG_AGO);
    await legacyRow("hero", collectionId, "Antes");
    await migrateCore();

    const purged = await teardownEntityI18n({
      adapter: current.adapter as unknown as Parameters<
        typeof teardownEntityI18n
      >[0]["adapter"],
      tableName: "dc_hero",
      slug: "hero",
      kind: "collection",
    });

    // The row archived since the collection existed is its own and goes with it; the older one
    // may be another entity's, so it stays.
    expect(purged.archiveRowsPurged).toBe(1);
    expect(await archived()).toEqual([
      { kind: "unresolved", entry: collectionId, value: "Antiguo" },
    ]);
  });

  it("keeps the rows of a slug two entities shared unresolved after one of them is deleted", async () => {
    // A collection and a field group both `hero`: their older rows cannot be told apart. Once the
    // collection is gone the field group looks like their only owner, and still is not.
    const collectionId = await seedCollection();
    await seedFieldGroup();
    await createdLongAgo("dynamic_collections", "hero");
    await createdLongAgo("dynamic_components", "hero");
    await archiveWithoutTheKind();
    await legacyRow("hero", collectionId, "Antes");
    await legacyRow("hero", "hero-1", "Grupo");
    await migrateCore();

    await teardownEntityI18n({
      adapter: current.adapter as unknown as Parameters<
        typeof teardownEntityI18n
      >[0]["adapter"],
      tableName: "dc_hero",
      slug: "hero",
      kind: "collection",
    });
    await query(
      `DELETE FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'hero'`
    );
    const restored = await restoreI18nArchive({
      adapter: restoreAdapter(),
      collection: "hero",
      kind: "fieldGroup",
      companionTableName: "comp_hero_locales",
    });

    expect(restored.rowsRead).toBe(0);
    expect(restored.rowsUnattributed).toBe(2);
    expect((await archived()).map(r => r.kind)).toEqual([
      "unresolved",
      "unresolved",
    ]);
  });

  it("archives a collection's languages when localization is turned off on an older archive", async () => {
    const collectionId = await seedCollection();
    await archiveWithoutTheKind();

    const saved = await handler().updateCollection(
      { collectionName: "hero" },
      { localized: false, fields: SHARED }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(true);
    expect(await archived()).toEqual([
      { kind: "collection", entry: collectionId, value: "Colección" },
    ]);
  });

  it("adds the kind when a Builder save archives before any migration has run", async () => {
    const collectionId = await seedCollection();
    const groupId = await seedFieldGroup();
    await archiveWithoutTheKind();
    await legacyRow("hero", collectionId, "Antes");

    await makeShared();

    expect(await archived()).toEqual([
      { kind: "collection", entry: collectionId, value: "Colección" },
      { kind: "fieldGroup", entry: groupId, value: "Grupo" },
      { kind: "unknown", entry: collectionId, value: "Antes" },
    ]);
  });
});
