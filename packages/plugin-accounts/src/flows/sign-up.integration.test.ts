/**
 * Sign-up on each dialect, against the fake core and fake mail: a free
 * address and a taken one answer alike, only the free one makes an account,
 * and no session starts.
 *
 * @module flows/sign-up.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accounts as accountsTable, sessions } from "../schema/tables";
import { accountByAddress, writeAtVersion } from "../storage/accounts";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";
import type { AccountsOptions } from "../settings";
import { flowDeps } from "../test-support/flow-deps";

import { PURPOSES } from "./purposes";
import { signUp, type SignUpResult } from "./sign-up";

const dana = {
  name: "Dana Reyes",
  address: "Dana@Example.com",
  password: "a long passphrase",
  client: "203.0.113.9" as string | null,
};

/** The value, or a failure naming what was missing. */
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("expected a value");
  return value;
}

function accepted(result: SignUpResult) {
  if (result.status !== "accepted")
    throw new Error(`expected accepted, got ${result.reason}`);
  return result;
}

describe.each(getConfiguredTestDialects())(
  "sign-up (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(options: Partial<AccountsOptions> = {}) {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      return {
        ctx: booted.ctx,
        ...flowDeps(booted.ctx, options),
      };
    }

    it("creates an unverified account holding the password's hash", async () => {
      const { ctx, deps, core } = await boot();
      accepted(await signUp(deps, dana));

      const account = required(
        await accountByAddress(ctx.db, "dana@example.com")
      );
      expect(account).toMatchObject({
        address: "Dana@Example.com",
        name: "Dana Reyes",
        verifiedAt: null,
      });
      expect(
        await core.passwords.verify(dana.password, account.passwordHash)
      ).toBe(true);
      expect(await ctx.db.select(sessions).all()).toEqual([]);
    });

    it("queues one verification email: a link on the site, a code, and a link to remove the account", async () => {
      const { ctx, deps, core, mail } = await boot();
      accepted(await signUp(deps, dana));
      const account = required(await accountByAddress(ctx.db, dana.address));

      expect(mail.queued).toHaveLength(1);
      const email = required(mail.ofKind("verify-address")[0]);
      expect(email).toMatchObject({
        accountId: account.id,
        to: "Dana@Example.com",
      });
      expect(email.code).toMatch(/^\d{6}$/);
      const link = new URL(email.link);
      expect(`${link.origin}${link.pathname}`).toBe(
        `${TEST_ORIGIN}/account/verify`
      );
      const token = required(link.searchParams.get("token"));
      expect(
        await core.secrets.peekToken({ purpose: PURPOSES.verifyLink, token })
      ).toMatchObject({
        ok: true,
        subject: account.id,
      });
      expect(new URL(email.notMeLink).pathname).toBe("/account/not-me");
    });

    it("puts nothing the visitor typed in the email to the unverified address", async () => {
      const { mail, deps } = await boot();
      accepted(
        await signUp(deps, {
          ...dana,
          name: 'Click <a href="https://evil.example.com">here</a>',
        })
      );

      expect(JSON.stringify(mail.queued)).not.toContain("evil.example.com");
    });

    it("undoes a sign-up whose verification email could not be queued, so a retry is a first sign-up", async () => {
      const { ctx, deps, mail } = await boot();
      const queueDown = {
        ...deps,
        mail: {
          queue: () => Promise.reject(new Error("the job queue is down")),
        },
      };
      const input = {
        name: "Dana Reyes",
        address: "dana@example.com",
        password: "a long passphrase",
        client: null,
      };

      await expect(signUp(queueDown, input)).rejects.toThrow(
        "the job queue is down"
      );
      expect(await accountByAddress(ctx.db, "dana@example.com")).toBeNull();
      expect(await signUp(deps, input)).toMatchObject({ status: "accepted" });
      expect(mail.queued.map(email => email.kind)).toEqual(["verify-address"]);
    });

    it("ties the browser that signed up to the new account", async () => {
      const { ctx, deps, core } = await boot();
      const answer = accepted(await signUp(deps, dana));
      const account = required(await accountByAddress(ctx.db, dana.address));

      expect(
        await core.secrets.peekToken({
          purpose: PURPOSES.signUpBrowser,
          token: answer.browserToken,
        })
      ).toMatchObject({ ok: true, subject: account.id });
    });

    it("answers a taken address as it answers a free one, and emails the address instead", async () => {
      const { ctx, deps, core, mail } = await boot();
      const free = accepted(await signUp(deps, dana));
      const taken = accepted(
        await signUp(deps, {
          ...dana,
          address: " DANA@example.com ",
          name: "Someone Else",
        })
      );

      // The same answer: a token of the same form and lifetime, and nothing else.
      expect(Object.keys(taken).sort()).toEqual(Object.keys(free).sort());
      expect(taken.browserToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(taken.browserToken).not.toBe(free.browserToken);
      expect(
        taken.browserTokenExpiresAt.getTime() -
          free.browserTokenExpiresAt.getTime()
      ).toBe(0);

      // One account, still Dana's; the taken sign-up's token is bound to none.
      expect(
        (await ctx.db.select(accountsTable).all()).map(a => a.name)
      ).toEqual(["Dana Reyes"]);
      const bound = await core.secrets.peekToken({
        purpose: PURPOSES.signUpBrowser,
        token: taken.browserToken,
      });
      expect(bound.ok && bound.subject.startsWith("unbound-")).toBe(true);

      const [notice] = mail.ofKind("sign-up-taken");
      expect(notice).toMatchObject({
        to: "Dana@Example.com",
        deactivated: false,
      });
      expect(notice?.signInLink).toBe(`${TEST_ORIGIN}/account/sign-in`);
      expect(notice?.resetLink).toBe(`${TEST_ORIGIN}/account/reset`);
    });

    it("hashes the password for a taken address too, so it costs what a free one does", async () => {
      const { deps, core } = await boot();
      const hash = vi.spyOn(core.passwords, "hash");
      accepted(await signUp(deps, dana));
      accepted(await signUp(deps, dana));

      expect(hash).toHaveBeenCalledTimes(2);
    });

    it("tells a deactivated account's address to contact the site", async () => {
      const { ctx, deps, mail } = await boot();
      accepted(await signUp(deps, dana));
      const account = await accountByAddress(ctx.db, dana.address);
      if (account === null) throw new Error("expected the account");
      await writeAtVersion(
        ctx.db,
        account,
        { deactivatedAt: new Date() },
        { endsSessions: true }
      );

      accepted(await signUp(deps, dana));
      expect(mail.ofKind("sign-up-taken")[0]?.deactivated).toBe(true);
    });

    it("keeps the browser that signed up when it signs up again before verifying", async () => {
      const { deps } = await boot();
      const first = accepted(await signUp(deps, dana));
      const again = accepted(
        await signUp(deps, { ...dana, browserToken: first.browserToken })
      );

      expect(again.browserToken).toBe(first.browserToken);
    });

    it("never lets another browser's sign-up take the binding", async () => {
      const { deps, core } = await boot();
      accepted(await signUp(deps, dana));
      const other = accepted(
        await signUp(deps, { ...dana, address: "lee@example.com" })
      );
      const stranger = accepted(
        await signUp(deps, { ...dana, browserToken: other.browserToken })
      );

      expect(stranger.browserToken).not.toBe(other.browserToken);
      const bound = await core.secrets.peekToken({
        purpose: PURPOSES.signUpBrowser,
        token: stranger.browserToken,
      });
      expect(bound.ok && bound.subject.startsWith("unbound-")).toBe(true);
    });

    it("refuses a password under the minimum or a common one, saying why, and creates nothing", async () => {
      const { ctx, deps, mail } = await boot();

      expect(await signUp(deps, { ...dana, password: "short" })).toEqual({
        status: "refused",
        reason: "too-short",
      });
      expect(await signUp(deps, { ...dana, password: "password1" })).toEqual({
        status: "refused",
        reason: "common",
      });
      expect(await accountByAddress(ctx.db, dana.address)).toBeNull();
      expect(mail.queued).toEqual([]);
    });

    it("accepts a long password of one kind of character", async () => {
      const { deps } = await boot();
      accepted(
        await signUp(deps, {
          ...dana,
          password: "abcdefghijklmnopqrstuvwxyz".repeat(3),
        })
      );
    });

    it("refuses a breached password where the site checks, and accepts it unchecked, logged, when the source is down", async () => {
      const { deps, core, warnings } = await boot({
        breachedPasswordCheck: true,
      });
      core.passwords.breached.add(dana.password);

      expect(await signUp(deps, dana)).toEqual({
        status: "refused",
        reason: "breached",
      });
      core.passwords.breachedSourceUp = false;
      accepted(await signUp(deps, dana));
      expect(warnings).toEqual([expect.stringContaining("went unchecked")]);
    });

    it("refuses a blank name and an address that is not one", async () => {
      const { deps } = await boot();
      expect(await signUp(deps, { ...dana, name: "   " })).toEqual({
        status: "refused",
        reason: "invalid-name",
      });
      expect(
        await signUp(deps, { ...dana, address: "not an address" })
      ).toEqual({
        status: "refused",
        reason: "invalid-address",
      });
    });

    it("makes one account of two sign-ups racing for one address, and answers both alike", async () => {
      const { ctx, deps, mail } = await boot();
      const results = await Promise.all([
        signUp(deps, dana),
        signUp(deps, { ...dana, address: "dana@EXAMPLE.com" }),
      ]);

      expect(results.map(result => result.status)).toEqual([
        "accepted",
        "accepted",
      ]);
      expect(await ctx.db.select(accountsTable).all()).toHaveLength(1);
      expect(mail.queued.map(email => email.kind).sort()).toEqual([
        "sign-up-taken",
        "verify-address",
      ]);
    });

    it("refuses a fourth sign-up for one address in 15 minutes, however it is cased, with its wait", async () => {
      const { deps, core } = await boot();
      for (const address of [
        "dana@example.com",
        "DANA@example.com",
        " Dana@Example.com ",
      ]) {
        accepted(
          await signUp(deps, {
            ...dana,
            address,
            client: `198.51.100.${address.length}`,
          })
        );
      }

      const refused = await signUp(deps, { ...dana, client: "198.51.100.200" });
      expect(refused).toMatchObject({
        status: "refused",
        reason: "too-many-requests",
      });
      expect(
        refused.status === "refused" && "retryAfterMs" in refused
          ? refused.retryAfterMs
          : 0
      ).toBeGreaterThan(0);
      core.clock.advance(15 * 60_000);
      accepted(await signUp(deps, { ...dana, client: "198.51.100.200" }));
    });

    it("refuses a client's twenty-first sign-up in 15 minutes, whatever addresses it names", async () => {
      const { deps } = await boot();
      for (let n = 0; n < 20; n += 1) {
        accepted(
          await signUp(deps, { ...dana, address: `visitor${n}@example.com` })
        );
      }

      expect(
        await signUp(deps, { ...dana, address: "another@example.com" })
      ).toMatchObject({
        status: "refused",
        reason: "too-many-requests",
      });
    });

    it("holds a client whose address cannot be read to the address's limit alone", async () => {
      const { deps } = await boot();
      for (let n = 0; n < 25; n += 1) {
        accepted(
          await signUp(deps, {
            ...dana,
            address: `visitor${n}@example.com`,
            client: null,
          })
        );
      }
    });

    it("makes nothing and sends nothing while the limit store does not answer", async () => {
      const { ctx, deps, core, mail } = await boot();
      core.limits.available = false;

      expect(await signUp(deps, dana)).toEqual({
        status: "refused",
        reason: "try-again",
      });
      expect(await accountByAddress(ctx.db, dana.address)).toBeNull();
      expect(mail.queued).toEqual([]);
    });

    it("counts no request for a password the local rules refuse", async () => {
      const { deps } = await boot();
      for (let n = 0; n < 5; n += 1) {
        expect(
          await signUp(deps, { ...dana, password: "short" })
        ).toMatchObject({ reason: "too-short" });
      }
      accepted(await signUp(deps, dana));
    });

    it("builds every link on the configured origin and pages", async () => {
      const { deps, mail } = await boot({
        pages: { verify: "/confirm-email" },
      });
      accepted(await signUp(deps, dana));

      expect(
        mail
          .ofKind("verify-address")[0]
          ?.link.startsWith(`${TEST_ORIGIN}/confirm-email?token=`)
      ).toBe(true);
    });
  }
);
