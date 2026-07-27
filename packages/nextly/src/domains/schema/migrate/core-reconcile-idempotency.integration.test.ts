/**
 * `reconcileCore` provisions the core schema by diffing the canonical
 * definition against live introspection, so running it a second time against
 * its own output must be a no-op.
 *
 * It was not, on MySQL. The second run reported a type change for all 23
 * boolean columns and a default change for every timestamp and boolean, then
 * refused the apply as destructive — so `nextly migrate` succeeded once and
 * then failed against the schema it had just written, advising a version
 * mismatch. The causes were dialect spellings of the same thing: MySQL has no
 * boolean type (`BOOL`/`BOOLEAN` are `TINYINT(1)`), reports `now()` where the
 * schema authored `CURRENT_TIMESTAMP`, and stores boolean defaults as 1/0.
 *
 * Asserted per dialect because that is where the difference lives; each leg
 * self-skips when its URL is unset, per the integration convention.
 */
import { describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import type { SupportedDialect } from "../../../types/database";
import { getSchemaEventsDdl } from "../events/schema-events-ddl";

import { reconcileCore } from "./core-reconcile";

type Leg = { dialect: SupportedDialect; url: string | undefined };

const LEGS: Leg[] = [
  { dialect: "postgresql", url: process.env.TEST_POSTGRES_URL },
  { dialect: "mysql", url: process.env.TEST_MYSQL_URL },
];

for (const { dialect, url } of LEGS) {
  describe.skipIf(!url)(`reconcileCore idempotency (${dialect})`, () => {
    it("reports no change on a second run", async () => {
      process.env.DB_DIALECT = dialect;
      const adapter = await createAdapter({
        type: dialect,
        url,
      } as Parameters<typeof createAdapter>[0]);

      const ensureLedger = async (): Promise<void> => {
        if (!(await adapter.tableExists("nextly_schema_events"))) {
          for (const stmt of getSchemaEventsDdl(dialect)) {
            await adapter.executeQuery(stmt);
          }
        }
      };
      const run = (): Promise<{ changed: boolean }> =>
        reconcileCore({
          db: adapter.getDrizzle(),
          dialect,
          logger: { info: () => {}, warn: () => {} },
          ensureLedger,
        });

      // First run provisions the schema.
      await run();

      // Second run sees its own output. Anything other than "unchanged" means
      // the differ disagrees with what the applier just wrote — and because
      // the core diff refuses destructive ops, that disagreement is fatal
      // rather than cosmetic.
      await expect(run()).resolves.toEqual({ changed: false });
    });
  });
}
