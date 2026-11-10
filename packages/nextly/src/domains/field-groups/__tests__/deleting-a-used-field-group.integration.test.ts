/**
 * A field group something uses is not deleted, on any way a field group is
 * deleted, and the refusal comes before anything is removed.
 *
 * Three ways in, all reaching the registry's delete: the Builder's dispatcher,
 * the schema route and the Direct API. Three kinds of dependent on each: a
 * field of a collection, a Single or another field group that places it, at
 * any depth; a foreign key a plugin declares on its own table, pointing at the
 * field group's table; and a hidden column and index a plugin added to that
 * table. Each refusal names what depends on the field group, and after it the
 * table, its rows for every host, its translations, its registry row and the
 * plugin's key, column, values and index are all still there.
 *
 * When a registry, the declared keys or the record of other owners' elements
 * cannot be read, the delete is refused as unreadable, never taken for one
 * nothing depends on.
 *
 * Every dialect, because the registries store a field list as jsonb, as JSON
 * and as text, and because what a drop does to another owner's key differs
 * between them.
 *
 * @module domains/field-groups/__tests__/deleting-a-used-field-group.integration.test
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, expect, it, vi } from "vitest";

import { DELETE as deleteFieldGroupRoute } from "../../../api/field-groups-detail";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, fieldGroup, text } from "../../../config";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { NextlyError } from "../../../errors/nextly-error";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import {
  columnValues,
  liveForeignKeys,
  liveIndexes,
  superAdminSession,
} from "../../collections/__tests__/helpers/collection-dependents-fixtures";
import { resolveFieldGroupRegistryName } from "../storage/resolve-storage-names";

import {
  ARTICLES,
  ARTICLES_TABLE,
  HOME,
  HOME_TABLE,
  LANGUAGES,
  LINKS_PLUGIN,
  LINKS_TABLE,
  MARKER_COLUMN,
  MARKER_PLUGIN,
  PLACED_MESSAGE,
  SEO,
  SEO_TABLE,
  articles,
  cardGroup,
  home,
  linksPluginTo,
  markerPluginOn,
  plainSeoGroup,
  seoGroup,
} from "./helpers/used-field-group-fixtures";

// The extension schema a booted process publishes, made unreadable by the
// one test that needs it to be: every other test reads the real one.
const extensionSchema = vi.hoisted(() => ({ unreadable: false }));
vi.mock("../../schema/extension/active-schema", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../../schema/extension/active-schema")
    >();
  return {
    ...actual,
    getActiveExtensionSchema: (
      ...args: Parameters<typeof actual.getActiveExtensionSchema>
    ) => {
      if (extensionSchema.unreadable) {
        throw new Error("a plugin's schema hook threw");
      }
      return actual.getActiveExtensionSchema(...args);
    },
  };
});

let current: TestNextly | undefined;

afterEach(async () => {
  extensionSchema.unreadable = false;
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
});

/** The three ways a field group is deleted. */
type Way = "builder" | "route" | "direct";
const WAYS: readonly Way[] = ["builder", "route", "direct"];

/** A delete's outcome, as each way answers it: a status, and the refusal's words. */
interface Outcome {
  status: number;
  message: string | undefined;
}

async function outcomeOf(attempt: Promise<unknown>): Promise<Outcome> {
  try {
    await attempt;
    return { status: 200, message: undefined };
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    return { status: error.statusCode, message: error.publicMessage };
  }
}

/** Delete `slug` the way `way` does, as its caller would. */
async function deleteVia(
  way: Way,
  t: TestNextly,
  slug: string
): Promise<Outcome> {
  if (way === "builder") {
    return outcomeOf(
      dispatchComponents("deleteComponent", { slug }, undefined)
    );
  }
  if (way === "direct") {
    return outcomeOf(t.nextly.fieldGroups.delete({ slug }));
  }
  const response = await deleteFieldGroupRoute(
    new Request(`http://localhost/api/field-groups/${slug}`, {
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

const q = (t: TestNextly, name: string) =>
  t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** A code-first field group's row as the Builder leaves one, so its delete reaches past the lock. */
async function unlock(t: TestNextly, slug: string): Promise<void> {
  const registry = await resolveFieldGroupRegistryName(t.adapter);
  await t.adapter.update(
    registry,
    { locked: false },
    { and: [{ column: "slug", op: "=", value: slug }] }
  );
}

/** What says SEO is untouched: its table, its rows per host, its translations, its registry row. */
async function seoState(t: TestNextly, translated: boolean) {
  const count = async (sql: string) =>
    Number((await t.adapter.executeQuery<{ n: unknown }>(sql))[0]?.n ?? NaN);
  const registry = await resolveFieldGroupRegistryName(t.adapter);
  const rowsFor = (host: string) =>
    count(
      `SELECT COUNT(*) AS n FROM ${q(t, SEO_TABLE)} WHERE ${q(t, "_parent_table")} = '${host}'`
    );
  return {
    table: await t.adapter.tableExists(SEO_TABLE),
    registry: await count(
      `SELECT COUNT(*) AS n FROM ${q(t, registry)} WHERE ${q(t, "slug")} = '${SEO}'`
    ),
    ...(translated
      ? {
          articleRows: await rowsFor(ARTICLES_TABLE),
          homeRows: await rowsFor(HOME_TABLE),
          translations: await count(
            `SELECT COUNT(*) AS n FROM ${q(t, `${SEO_TABLE}_locales`)}`
          ),
        }
      : {}),
  };
}

/**
 * Boot with SEO placed by a collection (twice, once inside a group), a Single
 * and another field group, holding values for the collection and the Single
 * in two languages.
 */
async function bootPlaced(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [articles],
    singles: [home],
    fieldGroups: [seoGroup, cardGroup],
    localization: LANGUAGES,
  });
  const article = await current.nextly.create({
    collection: ARTICLES,
    locale: "en",
    data: { title: "Hello", seo: { heading: "Hello", tone: "warm" } },
  });
  await current.nextly.update({
    collection: ARTICLES,
    id: (article.item as { id: string }).id,
    locale: "de",
    data: { seo: { heading: "Hallo", tone: "warm" }, _overwrite: true },
  });
  const singles = current.getService(
    "singleEntryService"
  ) as SingleEntryService;
  const saved = await singles.update(
    HOME,
    { title: "Home", seo: { heading: "Home", tone: "calm" }, _overwrite: true },
    { overrideAccess: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
  await unlock(current, SEO);
  return current;
}

/** The counts `bootPlaced` leaves, to compare after a refusal. */
async function placedState(t: TestNextly) {
  const state = await seoState(t, true);
  // Something to keep, so a refusal that removed it would show.
  expect(state).toMatchObject({ table: true, registry: 1 });
  expect(state.articleRows).toBeGreaterThan(0);
  expect(state.homeRows).toBeGreaterThan(0);
  expect(state.translations).toBeGreaterThan(0);
  return state;
}

/** A collection that places SEO and nothing else, to give its table rows. */
const HOST = "dep_seo_host";
const host = defineCollection({
  slug: HOST,
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "seo", component: SEO }),
  ],
});

describeEachDialect("deleting a field group something uses", dialect => {
  for (const way of WAYS) {
    it(`refuses the ${way} delete while a collection, a Single and a field group place it, and removes nothing`, async () => {
      const t = await bootPlaced(dialect);
      const before = await placedState(t);

      const outcome = await deleteVia(way, t, SEO);

      expect(outcome).toEqual({ status: 409, message: PLACED_MESSAGE });
      expect(await seoState(t, true)).toEqual(before);
    }, 120_000);

    it(`refuses the ${way} delete while a plugin's declared key points at its table, and keeps the key`, async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [plainSeoGroup],
        plugins: [linksPluginTo(SEO_TABLE)],
      });
      await unlock(current, SEO);
      const keys = await liveForeignKeys(current.adapter, dialect, LINKS_TABLE);
      expect(keys).toHaveLength(1);

      const outcome = await deleteVia(way, current, SEO);

      expect(outcome.status).toBe(409);
      expect(outcome.message).toContain(
        `"${SEO}" cannot be deleted while other schema depends on it. Foreign keys that point at its tables: `
      );
      expect(outcome.message).toContain(
        `on "${LINKS_TABLE}" (plugin "${LINKS_PLUGIN}")`
      );
      // SQLite keeps no constraint names.
      if (dialect !== "sqlite") {
        expect(outcome.message).toContain(`"${keys[0].split("->")[0]}"`);
      }
      expect(
        await liveForeignKeys(current.adapter, dialect, LINKS_TABLE)
      ).toEqual(keys);
      expect(await seoState(current, false)).toEqual({
        table: true,
        registry: 1,
      });
    }, 120_000);

    it(`refuses the ${way} delete while a plugin's hidden column and index are on its table, and keeps them`, async () => {
      current = await createTestNextly({
        dialect,
        collections: [host],
        fieldGroups: [plainSeoGroup],
        plugins: [markerPluginOn(SEO_TABLE)],
      });
      await current.nextly.create({
        collection: HOST,
        data: { title: "Hosted", seo: { heading: "kept" } },
      });
      await current.adapter.update(
        SEO_TABLE,
        { [MARKER_COLUMN]: "the plugin's value" },
        {}
      );
      await unlock(current, SEO);
      const indexes = (await liveIndexes(current.adapter, SEO_TABLE)).filter(
        name => name.includes(MARKER_COLUMN)
      );
      expect(indexes).toHaveLength(1);

      const outcome = await deleteVia(way, current, SEO);

      expect(outcome.status).toBe(409);
      expect(outcome.message).toContain(
        `the column "${MARKER_COLUMN}" on "${SEO_TABLE}" (plugin "${MARKER_PLUGIN}")`
      );
      expect(outcome.message).toContain(
        `the index "${indexes[0]}" on "${SEO_TABLE}" (plugin "${MARKER_PLUGIN}")`
      );
      expect(
        await columnValues(current.adapter, SEO_TABLE, MARKER_COLUMN)
      ).toEqual(["the plugin's value"]);
      expect(
        (await liveIndexes(current.adapter, SEO_TABLE)).filter(name =>
          name.includes(MARKER_COLUMN)
        )
      ).toEqual(indexes);
      expect(await seoState(current, false)).toEqual({
        table: true,
        registry: 1,
      });
    }, 120_000);
  }

  it("refuses the delete while a group with no name holds a field placing it, naming the field where it is stored", async () => {
    // A group with no name only lays fields out: the field placing SEO is
    // stored at the level the group sits in, as `meta.seo`. The code-first
    // config refuses a field with no name, so the Builder creates the shape.
    const LAID_OUT = "dep_seo_laid_out";
    current = await createTestNextly({
      dialect,
      fieldGroups: [plainSeoGroup],
    });
    await unlock(current, SEO);
    await dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      {
        name: LAID_OUT,
        label: "Laid out",
        fields: [
          { name: "title", type: "text" },
          {
            name: "meta",
            type: "group",
            fields: [
              {
                type: "group",
                label: "Layout",
                fields: [{ name: "seo", type: "component", component: SEO }],
              },
            ],
          },
        ],
      }
    );

    const outcome = await deleteVia("builder", current, SEO);

    expect(outcome).toEqual({
      status: 409,
      message: `"${SEO}" cannot be deleted while other schema depends on it. Fields that place it: ${LAID_OUT}.meta.seo. Remove those fields, or have them place another field group, then delete "${SEO}".`,
    });
    expect(await seoState(current, false)).toEqual({
      table: true,
      registry: 1,
    });
  }, 120_000);

  it("still deletes a field group nothing uses", async () => {
    current = await createTestNextly({
      dialect,
      fieldGroups: [plainSeoGroup],
    });
    await unlock(current, SEO);

    const outcome = await deleteVia("builder", current, SEO);

    expect(outcome.status).toBe(200);
    expect(await seoState(current, false)).toEqual({
      table: false,
      registry: 0,
    });
  }, 120_000);

  // -------------------------------------------------------------------------
  // What cannot be read is refused, never counted as nothing
  // -------------------------------------------------------------------------

  const UNREADABLE = (what: string) =>
    `"${SEO}" was not deleted, because ${what} could not be read, so whether anything depends on it is unknown. Nothing was removed. Fix the cause in the server log and try again.`;
  const FIELDS_UNREADABLE = UNREADABLE(
    "the fields of collections, Singles and field groups"
  );

  /** Damage one registry row's stored field list, as a damaged row reads on every dialect. */
  async function damage(t: TestNextly, registry: string, slug: string) {
    await t.adapter.executeQuery(
      `UPDATE ${q(t, registry)} SET ${q(t, "fields")} = '"damaged"' WHERE ${q(t, "slug")} = '${slug}'`
    );
  }

  for (const [registryName, slug] of [
    ["dynamic_collections", ARTICLES],
    ["dynamic_singles", HOME],
    ["field groups", "dep_card"],
  ] as const) {
    it(`refuses when the ${registryName} registry cannot be read, and removes nothing`, async () => {
      const t = await bootPlaced(dialect);
      const before = await placedState(t);
      const registry =
        registryName === "field groups"
          ? await resolveFieldGroupRegistryName(t.adapter)
          : registryName;
      // Read the row back before damaging it, to repair it for the counts.
      const [{ fields: stored }] = await t.adapter.executeQuery<{
        fields: unknown;
      }>(
        `SELECT ${q(t, "fields")} AS ${q(t, "fields")} FROM ${q(t, registry)} WHERE ${q(t, "slug")} = '${slug}'`
      );
      await damage(t, registry, slug);

      const outcome = await deleteVia("builder", t, SEO);

      expect(outcome).toEqual({ status: 503, message: FIELDS_UNREADABLE });
      const text = typeof stored === "string" ? stored : JSON.stringify(stored);
      await t.adapter.executeQuery(
        `UPDATE ${q(t, registry)} SET ${q(t, "fields")} = '${text.replaceAll("'", "''")}' WHERE ${q(t, "slug")} = '${slug}'`
      );
      expect(await seoState(t, true)).toEqual(before);
    }, 120_000);
  }

  it("refuses when the declared foreign keys cannot be read, and removes nothing", async () => {
    current = await createTestNextly({
      dialect,
      fieldGroups: [plainSeoGroup],
    });
    await unlock(current, SEO);
    extensionSchema.unreadable = true;

    const outcome = await deleteVia("builder", current, SEO);

    extensionSchema.unreadable = false;
    expect(outcome).toEqual({
      status: 503,
      message: UNREADABLE(
        "the foreign keys plugins and the app declare and the record of columns, indexes, foreign keys and checks other owners added to its tables"
      ),
    });
    expect(await seoState(current, false)).toEqual({
      table: true,
      registry: 1,
    });
  }, 120_000);

  it("refuses when the record of other owners' elements cannot be read, and removes nothing", async () => {
    current = await createTestNextly({
      dialect,
      fieldGroups: [plainSeoGroup],
    });
    await unlock(current, SEO);
    // The table is there, so the record is not merely absent, but it holds
    // none of the columns an owner row is read from.
    await current.adapter.executeQuery(`DROP TABLE nextly_schema_owners`);
    await current.adapter.executeQuery(
      `CREATE TABLE nextly_schema_owners (unrelated integer)`
    );

    const outcome = await deleteVia("builder", current, SEO);

    expect(outcome).toEqual({
      status: 503,
      message: UNREADABLE(
        "the record of columns, indexes, foreign keys and checks other owners added to its tables"
      ),
    });
    expect(await seoState(current, false)).toEqual({
      table: true,
      registry: 1,
    });
  }, 120_000);
});
