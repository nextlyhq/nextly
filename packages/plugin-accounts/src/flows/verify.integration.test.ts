/**
 * Verification on each dialect, against the fake core and fake mail: by link
 * and by code, only in the browser that signed up, each secret once, wrong
 * codes counted per address, and no verification outliving a change that
 * ends the account's sessions.
 *
 * @module flows/verify.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LIMIT_RULES } from "../core/limit-rules";
import { sessions } from "../schema/tables";
import type { AccountsOptions } from "../settings";
import {
  accountByAddress,
  writeAtVersion,
  type AccountRow,
} from "../storage/accounts";
import { liveSession } from "../storage/sessions";
import { bootAccounts } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { commitBeforeFirstTransaction } from "../test-support/race";

import type { AttemptRefusal } from "./password-attempt";
import { PURPOSES } from "./purposes";
import { signUp } from "./sign-up";
import {
  verifyByCode,
  verifyByCodeWithPassword,
  verifyByLink,
  verifyByLinkWithPassword,
  type VerifyResult,
} from "./verify";

const dana = {
  name: "Dana Reyes",
  address: "dana@example.com",
  password: "a long passphrase",
  client: "203.0.113.9" as string | null,
};
const MINUTE = 60_000;

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("expected a value");
  return value;
}

function verified(result: VerifyResult | AttemptRefusal) {
  if (result.status !== "verified")
    throw new Error(`expected verified, got ${JSON.stringify(result)}`);
  return result;
}

describe.each(getConfiguredTestDialects())(
  "verification (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Boot, sign Dana up, and hand back what the email and the browser hold. */
    async function signedUp(options: Partial<AccountsOptions> = {}) {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const { deps, core, mail } = flowDeps(booted.ctx, options);
      const answer = await signUp(deps, dana);
      if (answer.status !== "accepted")
        throw new Error("expected the sign-up to be accepted");
      const email = required(mail.ofKind("verify-address")[0]);
      const linkToken = required(new URL(email.link).searchParams.get("token"));
      const account = required(
        await accountByAddress(booted.ctx.db, dana.address)
      );
      const wrong = email.code === "000000" ? "000001" : "000000";
      return {
        db: booted.ctx.db,
        deps,
        core,
        mail,
        email,
        linkToken,
        account,
        browserToken: answer.browserToken,
        wrong,
      };
    }

    it("verifies by link in the browser that signed up, starts a session there, and voids the code", async () => {
      const { db, deps, core, email, linkToken, account, browserToken } =
        await signedUp();
      const result = verified(
        await verifyByLink(deps, { token: linkToken, browserToken })
      );

      expect(await accountByAddress(db, dana.address)).toMatchObject({
        verifiedBy: "link",
      });
      expect(
        (await accountByAddress(db, dana.address))?.verifiedAt
      ).toBeInstanceOf(Date);
      const session = required(result.session);
      expect(
        (await liveSession(db, core.opaque.hash(session.token), deps.now()))
          ?.accountId
      ).toBe(account.id);
      expect(
        await verifyByCode(deps, {
          address: dana.address,
          code: email.code,
          browserToken,
        })
      ).toEqual({
        status: "sign-in-needed",
      });
      // The verification voided the code, so there is no code to try, as
      // core answers it.
      expect(
        await core.secrets.consumeCode({
          purpose: PURPOSES.verifyCode,
          subject: account.id,
          code: email.code,
        })
      ).toEqual({
        ok: false,
        reason: "none",
      });
    });

    it("applies one of a link and a code used at once: the other finds the address verified", async () => {
      const { db, deps, email, linkToken, account, browserToken } =
        await signedUp();
      // The code is spent, then the link's verification commits before the
      // code's own transaction writes.
      const raced = {
        ...deps,
        db: commitBeforeFirstTransaction(deps.db, () =>
          verifyByLink(deps, { token: linkToken, browserToken })
        ),
      };

      expect(
        await verifyByCode(raced, {
          address: dana.address,
          code: email.code,
          browserToken,
        })
      ).toEqual({ status: "refused", reason: "spent" });
      expect(await accountByAddress(db, dana.address)).toMatchObject({
        verifiedBy: "link",
      });
      expect(
        (await db.select(sessions).all()).filter(
          row => row.accountId === account.id
        )
      ).toHaveLength(1);
    });

    it("spends a link once", async () => {
      const { deps, linkToken, browserToken } = await signedUp();
      verified(await verifyByLink(deps, { token: linkToken, browserToken }));

      expect(
        await verifyByLink(deps, { token: linkToken, browserToken })
      ).toEqual({ status: "refused", reason: "spent" });
    });

    it("refuses an expired link and one it never made", async () => {
      const { deps, core, linkToken, browserToken } = await signedUp();
      expect(
        await verifyByLink(deps, { token: "not-a-token", browserToken })
      ).toEqual({
        status: "refused",
        reason: "invalid",
      });
      core.clock.advance(24 * 60 * MINUTE);
      expect(
        await verifyByLink(deps, { token: linkToken, browserToken })
      ).toEqual({ status: "refused", reason: "expired" });
    });

    it("asks another browser to sign in, spending nothing, so the link still works where it signed up", async () => {
      const { db, deps, email, linkToken, browserToken } = await signedUp();

      expect(await verifyByLink(deps, { token: linkToken })).toEqual({
        status: "sign-in-needed",
      });
      // A browser that signed up for another account is another browser too.
      const lee = await signUp(deps, { ...dana, address: "lee@example.com" });
      const leeBrowser = lee.status === "accepted" ? lee.browserToken : "";
      expect(
        await verifyByLink(deps, { token: linkToken, browserToken: leeBrowser })
      ).toEqual({
        status: "sign-in-needed",
      });
      expect(
        await verifyByCode(deps, { address: dana.address, code: email.code })
      ).toEqual({ status: "sign-in-needed" });
      expect((await accountByAddress(db, dana.address))?.verifiedAt).toBeNull();
      expect(await db.select(sessions).all()).toEqual([]);
      verified(await verifyByLink(deps, { token: linkToken, browserToken }));
    });

    it("verifies by link in another browser only once the account's password is given there", async () => {
      const { db, deps, core, linkToken } = await signedUp();

      expect(
        await verifyByLinkWithPassword(deps, {
          token: linkToken,
          password: "not the password",
          client: null,
        })
      ).toEqual({ status: "refused", reason: "wrong-credentials" });
      expect((await accountByAddress(db, dana.address))?.verifiedAt).toBeNull();

      const result = verified(
        await verifyByLinkWithPassword(deps, {
          token: linkToken,
          password: dana.password,
          client: null,
        })
      );
      expect(await accountByAddress(db, dana.address)).toMatchObject({
        verifiedBy: "link",
      });
      expect(
        await liveSession(
          db,
          core.opaque.hash(required(result.session).token),
          deps.now()
        )
      ).not.toBeNull();
    });

    it("verifies by code in another browser once the password is given, and a wrong password spends no try", async () => {
      const { db, deps, core, email, account } = await signedUp({
        verification: { codeTries: 3 },
      });
      for (let n = 0; n < 5; n += 1) {
        expect(
          await verifyByCodeWithPassword(deps, {
            address: dana.address,
            code: email.code,
            password: "not the password",
            client: `198.51.100.${n}`,
          })
        ).toMatchObject({ status: "refused", reason: "wrong-credentials" });
        core.clock.advance(60_000);
      }
      expect(
        await core.limits.check([
          { rule: LIMIT_RULES.codeTries, key: account.addressNormalised },
        ])
      ).toMatchObject({
        entries: [{ wouldAdmit: true }],
      });

      verified(
        await verifyByCodeWithPassword(deps, {
          address: dana.address,
          code: email.code,
          password: dana.password,
          client: null,
        })
      );
      expect(await accountByAddress(db, dana.address)).toMatchObject({
        verifiedBy: "code",
      });
    });

    it("verifies by code in the browser that signed up, and gives the right code's try back", async () => {
      const { db, deps, core, email, account, browserToken, wrong } =
        await signedUp({
          verification: { codeTries: 3 },
        });
      expect(
        await verifyByCode(deps, {
          address: dana.address,
          code: wrong,
          browserToken,
        })
      ).toEqual({
        status: "refused",
        reason: "wrong-code",
        triesLeft: 2,
      });
      expect(
        await verifyByCode(deps, {
          address: dana.address,
          code: wrong,
          browserToken,
        })
      ).toMatchObject({
        reason: "wrong-code",
      });
      verified(
        await verifyByCode(deps, {
          address: "DANA@example.com ",
          code: email.code,
          browserToken,
        })
      );

      expect(await accountByAddress(db, dana.address)).toMatchObject({
        verifiedBy: "code",
      });
      // Two wrong tries counted, the right one given back: the third of three is still there.
      expect(
        await core.limits.check([
          { rule: LIMIT_RULES.codeTries, key: account.addressNormalised },
        ])
      ).toMatchObject({
        entries: [{ wouldAdmit: true }],
      });
    });

    it("counts wrong codes per address across a resend, and refuses past the limit while the link still works", async () => {
      const { deps, mail, linkToken, browserToken, wrong } = await signedUp({
        verification: { codeTries: 3 },
      });
      for (let i = 0; i < 3; i += 1) {
        await verifyByCode(deps, {
          address: dana.address,
          code: wrong,
          browserToken,
        });
      }
      // A second sign-up from this browser sends a fresh code, with no tries of its own for the address.
      await signUp(deps, { ...dana, browserToken });
      const fresh = required(mail.ofKind("verify-address")[1]);

      expect(
        await verifyByCode(deps, {
          address: dana.address,
          code: fresh.code,
          browserToken,
        })
      ).toMatchObject({
        status: "refused",
        reason: "too-many-tries",
      });
      verified(await verifyByLink(deps, { token: linkToken, browserToken }));
    });

    it("sends a fresh verification to a repeated sign-up from the same browser, whose code alone starts the session", async () => {
      const { db, deps, core, mail, email, browserToken } = await signedUp();
      await signUp(deps, { ...dana, browserToken });

      expect(mail.queued.map(sent => sent.kind)).toEqual([
        "verify-address",
        "verify-address",
      ]);
      const fresh = required(mail.ofKind("verify-address")[1]);
      if (fresh.code !== email.code) {
        expect(
          await verifyByCode(deps, {
            address: dana.address,
            code: email.code,
            browserToken,
          })
        ).toMatchObject({
          status: "refused",
        });
      }
      const result = verified(
        await verifyByCode(deps, {
          address: dana.address,
          code: fresh.code,
          browserToken,
        })
      );
      expect(
        await liveSession(
          db,
          core.opaque.hash(required(result.session).token),
          deps.now()
        )
      ).not.toBeNull();
    });

    it("keeps the first email's link working after a repeated sign-up, and it starts the session there", async () => {
      const { db, deps, core, linkToken, browserToken } = await signedUp();
      // The repeat is sent once the first sign-up has answered.
      await signUp(deps, { ...dana, browserToken });

      const result = verified(
        await verifyByLink(deps, { token: linkToken, browserToken })
      );
      expect(
        await liveSession(
          db,
          core.opaque.hash(required(result.session).token),
          deps.now()
        )
      ).not.toBeNull();
    });

    it("verifies a deactivated account's address, leaves it deactivated, and starts no session", async () => {
      const { db, deps, linkToken, account, browserToken } = await signedUp();
      await writeAtVersion(
        db,
        account,
        { deactivatedAt: new Date() },
        { endsSessions: true }
      );

      expect(
        await verifyByLink(deps, { token: linkToken, browserToken })
      ).toEqual({ status: "verified", session: null });
      expect(await accountByAddress(db, dana.address)).toMatchObject({
        verifiedBy: "link",
      });
      expect(
        (await accountByAddress(db, dana.address))?.deactivatedAt
      ).toBeInstanceOf(Date);
      expect(await db.select(sessions).all()).toEqual([]);
    });

    it("writes nothing when a change that ends the account's sessions commits while it runs, and keeps the link", async () => {
      const { db, deps, core, linkToken, account, browserToken } =
        await signedUp();
      const peek = core.secrets.peekToken.bind(core.secrets);
      // Between the account's read and the verification's write, staff end its sessions.
      const spy = vi
        .spyOn(core.secrets, "peekToken")
        .mockImplementation(async input => {
          if (input.purpose === PURPOSES.signUpBrowser)
            await endSessions(db, account);
          return peek(input);
        });

      expect(
        await verifyByLink(deps, { token: linkToken, browserToken })
      ).toEqual({
        status: "refused",
        reason: "try-again",
      });
      spy.mockRestore();
      expect((await accountByAddress(db, dana.address))?.verifiedAt).toBeNull();
      expect(await db.select(sessions).all()).toEqual([]);
      // Begun after the change, it verifies.
      verified(await verifyByLink(deps, { token: linkToken, browserToken }));
    });
  }
);

async function endSessions(
  db: Parameters<typeof writeAtVersion>[0],
  account: AccountRow
): Promise<void> {
  const fresh = required(await accountByAddress(db, account.address));
  await writeAtVersion(db, fresh, {}, { endsSessions: true });
}
