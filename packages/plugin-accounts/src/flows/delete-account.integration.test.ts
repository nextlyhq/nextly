/**
 * The holder deleting their account, on each dialect.
 *
 * @module flows/delete-account.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { knownBrowsers, sessions } from "../schema/tables";
import { accountById } from "../storage/accounts";
import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import { bootAccounts } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";

import { deleteOwnAccount } from "./delete-account";
import { requestPasswordReset } from "./reset-request";
import { signIn } from "./sign-in";

describe.each(getConfiguredTestDialects())(
  "deleting the account (%s)",
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
      const signedIn = await signIn(made.deps, {
        address: "dana@example.com",
        password: TEST_PASSWORD,
        client: null,
      });
      if (signedIn.status !== "signed-in")
        throw new Error("expected a sign-in");
      return {
        db: booted.ctx.db,
        ...made,
        id,
        session: signedIn.session.token,
      };
    }

    it("answers deleted, and logs the email it could not queue, once the deletion has committed", async () => {
      const { db, deps, emitted, warnings, id, session } = await boot();
      const queueDown = {
        ...deps,
        mail: {
          queue: () => Promise.reject(new Error("the job queue is down")),
        },
      };

      expect(
        await deleteOwnAccount(queueDown, {
          sessionToken: session,
          currentPassword: TEST_PASSWORD,
          client: null,
        })
      ).toEqual({ status: "deleted" });
      expect(await accountById(db, id)).toBeNull();
      expect(emitted).toHaveLength(1);
      expect(warnings).toEqual([
        "[accounts] the notice of a committed change was not queued",
      ]);
    });

    it("deletes the account and everything of it, voids its links, tells other plugins and emails the address", async () => {
      const { db, deps, core, mail, emitted, id, session } = await boot();
      await requestPasswordReset(deps, {
        address: "dana@example.com",
        client: null,
      });
      const link = mail.ofKind("reset-password")[0]?.link ?? "";
      const token = new URL(link).searchParams.get("token") ?? "";

      expect(
        await deleteOwnAccount(deps, {
          sessionToken: session,
          currentPassword: TEST_PASSWORD,
          client: null,
        })
      ).toEqual({ status: "deleted" });
      expect(await accountById(db, id)).toBeNull();
      expect(await db.select(sessions).all()).toEqual([]);
      expect(await db.select(knownBrowsers).all()).toEqual([]);
      expect(
        await core.secrets.peekToken({ purpose: "reset", token })
      ).toMatchObject({ ok: false });
      expect(emitted).toEqual([
        {
          name: "nextlyhq-plugin-accounts.account.deleted",
          payload: { accountId: id },
        },
      ]);
      expect(mail.ofKind("account-deleted").map(email => email.to)).toEqual([
        "dana@example.com",
      ]);
    });

    it("leaves no session from a sign-in under way when it commits", async () => {
      const { db, deps, session } = await boot();
      const raced = {
        ...deps,
        pacer: {
          ...deps.pacer,
          verify: async (password: string, hash: string | null) => {
            const valid = await deps.pacer.verify(password, hash);
            await deleteOwnAccount(deps, {
              sessionToken: session,
              currentPassword: TEST_PASSWORD,
              client: null,
            });
            return valid;
          },
        },
      };

      expect(
        await signIn(raced, {
          address: "dana@example.com",
          password: TEST_PASSWORD,
          client: null,
        })
      ).toEqual({
        status: "refused",
        reason: "try-again",
      });
      expect(await db.select(sessions).all()).toEqual([]);
    });

    it("asks for the current password, counting a wrong one, and deletes nothing without it", async () => {
      const { db, deps, emitted, id, session } = await boot();

      expect(
        await deleteOwnAccount(deps, {
          sessionToken: session,
          currentPassword: "wrong",
          client: null,
        })
      ).toEqual({
        status: "refused",
        reason: "wrong-credentials",
      });
      expect((await accountById(db, id))?.failuresInARow).toBe(1);
      expect(emitted).toEqual([]);
      expect(
        await deleteOwnAccount(deps, {
          sessionToken: "no-session",
          currentPassword: TEST_PASSWORD,
          client: null,
        })
      ).toEqual({ status: "signed-out" });
    });
  }
);
