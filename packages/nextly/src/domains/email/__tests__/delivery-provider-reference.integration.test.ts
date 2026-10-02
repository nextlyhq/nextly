/**
 * A deleted provider must not leave a delivery pointing at a row that is gone.
 *
 * The delivery log outlives the credentials it describes: `provider_type` beside
 * the id keeps every row meaningful without the join, so the right behaviour is
 * to NULL the reference rather than to remove the evidence or to refuse the
 * delete.
 *
 * Run per dialect because the constraint that does the nulling is declared once
 * per schema module, and only the database can be asked whether it is really
 * there. A green run on one dialect says nothing about another.
 *
 * MySQL is deliberately ABSENT from the table below. It does not declare the
 * constraint yet, and it cannot until the schema pipeline nulls pre-existing
 * dangling references first — MySQL refuses to add a foreign key while any row
 * violates it, so applying it alone would fail against exactly the databases
 * that need repairing. Asserting MySQL's current behaviour here would record
 * the gap as intended behaviour, which is the opposite of what a test is for.
 *
 * Tables are created from the PRODUCTION definitions through drizzle-kit rather
 * than from DDL written here, so the fixture cannot drift from the schema it is
 * meant to be testing.
 *
 * They are built fresh each run, in a database of this suite's own. A shared
 * test database keeps whatever shape it was first created with — so a table
 * created before this constraint existed is indistinguishable from one whose
 * schema never declared it, and reusing it would report the age of the
 * database instead of the correctness of the schema. That is not hypothetical:
 * the MySQL leg failed on exactly that, against a table created hours earlier.
 *
 * Nor are the shared ones rebuilt in place. These are fixed-name system tables
 * that every suite in the run shares, and dropping them leaves whatever shape
 * this suite built for the suites after it — a drop that once passed locally
 * four times and was refused in CI, where another table depended on them.
 * Postgres gets a database created for the run and dropped after it; SQLite's
 * is in memory, which is already its own.
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createScratchDatabase,
  describeSharedTables,
  type ScratchDatabase,
} from "../../../__tests__/helpers/fresh-database";
import { getDrizzleKitForDialect } from "../../../database/drizzle-kit-lazy";
import { emailDeliveriesPg } from "../../../schemas/email-deliveries/postgres";
import { emailDeliveriesSqlite } from "../../../schemas/email-deliveries/sqlite";
import { emailProvidersPg } from "../../../schemas/email-providers/postgres";
import { emailProvidersSqlite } from "../../../schemas/email-providers/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** The fixed-name system tables these suites build, which every suite in a run shares. */
const SHARED_TABLES = ["email_deliveries", "email_providers"];

const DIALECTS: Array<{
  dialect: SupportedDialect;
  url: string | null;
  make: (url: string) => TestAdapter;
  tables: Record<string, unknown>;
}> = [
  {
    dialect: "postgresql",
    url: process.env.TEST_POSTGRES_URL ?? null,
    make: url => createPostgresAdapter({ url }) as unknown as TestAdapter,
    tables: { emailProvidersPg, emailDeliveriesPg },
  },
  {
    dialect: "sqlite",
    url: "memory",
    make: () => createSqliteAdapter({ memory: true }) as unknown as TestAdapter,
    tables: { emailProvidersSqlite, emailDeliveriesSqlite },
  },
];

for (const entry of DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(`a deleted provider and its deliveries — ${entry.dialect}`, () => {
    let adapter: TestAdapter;
    let scratch: ScratchDatabase | undefined;
    let sharedBefore: unknown[] | null = null;

    const q = (id: string) =>
      entry.dialect === "mysql" ? `\`${id}\`` : `"${id}"`;
    // Postgres and MySQL take positional parameters in different spellings, and
    // the delivery insert below binds several. Written once so a dialect cannot
    // be given the wrong one by hand.
    const p = (index: number) =>
      entry.dialect === "postgresql" ? `$${index}` : "?";

    beforeAll(async () => {
      // Built fresh rather than reused, because the subject is a CONSTRAINT and
      // a table that predates it looks identical to one that never declared it
      // — and in a database of its own, so the shared tables are never touched.
      if (entry.dialect !== "sqlite") {
        sharedBefore = await describeSharedTables(entry.dialect, SHARED_TABLES);
        scratch = await createScratchDatabase(
          entry.dialect,
          "nextly_email_provider_ref"
        );
      }
      adapter = entry.make(scratch?.url ?? (entry.url as string));
      await adapter.connect();

      const kit = await getDrizzleKitForDialect(
        entry.dialect as "postgresql" | "mysql" | "sqlite"
      );
      const statements = await kit.generateMigration(
        await kit.generateDrizzleJson({}),
        await kit.generateDrizzleJson(entry.tables)
      );
      for (const statement of splitStatements(statements)) {
        await adapter.executeQuery(statement);
      }
    });

    afterAll(async () => {
      // The database goes even when the setup failed before connecting, or
      // disconnecting fails.
      try {
        await adapter?.disconnect();
      } finally {
        await scratch?.drop();
      }
    });

    beforeEach(async () => {
      // Deliveries first: they hold the reference.
      await adapter.executeQuery(`DELETE FROM ${q("email_deliveries")}`);
      await adapter.executeQuery(`DELETE FROM ${q("email_providers")}`);
    });

    it("nulls the reference and keeps the delivery row", async () => {
      // Canonical UUIDs, not arbitrary hex. PostgreSQL stores `id` as `uuid`
      // and hands the value back in its own canonical spelling, so a
      // differently-formatted string compares unequal to what was inserted —
      // which reads as the reference having changed when only its formatting
      // did.
      const providerId = randomUUID();
      const deliveryId = randomUUID();

      await adapter.executeQuery(
        `INSERT INTO ${q("email_providers")} (${q("id")}, ${q("name")}, ${q("type")}, ${q("from_email")}, ${q("configuration")}, ${q("is_default")}, ${q("is_active")}, ${q("created_at")}, ${q("updated_at")}) ` +
          `VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)})`,
        [
          providerId,
          "Transactional",
          "smtp",
          "hello@example.com",
          "{}",
          entry.dialect === "sqlite" ? 0 : false,
          entry.dialect === "sqlite" ? 1 : true,
          nowFor(entry.dialect),
          nowFor(entry.dialect),
        ]
      );

      await adapter.executeQuery(
        `INSERT INTO ${q("email_deliveries")} (${q("id")}, ${q("provider_id")}, ${q("provider_type")}, ${q("recipient_hash")}, ${q("recipient_kind")}, ${q("status")}, ${q("attempt_count")}, ${q("retention_class")}, ${q("created_at")}) ` +
          `VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)})`,
        [
          deliveryId,
          providerId,
          "smtp",
          "a".repeat(64),
          "to",
          "sent",
          1,
          "operational",
          nowFor(entry.dialect),
        ]
      );

      // The positive control. Without it a delivery whose reference was never
      // stored would satisfy the assertion below for the wrong reason — the
      // column would read null because nothing ever wrote it, not because the
      // delete nulled it.
      const before = await adapter.executeQuery<{ provider_id: string | null }>(
        `SELECT ${q("provider_id")} FROM ${q("email_deliveries")} WHERE ${q("id")} = ${p(1)}`,
        [deliveryId]
      );
      expect(before).toHaveLength(1);
      expect(before[0]?.provider_id).toBe(providerId);

      await adapter.executeQuery(
        `DELETE FROM ${q("email_providers")} WHERE ${q("id")} = ${p(1)}`,
        [providerId]
      );

      const after = await adapter.executeQuery<{ provider_id: string | null }>(
        `SELECT ${q("provider_id")} FROM ${q("email_deliveries")} WHERE ${q("id")} = ${p(1)}`,
        [deliveryId]
      );

      // The row SURVIVES: the log is evidence of what was sent, and a cascade
      // here would delete the record of a message because its credentials were
      // rotated away.
      expect(after).toHaveLength(1);
      expect(after[0]?.provider_id).toBeNull();
    });

    it.skipIf(entry.dialect === "sqlite")(
      "builds its tables in a database of its own, and leaves the shared ones as it found them",
      async () => {
        // The regression control: every assertion above reads the scratch
        // database, so a setup that went back to rebuilding the shared tables
        // would still pass them. This one reads the shared database itself.
        const [connected] = await adapter.executeQuery<{ name: string }>(
          entry.dialect === "postgresql"
            ? "SELECT current_database() AS name"
            : "SELECT DATABASE() AS name"
        );
        expect(connected?.name).not.toBe(
          new URL(entry.url as string).pathname.slice(1)
        );
        expect(
          await describeSharedTables(entry.dialect, SHARED_TABLES)
        ).toEqual(sharedBefore);
      }
    );
  });
}

/**
 * A timestamp each dialect's own column type accepts.
 *
 * SQLite stores these as an integer epoch while the other two take a `Date`.
 * Passing the wrong one is accepted by the driver and stored as something the
 * schema cannot read back.
 */
function nowFor(dialect: SupportedDialect): Date | number {
  return dialect === "sqlite" ? Date.now() : new Date();
}
