/**
 * The plugin as a site boots it, on each dialect: its own start, its
 * contributions accepted by core, and one pass of its sweep.
 *
 * @module wiring/wiring.integration.test
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { accounts } from "../plugin";
import {
  accounts as accountsTable,
  knownBrowsers,
  pendingAddressChanges,
  sessions,
} from "../schema/tables";
import { resolveAccountsSettings } from "../settings";
import { createAccount, writeAtVersion } from "../storage/accounts";
import { rememberBrowser } from "../storage/known-browsers";
import { askAddressChange } from "../storage/pending-changes";
import { startSession } from "../storage/sessions";
import { TEST_ORIGIN } from "../test-support/boot";

import { SEND_EMAIL_JOB, SWEEP_JOB } from "./jobs";
import { sweepAll } from "./runtime";

const DAY = 24 * 60 * 60 * 1000;

describe.each(getConfiguredTestDialects())(
  "the plugin as a site boots it (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Boots the plugin with its own start, and hands back the context that start was given. */
    async function boot(): Promise<PluginContext> {
      const plugin = accounts({ origin: TEST_ORIGIN });
      let captured: PluginContext | undefined;
      current = await createTestNextly({
        dialect,
        plugins: [
          {
            ...plugin,
            init: async (ctx: PluginContext) => {
              await plugin.init?.(ctx);
              captured = ctx;
            },
          },
        ],
      });
      if (captured === undefined) throw new Error("the plugin did not start");
      return captured;
    }

    it("boots with its templates, its event and its jobs accepted", async () => {
      await boot();
      const plugin = accounts({ origin: TEST_ORIGIN });

      expect(plugin.contributes?.jobs?.map(job => job.slug)).toEqual([
        SEND_EMAIL_JOB,
        SWEEP_JOB,
      ]);
      expect(plugin.contributes?.events).toEqual([
        { name: "nextlyhq-plugin-accounts.account.deleted" },
      ]);
      expect(plugin.contributes?.emailTemplates?.length).toBeGreaterThan(0);
    });

    it("sweeps what has run out in one pass, and keeps everything live", async () => {
      const { db } = await boot();
      const settings = resolveAccountsSettings({
        origin: TEST_ORIGIN,
        unverifiedKeptDays: 7,
      });
      const then = new Date("2026-01-01T00:00:00.000Z");
      const now = new Date(then.getTime() + 100 * DAY);
      const make = async (
        address: string,
        createdAt: Date,
        verified: boolean
      ) => {
        const created = await createAccount(db, dialect, {
          address,
          name: "A",
          passwordHash: null,
          createdAt,
        });
        if (created.status !== "created")
          throw new Error("expected an account");
        if (verified)
          await writeAtVersion(db, created.account, { verifiedAt: createdAt });
        return created.account.id;
      };
      await make("stale@example.com", then, false);
      const kept = await make("kept@example.com", then, true);
      const limits = { idleMs: DAY, absoluteMs: 30 * DAY, perAccount: 20 };
      await startSession(
        db,
        { accountId: kept, tokenHash: "1".repeat(64), now: then },
        limits
      );
      await startSession(
        db,
        { accountId: kept, tokenHash: "2".repeat(64), now },
        limits
      );
      await rememberBrowser(
        db,
        { accountId: kept, tokenHash: "3".repeat(64), now: then },
        10
      );
      await rememberBrowser(
        db,
        { accountId: kept, tokenHash: "4".repeat(64), now },
        10
      );
      await askAddressChange(db, {
        accountId: kept,
        newAddress: "new@example.com",
        expiresAt: then,
      });

      await sweepAll({ db, settings, now: () => now }, now);

      expect((await db.select(accountsTable).all()).map(row => row.id)).toEqual(
        [kept]
      );
      expect(
        (await db.select(sessions).all()).map(row => row.tokenHash)
      ).toEqual(["2".repeat(64)]);
      expect(
        (await db.select(knownBrowsers).all()).map(row => row.tokenHash)
      ).toEqual(["4".repeat(64)]);
      expect(await db.select(pendingAddressChanges).all()).toEqual([]);
    });
  }
);
