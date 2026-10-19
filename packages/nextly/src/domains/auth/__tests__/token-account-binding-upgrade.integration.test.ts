/**
 * Upgrading an install whose reset and verification links record no account.
 *
 * The database starts as the current core schema without `user_id` on either
 * token table, as the release before it shipped, holding outstanding links of
 * both kinds. `migrateCore`, the core of `nextly migrate` and of both boot
 * paths, has to add the column and then bind each link to the account it was
 * issued for, or remove it when that cannot be established:
 *
 * - bound: the account holding the address was created and last changed
 *   before the link was issued, so it held the address then;
 * - removed: the address was given to an account created after the link was
 *   issued (reassigned before the upgrade), the account changed after it, no
 *   account holds the address, or the link has expired.
 *
 * A bound link then works through the real services, and is refused once its
 * account moves and the address is reassigned after the upgrade.
 *
 * Runs on every configured dialect: the column is added by a different push
 * per dialect, and the binding step's statements are each dialect's own.
 */
import { createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { noMigrationsDir } from "../../../__tests__/helpers/migrate-core";
import { migrateCore } from "../../../cli/commands/migrate";
import { getDialectTables } from "../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { getSchemaEventsDdl } from "../../schema/events/schema-events-ddl";
import type { AuthService } from "../services/auth-service";

interface TestDb {
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown> };
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
}

const HOUR = 3600_000;
const OLD_HASH = "$2a$10$abcdefghijklmnopqrstuuJ7rOq0r9rUuJ1yYb1E5vZ3QhJcI2xyK";
const TOKEN_TABLES = [
  { name: "password_reset_tokens", index: "prt_user_id_idx" },
  { name: "email_verification_tokens", index: "evt_user_id_idx" },
] as const;

const { dir: NO_MIGRATIONS, remove: removeDir } = noMigrationsDir(
  "nextly-token-binding-"
);
afterAll(removeDir);

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Rows of a raw statement, whatever shape the adapter hands back. */
async function query(
  t: TestNextly,
  statement: string
): Promise<Record<string, unknown>[]> {
  const result = (await t.adapter.executeQuery(statement)) as unknown;
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

async function columnsOf(
  t: TestNextly,
  dialect: TestDialect,
  table: string
): Promise<string[]> {
  if (dialect === "sqlite") {
    return (await query(t, `PRAGMA table_info(${table})`)).map(row =>
      String(row.name)
    );
  }
  const schema = dialect === "postgresql" ? "current_schema()" : "DATABASE()";
  return (
    await query(
      t,
      `SELECT column_name AS name FROM information_schema.columns ` +
        `WHERE table_schema = ${schema} AND table_name = '${table}'`
    )
  ).map(row => String(row.name ?? row.NAME ?? row.COLUMN_NAME));
}

/** The token tables as the release before this one created them. */
async function toPreviousShape(
  t: TestNextly,
  dialect: TestDialect
): Promise<void> {
  for (const { name, index } of TOKEN_TABLES) {
    if (dialect === "sqlite") {
      // SQLite cannot drop a column a table-level foreign key names, so the
      // table, still empty here, is recreated from its own live definition
      // without the column, its key and its index.
      const objects = await query(
        t,
        `SELECT type, name, sql FROM sqlite_master WHERE tbl_name = '${name}' AND sql IS NOT NULL`
      );
      const table = objects.find(row => row.type === "table");
      const previous = String(table?.sql)
        .replace(/\n\s*`user_id` text,/, "")
        .replace(
          /,\n\s*CONSTRAINT `[^`]+` FOREIGN KEY \(`user_id`\)[^\n]*/,
          ""
        );
      await t.adapter.executeQuery(`DROP TABLE "${name}"`);
      await t.adapter.executeQuery(previous);
      for (const row of objects) {
        if (row.type === "index" && row.name !== index) {
          await t.adapter.executeQuery(String(row.sql));
        }
      }
    } else if (dialect === "postgresql") {
      await t.adapter.executeQuery(
        `ALTER TABLE "${name}" DROP COLUMN "user_id"`
      );
    } else {
      const [fk] = await query(
        t,
        `SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE ` +
          `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${name}' ` +
          `AND COLUMN_NAME = 'user_id' AND REFERENCED_TABLE_NAME IS NOT NULL`
      );
      await t.adapter.executeQuery(
        `ALTER TABLE \`${name}\` DROP FOREIGN KEY \`${String(fk.name ?? fk.CONSTRAINT_NAME)}\``
      );
      await t.adapter.executeQuery(
        `ALTER TABLE \`${name}\` DROP COLUMN \`user_id\``
      );
    }
  }
}

/** A timestamp literal each dialect's column takes, as the application writes it. */
function at(dialect: TestDialect, when: Date): string {
  return dialect === "sqlite"
    ? String(Math.floor(when.getTime() / 1000))
    : `'${when.toISOString().slice(0, 19).replace("T", " ")}'`;
}

/** The core migration, as `nextly migrate` runs it against this database. */
async function migrate(t: TestNextly, dialect: TestDialect): Promise<boolean> {
  const { coreChanged } = await migrateCore({
    extensionSchema: undefined,
    dialect,
    db: t.adapter.getDrizzle(),
    adapter: {
      dialect,
      connect: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
      isConnected: () => true,
      getCapabilities: () => ({ dialect }),
      executeQuery: (statement: string) => t.adapter.executeQuery(statement),
    } as unknown as Parameters<typeof migrateCore>[0]["adapter"],
    migrationsDir: NO_MIGRATIONS,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as never,
    lockMode: "fail-fast",
    ensureLedger: async () => {
      if ((await columnsOf(t, dialect, "nextly_schema_events")).length > 0) {
        return;
      }
      for (const statement of getSchemaEventsDdl(dialect)) {
        await t.adapter.executeQuery(statement);
      }
    },
  });
  return coreChanged;
}

describe.each(getConfiguredTestDialects())(
  "upgrading outstanding links (%s)",
  (dialect: TestDialect) => {
    it("binds the links it can tie to their account, removes the rest, and the bound ones keep working", async () => {
      current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      const t = current;
      const auth = t.getService("authService") as unknown as AuthService;
      const db = t.adapter.getDrizzle() as unknown as TestDb;
      const tables = getDialectTables(dialect);
      const now = Date.now();
      const ago = (hours: number): Date => new Date(now - hours * HOUR);

      await toPreviousShape(t, dialect);
      for (const { name } of TOKEN_TABLES) {
        expect(await columnsOf(t, dialect, name)).not.toContain("user_id");
      }

      async function account(
        id: string,
        createdAt: Date,
        updatedAt: Date = createdAt
      ): Promise<void> {
        await db.insert(tables.users).values({
          id,
          email: `${id}@example.com`,
          name: id,
          emailVerified: null,
          isActive: true,
          passwordHash: OLD_HASH,
          createdAt,
          updatedAt,
        });
      }

      /** One link of each kind, stored as the previous release stored it. */
      async function links(
        email: string,
        issuedAt: Date,
        stamped: { lifetimeHours?: number; createdAt?: Date } = {}
      ): Promise<{ reset: string; verification: string }> {
        const raw = {
          reset: randomBytes(32).toString("hex"),
          verification: randomBytes(32).toString("hex"),
        };
        const expires = at(
          dialect,
          new Date(issuedAt.getTime() + (stamped.lifetimeHours ?? 24) * HOUR)
        );
        const created = at(dialect, stamped.createdAt ?? issuedAt);
        // A verification link always lasted a day; only a reset link could
        // be given another lifetime.
        const dayLater = at(dialect, new Date(issuedAt.getTime() + 24 * HOUR));
        for (const [table, value, until] of [
          ["password_reset_tokens", raw.reset, expires],
          ["email_verification_tokens", raw.verification, dayLater],
        ] as const) {
          const hash = createHash("sha256").update(value).digest("hex");
          await t.adapter.executeQuery(
            `INSERT INTO ${table} (identifier, token_hash, expires, created_at) ` +
              `VALUES ('${email}', '${hash}', ${until}, ${created})`
          );
        }
        return raw;
      }

      // Held their address since before their links were issued.
      await account("keeps", ago(5));
      const keeps = await links("keeps@example.com", ago(1));
      await account("moves", ago(5));
      const moves = await links("moves@example.com", ago(1));
      // The address went to an account created after the link was issued.
      const reassigned = await links("reassigned@example.com", ago(2));
      await account("reassigned", ago(1));
      // The account changed after the link was issued.
      await account("changed", ago(5), ago(0.5));
      const changed = await links("changed@example.com", ago(1));
      // Nobody holds the address.
      const orphan = await links("orphan@example.com", ago(1));
      // Expired before the upgrade.
      await account("expired", ago(40));
      const expired = await links("expired@example.com", ago(30));
      // Created in the same instant its links were issued: not before them.
      await account("same-instant", ago(1));
      const sameInstant = await links("same-instant@example.com", ago(1));
      // A reset link given a week's lifetime, so its expiry does not say when
      // it was issued.
      await account("long-lived", ago(5));
      const longLived = await links("long-lived@example.com", ago(1), {
        lifetimeHours: 24 * 7,
      });
      // Stamped by a database five hours ahead of the application.
      await account("other-zone", ago(10));
      const otherZone = await links("other-zone@example.com", ago(1), {
        createdAt: ago(-4),
      });

      // An account stored before addresses were lowercased, sent a reset link
      // under the lowercased address. MySQL compares addresses without case,
      // so that link worked there; elsewhere the two never matched.
      await db.insert(tables.users).values({
        id: "mixed-case",
        email: "Mixed-Case@example.com",
        name: "mixed-case",
        emailVerified: null,
        isActive: true,
        passwordHash: OLD_HASH,
        createdAt: ago(5),
        updatedAt: ago(5),
      });
      const mixedCase = await links("mixed-case@example.com", ago(1));

      expect(await migrate(t, dialect)).toBe(true);

      for (const { name } of TOKEN_TABLES) {
        expect(await columnsOf(t, dialect, name)).toContain("user_id");
      }

      async function boundTo(raw: string): Promise<unknown[]> {
        const hash = createHash("sha256").update(raw).digest("hex");
        return [
          ...(await db
            .select()
            .from(tables.passwordResetTokens)
            .where(eq(tables.passwordResetTokens.tokenHash, hash))),
          ...(await db
            .select()
            .from(tables.emailVerificationTokens)
            .where(eq(tables.emailVerificationTokens.tokenHash, hash))),
        ].map(row => row.userId);
      }

      expect(await boundTo(keeps.reset)).toEqual(["keeps"]);
      expect(await boundTo(keeps.verification)).toEqual(["keeps"]);
      expect(await boundTo(moves.reset)).toEqual(["moves"]);
      expect(await boundTo(moves.verification)).toEqual(["moves"]);
      for (const removed of [
        reassigned,
        changed,
        orphan,
        expired,
        sameInstant,
      ]) {
        expect(await boundTo(removed.reset)).toEqual([]);
        expect(await boundTo(removed.verification)).toEqual([]);
      }
      // A reset link whose issue time is not known is removed; a verification
      // link always lasts a day, so its expiry says when it was issued, and it
      // is bound whatever its created_at says.
      expect(await boundTo(longLived.reset)).toEqual([]);
      expect(await boundTo(otherZone.reset)).toEqual([]);
      expect(await boundTo(otherZone.verification)).toEqual(["other-zone"]);
      expect(await boundTo(mixedCase.reset)).toEqual(
        dialect === "mysql" ? ["mixed-case"] : []
      );

      // Nothing left unbound, so a second run changes nothing.
      expect(await migrate(t, dialect)).toBe(false);

      // The new shape is enforced: a link cannot name an account that does
      // not exist.
      await expect(
        db.insert(tables.passwordResetTokens).values({
          identifier: "ghost@example.com",
          userId: "no-such-account",
          tokenHash: randomBytes(32).toString("hex"),
          expires: new Date(now + HOUR),
        })
      ).rejects.toThrow();

      async function user(id: string): Promise<Record<string, unknown>> {
        const [row] = await db
          .select()
          .from(tables.users)
          .where(eq(tables.users.id, id));
        return row;
      }

      // A bound link works through the real services.
      await auth.resetPasswordWithToken(keeps.reset, "Str0ngPassw0rd!");
      await auth.verifyEmail(keeps.verification);
      const kept = await user("keeps");
      expect(kept.passwordHash).not.toBe(OLD_HASH);
      expect(kept.emailVerified).not.toBeNull();

      // After the upgrade the account moves and its address is reassigned:
      // the old links act on neither account.
      await t.nextly.users.update({
        id: "moves",
        data: { email: "moved-away@example.com" },
      });
      await account("next-holder", new Date());
      await t.nextly.users.update({
        id: "next-holder",
        data: { email: "moves@example.com" },
      });
      await expect(
        auth.resetPasswordWithToken(moves.reset, "Str0ngPassw0rd!")
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(auth.verifyEmail(moves.verification)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      for (const id of ["moves", "next-holder"]) {
        const row = await user(id);
        expect(row.passwordHash).toBe(OLD_HASH);
        expect(row.emailVerified).toBeNull();
      }

      // The links removed at the upgrade are refused as unknown.
      await expect(
        auth.resetPasswordWithToken(reassigned.reset, "Str0ngPassw0rd!")
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(
        auth.verifyEmail(reassigned.verification)
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }, 300_000);
  }
);
