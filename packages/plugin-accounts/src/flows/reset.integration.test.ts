/**
 * Completing a password reset on each dialect: what it ends, voids,
 * forgets and marks, and the races it must lose or win.
 *
 * @module flows/reset.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import type { AccountsOptions } from "../settings";

import {
  knownBrowsers,
  pendingAddressChanges,
  sessions,
} from "../schema/tables";
import {
  accountById,
  recordFailedPassword,
  writeAtVersion,
} from "../storage/accounts";
import {
  knownBrowserOf,
  makeAccount,
  TEST_PASSWORD,
} from "../test-support/accounts";
import { bootAccounts } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";

import { completePasswordReset } from "./reset";
import { requestPasswordReset } from "./reset-request";
import { signIn } from "./sign-in";

const NEW_PASSWORD = "a brand new passphrase";
const HOUR = 60 * 60 * 1000;

describe.each(getConfiguredTestDialects())(
  "completing a password reset (%s)",
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
      const resetLink = async (address: string) => {
        await requestPasswordReset(made.deps, { address, client: null });
        const email = made.mail.ofKind("reset-password").at(-1);
        const token =
          email === undefined
            ? null
            : new URL(email.link).searchParams.get("token");
        if (token === null) throw new Error("expected a reset link");
        return token;
      };
      const signsIn = async (
        password: string,
        knownTokens: string[] = [],
        client: string | null = null
      ) =>
        (
          await signIn(made.deps, {
            address: "dana@example.com",
            password,
            client,
            knownTokens,
          })
        ).status;
      return { db: booted.ctx.db, ...made, resetLink, signsIn };
    }

    it("sets the password, ends every session, voids every other link, cancels a pending change, and signs nobody in", async () => {
      const { db, deps, core, mail, resetLink, signsIn } = await boot();
      const id = await makeAccount(deps, "dana@example.com");
      await knownBrowserOf(deps, "dana@example.com");
      const other = await resetLink("dana@example.com");
      const token = await resetLink("dana@example.com");
      await db.insert(pendingAddressChanges, {
        accountId: id,
        newAddress: "new@example.com",
        newAddressNormalised: "new@example.com",
        expiresAt: new Date(Date.now() + HOUR),
      });

      expect(
        await completePasswordReset(deps, { token, password: NEW_PASSWORD })
      ).toMatchObject({ status: "reset" });
      expect(await db.select(sessions).all()).toEqual([]);
      expect(await db.select(pendingAddressChanges).all()).toEqual([]);
      expect(
        await completePasswordReset(deps, {
          token: other,
          password: NEW_PASSWORD,
        })
      ).toMatchObject({
        status: "refused",
      });
      expect(await signsIn(TEST_PASSWORD)).toBe("refused");
      expect(await signsIn(NEW_PASSWORD)).toBe("signed-in");
      expect(mail.ofKind("password-changed").map(email => email.to)).toEqual([
        "dana@example.com",
      ]);
      expect(
        await core.secrets.peekToken({ purpose: "reset", token: other })
      ).toMatchObject({ ok: false });
    });

    it("forgets every browser known before but the one that reset, which then signs in past the waits", async () => {
      const { db, deps, core, resetLink, signsIn } = await boot();
      const id = await makeAccount(deps, "dana@example.com");
      const before = await knownBrowserOf(deps, "dana@example.com");
      for (let n = 0; n < 6; n += 1)
        await signsIn("wrong", [], `198.51.100.${n}`);
      expect(await signsIn(NEW_PASSWORD, [], "203.0.113.1")).toBe("refused");

      const result = await completePasswordReset(deps, {
        token: await resetLink("dana@example.com"),
        password: NEW_PASSWORD,
      });
      if (result.status !== "reset")
        throw new Error("expected the reset to complete");
      const known = await db.select(knownBrowsers).all();
      expect(known.map(row => row.tokenHash)).toEqual([
        core.opaque.hash(result.knownBrowserToken),
      ]);
      expect(known.map(row => row.accountId)).toEqual([id]);
      expect(core.opaque.hash(before)).not.toBe(known[0]?.tokenHash);
      // The address\'s waits have ended: a browser it has never seen signs in.

      expect(await signsIn(NEW_PASSWORD, [], "203.0.113.2")).toBe("signed-in");

      // And the browser that reset is known.
      expect(
        await signsIn(NEW_PASSWORD, [result.knownBrowserToken], "203.0.113.1")
      ).toBe("signed-in");
    });

    it("keeps the completing browser's own token, starting its count again", async () => {
      const { db, deps, core, resetLink } = await boot();
      await makeAccount(deps, "dana@example.com");
      const own = await knownBrowserOf(deps, "dana@example.com");

      expect(
        await completePasswordReset(deps, {
          token: await resetLink("dana@example.com"),
          password: NEW_PASSWORD,
          knownTokens: [own],
        })
      ).toEqual({ status: "reset", knownBrowserToken: own });
      expect(
        (await db.select(knownBrowsers).all()).map(row => [
          row.tokenHash,
          row.failuresInARow,
        ])
      ).toEqual([[core.opaque.hash(own), 0]]);
    });

    it("clears the reset-required state and the failures, and verifies an unverified address", async () => {
      const { db, deps, resetLink } = await boot();
      const id = await makeAccount(deps, "dana@example.com", {
        verified: false,
      });
      const checked = {
        id,
        securityVersion: (await accountById(db, id))?.securityVersion ?? -1,
      };
      for (let n = 0; n < 10; n += 1)
        await recordFailedPassword(db, checked, deps.now(), 10);

      await completePasswordReset(deps, {
        token: await resetLink("dana@example.com"),
        password: NEW_PASSWORD,
      });
      expect(await accountById(db, id)).toMatchObject({
        failuresInARow: 0,
        resetRequiredAt: null,
        verifiedBy: "reset",
      });
    });

    it("refuses a link for an account deactivated since it was sent", async () => {
      const { db, deps, resetLink } = await boot();
      const id = await makeAccount(deps, "dana@example.com");
      const token = await resetLink("dana@example.com");
      const account = await accountById(db, id);
      if (account === null) throw new Error("expected the account");
      await writeAtVersion(
        db,
        account,
        { deactivatedAt: new Date() },
        { endsSessions: true }
      );

      expect(
        await completePasswordReset(deps, { token, password: NEW_PASSWORD })
      ).toEqual({
        status: "refused",
        reason: "deactivated",
      });
    });

    it("lets only one of two uses of one link succeed, even at once", async () => {
      const { deps, resetLink } = await boot();
      await makeAccount(deps, "dana@example.com");
      const token = await resetLink("dana@example.com");

      const results = await Promise.all([
        completePasswordReset(deps, { token, password: NEW_PASSWORD }),
        completePasswordReset(deps, {
          token,
          password: "another new passphrase",
        }),
      ]);
      expect(results.filter(result => result.status === "reset")).toHaveLength(
        1
      );
    });

    it("refuses a new password the rules refuse, keeping the link", async () => {
      const { deps, resetLink } = await boot();
      await makeAccount(deps, "dana@example.com");
      const token = await resetLink("dana@example.com");

      expect(
        await completePasswordReset(deps, { token, password: "short" })
      ).toEqual({ status: "refused", reason: "too-short" });
      expect(
        await completePasswordReset(deps, { token, password: NEW_PASSWORD })
      ).toMatchObject({ status: "reset" });
    });

    it("counts each breached-password lookup against the account, so one link cannot ask the source without limit", async () => {
      const { core, deps, resetLink } = await boot({
        breachedPasswordCheck: true,
      });
      await makeAccount(deps, "dana@example.com");
      const token = await resetLink("dana@example.com");
      core.passwords.breached.add("a breached passphrase");

      for (let n = 0; n < 10; n += 1)
        expect(
          await completePasswordReset(deps, {
            token,
            password: "a breached passphrase",
          })
        ).toEqual({ status: "refused", reason: "breached" });
      expect(
        await completePasswordReset(deps, { token, password: NEW_PASSWORD })
      ).toMatchObject({ status: "refused", reason: "too-many-requests" });
    });

    it("writes nothing when a change that ends sessions commits while it runs, and keeps the link", async () => {
      const { db, deps, resetLink, signsIn } = await boot();
      const id = await makeAccount(deps, "dana@example.com");
      const token = await resetLink("dana@example.com");
      const raced = {
        ...deps,
        core: {
          ...deps.core,
          passwords: {
            ...deps.core.passwords,
            ceiling: deps.core.passwords.ceiling,
            check: deps.core.passwords.check.bind(deps.core.passwords),
            verify: deps.core.passwords.verify.bind(deps.core.passwords),
            needsRehash: deps.core.passwords.needsRehash.bind(
              deps.core.passwords
            ),
            hash: async (password: string) => {
              const fresh = await accountById(db, id);
              if (fresh !== null)
                await writeAtVersion(db, fresh, {}, { endsSessions: true });
              return deps.core.passwords.hash(password);
            },
          },
        },
      };

      expect(
        await completePasswordReset(raced, { token, password: NEW_PASSWORD })
      ).toEqual({
        status: "refused",
        reason: "try-again",
      });
      expect(await signsIn(TEST_PASSWORD)).toBe("signed-in");
      expect(
        await completePasswordReset(deps, { token, password: NEW_PASSWORD })
      ).toMatchObject({ status: "reset" });
    });
  }
);
