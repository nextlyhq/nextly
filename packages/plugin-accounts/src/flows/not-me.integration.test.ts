/**
 * Removing an unverified account, by its owner's "this wasn't me" link and
 * by the sweep of accounts nobody verified, on each dialect.
 *
 * @module flows/not-me.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import type { AccountsOptions } from "../settings";
import { accountByAddress, writeAtVersion } from "../storage/accounts";
import { bootAccounts } from "../test-support/boot";
import { auditRowAbout, auditRowsAbout } from "../test-support/audit";
import { flowDeps } from "../test-support/flow-deps";

import { removeUnverifiedAccount } from "./not-me";
import { PURPOSES } from "./purposes";
import { signUp } from "./sign-up";
import { sweepUnverifiedAccounts } from "./sweep-unverified";
import { verifyByLink } from "./verify";

const DAY = 24 * 60 * 60 * 1000;
const DELETED = "nextlyhq-plugin-accounts.account.deleted";

/** The accounts the flows said were deleted, in order. */
function deletedIds(emitted: Array<{ name: string; payload: unknown }>) {
  return emitted
    .filter(event => event.name === DELETED)
    .map(event => event.payload);
}

function tokenOf(link: string): string {
  const token = new URL(link).searchParams.get("token");
  if (token === null) throw new Error("expected a token");
  return token;
}

describe.each(getConfiguredTestDialects())(
  "removing unverified accounts (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(options: Partial<AccountsOptions> = {}) {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const made = flowDeps(booted.ctx, options);
      const signUpAs = async (address: string) => {
        const answer = await signUp(made.deps, {
          name: "A",
          address,
          password: "a long passphrase",
          client: null,
        });
        if (answer.status !== "accepted")
          throw new Error("expected the sign-up to be accepted");
        const email = made.mail.ofKind("verify-address").at(-1);
        if (email === undefined)
          throw new Error("expected the verification email");
        return {
          browserToken: answer.browserToken,
          link: tokenOf(email.link),
          notMe: tokenOf(email.notMeLink),
        };
      };
      return {
        ctx: booted.ctx,
        nextly: booted.nextly,
        db: booted.ctx.db,
        ...made,
        signUpAs,
      };
    }

    it("removes the account by its owner's link, voiding its links, tells other plugins, and spends the link once", async () => {
      const { db, deps, core, emitted, signUpAs } = await boot();
      const { link, notMe } = await signUpAs("dana@example.com");
      const id = (await accountByAddress(db, "dana@example.com"))?.id;

      expect(await removeUnverifiedAccount(deps, { token: notMe })).toEqual({
        status: "removed",
      });
      expect(await accountByAddress(db, "dana@example.com")).toBeNull();
      expect(deletedIds(emitted)).toEqual([{ accountId: id }]);
      expect(
        await core.secrets.peekToken({
          purpose: PURPOSES.verifyLink,
          token: link,
        })
      ).toMatchObject({ ok: false });
      expect(await removeUnverifiedAccount(deps, { token: notMe })).toEqual({
        status: "refused",
        reason: "spent",
      });
      expect(
        await removeUnverifiedAccount(deps, { token: "not-a-token" })
      ).toEqual({
        status: "refused",
        reason: "invalid",
      });
      expect(deletedIds(emitted)).toHaveLength(1);
    });

    it("keeps an account whose verification commits after the link's own transaction read it", async () => {
      const { db, deps, emitted, signUpAs } = await boot();
      const { notMe } = await signUpAs("dana@example.com");
      // The verification commits from outside while the removal's
      // transaction, having read the account unverified, voids its secrets.
      const secrets = deps.core.secrets;
      const raced = {
        ...deps,
        core: {
          ...deps.core,
          secrets: new Proxy(secrets, {
            get(target, key) {
              const member = Reflect.get(target, key) as unknown;
              if (typeof member !== "function") return member;
              const bound = (member as (...args: unknown[]) => unknown).bind(
                target
              );
              if (key !== "voidFor") return bound;
              return async (...args: unknown[]) => {
                const account = await accountByAddress(db, "dana@example.com");
                if (account !== null)
                  await writeAtVersion(db, account, {
                    verifiedAt: new Date(),
                    verifiedBy: "link",
                  });
                return bound(...args);
              };
            },
          }),
        },
      };

      expect(
        await removeUnverifiedAccount(raced, { token: notMe })
      ).toMatchObject({ status: "refused" });
      expect(await accountByAddress(db, "dana@example.com")).not.toBeNull();
      expect(deletedIds(emitted)).toEqual([]);
    });

    it("reports an account removed by the link or the sweep to core, which erases it from the audit rows about it", async () => {
      const { ctx, nextly, db, deps, core, signUpAs } = await boot({
        unverifiedKeptDays: 1,
      });
      const { notMe } = await signUpAs("dana@example.com");
      const dana = (await accountByAddress(db, "dana@example.com"))?.id ?? "";
      await signUpAs("lee@example.com");
      const lee = (await accountByAddress(db, "lee@example.com"))?.id ?? "";
      await auditRowAbout(ctx, dana);
      await auditRowAbout(ctx, lee);

      await removeUnverifiedAccount(deps, { token: notMe });
      expect(await auditRowsAbout(nextly, dana)).toEqual({ naming: 0, all: 2 });
      expect((await auditRowsAbout(nextly, lee)).naming).toBe(1);

      core.clock.advance(2 * DAY);
      expect(await sweepUnverifiedAccounts(deps)).toBe(1);
      expect(await auditRowsAbout(nextly, lee)).toEqual({ naming: 0, all: 2 });
    });

    it("never removes an account verified since", async () => {
      const { db, deps, signUpAs } = await boot();
      const { browserToken, link, notMe } = await signUpAs("dana@example.com");
      expect(
        await verifyByLink(deps, { token: link, browserToken })
      ).toMatchObject({ status: "verified" });

      expect(
        await removeUnverifiedAccount(deps, { token: notMe })
      ).toMatchObject({ status: "refused" });
      expect(await accountByAddress(db, "dana@example.com")).not.toBeNull();
    });

    it("sweeps accounts nobody verified past the kept days, telling other plugins, and keeps the rest", async () => {
      const { db, deps, core, emitted, signUpAs } = await boot({
        unverifiedKeptDays: 3,
      });
      await signUpAs("old@example.com");
      await signUpAs("old-verified@example.com").then(
        async ({ browserToken, link }) =>
          verifyByLink(deps, { token: link, browserToken })
      );
      core.clock.advance(2 * DAY);
      await signUpAs("young@example.com");
      core.clock.advance(DAY);

      const old = (await accountByAddress(db, "old@example.com"))?.id;

      expect(await sweepUnverifiedAccounts(deps)).toBe(1);
      expect(await accountByAddress(db, "old@example.com")).toBeNull();
      expect(deletedIds(emitted)).toEqual([{ accountId: old }]);
      expect(
        await accountByAddress(db, "old-verified@example.com")
      ).not.toBeNull();
      expect(await accountByAddress(db, "young@example.com")).not.toBeNull();
    });

    it("deletes at most a batch per run, oldest first", async () => {
      const { db, deps, core, signUpAs } = await boot({
        unverifiedKeptDays: 1,
      });
      for (const n of [1, 2, 3]) {
        await signUpAs(`v${n}@example.com`);
        core.clock.advance(1000);
      }
      core.clock.advance(DAY);

      expect(await sweepUnverifiedAccounts(deps, { batch: 2 })).toBe(2);
      expect(await accountByAddress(db, "v3@example.com")).not.toBeNull();
      expect(await sweepUnverifiedAccounts(deps, { batch: 2 })).toBe(1);
    });
  }
);
