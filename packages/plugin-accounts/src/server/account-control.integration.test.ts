/**
 * The server functions a site's own code ends someone's access with, on
 * each dialect: ending an account's sessions, deactivating and reactivating
 * it, each with staff's effect, each refused as staff's is, and each
 * recorded in core's audit log under the app's own kind.
 *
 * @module server/account-control.integration.test
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { accountsLimitRules } from "../core/limit-rules";
import type { FlowDeps } from "../flows/deps";
import { signIn } from "../flows/sign-in";
import { ACCOUNT_PRINCIPAL } from "../http/principal";
import { resolveAccountsSettings } from "../settings";
import { accountById } from "../storage/accounts";
import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { fakeAccountsCore } from "../testing";

import type { AccountsServer, AccountVisitor } from "./contract";
import { accountsServer, accountsServices } from "./installed";
import { accountsService } from "./service";

const ADDRESS = "dana@example.com";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

/** An audit row, as the adapter reads it back. */
interface AuditRow {
  kind: string;
  actorUserId: string | null;
  targetPrincipalKind: string | null;
  targetPrincipalId: string | null;
}

/** The code and public data a refusal was thrown with. */
async function refusalOf(
  work: Promise<unknown>
): Promise<{ code: string; data: unknown }> {
  try {
    await work;
  } catch (error) {
    if (NextlyError.is(error))
      return { code: error.code, data: error.publicData };
    throw error;
  }
  throw new Error("expected a refusal");
}

describe.each(getConfiguredTestDialects())(
  "the site's own code acting on an account (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(state: Parameters<typeof makeAccount>[2] = {}) {
      // The running plugin reads real time, so the fake core's clock starts there too.
      const core = fakeAccountsCore({
        start: new Date(),
        rules: accountsLimitRules(
          resolveAccountsSettings({ origin: TEST_ORIGIN })
        ),
      });
      const booted = await bootAccounts(dialect, { core });
      current = booted.nextly;
      const made = flowDeps(booted.ctx, {}, core);
      const id = await makeAccount(made.deps, ADDRESS, state);

      return {
        ...made,
        id,
        nextly: booted.nextly,
        ctx: booted.ctx,
        // Over the deps whose events the test reads, with core's real audit writer.
        server: accountsService(() => made.deps),
      };
    }

    /** A browser signed in to the account, as its session cookie carries it. */
    async function signedInVisitor(
      deps: FlowDeps,
      server: AccountsServer
    ): Promise<AccountVisitor> {
      const result = await signIn(deps, {
        address: ADDRESS,
        password: TEST_PASSWORD,
        client: null,
      });
      if (result.status !== "signed-in") throw new Error("expected a sign-in");

      return {
        ...server.visitorFrom(new Headers()),
        sessionToken: result.session.token,
      };
    }

    async function auditRows(nextly: TestNextly): Promise<AuditRow[]> {
      const rows = await nextly.adapter.select<AuditRow>("audit_log", {
        where: {
          and: [
            {
              column: "targetPrincipalKind",
              op: "=",
              value: ACCOUNT_PRINCIPAL,
            },
          ],
        },
      });
      // In kind order: the adapter promises no order of its own.
      return rows
        .map(row => ({
          kind: row.kind,
          actorUserId: row.actorUserId,
          targetPrincipalKind: row.targetPrincipalKind,
          targetPrincipalId: row.targetPrincipalId,
        }))
        .sort((a, b) => a.kind.localeCompare(b.kind));
    }

    const recorded = (kind: string, id: string): AuditRow => ({
      kind: `nextlyhq-plugin-accounts.app.${kind}`,
      actorUserId: null,
      targetPrincipalKind: ACCOUNT_PRINCIPAL,
      targetPrincipalId: id,
    });

    it("ends every session of the account, so its next request is signed out, and records it", async () => {
      const { deps, server, id, nextly } = await boot();
      const first = await signedInVisitor(deps, server);
      const second = await signedInVisitor(deps, server);
      expect(await server.currentAccount({ visitor: first })).toMatchObject({
        id,
      });

      expect(await server.endAccountSessions({ accountId: id })).toEqual({
        message: "The account's sessions have ended.",
        cookies: [],
      });

      expect(await server.currentAccount({ visitor: first })).toBeNull();
      expect(await server.currentAccount({ visitor: second })).toBeNull();
      // Not deactivated: the holder signs in again.
      expect((await accountById(deps.db, id))?.deactivatedAt).toBeNull();
      await signedInVisitor(deps, server);
      expect(await auditRows(nextly)).toEqual([recorded("sessions-ended", id)]);
    });

    it("deactivates the account: its sessions end, it signs in nowhere, other plugins hear, and it is recorded", async () => {
      const { deps, server, id, nextly, emitted } = await boot();
      const visitor = await signedInVisitor(deps, server);

      expect(await server.deactivateAccount({ accountId: id })).toEqual({
        message: "The account is deactivated.",
        cookies: [],
      });

      expect(await server.currentAccount({ visitor })).toBeNull();
      expect(
        await signIn(deps, {
          address: ADDRESS,
          password: TEST_PASSWORD,
          client: null,
        })
      ).toMatchObject({ status: "refused", reason: "deactivated" });
      expect(emitted).toEqual([
        {
          name: "nextlyhq-plugin-accounts.account.deactivated",
          payload: { accountId: id },
        },
      ]);
      expect(await auditRows(nextly)).toEqual([recorded("deactivated", id)]);

      // A second deactivation is refused as staff's is, and records nothing.
      expect(
        await refusalOf(server.deactivateAccount({ accountId: id }))
      ).toEqual({
        code: "ACCOUNTS_NOT_APPLICABLE",
        data: { reason: "already-deactivated" },
      });
      expect(await auditRows(nextly)).toHaveLength(1);
    });

    it("reactivates a deactivated account, which signs in again, and refuses an active one", async () => {
      const { deps, server, id, nextly, emitted } = await boot({
        deactivated: true,
      });

      expect(await server.reactivateAccount({ accountId: id })).toEqual({
        message: "The account is active again.",
        cookies: [],
      });
      await signedInVisitor(deps, server);
      expect(emitted).toEqual([
        {
          name: "nextlyhq-plugin-accounts.account.reactivated",
          payload: { accountId: id },
        },
      ]);
      expect(
        await refusalOf(server.reactivateAccount({ accountId: id }))
      ).toEqual({
        code: "ACCOUNTS_NOT_APPLICABLE",
        data: { reason: "already-active" },
      });
      expect(await auditRows(nextly)).toEqual([recorded("reactivated", id)]);
    });

    it("answers an account that is not there, or an id that names none, as not found", async () => {
      const { server, nextly } = await boot();

      for (const accountId of [UNKNOWN_ID, "", "x".repeat(37)]) {
        for (const act of [
          () => server.endAccountSessions({ accountId }),
          () => server.deactivateAccount({ accountId }),
          () => server.reactivateAccount({ accountId }),
        ]) {
          expect(await refusalOf(act())).toMatchObject({
            code: "ACCOUNTS_NOT_FOUND",
          });
        }
      }
      expect(await auditRows(nextly)).toEqual([]);
    });

    it("refuses on a core that lends no audit writer, before anything is done", async () => {
      const { deps, server, id } = await boot();
      const unrecorded = accountsService(() => ({ ...deps, audit: undefined }));
      const visitor = await signedInVisitor(deps, server);

      expect(
        await refusalOf(unrecorded.deactivateAccount({ accountId: id }))
      ).toMatchObject({ code: "ACCOUNTS_CORE_MISSING" });
      expect((await accountById(deps.db, id))?.deactivatedAt).toBeNull();
      expect(await server.currentAccount({ visitor })).toMatchObject({ id });
    });

    it("is offered by the started plugin, to a site's code and to another plugin", async () => {
      const { ctx, id, nextly } = await boot();

      await (await accountsServer()).endAccountSessions({ accountId: id });
      await accountsServices(ctx).deactivateAccount({ accountId: id });

      expect(await auditRows(nextly)).toEqual([
        recorded("deactivated", id),
        recorded("sessions-ended", id),
      ]);
    });
  }
);
