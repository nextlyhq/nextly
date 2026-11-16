/**
 * A core upgrade drops a retired column when the consent covers it, refuses
 * naming it when it does not, and brings every core table up to date, with
 * the real push on every dialect in this run (#383, #387).
 *
 * The starting points are built from the canonical definitions, then moved
 * back by hand to what an older release left: `access_rules` on both registry
 * tables (alpha.65), and for #387 also without the registry columns added
 * since (an alpha.42 database), which makes one table need a drop and adds.
 */
import { describe, expect, it } from "vitest";

import {
  availableDialects,
  buildCurrentCoreSchema,
  withFreshDatabase,
  type FreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import { getDialectTablesForPush } from "../../../database/index";
import { getCoreSchema } from "../../../schemas/core-schema";
import { freshPushSchema } from "../pipeline/fresh-push";

import { reconcileCore } from "./core-reconcile";
import { resolveDataLossConsent } from "./data-loss-consent";

const REGISTRY_TABLES = ["dynamic_collections", "dynamic_singles"] as const;
/** Registry columns added after alpha.42, which such a database lacks. */
const ADDED_SINCE = ["webhooks", "revalidate"] as const;
const CONSENT = REGISTRY_TABLES.map(table => `${table}.access_rules`).join(",");

async function addAccessRules(fresh: FreshDatabase): Promise<void> {
  for (const table of REGISTRY_TABLES) {
    await fresh.exec(`ALTER TABLE ${table} ADD COLUMN access_rules text`);
  }
}

async function dropAddedSince(fresh: FreshDatabase): Promise<void> {
  for (const table of REGISTRY_TABLES) {
    for (const column of ADDED_SINCE) {
      if ((await fresh.columnsOf(table)).includes(column)) {
        await fresh.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      }
    }
  }
}

/** Every core table's columns, sorted, as the live database has them. */
async function coreColumns(
  fresh: FreshDatabase
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const table of getCoreSchema(fresh.dialect).tables) {
    out[table.name] = [...(await fresh.columnsOf(table.name))].sort();
  }
  return out;
}

/** What a fresh install's core tables have on this dialect. */
async function freshInstallColumns(
  dialect: FreshDatabase["dialect"]
): Promise<Record<string, string[]>> {
  let columns: Record<string, string[]> = {};
  await withFreshDatabase(dialect, "nextly_core_fresh_ref", async fresh => {
    await buildCurrentCoreSchema(fresh);
    columns = await coreColumns(fresh);
  });
  return columns;
}

describe.each(availableDialects())(
  "a core upgrade with retired columns (%s)",
  dialect => {
    it("drops access_rules under consent, and a second run without consent passes (#383)", async () => {
      await withFreshDatabase(
        dialect,
        "nextly_core_retired_383",
        async fresh => {
          await buildCurrentCoreSchema(fresh);
          await addAccessRules(fresh);

          await reconcileCore({
            db: fresh.db,
            dialect,
            consent: resolveDataLossConsent({ flag: CONSENT }),
          });

          for (const table of REGISTRY_TABLES) {
            expect(await fresh.columnsOf(table)).not.toContain("access_rules");
          }
          // Nothing left to delete, so no consent is needed.
          await expect(
            reconcileCore({ db: fresh.db, dialect })
          ).resolves.toBeDefined();
        }
      );
    });

    it("refuses without consent, naming both columns and the consent, and changes nothing", async () => {
      await withFreshDatabase(
        dialect,
        "nextly_core_retired_refuse",
        async fresh => {
          await buildCurrentCoreSchema(fresh);
          await addAccessRules(fresh);
          await dropAddedSince(fresh);
          const before = await coreColumns(fresh);

          const refusal = reconcileCore({
            db: fresh.db,
            dialect,
            consent: resolveDataLossConsent({}),
          });

          await expect(refusal).rejects.toThrow(
            /dynamic_collections\.access_rules/
          );
          await expect(refusal).rejects.toThrow(
            /dynamic_singles\.access_rules/
          );
          await expect(refusal).rejects.toThrow(/--accept-data-loss/);
          expect(await coreColumns(fresh)).toEqual(before);
        }
      );
    });

    it("upgrades a database that needs a drop and adds on one table (#387)", async () => {
      await withFreshDatabase(
        dialect,
        "nextly_core_retired_387",
        async fresh => {
          await buildCurrentCoreSchema(fresh);
          await addAccessRules(fresh);
          await dropAddedSince(fresh);

          await reconcileCore({
            db: fresh.db,
            dialect,
            consent: resolveDataLossConsent({ flag: CONSENT }),
          });

          expect(await coreColumns(fresh)).toEqual(
            await freshInstallColumns(dialect)
          );
        }
      );
    });

    it("keeps access_rules, with the rest applied, where nobody consents and the run may keep it", async () => {
      // The development boot's reconcile: destructive changes allowed, no
      // consent. It never drops; it applies everything else.
      await withFreshDatabase(
        dialect,
        "nextly_core_retired_keep",
        async fresh => {
          await buildCurrentCoreSchema(fresh);
          await addAccessRules(fresh);
          await dropAddedSince(fresh);

          await reconcileCore({
            db: fresh.db,
            dialect,
            allowDestructive: true,
          });

          for (const table of REGISTRY_TABLES) {
            const columns = await fresh.columnsOf(table);
            expect(columns).toContain("access_rules");
            for (const column of ADDED_SINCE) expect(columns).toContain(column);
          }
        }
      );
    });

    it("refuses a push it cannot plan before changing anything, on every dialect", async () => {
      // The raw push of #387's database, with access_rules dropped from the
      // target as before this change: the shape drizzle-kit cannot plan.
      await withFreshDatabase(
        dialect,
        "nextly_core_unplannable",
        async fresh => {
          await buildCurrentCoreSchema(fresh);
          await addAccessRules(fresh);
          await dropAddedSince(fresh);
          const before = await coreColumns(fresh);

          await expect(
            freshPushSchema(
              dialect,
              fresh.db,
              getDialectTablesForPush(dialect, {}),
              {
                refuseUnplannable: true,
              }
            )
          ).rejects.toMatchObject({ name: "UnplannablePushError" });
          expect(await coreColumns(fresh)).toEqual(before);
        }
      );
    });
  }
);
