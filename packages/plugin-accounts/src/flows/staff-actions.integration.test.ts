/**
 * What each staff action does to an account, on each dialect.
 *
 * @module flows/staff-actions.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { STAFF_ACTIONS } from "../admin-contract";
import { knownBrowsers, sessions } from "../schema/tables";
import { accountById, writeAtVersion } from "../storage/accounts";
import { askAddressChange, pendingChangeOf } from "../storage/pending-changes";
import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import { bootAccounts } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { commitBeforeFirstTransaction } from "../test-support/race";

import { PURPOSES } from "./purposes";
import { completePasswordReset } from "./reset";
import { signIn } from "./sign-in";
import { runStaffAction } from "./staff-actions";

const ADDRESS = "dana@example.com";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

describe.each(getConfiguredTestDialects())(
  "staff acting on an account (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(state: Parameters<typeof makeAccount>[2] = {}) {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const made = flowDeps(booted.ctx);
      const id = await makeAccount(made.deps, ADDRESS, state);
      return { ...made, id };
    }

    /** Signs the account in, starting a session and making a browser known. */
    async function signedIn(deps: Parameters<typeof signIn>[0]) {
      const result = await signIn(deps, {
        address: ADDRESS,
        password: TEST_PASSWORD,
        client: null,
      });
      if (result.status !== "signed-in") throw new Error("expected a sign-in");
      return result;
    }

    /** A reset link minted for the account before staff act, to see whether it survives. */
    async function resetLink(
      core: ReturnType<typeof flowDeps>["core"],
      id: string
    ) {
      const { token } = await core.secrets.mintToken({
        purpose: PURPOSES.reset,
        subject: id,
        expiresInMs: 60 * 60 * 1000,
      });
      return token;
    }

    it("deactivates: ends every session, voids every link, cancels a pending change and tells other plugins", async () => {
      const { deps, core, emitted, id } = await boot();
      await signedIn(deps);
      const token = await resetLink(core, id);
      await askAddressChange(deps.db, {
        accountId: id,
        newAddress: "new@example.com",
        expiresAt: new Date(core.clock.now() + 60_000),
      });
      const before = await accountById(deps.db, id);

      expect(await runStaffAction(deps, "deactivate", id)).toMatchObject({
        status: "done",
      });

      const after = await accountById(deps.db, id);
      expect(after?.deactivatedAt).toBeInstanceOf(Date);
      expect(after?.securityVersion).toBe((before?.securityVersion ?? 0) + 1);
      expect(await deps.db.select(sessions).all()).toEqual([]);
      expect(await deps.db.select(knownBrowsers).all()).toHaveLength(1);
      expect(
        await core.secrets.peekToken({ purpose: PURPOSES.reset, token })
      ).toMatchObject({ ok: false });
      expect(await pendingChangeOf(deps.db, id)).toBeNull();
      expect(emitted).toEqual([
        {
          name: "nextlyhq-plugin-accounts.account.deactivated",
          payload: { accountId: id },
        },
      ]);
      expect(
        await signIn(deps, {
          address: ADDRESS,
          password: TEST_PASSWORD,
          client: null,
        })
      ).toMatchObject({ status: "refused", reason: "deactivated" });
    });

    it("refuses to deactivate a deactivated account, and tells nobody again", async () => {
      const { deps, emitted, id } = await boot({ deactivated: true });

      expect(await runStaffAction(deps, "deactivate", id)).toEqual({
        status: "refused",
        reason: "already-deactivated",
      });
      expect(emitted).toEqual([]);
    });

    it("reactivates a deactivated account, which signs in again, and refuses an active one", async () => {
      const { deps, emitted, id } = await boot({ deactivated: true });

      expect(await runStaffAction(deps, "reactivate", id)).toMatchObject({
        status: "done",
      });
      expect((await accountById(deps.db, id))?.deactivatedAt).toBeNull();
      expect(emitted).toEqual([
        {
          name: "nextlyhq-plugin-accounts.account.reactivated",
          payload: { accountId: id },
        },
      ]);
      await signedIn(deps);
      expect(await runStaffAction(deps, "reactivate", id)).toEqual({
        status: "refused",
        reason: "already-active",
      });
    });

    it("applies one of two reactivations at once, telling other plugins once", async () => {
      const { deps, emitted, id } = await boot({ deactivated: true });
      const raced = {
        ...deps,
        db: commitBeforeFirstTransaction(deps.db, () =>
          runStaffAction(deps, "reactivate", id)
        ),
      };

      expect(await runStaffAction(raced, "reactivate", id)).toEqual({
        status: "refused",
        reason: "already-active",
      });
      expect(
        emitted.filter(
          event => event.name === "nextlyhq-plugin-accounts.account.reactivated"
        )
      ).toHaveLength(1);
    });

    it("ends the sessions and moves the version, but voids no link and keeps a pending change", async () => {
      const { deps, core, id } = await boot();
      await signedIn(deps);
      await signedIn(deps);
      const token = await resetLink(core, id);
      await askAddressChange(deps.db, {
        accountId: id,
        newAddress: "new@example.com",
        expiresAt: new Date(core.clock.now() + 60_000),
      });
      const before = await accountById(deps.db, id);

      expect(await runStaffAction(deps, "end-sessions", id)).toMatchObject({
        status: "done",
      });

      expect(await deps.db.select(sessions).all()).toEqual([]);
      expect((await accountById(deps.db, id))?.securityVersion).toBe(
        (before?.securityVersion ?? 0) + 1
      );
      expect(await pendingChangeOf(deps.db, id)).not.toBeNull();
      expect(
        await completePasswordReset(deps, {
          token,
          password: "another long passphrase",
        })
      ).toMatchObject({ status: "reset" });
    });

    it("resends verification to an unverified account, voiding the earlier code", async () => {
      const { deps, core, mail, id } = await boot({ verified: false });

      expect(
        await runStaffAction(deps, "resend-verification", id)
      ).toMatchObject({ status: "done" });
      const first = core.secrets.lastMinted(id, PURPOSES.verifyCode);
      await runStaffAction(deps, "resend-verification", id);

      const sent = mail.ofKind("verify-address");
      expect(sent.map(email => email.to)).toEqual([ADDRESS, ADDRESS]);
      expect(sent[1]?.code).not.toBe(first?.secret);
      expect(
        await core.secrets.consumeCode({
          purpose: PURPOSES.verifyCode,
          subject: id,
          code: first?.secret ?? "",
        })
      ).toMatchObject({ ok: false });
    });

    it("refuses to resend verification to a verified or a deactivated account", async () => {
      const verified = await boot();
      expect(
        await runStaffAction(verified.deps, "resend-verification", verified.id)
      ).toEqual({ status: "refused", reason: "already-verified" });
      expect(verified.mail.queued).toEqual([]);
      await current?.destroy();

      const closed = await boot({ verified: false, deactivated: true });
      expect(
        await runStaffAction(closed.deps, "resend-verification", closed.id)
      ).toEqual({ status: "refused", reason: "deactivated" });
      expect(closed.mail.queued).toEqual([]);
    });

    it("refuses to resend once the holder's verification commits after the account was read", async () => {
      const { deps, mail, id } = await boot({ verified: false });
      const raced = {
        ...deps,
        db: commitBeforeFirstTransaction(deps.db, async () => {
          const fresh = await accountById(deps.db, id);
          if (fresh !== null)
            await writeAtVersion(deps.db, fresh, { verifiedAt: new Date() });
        }),
      };

      expect(await runStaffAction(raced, "resend-verification", id)).toEqual({
        status: "refused",
        reason: "already-verified",
      });
      expect(mail.ofKind("verify-address")).toEqual([]);
    });

    it("sends an active account a reset link that resets the password", async () => {
      const { deps, mail, id } = await boot();

      expect(await runStaffAction(deps, "send-reset", id)).toMatchObject({
        status: "done",
      });

      const [sent] = mail.ofKind("reset-password");
      expect(sent?.to).toBe(ADDRESS);
      const token = new URL(sent?.link ?? "").searchParams.get("token") ?? "";
      expect(
        await completePasswordReset(deps, {
          token,
          password: "another long passphrase",
        })
      ).toMatchObject({ status: "reset" });
    });

    it("sends no reset link once a deactivation commits after the account was read", async () => {
      const { deps, mail, id } = await boot();
      const raced = {
        ...deps,
        db: commitBeforeFirstTransaction(deps.db, async () => {
          const fresh = await accountById(deps.db, id);
          if (fresh !== null)
            await writeAtVersion(
              deps.db,
              fresh,
              { deactivatedAt: new Date() },
              { endsSessions: true }
            );
        }),
      };

      expect(await runStaffAction(raced, "send-reset", id)).toEqual({
        status: "refused",
        reason: "deactivated",
      });
      expect(mail.ofKind("reset-password")).toEqual([]);
    });

    it("sends a deactivated account no reset link", async () => {
      const { deps, mail, id } = await boot({ deactivated: true });

      expect(await runStaffAction(deps, "send-reset", id)).toEqual({
        status: "refused",
        reason: "deactivated",
      });
      expect(mail.queued).toEqual([]);
    });

    it("deletes the account with its sessions, voids its links, tells other plugins and emails the address", async () => {
      const { deps, core, mail, emitted, id } = await boot();
      await signedIn(deps);
      const token = await resetLink(core, id);

      expect(await runStaffAction(deps, "delete", id)).toMatchObject({
        status: "done",
      });

      expect(await accountById(deps.db, id)).toBeNull();
      expect(await deps.db.select(sessions).all()).toEqual([]);
      expect(await deps.db.select(knownBrowsers).all()).toEqual([]);
      expect(
        await core.secrets.peekToken({ purpose: PURPOSES.reset, token })
      ).toMatchObject({ ok: false });
      expect(emitted).toEqual([
        {
          name: "nextlyhq-plugin-accounts.account.deleted",
          payload: { accountId: id },
        },
      ]);
      expect(mail.ofKind("account-deleted")).toEqual([
        { kind: "account-deleted", accountId: id, to: ADDRESS },
      ]);
    });

    it("answers missing for an account that is not there, doing nothing", async () => {
      const { deps, mail, emitted } = await boot();

      for (const action of STAFF_ACTIONS)
        expect(await runStaffAction(deps, action, UNKNOWN_ID)).toEqual({
          status: "missing",
        });
      expect(mail.queued).toEqual([]);
      expect(emitted).toEqual([]);
    });
  }
);
