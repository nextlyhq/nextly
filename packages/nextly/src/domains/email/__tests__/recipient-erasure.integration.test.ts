/**
 * That the recipient erasure actually rewrites the column, on every dialect.
 *
 * The unit suite runs on in-memory SQLite and proves the logic. It cannot prove
 * the statement, because the thing under test is one UPDATE matched on a text
 * column, and how a database compares text is a property of the database:
 * MySQL's default collation for `varchar` is case- and pad-insensitive while
 * Postgres's `varchar` is neither, and SQLite's `text` is a third set of rules.
 * A digest that matched on one and not another would leave rows unerased on
 * exactly the installs nobody tested.
 *
 * All three dialects run here. Nothing in this change depends on a constraint,
 * a migration or a column that any dialect lacks — the sentinel was chosen so
 * it does not — so a dialect skipped here would be skipped for want of a
 * database URL and never for want of the behaviour.
 *
 * Tables are created from the PRODUCTION definitions through drizzle-kit rather
 * than from DDL written here, so the fixture cannot drift from the schema it is
 * meant to be testing. They are REBUILT each run: these are fixed-name system
 * tables and a shared test database keeps whatever shape it was first created
 * with, so reusing one would report the age of that database rather than the
 * correctness of this schema.
 */

import { randomUUID } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDrizzleKitForDialect } from "../../../database/drizzle-kit-lazy";
import { emailDeliveriesMysql } from "../../../schemas/email-deliveries/mysql";
import { emailDeliveriesPg } from "../../../schemas/email-deliveries/postgres";
import { emailDeliveriesSqlite } from "../../../schemas/email-deliveries/sqlite";
import { emailProvidersMysql } from "../../../schemas/email-providers/mysql";
import { emailProvidersPg } from "../../../schemas/email-providers/postgres";
import { emailProvidersSqlite } from "../../../schemas/email-providers/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { deliveriesTableFor } from "../deliveries-table";
import { ERASED_RECIPIENT_HASH, recipientDigest } from "../delivery-record";
import { eraseRecipientDeliveries } from "../erase-recipient";

// `hashRecipient` reads the validated environment, which is checked lazily on
// first ACCESS rather than at import — and the check refuses a configuration
// with no `DATABASE_URL`, which an integration run does not otherwise need
// because every adapter below is constructed from an explicit URL. Nothing ever
// connects to this one; it exists so the digest function can be called at all.
// Assigned rather than overwritten, matching how the shared setup supplies
// `NEXTLY_SECRET`, so a run providing its own value keeps it.
process.env.DATABASE_URL ??=
  process.env.TEST_POSTGRES_URL ?? "postgres://unused@localhost:5432/unused";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  getDrizzle(): unknown;
}

const ERASED = "erase-me@example.com";
const KEPT = "someone-else@example.com";

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

  suite(`erasing a recipient — ${entry.dialect}`, () => {
    let adapter: TestAdapter;

    const q = (id: string) =>
      entry.dialect === "mysql" ? `\`${id}\`` : `"${id}"`;
    const p = (index: number) =>
      entry.dialect === "postgresql" ? `$${index}` : "?";

    async function insertDelivery(address: string): Promise<void> {
      const columns = [
        "id",
        "provider_type",
        "recipient_hash",
        "recipient_kind",
        "status",
        "attempt_count",
        "retention_class",
        "created_at",
      ];
      await adapter.executeQuery(
        `INSERT INTO ${q("email_deliveries")} (${columns.map(q).join(", ")}) ` +
          `VALUES (${columns.map((_, i) => p(i + 1)).join(", ")})`,
        [
          randomUUID(),
          "smtp",
          recipientDigest(address),
          "to",
          "failed",
          1,
          "operational",
          new Date(),
        ]
      );
    }

    async function storedHashes(): Promise<string[]> {
      const rows = await adapter.executeQuery<{ recipient_hash: string }>(
        `SELECT ${q("recipient_hash")} FROM ${q("email_deliveries")}`
      );
      return rows.map(row => row.recipient_hash);
    }

    beforeAll(async () => {
      adapter = entry.make(entry.url as string);
      await adapter.connect();

      // Dropped in reference order — deliveries first, since it is the side
      // holding the key. The other order fails wherever the constraint exists.
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
    }, 60_000);

    afterAll(async () => {
      await adapter.disconnect();
    });

    beforeEach(async () => {
      await adapter.executeQuery(`DELETE FROM ${q("email_deliveries")}`);
      await insertDelivery(ERASED);
      await insertDelivery(KEPT);
    });

    it("writes both digests before anything is erased", async () => {
      // The instrument control. Every assertion below is "the digest is gone",
      // which an insert that silently failed would also produce.
      const before = await storedHashes();
      expect(before).toContain(recipientDigest(ERASED));
      expect(before).toContain(recipientDigest(KEPT));
    });

    it("replaces the digest with the sentinel and leaves the other row", async () => {
      await eraseRecipientDeliveries(
        adapter.getDrizzle() as Parameters<typeof eraseRecipientDeliveries>[0],
        deliveriesTableFor(entry.dialect),
        ERASED
      );

      const after = await storedHashes();
      expect(after).toContain(ERASED_RECIPIENT_HASH);
      expect(after).not.toContain(recipientDigest(ERASED));
      // The scope control: an UPDATE with a mismatched or absent predicate
      // would erase this one too, and the assertions above would not notice.
      expect(after).toContain(recipientDigest(KEPT));
      expect(after).toHaveLength(2);
    });

    it("writes only values no collation difference can confuse", async () => {
      // The dialects do NOT agree on how this column compares. MySQL's default
      // `varchar` collation is case- and pad-insensitive; Postgres and SQLite
      // compare these values exactly. Measured, not assumed: an UPDATE keyed on
      // an uppercased digest matches on MySQL and matches nothing on the other
      // two.
      //
      // That divergence is made unreachable rather than handled. `hashRecipient`
      // emits lowercase hex and the sentinel is lowercase letters, so no two
      // distinct stored values can ever differ only by case or trailing space —
      // which is the property that lets one UPDATE mean the same thing on all
      // three. Asserted here because it is load-bearing and invisible: a digest
      // that gained uppercase would keep every other test green while MySQL
      // quietly began matching rows the others would not.
      for (const hash of await storedHashes()) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(ERASED_RECIPIENT_HASH).toMatch(/^[a-z]+$/);
      expect(recipientDigest(ERASED)).toMatch(/^[0-9a-f]{64}$/);
    });
  });
}
