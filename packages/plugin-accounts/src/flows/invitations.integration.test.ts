/**
 * Invitations on each dialect: a link for one address, kept only as a hash,
 * lasting the site's days, spent once even when used twice at the same
 * moment, refused for another address, after it expires, once it is spent
 * and once it is withdrawn or replaced, issued and accepted while sign-up is
 * closed, counted as every request that emails an address, and answered
 * alike for an address that already has an account.
 *
 * @module flows/invitations.integration.test
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { accountsLimitRules } from "../core/limit-rules";
import { CSRF_HEADER } from "../http/guard";
import { PLUGIN_NAME } from "../schema/definition";
import { accounts } from "../schema/tables";
import type { AccountsServer, AccountVisitor } from "../server/contract";
import { accountsServer, accountsServices } from "../server/installed";
import { accountsService } from "../server/service";
import { resolveAccountsSettings, type AccountsOptions } from "../settings";
import { accountByAddress } from "../storage/accounts";
import { makeAccount } from "../test-support/accounts";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { commitBeforeFirstTransaction } from "../test-support/race";
import { fakeAccountsCore } from "../testing";

import { DAY } from "./deps";
import { acceptInvitation, invitationSubject, invite } from "./invitations";
import { PURPOSES } from "./purposes";
import { signIn } from "./sign-in";

const ADDRESS = "dana@example.com";
const NAME = "Dana Reyes";
const PASSWORD = "a long passphrase";
const OTHER_PASSWORD = "another long passphrase";

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
  "invitations (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Booted on fake core helpers, whose clock and mail the test reads. */
    async function boot(options: Omit<AccountsOptions, "origin"> = {}) {
      const core = fakeAccountsCore({
        start: new Date(),
        rules: accountsLimitRules(
          resolveAccountsSettings({ origin: TEST_ORIGIN, ...options })
        ),
      });
      const booted = await bootAccounts(dialect, { core, settings: options });
      current = booted.nextly;
      const made = flowDeps(booted.ctx, options, core);
      const server = accountsService(() => made.deps);

      return {
        ...made,
        ctx: booted.ctx,
        nextly: booted.nextly,
        server,
        visitor: server.visitorFrom(new Headers()),
      };
    }

    /** Booted on core's own helpers, as a site runs: its real secrets decide every race. */
    async function bootReal(): Promise<{
      server: AccountsServer;
      visitor: AccountVisitor;
      nextly: TestNextly;
    }> {
      // Sign-up closed: invitations are the way in.
      const booted = await bootAccounts(dialect, {
        settings: { signUp: "closed" },
      });
      current = booted.nextly;
      const server = await accountsServer();

      return {
        server,
        visitor: server.visitorFrom(new Headers()),
        nextly: booted.nextly,
      };
    }

    async function signsIn(
      deps: Parameters<typeof signIn>[0],
      password: string
    ): Promise<boolean> {
      const result = await signIn(deps, {
        address: ADDRESS,
        password,
        client: null,
      });
      return result.status === "signed-in";
    }

    it("makes a verified account for the invited address, signs it in, and hands back the site's data", async () => {
      const { deps, server, visitor, mail, emitted } = await boot({
        signUp: "closed",
      });

      const issued = await server.invite({
        address: ADDRESS,
        name: NAME,
        data: { personId: "e-17", level: 2 },
      });
      expect(issued.link).toBe(
        `${TEST_ORIGIN}/account/invitation?token=${encodeURIComponent(issued.token)}`
      );
      expect(mail.ofKind("invitation")).toEqual([
        {
          kind: "invitation",
          accountId: null,
          to: ADDRESS,
          link: issued.link,
        },
      ]);

      const accepted = await server.acceptInvitation({
        visitor,
        token: issued.token,
        password: PASSWORD,
      });

      const account = await accountByAddress(deps.db, ADDRESS);
      expect(account).toMatchObject({
        name: NAME,
        verifiedBy: "invitation",
      });
      expect(account?.verifiedAt).toBeInstanceOf(Date);
      expect(accepted).toMatchObject({
        message: "Your account is ready.",
        account: { id: account?.id, address: ADDRESS, name: NAME },
        data: { personId: "e-17", level: 2 },
      });
      const session = accepted.cookies.find(
        change => change.cookie === "session" && change.action === "set"
      );
      expect(session).toBeDefined();
      expect(
        await server.currentAccount({
          visitor: {
            ...visitor,
            sessionToken: session?.action === "set" ? session.value : null,
          },
        })
      ).toMatchObject({ id: account?.id, verified: true });
      expect(emitted).toEqual([
        {
          name: "nextlyhq-plugin-accounts.invitation.accepted",
          payload: {
            accountId: account?.id,
            data: { personId: "e-17", level: 2 },
          },
        },
      ]);
      expect(await signsIn(deps, PASSWORD)).toBe(true);
    });

    it("lasts 7 days by default and the site's days when it sets them", async () => {
      for (const [options, days] of [
        [{}, 7],
        [{ invitationLinkDays: 3 }, 3],
      ] as const) {
        const { core, server } = await boot(options);
        const issued = await server.invite({ address: ADDRESS, name: NAME });
        expect(issued.expiresAt.getTime() - core.clock.now()).toBe(days * DAY);
        await current?.destroy();
        current = undefined;
      }
    });

    it("keeps only the link's hash, under the address's digest, in core's one-purpose secrets", async () => {
      const { server, nextly } = await bootReal();

      const issued = await server.invite({
        address: ADDRESS,
        name: NAME,
        sendEmail: false,
      });

      const rows = await nextly.adapter.select<{
        purpose: string;
        subject: string;
        secretHash: string;
      }>("nextly_one_time_secrets", {});
      const ours = rows.filter(row =>
        row.purpose.endsWith(PURPOSES.invitation)
      );
      expect(ours).toHaveLength(1);
      expect(ours[0]?.subject).toBe(invitationSubject(ADDRESS));
      expect(ours[0]?.secretHash).not.toBe(issued.token);
      // No row core keeps holds the link itself.
      expect(JSON.stringify(rows)).not.toContain(issued.token);
    });

    it("spends a link used twice at the same moment once: exactly one account, with one password", async () => {
      const { server, visitor } = await bootReal();
      const issued = await server.invite({
        address: ADDRESS,
        name: NAME,
        sendEmail: false,
      });

      const results = await Promise.allSettled([
        server.acceptInvitation({
          visitor,
          token: issued.token,
          password: PASSWORD,
        }),
        server.acceptInvitation({
          visitor,
          token: issued.token,
          password: OTHER_PASSWORD,
        }),
      ]);

      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find(r => r.status === "rejected");
      expect(
        NextlyError.is(lost?.reason) ? lost.reason.code : lost?.reason
      ).toBe("ACCOUNTS_LINK_REFUSED");
      const outcomes = await Promise.all(
        [PASSWORD, OTHER_PASSWORD].map(password =>
          server
            .signIn({ visitor, address: ADDRESS, password })
            .then(() => true)
            .catch(() => false)
        )
      );
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      expect(
        await refusalOf(
          server.acceptInvitation({
            visitor,
            token: issued.token,
            password: "a third long passphrase",
          })
        )
      ).toEqual({ code: "ACCOUNTS_LINK_REFUSED", data: { reason: "spent" } });
    });

    it("refuses the link a use committed between this use's checks and its transaction, and makes no second account", async () => {
      const { deps, server } = await boot();
      const issued = await server.invite({ address: ADDRESS, name: NAME });
      const raced = {
        ...deps,
        db: commitBeforeFirstTransaction(deps.db, () =>
          acceptInvitation(deps, { token: issued.token, password: PASSWORD })
        ),
      };

      expect(
        await acceptInvitation(raced, {
          token: issued.token,
          password: OTHER_PASSWORD,
        })
      ).toEqual({ status: "refused", reason: "spent" });
      expect(await deps.db.select(accounts).all()).toHaveLength(1);
      expect(await signsIn(deps, PASSWORD)).toBe(true);
      expect(await signsIn(deps, OTHER_PASSWORD)).toBe(false);
    });

    it("refuses a use naming another address, spending nothing", async () => {
      const { deps, server, visitor } = await boot();
      const issued = await server.invite({ address: ADDRESS, name: NAME });

      expect(
        await refusalOf(
          server.acceptInvitation({
            visitor,
            token: issued.token,
            password: PASSWORD,
            address: "someone.else@example.com",
          })
        )
      ).toEqual({
        code: "ACCOUNTS_LINK_REFUSED",
        data: { reason: "other-address" },
      });
      expect(await deps.db.select(accounts).all()).toEqual([]);
      // The invited address, however cased, is its own.
      await server.acceptInvitation({
        visitor,
        token: issued.token,
        password: PASSWORD,
        address: " Dana@Example.com ",
      });
      expect(await accountByAddress(deps.db, ADDRESS)).not.toBeNull();
    });

    it("refuses an expired link, a withdrawn one and one a newer invitation replaced, and changes nothing", async () => {
      const { core, deps, server, visitor } = await boot();
      const accept = (token: string) =>
        refusalOf(
          server.acceptInvitation({ visitor, token, password: PASSWORD })
        );

      const expired = await server.invite({ address: ADDRESS, name: NAME });
      core.clock.advance(7 * DAY + 1000);
      expect(await accept(expired.token)).toEqual({
        code: "ACCOUNTS_LINK_REFUSED",
        data: { reason: "expired" },
      });

      const replaced = await server.invite({ address: ADDRESS, name: NAME });
      const newer = await server.invite({ address: ADDRESS, name: NAME });
      expect(await accept(replaced.token)).toMatchObject({
        code: "ACCOUNTS_LINK_REFUSED",
      });

      expect(await server.withdrawInvitation({ address: ADDRESS })).toEqual({
        withdrawn: true,
      });
      expect(await accept(newer.token)).toMatchObject({
        code: "ACCOUNTS_LINK_REFUSED",
      });
      expect(await server.withdrawInvitation({ address: ADDRESS })).toEqual({
        withdrawn: false,
      });
      expect(await deps.db.select(accounts).all()).toEqual([]);
    });

    it("refuses a password the site's rules refuse, keeping the link for one they accept", async () => {
      const { deps, server, visitor } = await boot();
      const issued = await server.invite({ address: ADDRESS, name: NAME });

      expect(
        await refusalOf(
          server.acceptInvitation({
            visitor,
            token: issued.token,
            password: "short",
          })
        )
      ).toMatchObject({
        code: "ACCOUNTS_INVALID_INPUT",
        data: { reason: "too-short" },
      });
      expect(await deps.db.select(accounts).all()).toEqual([]);
      await server.acceptInvitation({
        visitor,
        token: issued.token,
        password: PASSWORD,
      });
      expect(await signsIn(deps, PASSWORD)).toBe(true);
    });

    it("answers an address that has an account as any other, and refuses its link when used", async () => {
      const { deps, mail, server, visitor } = await boot();
      const id = await makeAccount(deps, ADDRESS);

      const issued = await server.invite({ address: ADDRESS, name: NAME });
      const fresh = await server.invite({
        address: "fresh@example.com",
        name: NAME,
      });

      expect(Object.keys(issued).sort()).toEqual(Object.keys(fresh).sort());
      expect(issued.token).toHaveLength(fresh.token.length);
      expect(mail.ofKind("invitation-has-account")).toEqual([
        {
          kind: "invitation-has-account",
          accountId: id,
          to: ADDRESS,
          signInLink: `${TEST_ORIGIN}/account/sign-in`,
          resetLink: `${TEST_ORIGIN}/account/reset`,
        },
      ]);
      expect(
        await refusalOf(
          server.acceptInvitation({
            visitor,
            token: issued.token,
            password: PASSWORD,
          })
        )
      ).toEqual({
        code: "ACCOUNTS_LINK_REFUSED",
        data: { reason: "has-account" },
      });
    });

    it("counts invitations to an address as every emailing request is, and sends none past the limit", async () => {
      const { mail, server } = await boot();

      for (let sent = 0; sent < 3; sent += 1)
        await server.invite({ address: ADDRESS, name: NAME });
      expect(
        await refusalOf(server.invite({ address: ADDRESS, name: NAME }))
      ).toMatchObject({ code: "ACCOUNTS_TOO_MANY_REQUESTS" });
      expect(mail.ofKind("invitation")).toHaveLength(3);
    });

    it("refuses an invitation's name, address or data that cannot be kept, minting nothing", async () => {
      const { core, deps } = await boot();

      for (const [input, reason] of [
        [{ address: ADDRESS, name: " " }, "invalid-name"],
        [{ address: "not an address", name: NAME }, "invalid-address"],
        [
          { address: ADDRESS, name: NAME, data: { nested: {} } },
          "invalid-data",
        ],
        [{ address: ADDRESS, name: NAME, data: ["a list"] }, "invalid-data"],
        [
          { address: ADDRESS, name: NAME, data: { big: "x".repeat(257) } },
          "invalid-data",
        ],
        // Each value within bounds, together past what a secret may carry.
        [
          {
            address: ADDRESS,
            name: "n".repeat(255),
            data: Object.fromEntries(
              Array.from({ length: 4 }, (_, i) => [`k${i}`, "v".repeat(250)])
            ),
          },
          "invalid-data",
        ],
      ] as const) {
        expect(
          await invite(deps, { ...input, sendEmail: true, client: null })
        ).toEqual({ status: "refused", reason });
      }
      expect(core.secrets.minted).toEqual([]);
    });

    it("sends nothing when the site's code sends the link itself", async () => {
      const { mail, server } = await boot();

      await server.invite({ address: ADDRESS, name: NAME, sendEmail: false });
      expect(mail.queued).toEqual([]);
    });

    it("accepts through the REST endpoint while sign-up is closed, answering the cookies and never the site's data", async () => {
      const { server } = await bootReal();
      const issued = await server.invite({
        address: ADDRESS,
        name: NAME,
        data: { personId: "e-17" },
        sendEmail: false,
      });
      const handlers = createDynamicHandlers();
      const call = (
        method: "GET" | "POST",
        path: string,
        init: RequestInit
      ) => {
        const url = new URL(`${TEST_ORIGIN}/api/plugins/${PLUGIN_NAME}${path}`);
        return handlers[method](new Request(url, { method, ...init }), {
          params: Promise.resolve({
            params: url.pathname.split("/").filter(Boolean).slice(1),
          }),
        });
      };
      const csrf = await call("GET", "/csrf", {});
      const { csrfToken } = (await csrf.json()) as { csrfToken: string };

      const answered = await call("POST", "/invitation/accept", {
        headers: {
          origin: TEST_ORIGIN,
          cookie: (csrf.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
          [CSRF_HEADER]: csrfToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token: issued.token,
          password: PASSWORD,
          next: "/welcome",
        }),
      });

      expect(answered.status).toBe(200);
      expect(await answered.json()).toEqual({
        message: "Your account is ready.",
        redirectTo: "/welcome",
      });
      expect(answered.headers.getSetCookie().map(c => c.split("=")[0])).toEqual(
        ["__Host-nx-account", "__Host-nx-account-known"]
      );
    });

    it("is offered by the started plugin to another plugin too", async () => {
      const { ctx, visitor } = await boot({ signUp: "closed" });
      const other = accountsServices(ctx);

      const issued = await other.invite({
        address: ADDRESS,
        name: NAME,
        sendEmail: false,
      });
      expect(
        (
          await other.acceptInvitation({
            visitor,
            token: issued.token,
            password: PASSWORD,
          })
        ).account
      ).toMatchObject({ address: ADDRESS });
    });
  }
);
