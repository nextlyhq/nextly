/**
 * A collection something depends on is not deleted, on any path that deletes
 * one, and the refusal comes before anything is removed.
 *
 * Three kinds of dependent, each on every path: a field of another
 * collection, a Single or a field group pointing at the collection at any
 * depth; a foreign key a plugin declares on its own table, pointing at the
 * collection's table; and a hidden column and index a plugin added to the
 * collection's table. Each refusal names what depends on the collection, and
 * after it the table, its rows, its field-group values, its translations, its
 * registry row and the plugin's key, column, values and index are all still
 * there.
 *
 * Every dialect, because the registries store a field list as jsonb, as JSON
 * and as text, and because what a drop does to another owner's key differs
 * between them: a reader that parses one and not the others refuses nothing
 * on that database.
 *
 * @module domains/collections/__tests__/deleting-a-collection-something-depends-on.integration.test
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, expect, it } from "vitest";

import { DELETE as deleteCollectionRoute } from "../../../api/collections-schema-detail";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { runPrune } from "../../../cli/commands/prune";
import { defineCollection, relationship, text } from "../../../config";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { NextlyError } from "../../../errors/nextly-error";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { resolveFieldGroupRegistryName } from "../../field-groups/storage/resolve-storage-names";
import { getActiveExtensionSchema } from "../../schema/extension/active-schema";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import type { CollectionRegistryService } from "../services/collection-registry-service";

import {
  CARDS,
  LINKS_PLUGIN,
  LINKS_TABLE,
  MARKER_COLUMN,
  MARKER_PLUGIN,
  META,
  POSTS,
  SETTINGS,
  TAGS,
  TAGS_TABLE,
  cards,
  columnValues,
  linksPlugin,
  liveForeignKeys,
  liveIndexes,
  markerPlugin,
  metaGroup,
  plainTags,
  posts,
  settings,
  tags,
} from "./helpers/collection-dependents-fixtures";

let current: TestNextly | undefined;

afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
});

const registryOf = (t: TestNextly) =>
  t.getService("collectionRegistryService") as CollectionRegistryService;

const handlerOf = (t: TestNextly) =>
  t.getService("collectionsHandler") as CollectionsHandler;

/** A code-first collection's row as the Builder leaves one, so the Builder's delete reaches past the lock. */
async function unlock(t: TestNextly, slug: string): Promise<void> {
  await t.adapter.update(
    "dynamic_collections",
    { locked: 0 },
    { and: [{ column: "slug", op: "=", value: slug }] }
  );
}

/** What a call rejected with, so the assertion reads the refusal itself. */
async function refusalOf(attempt: Promise<unknown>): Promise<NextlyError> {
  const outcome = await attempt.then(
    () => undefined,
    (error: unknown) => error
  );
  if (!NextlyError.is(outcome)) {
    throw new Error(`expected a NextlyError, got ${String(outcome)}`);
  }
  return outcome;
}

/** The Builder's delete of several collections at once, through the dispatcher. */
function builderBulkDelete(slugs: readonly string[]): Promise<unknown> {
  return dispatchCollections(
    {} as ServiceContainer,
    "deleteCollection",
    { collectionName: slugs[0], together: slugs.slice(1).join(",") },
    undefined
  );
}

/** A super-admin's session cookie: the first user created is the super-admin. */
async function superAdminSession(
  t: TestNextly
): Promise<Record<string, string>> {
  const direct = t.nextly as unknown as {
    users: {
      create(a: {
        email: string;
        password: string;
        data: Record<string, unknown>;
      }): Promise<{ item: { id: string } }>;
    };
  };
  const seeder = t.getService("permissionSeedService") as unknown as {
    seedSystemPermissions: () => Promise<unknown>;
  };
  await seeder.seedSystemPermissions();
  const userId = (
    await direct.users.create({
      email: "owner@example.com",
      password: "Password123!",
      data: { name: "Owner", isActive: true },
    })
  ).item.id;
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: "owner@example.com",
      name: "Owner",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return { cookie: `nextly_session=${token}` };
}

/** The schema route's delete, answered as the Builder's admin would be. */
async function schemaRouteDelete(
  t: TestNextly,
  slug: string
): Promise<{ status: number; message: string | undefined }> {
  const response = await deleteCollectionRoute(
    new Request(`http://localhost/api/collections/schema/${slug}`, {
      method: "DELETE",
      headers: await superAdminSession(t),
    }),
    { params: Promise.resolve({ slug }) }
  );
  const body =
    response.status === 204
      ? undefined
      : ((await response.json()) as { error?: { message?: string } });
  return { status: response.status, message: body?.error?.message };
}

/** Row counts that say TAGS is untouched: its rows, translations, field-group values. */
async function tagsState(t: TestNextly, translated: boolean) {
  const q = (name: string) =>
    t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const count = async (sql: string) =>
    Number(
      (await t.adapter.executeQuery<{ n: unknown }>(sql))[0]?.n ?? Number.NaN
    );
  return {
    table: await t.adapter.tableExists(TAGS_TABLE),
    rows: await count(`SELECT COUNT(*) AS n FROM ${q(TAGS_TABLE)}`),
    registry: (await registryOf(t).getCollectionBySlug(TAGS)) !== null,
    ...(translated
      ? {
          translations: await count(
            `SELECT COUNT(*) AS n FROM ${q(`${TAGS_TABLE}_locales`)}`
          ),
          fieldGroupValues: await count(
            `SELECT COUNT(*) AS n FROM ${q(resolveComponentTableName(META))} WHERE ${q("_parent_table")} = '${TAGS_TABLE}'`
          ),
        }
      : {}),
  };
}

const INTACT = { table: true, rows: 1, registry: true };
const INTACT_TRANSLATED = {
  ...INTACT,
  translations: 1,
  fieldGroupValues: 1,
};

const FIELDS_MESSAGE = `"${TAGS}" cannot be deleted while other schema depends on it. Fields that point at it: ${POSTS}.sections.meta.tag, the Single ${SETTINGS}.featured, the field group ${CARDS}.topic. Remove those fields, or point them at another collection, then delete "${TAGS}".`;

/** Boot with TAGS and every kind of field that points at it, and one stored TAGS entry. */
async function bootWithFieldsPointing(dialect: TestDialect, translated = true) {
  current = await createTestNextly({
    dialect,
    collections: [translated ? tags : plainTags, posts],
    singles: [settings],
    fieldGroups: translated ? [metaGroup, cards] : [cards],
    ...(translated
      ? { localization: { locales: ["en", "de"], defaultLocale: "en" } }
      : {}),
  });
  await current.nextly.create({
    collection: TAGS,
    data: translated
      ? { label: "kept", meta: { note: "n" } }
      : { label: "kept" },
  });
  await unlock(current, TAGS);
  return current;
}

/** Boot with TAGS and a plugin whose own table has a key to TAGS's table. */
async function bootWithDeclaredKey(dialect: TestDialect, contributed = false) {
  current = await createTestNextly({
    dialect,
    collections: contributed ? [] : [plainTags],
    plugins: contributed
      ? [
          linksPlugin,
          definePlugin({
            name: "@t/dep-tags-owner",
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: { collections: [plainTags] },
          }),
        ]
      : [linksPlugin],
  });
  await current.nextly.create({ collection: TAGS, data: { label: "kept" } });
  await unlock(current, TAGS);
  return current;
}

/** Boot with TAGS and a plugin's hidden column and index on its table, holding a value. */
async function bootWithHiddenColumn(dialect: TestDialect, contributed = false) {
  current = await createTestNextly({
    dialect,
    collections: contributed ? [] : [plainTags],
    plugins: contributed
      ? [
          markerPlugin,
          definePlugin({
            name: "@t/dep-tags-owner",
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: { collections: [plainTags] },
          }),
        ]
      : [markerPlugin],
  });
  await current.nextly.create({ collection: TAGS, data: { label: "kept" } });
  await current.adapter.update(
    TAGS_TABLE,
    { [MARKER_COLUMN]: "the plugin's value" },
    {}
  );
  await unlock(current, TAGS);
  return current;
}

/** The live key the plugin declared, in the catalog's own spelling. */
async function declaredKeyName(t: TestNextly, dialect: TestDialect) {
  const keys = await liveForeignKeys(t.adapter, dialect, LINKS_TABLE);
  expect(keys).toHaveLength(1);
  return keys[0];
}

/** What the plugin's key, column and index look like, to compare after a refusal. */
async function pluginState(t: TestNextly, dialect: TestDialect) {
  return {
    keys: await liveForeignKeys(t.adapter, dialect, LINKS_TABLE),
  };
}

async function markerState(t: TestNextly) {
  return {
    values: await columnValues(t.adapter, TAGS_TABLE, MARKER_COLUMN),
    indexes: (await liveIndexes(t.adapter, TAGS_TABLE)).filter(name =>
      name.includes(MARKER_COLUMN)
    ),
  };
}

/** The message names the plugin, the key and its table; SQLite keeps no key names. */
function expectNamesTheKey(message: string, key: string, dialect: TestDialect) {
  expect(message).toContain(`"${TAGS}"`);
  expect(message).toContain(`on "${LINKS_TABLE}" (plugin "${LINKS_PLUGIN}")`);
  if (dialect !== "sqlite") {
    expect(message).toContain(`"${key.split("->")[0]}"`);
  }
}

function expectNamesTheMarker(message: string, indexes: readonly string[]) {
  expect(message).toContain(
    `the column "${MARKER_COLUMN}" on "${TAGS_TABLE}" (plugin "${MARKER_PLUGIN}")`
  );
  expect(indexes).toHaveLength(1);
  expect(message).toContain(
    `the index "${indexes[0]}" on "${TAGS_TABLE}" (plugin "${MARKER_PLUGIN}")`
  );
}

describeEachDialect("deleting a collection something depends on", dialect => {
  // -------------------------------------------------------------------------
  // The Builder's delete
  // -------------------------------------------------------------------------

  it("refuses the Builder's delete while fields point at it, naming each, and removes nothing", async () => {
    const t = await bootWithFieldsPointing(dialect);
    const before = await tagsState(t, true);
    expect(before).toEqual(INTACT_TRANSLATED);

    const result = await handlerOf(t).deleteCollection({
      collectionName: TAGS,
    });

    expect(result).toMatchObject({
      success: false,
      statusCode: 409,
      message: FIELDS_MESSAGE,
    });
    expect(await tagsState(t, true)).toEqual(INTACT_TRANSLATED);
  }, 120_000);

  it("refuses the Builder's delete while a plugin's declared key points at its table, and keeps the key", async () => {
    const t = await bootWithDeclaredKey(dialect);
    const key = await declaredKeyName(t, dialect);

    const result = await handlerOf(t).deleteCollection({
      collectionName: TAGS,
    });

    expect(result).toMatchObject({ success: false, statusCode: 409 });
    expectNamesTheKey(String(result.message), key, dialect);
    expect(await pluginState(t, dialect)).toEqual({ keys: [key] });
    expect(await tagsState(t, false)).toEqual(INTACT);
  }, 120_000);

  it("refuses the Builder's delete while a plugin's hidden column and index are on its table, and keeps them", async () => {
    const t = await bootWithHiddenColumn(dialect);
    const before = await markerState(t);
    expect(before.values).toEqual(["the plugin's value"]);

    const result = await handlerOf(t).deleteCollection({
      collectionName: TAGS,
    });

    expect(result).toMatchObject({ success: false, statusCode: 409 });
    expectNamesTheMarker(String(result.message), before.indexes);
    expect(await markerState(t)).toEqual(before);
    expect(await tagsState(t, false)).toEqual(INTACT);
  }, 120_000);

  it("deletes a collection whose only reference is to itself", async () => {
    // The control for the field refusals: what they refuse over is a field
    // outside the collection, not a reference as such.
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: TAGS,
          fields: [
            text({ name: "label" }),
            relationship({ name: "parent", relationTo: TAGS }),
          ],
        }),
      ],
    });
    await unlock(current, TAGS);

    const result = await handlerOf(current).deleteCollection({
      collectionName: TAGS,
    });

    // Outside development the drop is written as a migration rather than run,
    // so the registry row is what the delete removes here.
    expect(result).toMatchObject({ success: true });
    expect(await registryOf(current).getCollectionBySlug(TAGS)).toBeNull();
  }, 120_000);

  it("deletes, in one Builder bulk delete, a collection and the only one that points at it", async () => {
    current = await createTestNextly({
      dialect,
      collections: [
        plainTags,
        defineCollection({
          slug: POSTS,
          fields: [relationship({ name: "tag", relationTo: TAGS })],
        }),
      ],
    });
    await unlock(current, TAGS);
    await unlock(current, POSTS);

    await builderBulkDelete([TAGS, POSTS]);

    expect(await registryOf(current).getCollectionBySlug(TAGS)).toBeNull();
    expect(await registryOf(current).getCollectionBySlug(POSTS)).toBeNull();
  }, 120_000);

  it("refuses a Builder bulk delete whole while something outside it points at one of them", async () => {
    const t = await bootWithFieldsPointing(dialect, false);
    await unlock(t, POSTS);

    // POSTS goes too, so only the Single's and the field group's fields count.
    const refusal = await refusalOf(builderBulkDelete([TAGS, POSTS]));

    expect(refusal.statusCode).toBe(409);
    expect(refusal.publicMessage).toBe(
      `Nothing was deleted, because other schema depends on "${TAGS}". "${TAGS}": Fields that point at it: the Single ${SETTINGS}.featured, the field group ${CARDS}.topic. Remove those fields, or point them at another collection, then try again.`
    );
    expect(await tagsState(t, false)).toEqual(INTACT);
    expect(await t.adapter.tableExists(`dc_${POSTS}`)).toBe(true);
    expect(await registryOf(t).getCollectionBySlug(POSTS)).not.toBeNull();
  }, 120_000);

  // -------------------------------------------------------------------------
  // The schema route
  // -------------------------------------------------------------------------

  it("refuses the schema route's delete while fields point at it", async () => {
    const t = await bootWithFieldsPointing(dialect);

    const response = await schemaRouteDelete(t, TAGS);

    expect(response).toEqual({ status: 409, message: FIELDS_MESSAGE });
    expect(await tagsState(t, true)).toEqual(INTACT_TRANSLATED);
  }, 120_000);

  it("refuses the schema route's delete while a plugin's declared key points at its table", async () => {
    const t = await bootWithDeclaredKey(dialect);
    const key = await declaredKeyName(t, dialect);

    const response = await schemaRouteDelete(t, TAGS);

    expect(response.status).toBe(409);
    expectNamesTheKey(String(response.message), key, dialect);
    expect(await pluginState(t, dialect)).toEqual({ keys: [key] });
    expect(await tagsState(t, false)).toEqual(INTACT);
  }, 120_000);

  it("refuses the schema route's delete while a plugin's hidden column and index are on its table", async () => {
    const t = await bootWithHiddenColumn(dialect);
    const before = await markerState(t);

    const response = await schemaRouteDelete(t, TAGS);

    expect(response.status).toBe(409);
    expectNamesTheMarker(String(response.message), before.indexes);
    expect(await markerState(t)).toEqual(before);
    expect(await tagsState(t, false)).toEqual(INTACT);
  }, 120_000);

  it("still lets the schema route delete a collection nothing depends on", async () => {
    current = await createTestNextly({ dialect, collections: [plainTags] });
    await unlock(current, TAGS);

    const response = await schemaRouteDelete(current, TAGS);

    expect(response.status).toBe(204);
    expect(await registryOf(current).getCollectionBySlug(TAGS)).toBeNull();
  }, 120_000);

  // -------------------------------------------------------------------------
  // nextly prune
  // -------------------------------------------------------------------------

  const prune = (t: TestNextly, currentSlugs: string[]) =>
    runPrune({
      registry: registryOf(t),
      adapter: t.adapter,
      currentSlugs,
      force: true,
      extensionSchema: () => Promise.resolve(getActiveExtensionSchema(dialect)),
    });

  it("refuses a prune whose orphan a remaining field points at, before dropping anything", async () => {
    current = await createTestNextly({
      dialect,
      plugins: [
        definePlugin({
          name: "@t/dep-tags-owner",
          version: "1.0.0",
          nextly: ">=0.0.0",
          contributes: { collections: [plainTags] },
        }),
      ],
      collections: [posts],
    });
    await current.nextly.create({ collection: TAGS, data: { label: "kept" } });

    const refusal = await refusalOf(prune(current, [POSTS]));

    expect(refusal.publicMessage).toBe(
      `"${TAGS}" cannot be deleted while other schema depends on it. Fields that point at it: ${POSTS}.sections.meta.tag. Remove those fields, or point them at another collection, then delete "${TAGS}".`
    );
    expect(await tagsState(current, false)).toEqual(INTACT);
  }, 120_000);

  it("refuses a prune whose orphan a plugin's declared key points at", async () => {
    const t = await bootWithDeclaredKey(dialect, true);
    const key = await declaredKeyName(t, dialect);

    const refusal = await refusalOf(prune(t, []));

    expect(refusal.statusCode).toBe(409);
    expectNamesTheKey(refusal.publicMessage, key, dialect);
    expect(await pluginState(t, dialect)).toEqual({ keys: [key] });
    expect(await tagsState(t, false)).toEqual(INTACT);
  }, 120_000);

  it("refuses a prune whose orphan holds a plugin's hidden column and index", async () => {
    const t = await bootWithHiddenColumn(dialect, true);
    const before = await markerState(t);

    const refusal = await refusalOf(prune(t, []));

    expect(refusal.statusCode).toBe(409);
    expectNamesTheMarker(refusal.publicMessage, before.indexes);
    expect(await markerState(t)).toEqual(before);
    expect(await tagsState(t, false)).toEqual(INTACT);
  }, 120_000);

  it("prunes orphans that point only at each other, dropping every one", async () => {
    // Each points at the other, so whichever is dropped first still has a
    // field pointing at it until the second goes: only a check that knows
    // they go together lets the prune finish.
    current = await createTestNextly({
      dialect,
      plugins: [
        definePlugin({
          name: "@t/dep-together",
          version: "1.0.0",
          nextly: ">=0.0.0",
          contributes: {
            collections: [
              defineCollection({
                slug: TAGS,
                fields: [relationship({ name: "featured", relationTo: POSTS })],
              }),
              defineCollection({
                slug: POSTS,
                fields: [relationship({ name: "tag", relationTo: TAGS })],
              }),
            ],
          },
        }),
      ],
    });

    const result = await prune(current, []);

    expect([...result.dropped].sort()).toEqual([POSTS, TAGS]);
    expect(await current.adapter.tableExists(TAGS_TABLE)).toBe(false);
    expect(await registryOf(current).getCollectionBySlug(TAGS)).toBeNull();
  }, 120_000);

  // -------------------------------------------------------------------------
  // What cannot be read is not taken for nothing
  // -------------------------------------------------------------------------

  it("refuses the Builder's delete when the field-group registry cannot be read", async () => {
    current = await createTestNextly({
      dialect,
      collections: [plainTags],
      fieldGroups: [cards],
    });
    await current.nextly.create({ collection: TAGS, data: { label: "kept" } });
    await unlock(current, TAGS);
    // A stored field list that is a JSON string, not a list: what a damaged
    // row reads as on every dialect.
    const registry = await resolveFieldGroupRegistryName(current.adapter);
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    await current.adapter.executeQuery(
      `UPDATE ${q(registry)} SET ${q("fields")} = '"damaged"' WHERE ${q("slug")} = '${CARDS}'`
    );

    const result = await handlerOf(current).deleteCollection({
      collectionName: TAGS,
    });

    expect(result).toMatchObject({
      success: false,
      statusCode: 503,
      message: `"${TAGS}" was not deleted, because the fields of collections, Singles and field groups could not be read, so whether anything depends on it is unknown. Nothing was removed. Fix the cause in the server log and try again.`,
    });
    expect(await tagsState(current, false)).toEqual(INTACT);
  }, 120_000);

  it("refuses the Builder's delete when the record of other owners' elements cannot be read", async () => {
    current = await createTestNextly({ dialect, collections: [plainTags] });
    await current.nextly.create({ collection: TAGS, data: { label: "kept" } });
    await unlock(current, TAGS);
    // The table is there, so the record is not merely absent, but it holds
    // none of the columns an owner row is read from.
    await current.adapter.executeQuery(`DROP TABLE nextly_schema_owners`);
    await current.adapter.executeQuery(
      `CREATE TABLE nextly_schema_owners (unrelated integer)`
    );

    const result = await handlerOf(current).deleteCollection({
      collectionName: TAGS,
    });

    expect(result).toMatchObject({
      success: false,
      statusCode: 503,
      message: `"${TAGS}" was not deleted, because the record of columns, indexes, foreign keys and checks other owners added to its tables could not be read, so whether anything depends on it is unknown. Nothing was removed. Fix the cause in the server log and try again.`,
    });
    expect(await tagsState(current, false)).toEqual(INTACT);
  }, 120_000);

  it("refuses a prune when the declared foreign keys cannot be read", async () => {
    current = await createTestNextly({
      dialect,
      plugins: [
        definePlugin({
          name: "@t/dep-tags-owner",
          version: "1.0.0",
          nextly: ">=0.0.0",
          contributes: { collections: [plainTags] },
        }),
      ],
    });
    await current.nextly.create({ collection: TAGS, data: { label: "kept" } });

    const refusal = await refusalOf(
      runPrune({
        registry: registryOf(current),
        adapter: current.adapter,
        currentSlugs: [],
        force: true,
        extensionSchema: () =>
          Promise.reject(new Error("a plugin's schema hook threw")),
      })
    );

    expect(refusal.statusCode).toBe(503);
    expect(refusal.publicMessage).toBe(
      `"${TAGS}" was not deleted, because the foreign keys plugins and the app declare and the record of columns, indexes, foreign keys and checks other owners added to its tables could not be read, so whether anything depends on it is unknown. Nothing was removed. Fix the cause in the server log and try again.`
    );
    expect(await tagsState(current, false)).toEqual(INTACT);
  }, 120_000);
});
