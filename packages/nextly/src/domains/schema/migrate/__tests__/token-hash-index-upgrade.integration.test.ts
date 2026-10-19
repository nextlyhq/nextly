/**
 * The token-hash indexes on the password-reset and email-verification token
 * tables reach a fresh database and an existing one through `migrateCore`, the
 * core of `nextly migrate`.
 *
 * Both tables are read by token hash alone, which their unique index on
 * (identifier, token_hash) cannot serve. The existing database is the current
 * core schema without the two indexes, holding a token issued before them.
 * The migrate adds the indexes and rewrites no row: the token still reads as
 * it did, and a second run changes nothing.
 *
 * Runs on every dialect with a database in this run, since each dialect
 * creates and reports indexes its own way.
 */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  availableDialects,
  withFreshDatabase,
  type FreshDatabase,
} from "../../../../__tests__/helpers/fresh-database";
import {
  migrateFresh,
  noMigrationsDir,
} from "../../../../__tests__/helpers/migrate-core";

const INDEXES = [
  { table: "password_reset_tokens", index: "prt_token_hash_idx" },
  { table: "email_verification_tokens", index: "evt_token_hash_idx" },
];

/** An install from before the indexes: the current schema without them. */
async function removeTokenHashIndexes(fresh: FreshDatabase): Promise<void> {
  for (const { table, index } of INDEXES) {
    await fresh.exec(
      fresh.dialect === "mysql"
        ? `DROP INDEX ${index} ON ${table}`
        : `DROP INDEX ${index}`
    );
  }
}

/** A reset token and a verification token issued before the indexes. */
async function insertLegacyTokens(fresh: FreshDatabase): Promise<void> {
  // Seconds on SQLite, where the columns are integer timestamps.
  const at = (sqlite: string, other: string) =>
    fresh.dialect === "sqlite" ? sqlite : `'${other}'`;
  const expires = at("1893456000", "2030-01-01 00:00:00");
  const created = at("1767225600", "2026-01-01 00:00:00");
  for (const table of ["password_reset_tokens", "email_verification_tokens"]) {
    await fresh.exec(
      `INSERT INTO ${table} (identifier, token_hash, expires, created_at) ` +
        `VALUES ('legacy@example.com', 'legacy-${table}', ${expires}, ${created})`
    );
  }
}

/** Both legacy tokens, every column, in a fixed order. */
async function readLegacyTokens(
  fresh: FreshDatabase
): Promise<Array<Record<string, unknown>>> {
  const { passwordResetTokens, emailVerificationTokens } =
    fresh.tables as unknown as Record<string, { tokenHash: unknown }>;
  const db = fresh.db as unknown as {
    select: () => {
      from: (table: unknown) => {
        where: (cond: unknown) => Promise<Record<string, unknown>[]>;
      };
    };
  };
  const rows: Array<Record<string, unknown>> = [];
  for (const [table, hash] of [
    [passwordResetTokens, "legacy-password_reset_tokens"],
    [emailVerificationTokens, "legacy-email_verification_tokens"],
  ] as const) {
    rows.push(
      ...(await db
        .select()
        .from(table)
        .where(eq(table.tokenHash as never, hash)))
    );
  }
  return rows;
}

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-thi-");
afterAll(remove);

describe.each(availableDialects())(
  "token-hash indexes through nextly migrate (%s)",
  dialect => {
    it("creates them on a fresh database", async () => {
      await withFreshDatabase(dialect, "nextly_thi_fresh", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);

        for (const { table, index } of INDEXES) {
          // The name alone would pass for an index over the wrong column.
          expect(await fresh.indexColumnsOf(table, index)).toEqual([
            "token_hash",
          ]);
        }
      });
    }, 180_000);

    it("adds them to an existing database and leaves its tokens as they were", async () => {
      await withFreshDatabase(dialect, "nextly_thi_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        await removeTokenHashIndexes(fresh);
        for (const { table, index } of INDEXES) {
          expect(await fresh.indexesOf(table)).not.toContain(index);
        }
        await insertLegacyTokens(fresh);
        const read = () => readLegacyTokens(fresh);
        const before = await read();
        expect(before.map(row => row.tokenHash)).toEqual([
          "legacy-password_reset_tokens",
          "legacy-email_verification_tokens",
        ]);

        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);

        for (const { table, index } of INDEXES) {
          expect(await fresh.indexColumnsOf(table, index)).toEqual([
            "token_hash",
          ]);
        }
        // An index adds nothing to a row: both tokens issued before read back
        // exactly as they were, in every column.
        expect(await read()).toEqual(before);

        // Nothing left to add.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
