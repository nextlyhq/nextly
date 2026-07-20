/**
 * Affected-row count from `adapter.delete`, per dialect.
 *
 * The retention gate decides who runs a pass by whether its conditional delete
 * removed the marker, so a count that does not reflect reality removes the
 * gating entirely. mysql2 resolves a delete to `[ResultSetHeader, FieldPacket[]]`,
 * and reading that as a row list reports a constant 2 — every caller would then
 * see a successful claim. Version retention counts its pruned rows the same way,
 * so this is not specific to webhooks.
 *
 * SQLite is covered by the ordinary suite; this gate exists for the drivers whose
 * result shape differs and which the shared harness never exercises.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

type Dialect = "postgresql" | "mysql";

interface Leg {
  name: string;
  dialect: Dialect;
  url: string;
}

const LEGS: Leg[] = [
  {
    name: "postgres",
    dialect: "postgresql",
    url: process.env.TEST_POSTGRES_URL ?? "",
  },
  { name: "mysql", dialect: "mysql", url: process.env.TEST_MYSQL_URL ?? "" },
];

const KEYS = ["delcount.a", "delcount.b", "delcount.c"];

for (const leg of LEGS) {
  // Dialect gate: the whole suite is skipped when this dialect's URL is
  // unset, matching how the other dialect gates in this package self-skip.
  const describeLeg = describe.skipIf(!leg.url);

  describeLeg(`adapter.delete affected rows (${leg.name})`, () => {
    let handle: TestNextly | undefined;

    beforeAll(async () => {
      if (!leg.url) return;
      // env.ts validates DATABASE_URL against DB_DIALECT on first read and
      // caches it, so both must be set before the adapter is built.
      process.env.DB_DIALECT = leg.dialect;
      process.env.DATABASE_URL = leg.url;
      const adapter = await createAdapter({
        type: leg.dialect,
        url: leg.url,
      } as Parameters<typeof createAdapter>[0]);
      handle = await createTestNextly({ adapter });
    });

    afterAll(async () => {
      await handle?.destroy();
    });

    it("reports 0, 1 and 2 rather than a constant", async () => {
      const adapter = handle!.adapter;
      for (const key of KEYS) {
        await adapter.delete("nextly_meta", {
          and: [{ column: "key", op: "=", value: key }],
        });
      }

      const none = await adapter.delete("nextly_meta", {
        and: [{ column: "key", op: "=", value: "delcount.absent" }],
      });
      expect(none).toBe(0);

      await adapter.insert("nextly_meta", {
        key: KEYS[0],
        value: JSON.stringify("v"),
        updated_at: new Date(),
      });
      const one = await adapter.delete("nextly_meta", {
        and: [{ column: "key", op: "=", value: KEYS[0] }],
      });
      expect(one).toBe(1);

      for (const key of [KEYS[1], KEYS[2]]) {
        await adapter.insert("nextly_meta", {
          key,
          value: JSON.stringify("v"),
          updated_at: new Date(),
        });
      }
      const two = await adapter.delete("nextly_meta", {
        and: [{ column: "key", op: "IN", value: [KEYS[1], KEYS[2]] }],
      });
      expect(two).toBe(2);
    });
  });
}
