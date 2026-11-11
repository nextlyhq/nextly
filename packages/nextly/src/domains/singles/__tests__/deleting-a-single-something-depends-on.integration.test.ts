/**
 * A Single another owner depends on is not deleted, on either way a Single is
 * deleted, and the refusal comes before anything is removed.
 *
 * Two ways in: the Builder's dispatcher, which drops the Single's storage and
 * then its registry row, and the schema route, which removes the row. Two
 * kinds of dependent on each: a foreign key a plugin declares on its own
 * table, pointing at the Single's table, and a hidden column and index a
 * plugin added to that table. No field points at a Single, so none is asked
 * about. Each refusal names the key or the element with its owner and table,
 * and after it the Single's table, its row, its registry row and the
 * plugin's key, column, values and index are all still there.
 *
 * When the declared keys or the record of other owners' elements cannot be
 * read, the delete is refused as unreadable, never taken for one nothing
 * depends on.
 *
 * @module domains/singles/__tests__/deleting-a-single-something-depends-on.integration.test
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, expect, it, vi } from "vitest";

import { DELETE as deleteSingleRoute } from "../../../api/singles-schema-detail";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../../errors/nextly-error";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  columnValues,
  liveForeignKeys,
  liveIndexes,
  superAdminSession,
} from "../../collections/__tests__/helpers/collection-dependents-fixtures";
import {
  HOME,
  HOME_TABLE,
  LINKS_PLUGIN,
  LINKS_TABLE,
  MARKER_COLUMN,
  MARKER_PLUGIN,
  linksPluginTo,
  markerPluginOn,
  plainHome,
} from "../../field-groups/__tests__/helpers/used-field-group-fixtures";
import type { SingleEntryService } from "../services/single-entry-service";

// The extension schema a booted process publishes, made unreadable by the
// one test that needs it to be: every other test reads the real one.
const extensionSchema = vi.hoisted(() => ({
  unreadable: false,
  // Read as if the configuration declared nothing: a key a plugin stopped
  // declaring, still in the database until its migration removes it.
  undeclared: false,
}));
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
      if (extensionSchema.undeclared) return null;
      return actual.getActiveExtensionSchema(...args);
    },
  };
});

// The database's own record of the keys pointing into a table, made
// unreadable by the one test that needs it to be.
const liveCatalog = vi.hoisted(() => ({ unreadable: false }));
vi.mock("../../schema/pipeline/live-table-facts", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../../schema/pipeline/live-table-facts")
    >();
  return {
    ...actual,
    readReferencingTables: (
      ...args: Parameters<typeof actual.readReferencingTables>
    ) => {
      if (liveCatalog.unreadable) {
        return Promise.reject(new Error("the catalog could not be read"));
      }
      return actual.readReferencingTables(...args);
    },
  };
});

let current: TestNextly | undefined;

afterEach(async () => {
  extensionSchema.unreadable = false;
  extensionSchema.undeclared = false;
  liveCatalog.unreadable = false;
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
});

/** The two ways a Single is deleted. */
type Way = "builder" | "route";
const WAYS: readonly Way[] = ["builder", "route"];

interface Outcome {
  status: number;
  message: string | undefined;
}

/** Delete `slug` the way `way` does, as its caller would. */
async function deleteVia(
  way: Way,
  t: TestNextly,
  slug: string
): Promise<Outcome> {
  if (way === "builder") {
    try {
      await dispatchSingles("deleteSingle", { slug }, {});
      return { status: 200, message: undefined };
    } catch (error) {
      if (!NextlyError.is(error)) throw error;
      return { status: error.statusCode, message: error.publicMessage };
    }
  }
  const response = await deleteSingleRoute(
    new Request(`http://localhost/api/singles/schema/${slug}`, {
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

/** Boot with HOME and `plugin`, HOME holding one stored document, its row unlocked as the Builder leaves one. */
async function boot(
  dialect: TestDialect,
  plugin?: ReturnType<typeof linksPluginTo>
): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [plainHome],
    plugins: plugin === undefined ? [] : [plugin],
  });
  const singles = current.getService(
    "singleEntryService"
  ) as SingleEntryService;
  const saved = await singles.update(
    HOME,
    { title: "Home", _overwrite: true },
    { overrideAccess: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
  await current.adapter.update(
    "dynamic_singles",
    { locked: false },
    { and: [{ column: "slug", op: "=", value: HOME }] }
  );
  return current;
}

/** What says HOME is untouched: its table, its document and its registry row. */
async function homeState(t: TestNextly) {
  const count = async (sql: string) =>
    Number((await t.adapter.executeQuery<{ n: unknown }>(sql))[0]?.n ?? NaN);
  return {
    table: await t.adapter.tableExists(HOME_TABLE),
    rows: (await t.adapter.tableExists(HOME_TABLE))
      ? await count(`SELECT COUNT(*) AS n FROM ${q(t, HOME_TABLE)}`)
      : 0,
    registry: await count(
      `SELECT COUNT(*) AS n FROM ${q(t, "dynamic_singles")} WHERE ${q(t, "slug")} = '${HOME}'`
    ),
  };
}

const INTACT = { table: true, rows: 1, registry: 1 };

describeEachDialect("deleting a Single something depends on", dialect => {
  for (const way of WAYS) {
    it(`refuses the ${way} delete while a plugin's declared key points at its table, and keeps the key`, async () => {
      const t = await boot(dialect, linksPluginTo(HOME_TABLE));
      const keys = await liveForeignKeys(t.adapter, dialect, LINKS_TABLE);
      expect(keys).toHaveLength(1);
      expect(await homeState(t)).toEqual(INTACT);

      const outcome = await deleteVia(way, t, HOME);

      expect(outcome.status).toBe(409);
      expect(outcome.message).toContain(
        `"${HOME}" cannot be deleted while other schema depends on it. Foreign keys that point at its tables: `
      );
      expect(outcome.message).toContain(
        `on "${LINKS_TABLE}" (plugin "${LINKS_PLUGIN}")`
      );
      // SQLite keeps no constraint names.
      if (dialect !== "sqlite") {
        expect(outcome.message).toContain(`"${keys[0].split("->")[0]}"`);
      }
      expect(await liveForeignKeys(t.adapter, dialect, LINKS_TABLE)).toEqual(
        keys
      );
      expect(await homeState(t)).toEqual(INTACT);
    }, 120_000);

    it(`refuses the ${way} delete while a plugin's hidden column and index are on its table, and keeps them`, async () => {
      const t = await boot(dialect, markerPluginOn(HOME_TABLE));
      await t.adapter.update(
        HOME_TABLE,
        { [MARKER_COLUMN]: "the plugin's value" },
        {}
      );
      const indexes = (await liveIndexes(t.adapter, HOME_TABLE)).filter(name =>
        name.includes(MARKER_COLUMN)
      );
      expect(indexes).toHaveLength(1);

      const outcome = await deleteVia(way, t, HOME);

      expect(outcome).toEqual({
        status: 409,
        message: `"${HOME}" cannot be deleted while other schema depends on it. What other owners added to its tables: the column "${MARKER_COLUMN}" on "${HOME_TABLE}" (plugin "${MARKER_PLUGIN}"), the index "${indexes[0]}" on "${HOME_TABLE}" (plugin "${MARKER_PLUGIN}"). Have each owner named remove its foreign keys, columns, indexes and checks (a plugin's go when the plugin stops declaring them or is uninstalled), then delete "${HOME}".`,
      });
      expect(await columnValues(t.adapter, HOME_TABLE, MARKER_COLUMN)).toEqual([
        "the plugin's value",
      ]);
      expect(
        (await liveIndexes(t.adapter, HOME_TABLE)).filter(name =>
          name.includes(MARKER_COLUMN)
        )
      ).toEqual(indexes);
      expect(await homeState(t)).toEqual(INTACT);
    }, 120_000);
  }

  for (const way of WAYS) {
    it(`refuses the ${way} delete while a key no configuration declares any more points at its table, and keeps the key`, async () => {
      const t = await boot(dialect, linksPluginTo(HOME_TABLE));
      const keys = await liveForeignKeys(t.adapter, dialect, LINKS_TABLE);
      expect(keys).toHaveLength(1);
      // The plugin stopped declaring the key; its migration has not removed it.
      extensionSchema.undeclared = true;

      const outcome = await deleteVia(way, t, HOME);

      extensionSchema.undeclared = false;
      expect(outcome.status).toBe(409);
      expect(outcome.message).toContain(
        `"${HOME}" cannot be deleted while other schema depends on it. Foreign keys that point at its tables: `
      );
      expect(outcome.message).toContain(`a key on "${LINKS_TABLE}"`);
      expect(await liveForeignKeys(t.adapter, dialect, LINKS_TABLE)).toEqual(
        keys
      );
      expect(await homeState(t)).toEqual(INTACT);
    }, 120_000);
  }

  // -------------------------------------------------------------------------
  // What cannot be read is refused, never counted as nothing
  // -------------------------------------------------------------------------

  const UNREADABLE = (what: string) =>
    `"${HOME}" was not deleted, because ${what} could not be read, so whether anything depends on it is unknown. Nothing was removed. Fix the cause in the server log and try again.`;

  for (const way of WAYS) {
    it(`refuses the ${way} delete when the declared foreign keys cannot be read, and removes nothing`, async () => {
      const t = await boot(dialect);
      extensionSchema.unreadable = true;

      const outcome = await deleteVia(way, t, HOME);

      extensionSchema.unreadable = false;
      expect(outcome).toEqual({
        status: 503,
        message: UNREADABLE(
          "the foreign keys plugins and the app declare and the record of columns, indexes, foreign keys and checks other owners added to its tables"
        ),
      });
      expect(await homeState(t)).toEqual(INTACT);
    }, 120_000);
  }

  for (const way of WAYS) {
    it(`refuses the ${way} delete when the Single's own stored fields are not a list, and removes nothing`, async () => {
      const t = await boot(dialect);
      // A damaged row: JSON, but not a list, so its junction tables, and what
      // could depend on them, cannot be named.
      const row = `${q(t, "dynamic_singles")} WHERE ${q(t, "slug")} = '${HOME}'`;
      const [{ fields: stored }] = await t.adapter.executeQuery<{
        fields: unknown;
      }>(`SELECT ${q(t, "fields")} AS ${q(t, "fields")} FROM ${row}`);
      await t.adapter.executeQuery(
        `UPDATE ${q(t, "dynamic_singles")} SET ${q(t, "fields")} = '{}' WHERE ${q(t, "slug")} = '${HOME}'`
      );

      const outcome = await deleteVia(way, t, HOME);

      expect(outcome).toEqual({
        status: 503,
        message: UNREADABLE(
          "the fields of collections, Singles and field groups"
        ),
      });
      // Repaired, so the counts read the Single as it was: nothing removed.
      const text = typeof stored === "string" ? stored : JSON.stringify(stored);
      await t.adapter.executeQuery(
        `UPDATE ${q(t, "dynamic_singles")} SET ${q(t, "fields")} = '${text.replaceAll("'", "''")}' WHERE ${q(t, "slug")} = '${HOME}'`
      );
      expect(await homeState(t)).toEqual(INTACT);
    }, 120_000);
  }

  it("refuses the Builder's delete when the keys the database holds into its tables cannot be read, and removes nothing", async () => {
    const t = await boot(dialect);
    liveCatalog.unreadable = true;

    const outcome = await deleteVia("builder", t, HOME);

    liveCatalog.unreadable = false;
    expect(outcome).toEqual({
      status: 503,
      message: UNREADABLE(
        "the foreign keys the database holds into its tables"
      ),
    });
    expect(await homeState(t)).toEqual(INTACT);
  }, 120_000);

  it("refuses the Builder's delete when the record of other owners' elements cannot be read, and removes nothing", async () => {
    const t = await boot(dialect);
    // The table is there, so the record is not merely absent, but it holds
    // none of the columns an owner row is read from.
    await t.adapter.executeQuery(`DROP TABLE nextly_schema_owners`);
    await t.adapter.executeQuery(
      `CREATE TABLE nextly_schema_owners (unrelated integer)`
    );

    const outcome = await deleteVia("builder", t, HOME);

    expect(outcome).toEqual({
      status: 503,
      message: UNREADABLE(
        "the record of columns, indexes, foreign keys and checks other owners added to its tables"
      ),
    });
    expect(await homeState(t)).toEqual(INTACT);
  }, 120_000);
});
