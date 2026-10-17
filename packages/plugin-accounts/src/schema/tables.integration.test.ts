/**
 * The accounts plugin's tables on each dialect: the rules the database itself
 * keeps, so no race between two requests can break them. And a production boot
 * over a database the plugin was never installed on, which core refuses.
 *
 * @module schema/tables.integration.test
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";
import { eq } from "@nextlyhq/plugin-sdk/db";
import { isUniqueViolation } from "@nextlyhq/plugin-sdk/schema";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { accounts } from "../plugin";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";

import {
  accounts as accountsTable,
  knownBrowsers,
  pendingAddressChanges,
  sessions,
} from "./tables";

describe.each(getConfiguredTestDialects())(
  "the accounts tables (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Boot with the plugin, and hand back its context. */
    async function boot(): Promise<PluginContext> {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      return booted.ctx;
    }

    const account = (id: string, address: string) => ({
      id,
      address,
      addressNormalised: address.trim().toLowerCase(),
      name: "Dana Reyes",
    });

    it("keeps one account per normalised address, refusing the second", async () => {
      const { db } = await boot();
      await db.insert(accountsTable, account("a-1", "Dana@Example.com"));

      let refusal: unknown;
      try {
        await db.insert(accountsTable, account("a-2", "dana@example.com"));
      } catch (error) {
        refusal = error;
      }
      expect(isUniqueViolation(dialect, refusal)).toBe(true);
      // The control: another address is accepted, so the refusal is the address's.
      await expect(
        db.insert(accountsTable, account("a-3", "lee@example.com"))
      ).resolves.not.toThrow();
    });

    it("starts an account's counters at zero and leaves it unverified", async () => {
      const { db } = await boot();
      await db.insert(accountsTable, account("a-1", "dana@example.com"));
      const a = db.table(accountsTable);
      const row = await db.select(accountsTable).where(eq(a.id, "a-1")).first();

      expect(row).toMatchObject({
        failuresInARow: 0,
        securityVersion: 0,
        verifiedAt: null,
        passwordHash: null,
      });
    });

    it("removes an account's sessions, known browsers and pending address change with it", async () => {
      const { db } = await boot();
      const now = new Date();
      await db.insert(accountsTable, account("a-1", "dana@example.com"));
      await db.insert(accountsTable, account("a-2", "lee@example.com"));
      for (const accountId of ["a-1", "a-2"]) {
        await db.insert(sessions, {
          id: `s-${accountId}`,
          accountId,
          tokenHash: accountId.padEnd(64, "0"),
          lastUsedAt: now,
          idleExpiresAt: now,
          absoluteExpiresAt: now,
        });
        await db.insert(knownBrowsers, {
          id: `k-${accountId}`,
          accountId,
          tokenHash: accountId.padEnd(64, "1"),
          knownAt: now,
        });
        await db.insert(pendingAddressChanges, {
          id: `p-${accountId}`,
          accountId,
          newAddress: `new-${accountId}@example.com`,
          newAddressNormalised: `new-${accountId}@example.com`,
          expiresAt: now,
        });
      }

      const a = db.table(accountsTable);
      await db.delete(accountsTable).where(eq(a.id, "a-1"));

      // The deleted account's rows are gone; the other account's stay.
      for (const table of [sessions, knownBrowsers, pendingAddressChanges]) {
        const rows = await db.select(table).all();
        expect(rows.map(row => row.accountId)).toEqual(["a-2"]);
      }
    });

    it("keeps at most one pending address change per account", async () => {
      const { db } = await boot();
      await db.insert(accountsTable, account("a-1", "dana@example.com"));
      const change = (id: string) => ({
        id,
        accountId: "a-1",
        newAddress: `${id}@example.com`,
        newAddressNormalised: `${id}@example.com`,
        expiresAt: new Date(),
      });
      await db.insert(pendingAddressChanges, change("first"));

      let refusal: unknown;
      try {
        await db.insert(pendingAddressChanges, change("second"));
      } catch (error) {
        refusal = error;
      }
      expect(isUniqueViolation(dialect, refusal)).toBe(true);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "the accounts plugin at a production boot (%s)",
  (dialect: TestDialect) => {
    // A production install gets the plugin's tables only from `nextly plugins
    // install`, which applies its migration modules and records the install.
    // Core refuses a configured plugin with no install record first, before the
    // schema-version gate, on every dialect. The schema-version gate itself is
    // reached only past this one, so `install.integration.test.ts` pins it with a
    // database the real commands make.
    it("refuses a database the accounts plugin was never installed on", async () => {
      // What a production boot requires before it reaches the plugin gates. A
      // throwaway secret for this boot alone, never a real one.
      const production: Record<string, string> = {
        NODE_ENV: "production",
        NEXTLY_SECRET: "test-only-secret-for-the-boot-gate-0123456789",
        NEXT_PUBLIC_APP_URL: "http://localhost",
      };
      const previous = Object.fromEntries(
        Object.keys(production).map(key => [key, process.env[key]])
      );
      Object.assign(process.env, production);
      let failure: unknown;
      try {
        const booted = await createTestNextly({
          dialect,
          plugins: [accounts({ origin: TEST_ORIGIN })],
        });
        await booted.destroy();
      } catch (error) {
        failure = error;
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      expect(NextlyError.is(failure) ? failure.code : String(failure)).toBe(
        "PLUGIN_NOT_INSTALLED"
      );
    });
  }
);
