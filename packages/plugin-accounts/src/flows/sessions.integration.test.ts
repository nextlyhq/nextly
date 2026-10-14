/**
 * Sessions as requests see them, and signing out, on each dialect.
 *
 * @module flows/sessions.integration.test
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
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
  sessions,
} from "../schema/tables";
import {
  accountById,
  createAccount,
  writeAtVersion,
} from "../storage/accounts";
import { liveSession, touchSession } from "../storage/sessions";
import { bootAccounts } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { commitBeforeFirstTransaction } from "../test-support/race";

import { sessionAccount, signOut, signOutEverywhere } from "./sessions";
import { signIn, type SignInResult } from "./sign-in";

const PASSWORD = "a long passphrase";
const HOUR = 60 * 60 * 1000;

function signedIn(result: SignInResult) {
  if (result.status !== "signed-in")
    throw new Error(`expected signed-in, got ${JSON.stringify(result)}`);
  return result;
}

describe.each(getConfiguredTestDialects())(
  "sessions and signing out (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot() {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const made = flowDeps(booted.ctx, {
        session: { idleHours: 10, absoluteDays: 30 },
      });
      const db: PluginContext["db"] = booted.ctx.db;
      const created = await createAccount(db, dialect, {
        address: "dana@example.com",
        name: "Dana Reyes",
        passwordHash: await made.core.passwords.hash(PASSWORD),
      });
      if (created.status !== "created") throw new Error("expected an account");
      await writeAtVersion(db, created.account, { verifiedAt: new Date() });
      const browser = async () =>
        signedIn(
          await signIn(made.deps, {
            address: "dana@example.com",
            password: PASSWORD,
            client: null,
          })
        );
      return { db, ...made, accountId: created.account.id, browser };
    }

    it("names the session's account for a request, and nobody once it idles out", async () => {
      const { deps, core, accountId, browser } = await boot();
      const { session } = await browser();

      expect(
        await sessionAccount(deps, { sessionToken: session.token })
      ).toEqual({
        id: accountId,
        name: "Dana Reyes",
        address: "dana@example.com",
        verified: true,
      });
      core.clock.advance(9 * HOUR);
      expect(
        await sessionAccount(deps, { sessionToken: session.token })
      ).not.toBeNull();
      // Used at nine hours, it lasts ten more.
      core.clock.advance(9 * HOUR);
      expect(
        await sessionAccount(deps, { sessionToken: session.token })
      ).not.toBeNull();
      core.clock.advance(10 * HOUR);
      expect(
        await sessionAccount(deps, { sessionToken: session.token })
      ).toBeNull();
      expect(
        await sessionAccount(deps, { sessionToken: "not-a-token" })
      ).toBeNull();
    });

    it("names nobody for a deactivated account's session", async () => {
      const { db, deps, accountId, browser } = await boot();
      const { session } = await browser();
      const [row] = await db.select(accounts).all();
      if (row === undefined || row.id !== accountId)
        throw new Error("expected the account");
      await writeAtVersion(db, row, { deactivatedAt: new Date() });

      expect(
        await sessionAccount(deps, { sessionToken: session.token })
      ).toBeNull();
    });

    it("signs one session out and leaves the other browser's", async () => {
      const { deps, browser } = await boot();
      const first = await browser();
      const second = await browser();

      await signOut(deps, { sessionToken: first.session.token });
      expect(
        await sessionAccount(deps, { sessionToken: first.session.token })
      ).toBeNull();
      expect(
        await sessionAccount(deps, { sessionToken: second.session.token })
      ).not.toBeNull();
    });

    it("signs out everywhere: every session, every link and the pending change go, and known browsers stay", async () => {
      const { db, deps, core, accountId, browser } = await boot();
      const first = await browser();
      await browser();
      const { token } = await core.secrets.mintToken({
        purpose: "reset",
        subject: accountId,
        expiresInMs: HOUR,
      });
      await db.insert(pendingAddressChanges, {
        accountId,
        newAddress: "new@example.com",
        newAddressNormalised: "new@example.com",
        expiresAt: new Date(Date.now() + HOUR),
      });

      expect(
        await signOutEverywhere(deps, { sessionToken: first.session.token })
      ).toBe(true);
      expect(await db.select(sessions).all()).toEqual([]);
      expect(
        await core.secrets.peekToken({ purpose: "reset", token })
      ).toMatchObject({ ok: false });
      expect(await db.select(pendingAddressChanges).all()).toEqual([]);
      expect((await db.select(knownBrowsers).all()).length).toBeGreaterThan(0);
      expect(
        await signOutEverywhere(deps, { sessionToken: first.session.token })
      ).toBe(false);
    });

    it("does nothing once a change that ended the asking session commits before it", async () => {
      const { db, deps, accountId, browser } = await boot();
      const asking = await browser();
      let later: Awaited<ReturnType<typeof browser>> | undefined;
      // The first try's transaction finds a password change committed after
      // the account was read: the asking session gone, the version moved,
      // and a sign-in made since with the new password.
      const raced = {
        ...deps,
        db: commitBeforeFirstTransaction(deps.db, async () => {
          await signOut(deps, { sessionToken: asking.session.token });
          const fresh = await accountById(db, accountId);
          if (fresh !== null)
            await writeAtVersion(db, fresh, {}, { endsSessions: true });
          later = await browser();
        }),
      };

      expect(
        await signOutEverywhere(raced, { sessionToken: asking.session.token })
      ).toBe(false);
      expect(
        await sessionAccount(deps, { sessionToken: later?.session.token ?? "" })
      ).not.toBeNull();
    });

    it("never moves a session's idle expiry back for a slower request's older use", async () => {
      const { db, deps, core, browser } = await boot();
      const { session } = await browser();
      const row = await liveSession(
        db,
        core.opaque.hash(session.token),
        deps.now()
      );
      if (row === null) throw new Error("expected a live session");
      const limits = { idleMs: 10 * HOUR };
      const at = (hours: number) =>
        new Date(row.lastUsedAt.getTime() + hours * HOUR);

      expect(await touchSession(db, row, at(3), limits)).toBe(true);
      expect(await touchSession(db, row, at(2), limits)).toBe(false);
      expect(
        (await liveSession(db, row.tokenHash, at(3)))?.idleExpiresAt
      ).toEqual(new Date(at(3).getTime() + 10 * HOUR));
    });

    it("leaves no session from a sign-in under way when it commits", async () => {
      const { db, deps, browser } = await boot();
      const { session } = await browser();
      const raced = {
        ...deps,
        pacer: {
          ...deps.pacer,
          verify: async (password: string, hash: string | null) => {
            await signOutEverywhere(deps, { sessionToken: session.token });
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
      expect(await db.select(sessions).all()).toEqual([]);
      // Begun after it, a sign-in keeps its session.
      signedIn(
        await signIn(deps, {
          address: "dana@example.com",
          password: PASSWORD,
          client: null,
        })
      );
    });
  }
);
