/**
 * An initialized database that still holds stored access rules is named at
 * boot, and one that does not stays quiet.
 *
 * Runs the real check — live introspection and the real count queries — then
 * reaches it the way a boot does, through `ensureFirstRunSetup`'s
 * already-initialized branch. The quiet cases are asserted alongside the loud
 * one, because a check that warns unconditionally passes the loud case alone.
 *
 * On every dialect with a database in this run, because the count helpers and
 * the introspection each have a branch per dialect — the drivers return
 * different shapes — and a wrong branch here does not fail loudly: the
 * diagnostic is bounded, so a thrown count becomes a debug line and the
 * warning simply never appears. That is the one outcome this warning exists
 * to prevent, so each dialect's branch is driven for real.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  availableDialects,
  buildCurrentCoreSchema,
  type FreshDatabase,
  withFreshDatabase,
} from "../../__tests__/helpers/fresh-database";
import { ensureFirstRunSetup } from "../first-run";

const REGISTRY_TABLES = ["dynamic_collections", "dynamic_singles"] as const;

async function addRetiredColumn(fresh: FreshDatabase): Promise<void> {
  for (const table of REGISTRY_TABLES) {
    await fresh.exec(`ALTER TABLE ${table} ADD COLUMN access_rules text`);
  }
}

/** The drizzle surface the inserts below need, whichever dialect built it. */
interface Inserter {
  insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
}

// The registry rows an installation from before the removal would hold,
// written through the dialect's own table objects so each dialect's JSON and
// timestamp encoding is the real one. The retired column is not on those
// objects any more, so its value is set with a plain UPDATE afterwards. Ids
// are real UUIDs: Postgres types the singles id as one and refuses anything
// else.
async function insertCollection(
  fresh: FreshDatabase,
  slug: string,
  accessRules: string | null
): Promise<void> {
  const id = randomUUID();
  await (fresh.db as Inserter).insert(fresh.tables.dynamicCollections).values({
    id,
    slug,
    labels: { singular: slug, plural: slug },
    tableName: `dc_${slug}`,
    fields: [],
    schemaHash: "h",
  });
  await setAccessRules(fresh, "dynamic_collections", id, accessRules);
}

async function insertSingle(
  fresh: FreshDatabase,
  slug: string,
  accessRules: string | null
): Promise<void> {
  const id = randomUUID();
  await (fresh.db as Inserter).insert(fresh.tables.dynamicSingles).values({
    id,
    slug,
    label: slug,
    tableName: `single_${slug}`,
    fields: [],
    schemaHash: "h",
  });
  await setAccessRules(fresh, "dynamic_singles", id, accessRules);
}

async function setAccessRules(
  fresh: FreshDatabase,
  table: string,
  id: string,
  accessRules: string | null
): Promise<void> {
  if (accessRules === null) return;
  await fresh.exec(
    `UPDATE ${table} SET access_rules = '${accessRules}' WHERE id = '${id}'`
  );
}

async function boot(fresh: FreshDatabase) {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const result = await ensureFirstRunSetup({
    adapter: {
      dialect: fresh.dialect,
      getDrizzle: () => fresh.db,
      // The probe table exists on this database, so this is the initialized
      // path — the only one the warning runs on.
      tableExists: async () => true,
      executeQuery: async () => undefined,
    },
    logger,
  });
  expect(result).toEqual({ ranSetup: false, reason: "already_initialized" });
  return logger;
}

function accessRulesWarnings(logger: { warn: ReturnType<typeof vi.fn> }) {
  return logger.warn.mock.calls
    .map(([message]) => String(message))
    .filter(message => message.includes("stored access rules"));
}

describe.each(availableDialects())(
  "boot on a database that still holds stored access rules (%s)",
  dialect => {
    const fresh = (body: (fresh: FreshDatabase) => Promise<void>) =>
      withFreshDatabase(dialect, "nextly_access_rules_boot", async db => {
        await buildCurrentCoreSchema(db);
        await body(db);
      });

    it("names each table and how many rows carry a rule", async () => {
      await fresh(async db => {
        await addRetiredColumn(db);
        await insertCollection(db, "posts", '{"read":{"type":"public"}}');
        await insertCollection(db, "pages", '{"read":{"type":"owner"}}');
        await insertCollection(db, "tags", null);
        await insertSingle(db, "settings", '{"update":{"type":"owner"}}');

        const logger = await boot(db);

        const [warning, ...rest] = accessRulesWarnings(logger);
        expect(rest).toEqual([]);
        expect(warning).toContain("dynamic_collections: 2 rows carry");
        expect(warning).toContain("dynamic_singles: 1 row carries");
        expect(warning).toContain("nextly migrate");
        // Neither bound tripped: the warning came from the check completing.
        expect(logger.debug).not.toHaveBeenCalledWith(
          expect.stringContaining("stored access rules")
        );
      });
    }, 120_000);

    it("names only the table whose rows still carry a rule", async () => {
      await fresh(async db => {
        await addRetiredColumn(db);
        await insertCollection(db, "posts", null);
        await insertSingle(db, "settings", '{"read":{"type":"public"}}');

        const logger = await boot(db);

        const [warning] = accessRulesWarnings(logger);
        expect(warning).toContain("dynamic_singles: 1 row carries");
        expect(warning).not.toContain("dynamic_collections");
      });
    }, 120_000);

    it("stays quiet when the column is present but every rule is empty", async () => {
      await fresh(async db => {
        await addRetiredColumn(db);
        await insertCollection(db, "posts", null);
        await insertSingle(db, "settings", null);

        const logger = await boot(db);

        expect(accessRulesWarnings(logger)).toEqual([]);
        // Quiet because the check ran and found nothing, not because it
        // failed on the way.
        expect(logger.debug).not.toHaveBeenCalledWith(
          expect.stringContaining("Could not check for stored access rules")
        );
      });
    }, 120_000);

    it("stays quiet on a database that never had the column", async () => {
      await fresh(async db => {
        // Rows exist, so a check that counts without first looking for the
        // column would either warn or throw here; both are asserted against.
        await insertCollection(db, "posts", null);

        const logger = await boot(db);

        expect(accessRulesWarnings(logger)).toEqual([]);
        expect(logger.debug).not.toHaveBeenCalledWith(
          expect.stringContaining("Could not check for stored access rules")
        );
      });
    }, 120_000);
  }
);
