/**
 * The received-webhooks table through `nextly migrate`: created on a fresh
 * database, and added to an existing one that lacks it, on every dialect,
 * without the data-loss flag. A delivery is claimed once: the database itself
 * refuses a second row of the same key on the upgraded table, which is what
 * holds a plugin to processing a delivery once.
 *
 * @module plugins/security/__tests__/received-webhooks-upgrade.integration.test
 */
import { afterAll, describe, expect, it } from "vitest";

import {
  availableDialects,
  withFreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import {
  migrateFresh,
  noMigrationsDir,
} from "../../../__tests__/helpers/migrate-core";

const TABLE = "nextly_received_webhooks";
const COLUMNS = [
  "claim_token",
  "completed_at",
  "delivery_id",
  "delivery_key",
  "freshness",
  "lease_until",
  "owner",
  "provider",
  "prune_at",
  "received_at",
  "status",
];

const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-received-");
afterAll(remove);

describe.each(availableDialects())(
  "the received-webhooks table through nextly migrate (%s)",
  dialect => {
    it("is created on a fresh database", async () => {
      await withFreshDatabase(dialect, "nextly_rw_fresh", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        expect((await fresh.columnsOf(TABLE)).sort()).toEqual(COLUMNS);
      });
    }, 180_000);

    it("is added to an existing database, one record per delivery, and a second run changes nothing", async () => {
      await withFreshDatabase(dialect, "nextly_rw_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        await fresh.exec(`DROP TABLE ${TABLE}`);
        expect(await fresh.columnsOf(TABLE)).toEqual([]);

        // No data-loss flag: `migrateFresh` passes none, so adding the table
        // is a change the core phase makes on its own.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);
        expect((await fresh.columnsOf(TABLE)).sort()).toEqual(COLUMNS);

        const at =
          fresh.dialect === "sqlite" ? "1767225600" : "'2026-01-01 00:00:00'";
        const record = (key: string) =>
          `INSERT INTO ${TABLE} (delivery_key, owner, provider, delivery_id, ` +
          `freshness, status, claim_token, lease_until, received_at, ` +
          `completed_at, prune_at) VALUES ('${key}', '@acme/plugin', 'acme', ` +
          `'evt_1', 'checked', 'completed', 'token', NULL, ${at}, ${at}, ${at})`;
        const key = "a".repeat(64);
        await fresh.exec(record(key));
        // The same delivery again is refused by the database, on the upgraded
        // table as on a fresh one.
        await expect(fresh.exec(record(key))).rejects.toThrow();
        // Another delivery's key is its own row.
        await fresh.exec(record("b".repeat(64)));

        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
