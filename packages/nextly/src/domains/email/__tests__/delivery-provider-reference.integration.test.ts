/**
 * A deleted provider must not leave a delivery pointing at a row that is gone.
 *
 * The delivery log outlives the credentials it describes: `provider_type` beside
 * the id keeps every row meaningful without the join, so the right behaviour is
 * to NULL the reference rather than to remove the evidence or to refuse the
 * delete.
 *
 * Run per dialect because the constraint that does the nulling is declared
 * three times, once per schema module, and only the database can be asked
 * whether it is really there. A green SQLite run says nothing about MySQL —
 * which is precisely where the constraint was absent.
 *
 * Tables are created from the PRODUCTION definitions through drizzle-kit rather
 * than from DDL written here, so the fixture cannot drift from the schema it is
 * meant to be testing.
 *
 * They are REBUILT each run rather than reused. These are fixed-name system
 * tables, and a shared test database keeps whatever shape it was first created
 * with — so a table created before this constraint existed is indistinguishable
 * from one whose schema never declared it, and reusing it would report the age
 * of the database instead of the correctness of the schema. That is not
 * hypothetical: the MySQL leg failed on exactly that before this suite started
 * rebuilding, against a table created hours earlier.
 *
 * Dropped in reference order, deliveries first. The reverse fails wherever the
 * constraint is present, which is the state this suite exists to produce.
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDrizzleKitForDialect } from "../../../database/drizzle-kit-lazy";
import { emailDeliveriesMysql } from "../../../schemas/email-deliveries/mysql";
import { emailDeliveriesPg } from "../../../schemas/email-deliveries/postgres";
import { emailDeliveriesSqlite } from "../../../schemas/email-deliveries/sqlite";
import { emailProvidersMysql } from "../../../schemas/email-providers/mysql";
import { emailProvidersPg } from "../../../schemas/email-providers/postgres";
import { emailProvidersSqlite } from "../../../schemas/email-providers/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  tableExists(name: string): Promise<boolean>;
}

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
    dialect: "mysql",
    url: process.env.TEST_MYSQL_URL ?? null,
    make: url => createMySqlAdapter({ url }) as unknown as TestAdapter,
    tables: { emailProvidersMysql, emailDeliveriesMysql },
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

    const q = (id: string) =>
      entry.dialect === "mysql" ? `\`${id}\`` : `"${id}"`;
    // Postgres and MySQL take positional parameters in different spellings, and
    // the delivery insert below binds several. Written once so a dialect cannot
    // be given the wrong one by hand.
    const p = (index: number) =>
      entry.dialect === "postgresql" ? `$${index}` : "?";

    beforeAll(async () => {
      adapter = entry.make(entry.url as string);
      await adapter.connect();

      // Rebuilt rather than reused, because the subject is a CONSTRAINT and a
      // table that predates it looks identical to one that never declared it.
      // A shared test database keeps whatever shape it was first created with,
      // so reusing it would report the age of that database instead of the
      // correctness of this schema.
      //
      // Dropped in reference order — deliveries first, since it is the side
      // that holds the key. The other order fails wherever the constraint is
      // actually present, which is exactly the case this suite exists to
      // create.
      await adapter.executeQuery(
        `DROP TABLE IF EXISTS ${q("email_deliveries")}`
      );
      await adapter.executeQuery(
        `DROP TABLE IF EXISTS ${q("email_providers")}`
      );

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
      await adapter.disconnect();
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
