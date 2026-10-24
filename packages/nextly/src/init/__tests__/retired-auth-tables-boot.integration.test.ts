/**
 * A boot on a database that still holds a retired `accounts`, `sessions` or
 * `user_permission_cache` table names the table in a startup warning, with its
 * row count. A database
 * without them stays quiet about auth tables.
 *
 * Runs the real check — live introspection, the shape test and the count
 * queries — and reaches it through `ensureFirstRunSetup`'s already-initialized
 * branch, the only branch the warning runs on. `tableExists` answers from the
 * live catalogue, so the namesake check sees the same columns a boot would.
 * On every dialect with a database in this run.
 */
import { describe, expect, it, vi } from "vitest";

import {
  availableDialects,
  buildCurrentCoreSchema,
  type FreshDatabase,
  withFreshDatabase,
} from "../../__tests__/helpers/fresh-database";
import { ensureFirstRunSetup } from "../first-run";
import {
  createRetiredAuthTables,
  createStoredPermissionAnswersTable,
} from "./retired-auth-tables-fixture";

const WARNING_OPENING = "still has auth tables";

async function boot(fresh: FreshDatabase) {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const result = await ensureFirstRunSetup({
    adapter: {
      dialect: fresh.dialect,
      getDrizzle: () => fresh.db,
      // The probe table exists on this database, so this is the initialized
      // path. A table is present when the catalogue has columns for it.
      tableExists: async table => (await fresh.columnsOf(table)).length > 0,
      executeQuery: async sql => fresh.exec(sql),
    },
    logger,
  });
  expect(result).toEqual({ ranSetup: false, reason: "already_initialized" });
  return logger;
}

function authTableWarnings(logger: { warn: ReturnType<typeof vi.fn> }) {
  return logger.warn.mock.calls
    .map(([message]) => String(message))
    .filter(message => message.includes(WARNING_OPENING));
}

describe.each(availableDialects())(
  "boot warning for retired auth tables (%s)",
  dialect => {
    const fresh = (body: (fresh: FreshDatabase) => Promise<void>) =>
      withFreshDatabase(dialect, "nextly_retired_auth_boot", async db => {
        await buildCurrentCoreSchema(db);
        await body(db);
      });

    it("names each retired table present, with its row count", async () => {
      await fresh(async db => {
        await createRetiredAuthTables(
          { executeQuery: sql => db.exec(sql) },
          dialect
        );
        await db.exec(
          "INSERT INTO sessions (session_token, user_id, expires) VALUES ('t', 'u', 1)"
        );

        const logger = await boot(db);

        const [warning, ...rest] = authTableWarnings(logger);
        expect(rest).toEqual([]);
        expect(warning).toContain("accounts: 0 rows");
        expect(warning).toContain("sessions: 1 row");
      });
    });

    it("names the stored permission answers an upgraded database still has", async () => {
      await fresh(async db => {
        await createStoredPermissionAnswersTable(
          { executeQuery: sql => db.exec(sql) },
          dialect
        );
        // Empty: its rows need a user to point at, and the count is read the
        // same way the case above reads the sign-in tables'.
        const logger = await boot(db);

        const [warning, ...rest] = authTableWarnings(logger);
        expect(rest).toEqual([]);
        expect(warning).toContain("user_permission_cache: 0 rows");
        expect(warning).toContain("whether or not it holds rows");
      });
    });

    it("stays quiet about auth tables on a database that never had them", async () => {
      await fresh(async db => {
        const logger = await boot(db);

        expect(authTableWarnings(logger)).toEqual([]);
      });
    });
  }
);
