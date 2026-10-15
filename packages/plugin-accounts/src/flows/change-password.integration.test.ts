/**
 * The holder changing their password, on each dialect.
 *
 * @module flows/change-password.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  accounts,
  knownBrowsers,
  pendingAddressChanges,
} from "../schema/tables";
import { accountById, writeAtVersion } from "../storage/accounts";
import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import { bootAccounts } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { commitBeforeFirstRead } from "../test-support/race";

import { changePassword } from "./change-password";
import { completePasswordReset } from "./reset";
import { requestPasswordReset } from "./reset-request";
import { sessionAccount, signOut } from "./sessions";
import { signIn, type SignInResult } from "./sign-in";
import { runStaffAction } from "./staff-actions";

const NEW_PASSWORD = "a brand new passphrase";
const HOUR = 60 * 60 * 1000;

function signedIn(result: SignInResult) {
  if (result.status !== "signed-in")
    throw new Error(`expected signed-in, got ${JSON.stringify(result)}`);
  return result;
}

describe.each(getConfiguredTestDialects())(
  "changing the password (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot() {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const made = flowDeps(booted.ctx);
      const id = await makeAccount(made.deps, "dana@example.com");
      const browser = async (
        password = TEST_PASSWORD,
        knownTokens: string[] = []
      ) =>
        signedIn(
          await signIn(made.deps, {
            address: "dana@example.com",
            password,
            client: null,
            knownTokens,
          })
        );
      const change = (
        sessionToken: string,
        currentPassword: string,
        extra: { knownTokens?: string[]; newPassword?: string } = {}
      ) =>
        changePassword(made.deps, {
          sessionToken,
          currentPassword,
          newPassword: extra.newPassword ?? NEW_PASSWORD,
          client: null,
          knownTokens: extra.knownTokens ?? [],
        });
      return { db: booted.ctx.db, ...made, id, browser, change };
    }

    it("sets the password, keeps this session and browser, and ends, voids, cancels and forgets the rest", async () => {
      const { db, deps, core, mail, id, browser, change } = await boot();
      const here = await browser();
      const elsewhere = await browser();
      await requestPasswordReset(deps, {
        address: "dana@example.com",
        client: null,
      });
      const resetEmail = mail.ofKind("reset-password")[0];
      const resetToken =
        new URL(resetEmail?.link ?? "").searchParams.get("token") ?? "";
      await db.insert(pendingAddressChanges, {
        accountId: id,
        newAddress: "new@example.com",
        newAddressNormalised: "new@example.com",
        expiresAt: new Date(Date.now() + HOUR),
      });

      expect(
        await change(here.session.token, TEST_PASSWORD, {
          knownTokens: [here.knownBrowserToken],
        })
      ).toEqual({
        status: "changed",
      });
      expect(
        await sessionAccount(deps, { sessionToken: here.session.token })
      ).not.toBeNull();
      expect(
        await sessionAccount(deps, { sessionToken: elsewhere.session.token })
      ).toBeNull();
      expect(
        await completePasswordReset(deps, {
          token: resetToken,
          password: "yet another passphrase",
        })
      ).toMatchObject({
        status: "refused",
      });
      expect(await db.select(pendingAddressChanges).all()).toEqual([]);
      expect(
        (await db.select(knownBrowsers).all()).map(row => row.tokenHash)
      ).toEqual([core.opaque.hash(here.knownBrowserToken)]);
      expect(mail.ofKind("password-changed").map(email => email.to)).toEqual([
        "dana@example.com",
      ]);
      expect(
        (
          await signIn(deps, {
            address: "dana@example.com",
            password: TEST_PASSWORD,
            client: null,
          })
        ).status
      ).toBe("refused");
      await browser(NEW_PASSWORD);
      expect((await accountById(db, id))?.passwordChangedAt).toBeInstanceOf(
        Date
      );
    });

    it("counts a wrong current password as a failed sign-in, changing nothing", async () => {
      const { db, id, browser, change } = await boot();
      const { session } = await browser();

      expect(await change(session.token, "wrong")).toEqual({
        status: "refused",
        reason: "wrong-credentials",
      });
      expect((await accountById(db, id))?.failuresInARow).toBe(1);
      for (let n = 0; n < 4; n += 1) await change(session.token, "wrong");
      expect(await change(session.token, TEST_PASSWORD)).toMatchObject({
        status: "refused",
        reason: "wait",
      });
      expect((await accountById(db, id))?.passwordChangedAt).toBeNull();
    });

    it("settles a proven current password even when the new one is refused, so mistakes never make the holder wait", async () => {
      const { db, id, browser, change } = await boot();
      const { session } = await browser();

      for (let n = 0; n < 7; n += 1)
        expect(
          await change(session.token, TEST_PASSWORD, { newPassword: "short" })
        ).toMatchObject({ reason: "too-short" });
      expect(await change(session.token, TEST_PASSWORD)).toEqual({
        status: "changed",
      });
      expect((await accountById(db, id))?.failuresInARow).toBe(0);
    });

    it("starts the browser's own token's count again once the current password is proven", async () => {
      const { browser, change } = await boot();
      const { session, knownBrowserToken } = await browser();
      const knownTokens = [knownBrowserToken];

      for (let n = 0; n < 12; n += 1)
        expect(
          await change(session.token, TEST_PASSWORD, {
            knownTokens,
            newPassword: "short",
          })
        ).toMatchObject({ reason: "too-short" });
      expect(
        await change(session.token, TEST_PASSWORD, { knownTokens })
      ).toEqual({ status: "changed" });
    });

    it("clears the reset-required state, as a reset does, so the new password signs in anywhere", async () => {
      const { db, id, browser, change } = await boot();
      const { session } = await browser();
      const account = await accountById(db, id);
      if (account === null) throw new Error("expected the account");
      await writeAtVersion(db, account, { resetRequiredAt: new Date() });

      expect(await change(session.token, TEST_PASSWORD)).toEqual({
        status: "changed",
      });
      expect((await accountById(db, id))?.resetRequiredAt).toBeNull();
    });

    it("signs out a holder whose session staff ended between its two reads, changing nothing", async () => {
      const { db, deps, id, browser } = await boot();
      const { session } = await browser();
      // Staff end the account's sessions after the session is read and
      // before the account is: the account read carries the moved version.
      const raced = {
        ...deps,
        db: commitBeforeFirstRead(deps.db, accounts, () =>
          runStaffAction(deps, "end-sessions", id)
        ),
      };

      expect(
        await changePassword(raced, {
          sessionToken: session.token,
          currentPassword: TEST_PASSWORD,
          newPassword: NEW_PASSWORD,
          client: null,
          knownTokens: [],
        })
      ).toEqual({ status: "signed-out" });
      expect((await accountById(db, id))?.passwordChangedAt).toBeNull();
    });

    it("refuses a new password the rules refuse, and a session that has ended", async () => {
      const { deps, browser, change } = await boot();
      const { session } = await browser();

      expect(
        await change(session.token, TEST_PASSWORD, { newPassword: "short" })
      ).toEqual({
        status: "refused",
        reason: "too-short",
      });
      await signOut(deps, { sessionToken: session.token });
      expect(await change(session.token, TEST_PASSWORD)).toEqual({
        status: "signed-out",
      });
    });
  }
);
