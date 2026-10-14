/**
 * Sign-in on each dialect, against the fake core: the address's and the
 * client's waits, the owner's known browser, refusals that must look like a
 * wrong password, the account's failures in a row, and the session.
 *
 * @module flows/sign-in.integration.test
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import type { AccountsOptions } from "../settings";
import {
  accountByAddress,
  accountById,
  claimResetRequiredEmail,
  createAccount,
  recordFailedPassword,
  writeAtVersion,
} from "../storage/accounts";
import { liveKnownBrowsers } from "../storage/known-browsers";
import { liveSession } from "../storage/sessions";
import { bootAccounts } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";

import { signIn, type SignInResult } from "./sign-in";

const PASSWORD = "a long passphrase";
const SECOND = 1000;

function signedIn(result: SignInResult) {
  if (result.status !== "signed-in")
    throw new Error(`expected signed-in, got ${JSON.stringify(result)}`);
  return result;
}

describe.each(getConfiguredTestDialects())(
  "sign-in (%s)",
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
      const db: PluginContext["db"] = booted.ctx.db;
      /** An account with the password, verified unless told otherwise. */
      const account = async (
        address: string,
        state: { verified?: boolean; deactivated?: boolean } = {}
      ) => {
        const created = await createAccount(db, dialect, {
          address,
          name: "A",
          passwordHash: await made.core.passwords.hash(PASSWORD),
        });
        if (created.status !== "created")
          throw new Error("expected an account");
        await writeAtVersion(db, created.account, {
          verifiedAt: state.verified === false ? null : new Date(),
          deactivatedAt: state.deactivated === true ? new Date() : null,
        });
        return created.account.id;
      };
      const attempt = (
        address: string,
        password: string,
        extra: { client?: string | null; knownTokens?: string[] } = {}
      ) =>
        signIn(made.deps, {
          address,
          password,
          client: "203.0.113.9",
          ...extra,
        });
      return { db, ...made, account, attempt };
    }

    it("signs a verified account in with a new session, and marks the browser known", async () => {
      const { db, deps, core, account, attempt } = await boot();
      const id = await account("dana@example.com");
      const result = signedIn(await attempt(" DANA@example.com", PASSWORD));

      expect(
        (
          await liveSession(
            db,
            core.opaque.hash(result.session.token),
            deps.now()
          )
        )?.accountId
      ).toBe(id);
      expect(
        (
          await liveKnownBrowsers(
            db,
            [core.opaque.hash(result.knownBrowserToken)],
            deps.now(),
            90
          )
        ).map(row => row.accountId)
      ).toEqual([id]);
      expect((await accountById(db, id))?.lastSignedInAt).toBeInstanceOf(Date);
      const again = signedIn(
        await attempt("dana@example.com", PASSWORD, {
          knownTokens: [result.knownBrowserToken],
        })
      );
      expect(again.session.token).not.toBe(result.session.token);
      expect(again.knownBrowserToken).toBe(result.knownBrowserToken);
    });

    it("answers a wrong password and an unknown address alike, each after one password check", async () => {
      const { account, attempt, pacing } = await boot();
      await account("dana@example.com");

      expect(await attempt("dana@example.com", "wrong")).toEqual({
        status: "refused",
        reason: "wrong-credentials",
      });
      expect(await attempt("nobody@example.com", PASSWORD)).toEqual({
        status: "refused",
        reason: "wrong-credentials",
      });
      expect(pacing.checks).toBe(2);
    });

    it("says an account is unverified or deactivated only once its password is proven", async () => {
      const { account, attempt } = await boot();
      await account("new@example.com", { verified: false });
      await account("gone@example.com", { deactivated: true });

      expect(await attempt("new@example.com", "wrong")).toMatchObject({
        reason: "wrong-credentials",
      });
      expect(await attempt("new@example.com", PASSWORD)).toEqual({
        status: "refused",
        reason: "unverified",
      });
      expect(await attempt("gone@example.com", "wrong")).toMatchObject({
        reason: "wrong-credentials",
      });
      expect(await attempt("gone@example.com", PASSWORD)).toEqual({
        status: "refused",
        reason: "deactivated",
      });
    });

    it("signs an unverified account in where the site lets it", async () => {
      const { account, attempt } = await boot({ verificationRequired: false });
      await account("new@example.com", { verified: false });
      signedIn(await attempt("new@example.com", PASSWORD));
    });

    it("lets five failures for an address run free, then waits, never counting a refused attempt", async () => {
      const { db, core, account, attempt } = await boot();
      const id = await account("dana@example.com");
      for (let n = 0; n < 5; n += 1)
        expect(
          await attempt("dana@example.com", "wrong", {
            client: `198.51.100.${n}`,
          })
        ).toMatchObject({ reason: "wrong-credentials" });

      expect(
        await attempt("dana@example.com", PASSWORD, { client: "198.51.100.9" })
      ).toEqual({
        status: "refused",
        reason: "wait",
        retryAfterMs: SECOND,
      });
      expect((await accountById(db, id))?.failuresInARow).toBe(5);
      core.clock.advance(SECOND);
      expect(
        await attempt("dana@example.com", "wrong", { client: "198.51.100.9" })
      ).toMatchObject({ reason: "wrong-credentials" });
      expect(
        await attempt("dana@example.com", PASSWORD, { client: "198.51.100.9" })
      ).toMatchObject({ retryAfterMs: 2 * SECOND });
      core.clock.advance(2 * SECOND);

      // A sign-in ends the address's waits.
      signedIn(
        await attempt("dana@example.com", PASSWORD, { client: "198.51.100.9" })
      );
      expect(
        await attempt("dana@example.com", "wrong", { client: "198.51.100.9" })
      ).toMatchObject({ reason: "wrong-credentials" });
    });

    it("makes a client wait from its twentieth failure, whatever addresses it names", async () => {
      const { attempt } = await boot();
      for (let n = 0; n < 20; n += 1)
        await attempt(`nobody${n}@example.com`, "wrong");

      expect(await attempt("another@example.com", "wrong")).toMatchObject({
        status: "refused",
        reason: "wait",
      });
    });

    it("counts a client's refused attempts too, so its next wait is longer", async () => {
      const { core, attempt } = await boot();
      for (let n = 0; n < 20; n += 1)
        await attempt(`nobody${n}@example.com`, "wrong");
      for (let n = 0; n < 4; n += 1)
        expect(await attempt(`more${n}@example.com`, "wrong")).toMatchObject({
          reason: "wait",
        });
      core.clock.advance(SECOND);

      expect(await attempt("late@example.com", "wrong")).toMatchObject({
        reason: "wrong-credentials",
      });
      expect(await attempt("later@example.com", "wrong")).toMatchObject({
        reason: "wait",
        retryAfterMs: 32 * SECOND,
      });
    });

    it("gives a client back a sign-in that succeeds", async () => {
      const { account, attempt } = await boot();
      await account("dana@example.com");
      for (let n = 0; n < 19; n += 1)
        await attempt(`nobody${n}@example.com`, "wrong");
      signedIn(await attempt("dana@example.com", PASSWORD));

      expect(await attempt("nobody@example.com", "wrong")).toMatchObject({
        reason: "wrong-credentials",
      });
      expect(await attempt("nobody2@example.com", "wrong")).toMatchObject({
        reason: "wait",
      });
    });

    it("never counts toward the address an attempt from a waiting client, even one the owner's token lets through", async () => {
      const { account, attempt } = await boot();
      await account("dana@example.com");
      const { knownBrowserToken } = signedIn(
        await attempt("dana@example.com", PASSWORD, { client: "192.0.2.1" })
      );
      for (let n = 0; n < 4; n += 1)
        await attempt("dana@example.com", "wrong", {
          client: `198.51.100.${n}`,
        });
      for (let n = 0; n < 20; n += 1)
        await attempt(`nobody${n}@example.com`, "wrong");

      // The copied cookie's probe from the waiting client is checked, but leaves the address at four.
      expect(
        await attempt("dana@example.com", "wrong", {
          knownTokens: [knownBrowserToken],
        })
      ).toMatchObject({
        reason: "wrong-credentials",
      });
      expect(
        await attempt("dana@example.com", "wrong", { client: "198.51.100.50" })
      ).toMatchObject({
        reason: "wrong-credentials",
      });
      expect(
        await attempt("dana@example.com", "wrong", { client: "198.51.100.51" })
      ).toMatchObject({ reason: "wait" });
    });

    it("lets the owner's known browser past the address's and the client's waits", async () => {
      const { account, attempt } = await boot();
      await account("dana@example.com");
      const { knownBrowserToken } = signedIn(
        await attempt("dana@example.com", PASSWORD)
      );
      for (let n = 0; n < 25; n += 1)
        await attempt("dana@example.com", "wrong", { client: "192.0.2.66" });

      expect(
        await attempt("dana@example.com", "wrong", { client: "192.0.2.66" })
      ).toMatchObject({ reason: "wait" });
      signedIn(
        await attempt("dana@example.com", PASSWORD, {
          client: "192.0.2.66",
          knownTokens: [knownBrowserToken],
        })
      );
    });

    it("answers a wait's refusal as a wrong password, computing nothing, when the attempt carries a valid token", async () => {
      const { account, attempt, pacing } = await boot();
      await account("dana@example.com");
      await account("lee@example.com");
      const { knownBrowserToken } = signedIn(
        await attempt("lee@example.com", PASSWORD, { client: "192.0.2.1" })
      );
      for (let n = 0; n < 20; n += 1)
        await attempt(`nobody${n}@example.com`, "wrong");
      const checks = pacing.checks;

      // While the client waits, a copied cookie probes its own account's address, another's and none: one answer.
      for (const address of [
        "dana@example.com",
        "lee@example.com",
        "nobody-at-all@example.com",
      ]) {
        expect(
          await attempt(address, "wrong", { knownTokens: [knownBrowserToken] })
        ).toEqual({
          status: "refused",
          reason: "wrong-credentials",
        });
      }
      // Its own account's address was checked; the two the client's wait refused took a check's time instead.
      expect(pacing.checks).toBe(checks + 1);
      expect(pacing.waits).toBe(2);
    });

    it("charges every token the cookie carries, and a sign-in starts only its own account's count again", async () => {
      const { db, core, deps, account, attempt } = await boot();
      await account("dana@example.com");
      await account("lee@example.com");
      const dana = signedIn(
        await attempt("dana@example.com", PASSWORD)
      ).knownBrowserToken;
      const lee = signedIn(
        await attempt("lee@example.com", PASSWORD)
      ).knownBrowserToken;
      const failures = async (token: string) =>
        (
          await liveKnownBrowsers(db, [core.opaque.hash(token)], deps.now(), 90)
        )[0]?.failuresInARow;

      await attempt("nobody@example.com", PASSWORD, {
        knownTokens: [dana, lee],
      });
      expect([await failures(dana), await failures(lee)]).toEqual([1, 1]);
      signedIn(
        await attempt("dana@example.com", PASSWORD, {
          knownTokens: [dana, lee],
        })
      );
      expect([await failures(dana), await failures(lee)]).toEqual([0, 2]);
    });

    it("holds a token past its cap to one check a minute for its own account, from the later of its cap and its last failed check", async () => {
      const { core, account, attempt, pacing } = await boot();
      await account("dana@example.com");
      const { knownBrowserToken } = signedIn(
        await attempt("dana@example.com", PASSWORD)
      );
      const withToken = {
        client: "192.0.2.1",
        knownTokens: [knownBrowserToken],
      };
      for (let n = 0; n < 10; n += 1)
        await attempt("dana@example.com", "wrong", withToken);
      core.clock.advance(10 * SECOND);
      const checks = pacing.checks;

      expect(
        await attempt("dana@example.com", PASSWORD, withToken)
      ).toMatchObject({ reason: "wrong-credentials" });
      expect(pacing.checks).toBe(checks);
      core.clock.advance(50 * SECOND);
      signedIn(await attempt("dana@example.com", PASSWORD, withToken));
    });

    it("refuses a browser it does not know once the account needs a reset, and lets a known one in", async () => {
      const { db, deps, account, attempt } = await boot({
        failuresBeforeReset: 10,
      });
      const id = await account("dana@example.com");
      const { knownBrowserToken } = signedIn(
        await attempt("dana@example.com", PASSWORD)
      );
      const checked = {
        id,
        securityVersion: (await accountById(db, id))?.securityVersion ?? -1,
      };
      for (let n = 0; n < 10; n += 1)
        await recordFailedPassword(db, checked, deps.now(), 10);
      expect((await accountById(db, id))?.resetRequiredAt).toBeInstanceOf(Date);

      expect(
        await attempt("dana@example.com", PASSWORD, { client: "192.0.2.7" })
      ).toMatchObject({
        reason: "wrong-credentials",
      });
      signedIn(
        await attempt("dana@example.com", PASSWORD, {
          knownTokens: [knownBrowserToken],
        })
      );
    });

    it("emails a reset link when the account reaches its threshold, and at most once a day after", async () => {
      const { core, mail, account, attempt } = await boot({
        failuresBeforeReset: 10,
      });
      await account("dana@example.com");
      const fail = async () => {
        await attempt("dana@example.com", "wrong");
        core.clock.advance(60 * SECOND);
      };
      for (let n = 0; n < 9; n += 1) await fail();
      expect(mail.ofKind("reset-required")).toEqual([]);

      await fail();
      const [email] = mail.ofKind("reset-required");
      expect(email?.to).toBe("dana@example.com");
      expect(new URL(email?.link ?? "").pathname).toBe("/account/reset");
      await fail();
      expect(mail.ofKind("reset-required")).toHaveLength(1);
      core.clock.advance(24 * 60 * 60 * SECOND);
      await fail();
      expect(mail.ofKind("reset-required")).toHaveLength(2);
    });

    it("never emails a deactivated account a reset link, and one of two claims at once wins", async () => {
      const { db, deps, mail, account } = await boot({
        failuresBeforeReset: 10,
      });
      const id = await account("gone@example.com", { deactivated: true });
      for (let n = 0; n < 10; n += 1) {
        await signIn(deps, {
          address: "gone@example.com",
          password: "wrong",
          client: null,
        });
        await deps.core.limits.reset({
          rule: "sign-in-address",
          key: "gone@example.com",
        });
      }
      expect(mail.ofKind("reset-required")).toEqual([]);

      const claims = await Promise.all([
        claimResetRequiredEmail(db, id, deps.now()),
        claimResetRequiredEmail(db, id, deps.now()),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
    });

    it("re-hashes a password stored at an older setting", async () => {
      const { db, core, account, attempt } = await boot();
      const id = await account("dana@example.com");
      core.passwords.scheme = "fake2";
      signedIn(await attempt("dana@example.com", PASSWORD));

      expect(
        (await accountById(db, id))?.passwordHash?.startsWith("fake2$")
      ).toBe(true);
    });

    it("starts no session when a change that ends sessions commits while it runs", async () => {
      const { db, deps, account } = await boot();
      const id = await account("dana@example.com");
      const raced = {
        ...deps,
        pacer: {
          ...deps.pacer,
          verify: async (password: string, hash: string | null) => {
            const fresh = await accountById(db, id);
            if (fresh !== null)
              await writeAtVersion(db, fresh, {}, { endsSessions: true });
            return deps.pacer.verify(password, hash);
          },
        },
      };

      expect(
        await signIn(raced, {
          address: "dana@example.com",
          password: PASSWORD,
          client: null,
        })
      ).toEqual({
        status: "refused",
        reason: "try-again",
      });
      expect(
        (await accountByAddress(db, "dana@example.com"))?.lastSignedInAt
      ).toBeNull();
    });

    it("drops a wrong password checked against a password a reset replaced while it ran", async () => {
      const { db, deps, account } = await boot();
      const id = await account("dana@example.com");
      const raced = {
        ...deps,
        pacer: {
          ...deps.pacer,
          verify: async (password: string, hash: string | null) => {
            const fresh = await accountById(db, id);
            if (fresh !== null)
              await writeAtVersion(db, fresh, {}, { endsSessions: true });
            return deps.pacer.verify(password, hash);
          },
        },
      };

      expect(
        await signIn(raced, {
          address: "dana@example.com",
          password: "not the password",
          client: null,
        })
      ).toMatchObject({ reason: "wrong-credentials" });
      expect((await accountById(db, id))?.failuresInARow).toBe(0);
    });

    it("refuses while the limit store does not answer", async () => {
      const { core, account, attempt, pacing } = await boot();
      await account("dana@example.com");
      core.limits.available = false;

      expect(await attempt("dana@example.com", PASSWORD)).toEqual({
        status: "refused",
        reason: "try-again",
      });
      expect(pacing.checks).toBe(0);
    });
  }
);
