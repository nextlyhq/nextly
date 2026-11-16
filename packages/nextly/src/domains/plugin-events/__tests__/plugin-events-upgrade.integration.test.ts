/**
 * The durable plugin events' two tables through `nextly migrate`: created on
 * a fresh database, and added to an existing one that lacks them, on every
 * dialect, without the data-loss flag. One delivery per event and subscriber:
 * the database itself refuses a second, on the upgraded table as on a fresh
 * one, which is what holds two dispatchers to one delivery each.
 *
 * @module domains/plugin-events/__tests__/plugin-events-upgrade.integration.test
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

const EVENTS = "nextly_plugin_events";
const DELIVERIES = "nextly_plugin_event_deliveries";
const EVENT_COLUMNS = [
  "created_at",
  "fanned_out_at",
  "finished_at",
  "id",
  "name",
  "owner",
  "payload",
];
const DELIVERY_COLUMNS = [
  "attempt_count",
  "created_at",
  "event_id",
  "finished_at",
  "id",
  "last_error",
  "locked_by",
  "locked_until",
  "next_attempt_at",
  "status",
  "subscriber",
  "subscriber_key",
];

const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-plugin-events-");
afterAll(remove);

describe.each(availableDialects())(
  "the durable plugin events' tables through nextly migrate (%s)",
  dialect => {
    it("is created on a fresh database", async () => {
      await withFreshDatabase(dialect, "nextly_pe_fresh", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        expect((await fresh.columnsOf(EVENTS)).sort()).toEqual(EVENT_COLUMNS);
        expect((await fresh.columnsOf(DELIVERIES)).sort()).toEqual(
          DELIVERY_COLUMNS
        );
      });
    }, 180_000);

    it("is added to an existing database, one delivery per event and subscriber, and a second run changes nothing", async () => {
      await withFreshDatabase(dialect, "nextly_pe_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        await fresh.exec(`DROP TABLE ${DELIVERIES}`);
        await fresh.exec(`DROP TABLE ${EVENTS}`);
        expect(await fresh.columnsOf(EVENTS)).toEqual([]);
        expect(await fresh.columnsOf(DELIVERIES)).toEqual([]);

        // No data-loss flag: `migrateFresh` passes none, so adding the
        // tables is a change the core phase makes on its own.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);
        expect((await fresh.columnsOf(EVENTS)).sort()).toEqual(EVENT_COLUMNS);
        expect((await fresh.columnsOf(DELIVERIES)).sort()).toEqual(
          DELIVERY_COLUMNS
        );

        const at =
          fresh.dialect === "sqlite" ? "1767225600" : "'2026-01-01 00:00:00'";
        await fresh.exec(
          `INSERT INTO ${EVENTS} (id, owner, name, payload, created_at, ` +
            `fanned_out_at, finished_at) VALUES ('evt-1', '@acme/orders', ` +
            `'acme-orders.paid', '{}', ${at}, NULL, NULL)`
        );
        const delivery = (id: string, key: string) =>
          `INSERT INTO ${DELIVERIES} (id, event_id, subscriber, subscriber_key, ` +
          `status, attempt_count, next_attempt_at, locked_by, locked_until, ` +
          `last_error, created_at, finished_at) VALUES ('${id}', 'evt-1', ` +
          `'@acme/loyalty:points', '${key}', 'pending', 0, ${at}, NULL, NULL, ` +
          `NULL, ${at}, NULL)`;
        await fresh.exec(delivery("d-1", "a".repeat(64)));
        // The same event and subscriber again is refused by the database.
        await expect(
          fresh.exec(delivery("d-2", "a".repeat(64)))
        ).rejects.toThrow();
        // Another subscriber of the same event is a delivery of its own.
        await fresh.exec(delivery("d-3", "b".repeat(64)));

        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
