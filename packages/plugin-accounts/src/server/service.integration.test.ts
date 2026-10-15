/**
 * The typed server functions on the started plugin, on each dialect: the
 * cookies each answers carry the visitor through the next call, a refusal
 * is thrown with its stable code, and the REST endpoints answer what the
 * functions do.
 *
 * @module server/service.integration.test
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { accountsLimitRules } from "../core/limit-rules";
import type { AccountsErrorCode } from "../errors";
import { PURPOSES } from "../flows/purposes";
import { CSRF_HEADER } from "../http/guard";
import { PLUGIN_NAME } from "../schema/definition";
import { resolveAccountsSettings } from "../settings";
import { accountByAddress } from "../storage/accounts";
import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { fakeAccountsCore, type FakeAccountsCore } from "../testing";

import type { AccountCookieChange, AccountsServer } from "./contract";
import { accountsServer, accountsServices } from "./installed";
import { accountsService } from "./service";

const dana = {
  name: "Dana Reyes",
  address: "dana@example.com",
  password: "a long passphrase",
};

/** The value, or a failure naming what was missing. */
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("expected a value");
  return value;
}

/** The code a refusal was thrown with, or a failure when nothing was refused. */
async function refusedWith(work: Promise<unknown>): Promise<AccountsErrorCode> {
  try {
    await work;
  } catch (error) {
    if (NextlyError.is(error)) return error.code as AccountsErrorCode;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe.each(getConfiguredTestDialects())(
  "the server functions (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<{
      ctx: PluginContext;
      core: FakeAccountsCore;
      server: AccountsServer;
      watched: AccountsServer;
    }> {
      // The running plugin reads real time, so the fake core's clock starts there too.
      const core = fakeAccountsCore({
        start: new Date(),
        rules: accountsLimitRules(
          resolveAccountsSettings({ origin: TEST_ORIGIN })
        ),
      });
      const booted = await bootAccounts(dialect, { core });
      current = booted.nextly;

      // The functions over the deps the flows' own tests use, whose database
      // the fake core watches: a flow that mints a secret inside its
      // transaction needs that, and the started plugin's deps do not give it.
      const { deps } = flowDeps(booted.ctx, {}, core);

      return {
        ctx: booted.ctx,
        core,
        server: await accountsServer(),
        watched: accountsService(() => deps),
      };
    }

    /** A browser's request holding the cookies the changes leave set. */
    function browser(
      server: AccountsServer,
      changes: readonly AccountCookieChange[]
    ): Request {
      const jar = new Map<string, string>();
      for (const change of changes) {
        const write = server.cookieWrite(change);
        if (change.action === "set") jar.set(write.name, write.value);
        else jar.delete(write.name);
      }
      const cookie = [...jar]
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join("; ");

      return new Request(`${TEST_ORIGIN}/account`, {
        headers: cookie === "" ? {} : { cookie },
      });
    }

    it("carries a visitor from sign-up to signed in and out through the cookies they answer", async () => {
      const { ctx, core, watched: server } = await boot();
      const fresh = server.visitorFrom(browser(server, []));
      expect(fresh).toEqual({
        client: null,
        sessionToken: null,
        knownTokens: [],
        signUpToken: null,
      });

      const signedUp = await server.signUp({ visitor: fresh, ...dana });
      expect(signedUp.message).toBe(
        "Check your email to confirm your address."
      );
      expect(signedUp.cookies).toEqual([
        expect.objectContaining({ cookie: "signUp", action: "set" }),
      ]);

      const account = required(await accountByAddress(ctx.db, dana.address));
      const code = required(
        core.secrets.lastMinted(account.id, PURPOSES.verifyCode)
      ).secret;
      let held = [...signedUp.cookies];
      const verified = await server.verifyAddress({
        visitor: server.visitorFrom(browser(server, held)),
        address: dana.address,
        code,
      });
      expect(verified.signedIn).toBe(true);
      expect(verified.cookies.map(c => [c.cookie, c.action])).toEqual([
        ["signUp", "clear"],
        ["session", "set"],
      ]);

      held = [...held, ...verified.cookies];
      const signedIn = server.visitorFrom(browser(server, held));
      expect(signedIn.signUpToken).toBeNull();
      expect(await server.currentAccount({ visitor: signedIn })).toEqual({
        id: account.id,
        name: dana.name,
        address: dana.address,
        verified: true,
      });

      const out = await server.signOut({ visitor: signedIn });
      expect(out.cookies).toEqual([{ cookie: "session", action: "clear" }]);
      expect(
        await server.currentAccount({
          visitor: server.visitorFrom(
            browser(server, [...held, ...out.cookies])
          ),
        })
      ).toBeNull();
      // The token itself is ended, not only its cookie.
      expect(await server.currentAccount({ visitor: signedIn })).toBeNull();
    });

    it("marks the browser known on sign-in, keeping the tokens it already held", async () => {
      const { ctx, core, server } = await boot();
      const { deps } = flowDeps(ctx, {}, core);
      await makeAccount(deps, "dana@example.com");
      await makeAccount(deps, "eli@example.com");

      const first = await server.signIn({
        visitor: server.visitorFrom(browser(server, [])),
        address: "dana@example.com",
        password: TEST_PASSWORD,
      });
      expect(first.cookies.map(c => [c.cookie, c.action])).toEqual([
        ["session", "set"],
        ["knownBrowsers", "set"],
      ]);
      const second = await server.signIn({
        visitor: server.visitorFrom(browser(server, first.cookies)),
        address: "eli@example.com",
        password: TEST_PASSWORD,
      });
      const known = server.visitorFrom(
        browser(server, [...first.cookies, ...second.cookies])
      ).knownTokens;

      expect(known).toHaveLength(2);
      expect(
        server.visitorFrom(browser(server, first.cookies)).knownTokens[0]
      ).toBe(known[0]);
    });

    it("throws each refusal as its stable code", async () => {
      const { ctx, core, server } = await boot();
      const { deps } = flowDeps(ctx, {}, core);
      await makeAccount(deps, "dana@example.com");
      const nobody = server.visitorFrom(browser(server, []));

      expect(
        await refusedWith(
          server.signIn({
            visitor: nobody,
            address: "dana@example.com",
            password: "not the passphrase",
          })
        )
      ).toBe("ACCOUNTS_WRONG_CREDENTIALS");
      expect(
        await refusedWith(server.signOutEverywhere({ visitor: nobody }))
      ).toBe("ACCOUNTS_SIGN_IN_NEEDED");
      expect(
        await refusedWith(
          server.changePassword({
            visitor: nobody,
            currentPassword: TEST_PASSWORD,
            newPassword: "another long passphrase",
          })
        )
      ).toBe("ACCOUNTS_SIGN_IN_NEEDED");
      expect(
        await refusedWith(
          server.resetPassword({
            visitor: nobody,
            token: "not-a-token",
            password: "another long passphrase",
          })
        )
      ).toBe("ACCOUNTS_LINK_REFUSED");
    });

    it("is the same service another plugin reaches through its own context", async () => {
      const { ctx, core, server } = await boot();
      const { deps } = flowDeps(ctx, {}, core);
      const id = await makeAccount(deps, "dana@example.com");
      const signedIn = await server.signIn({
        visitor: server.visitorFrom(browser(server, [])),
        address: "dana@example.com",
        password: TEST_PASSWORD,
      });

      expect(
        await accountsServices(ctx).currentAccount({
          visitor: server.visitorFrom(browser(server, signedIn.cookies)),
        })
      ).toMatchObject({ id });
    });

    it("answers through REST what the function answers, its cookie changes as Set-Cookie", async () => {
      const { ctx, core, server } = await boot();
      const { deps } = flowDeps(ctx, {}, core);
      await makeAccount(deps, "dana@example.com");
      const base = `${TEST_ORIGIN}/api/plugins/${PLUGIN_NAME}`;
      const handlers = createDynamicHandlers();
      const call = (
        method: "GET" | "POST",
        path: string,
        init: RequestInit
      ) => {
        const url = new URL(`${base}${path}`);
        return handlers[method](new Request(url, { method, ...init }), {
          params: Promise.resolve({
            params: url.pathname.split("/").filter(Boolean).slice(1),
          }),
        });
      };

      const issued = await call("GET", "/csrf", {});
      const csrfCookie = required(issued.headers.get("set-cookie")).split(
        ";"
      )[0];
      const { csrfToken } = (await issued.json()) as { csrfToken: string };
      const answered = await call("POST", "/sign-in", {
        headers: {
          origin: TEST_ORIGIN,
          cookie: required(csrfCookie),
          [CSRF_HEADER]: csrfToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          address: "dana@example.com",
          password: TEST_PASSWORD,
          next: "//elsewhere.example/steal",
        }),
      });

      expect(answered.status).toBe(200);
      expect(await answered.json()).toEqual({
        message: "Signed in.",
        redirectTo: "/",
      });
      // The function's two cookie changes, in its order: the session, then
      // the browser marked known.
      const written = answered.headers.getSetCookie();
      expect(written.map(cookie => cookie.split("=")[0])).toEqual([
        server.cookieWrite({ cookie: "session", action: "clear" }).name,
        server.cookieWrite({ cookie: "knownBrowsers", action: "clear" }).name,
      ]);
      expect(written[0]).toMatch(
        /^__Host-nx-account=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=[1-9]\d*; Secure$/
      );
    });
  }
);
