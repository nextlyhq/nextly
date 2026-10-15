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

import { accountsLimitRules } from "../core/limit-rules";
import { accounts } from "../plugin";
import {
  accounts as accountsTable,
  knownBrowsers,
  pendingAddressChanges,
  sentEmails,
  sessions,
} from "../schema/tables";
import { resolveAccountsSettings } from "../settings";
import { createAccount, writeAtVersion } from "../storage/accounts";
import { rememberBrowser } from "../storage/known-browsers";
import { askAddressChange } from "../storage/pending-changes";
import { recordEmailSent } from "../storage/sent-emails";
import { startSession } from "../storage/sessions";
import { TEST_ORIGIN } from "../test-support/boot";

import { SEND_EMAIL_JOB, sendEmailJob, SWEEP_JOB } from "./jobs";
import { accountPrincipals, sendQueuedEmail, sweepAll } from "./runtime";
import { accountsServices } from "../server/installed";
import { bootAccounts } from "../test-support/boot";
import { fakeAccountsCore } from "../testing";
import { accountByAddress } from "../storage/accounts";

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

    it("boots with its templates, its events and its jobs accepted", async () => {
      await boot();
      const plugin = accounts({ origin: TEST_ORIGIN });

      expect(plugin.contributes?.jobs?.map(job => job.slug)).toEqual([
        SEND_EMAIL_JOB,
        SWEEP_JOB,
      ]);
      expect(plugin.contributes?.events).toEqual([
        { name: "nextlyhq-plugin-accounts.account.deleted" },
        { name: "nextlyhq-plugin-accounts.account.deactivated" },
        { name: "nextlyhq-plugin-accounts.account.reactivated" },
      ]);
      expect(plugin.contributes?.emailTemplates?.length).toBeGreaterThan(0);
    });

    it("runs a flow that writes secrets in a transaction through the started plugin, on stand-ins", async () => {
      const core = fakeAccountsCore({
        start: new Date(),
        rules: accountsLimitRules(
          resolveAccountsSettings({ origin: TEST_ORIGIN })
        ),
      });
      const booted = await bootAccounts(dialect, { core });
      current = booted.nextly;
      const service = accountsServices(booted.ctx);

      const outcome = await service.signUp({
        visitor: {
          client: null,
          sessionToken: null,
          knownTokens: [],
          signUpToken: null,
        },
        name: "Dana Reyes",
        address: "dana@example.com",
        password: "a long passphrase",
      });
      expect(outcome.cookies.map(change => change.cookie)).toContain("signUp");
      expect(
        await accountByAddress(booted.ctx.db, "dana@example.com")
      ).not.toBeNull();
    });

    it("keeps one pacer for the started plugin, primed by a single check", async () => {
      const core = fakeAccountsCore({
        start: new Date(),
        rules: accountsLimitRules(
          resolveAccountsSettings({ origin: TEST_ORIGIN })
        ),
      });
      const booted = await bootAccounts(dialect, { core });
      current = booted.nextly;
      const service = accountsServices(booted.ctx);
      const attempt = () =>
        service.signIn({
          visitor: {
            client: null,
            sessionToken: null,
            knownTokens: [],
            signUpToken: null,
          },
          address: "nobody@example.com",
          password: "a long passphrase",
        });

      await expect(attempt()).rejects.toMatchObject({
        code: "ACCOUNTS_WRONG_CREDENTIALS",
      });
      await expect(attempt()).rejects.toMatchObject({
        code: "ACCOUNTS_WRONG_CREDENTIALS",
      });
      // Each attempt for an address nobody has checks the decoy once; the
      // pacer's priming is the one check more, made once for both requests.
      expect(core.passwords.decoyVerifications).toBe(3);
    });

    it("sends a job's email once however many times the job runs, and again after a failed send", async () => {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const outcomes = [true, false, true, true];
      const sends: string[] = [];
      const ctx = {
        db: booted.ctx.db,
        dialect: booted.ctx.dialect,
        services: {
          email: {
            sendWithTemplate: async (_slug: string, to: string) => {
              sends.push(to);
              return { success: outcomes.shift() ?? true };
            },
          },
        },
      };
      const email = {
        kind: "account-deleted" as const,
        accountId: "a1",
        to: "dana@example.com",
      };
      const now = new Date();

      // One job, run three times: it sends once.
      for (let attempt = 0; attempt < 3; attempt += 1)
        await sendQueuedEmail(ctx, email, { jobId: "job-1", now });
      expect(sends).toHaveLength(1);

      // Another job whose first send fails: it is free to send on its retry.
      await expect(
        sendQueuedEmail(ctx, email, { jobId: "job-2", now })
      ).rejects.toThrow("did not send");
      await sendQueuedEmail(ctx, email, { jobId: "job-2", now });
      await sendQueuedEmail(ctx, email, { jobId: "job-2", now });
      expect(sends).toHaveLength(3);
    });

    it("hands the send its job's id, the same on every attempt", async () => {
      const seen: string[] = [];
      const job = sendEmailJob(async (_email, attempt) => {
        seen.push(attempt.jobId);
      });
      const email = { kind: "account-deleted", accountId: "a1", to: "d@e.com" };
      for (const attempt of [1, 2])
        await job.handler({ email }, {
          jobId: "job-7",
          attempt,
          now: new Date(),
        } as Parameters<typeof job.handler>[1]);
      expect(seen).toEqual(["job-7", "job-7"]);
    });

    it("sweeps what has run out in one pass, and keeps everything live", async () => {
      const ctx = await boot();
      const { db } = ctx;
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
      const stale = await make("stale@example.com", then, false);
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

      await recordEmailSent(db, dialect, "long-gone", then);
      await recordEmailSent(db, dialect, "recent", now);
      const deleted: unknown[] = [];
      await sweepAll(
        {
          db,
          settings,
          now: () => now,
          events: { emit: (_name, payload) => void deleted.push(payload) },
          principals: accountPrincipals(ctx),
        },
        now
      );

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
      expect(deleted).toEqual([{ accountId: stale }]);
      expect((await db.select(sentEmails).all()).map(row => row.jobId)).toEqual(
        ["recent"]
      );
    });
  }
);
