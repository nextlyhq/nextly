/**
 * The plugin's kind of signed-in person, as core asks for it, on each
 * dialect.
 *
 * @module http/principal.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { accountsLimitRules } from "../core/limit-rules";
import { signOut } from "../flows/sessions";
import { signIn } from "../flows/sign-in";
import { resolveAccountsSettings } from "../settings";
import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { fakeAccountsCore } from "../testing";

import { cookieName } from "./cookies";
import { ACCOUNT_KIND } from "./principal";

describe.each(getConfiguredTestDialects())(
  "the account kind (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot() {
      // The running plugin reads real time, so the flows' clock starts there too.
      const core = fakeAccountsCore({
        start: new Date(),
        rules: accountsLimitRules(
          resolveAccountsSettings({ origin: TEST_ORIGIN })
        ),
      });
      const booted = await bootAccounts(dialect, { core });
      current = booted.nextly;
      const made = flowDeps(booted.ctx, {}, core);
      const id = await makeAccount(made.deps, "dana@example.com");
      const signedIn = await signIn(made.deps, {
        address: "dana@example.com",
        password: TEST_PASSWORD,
        client: null,
      });
      if (signedIn.status !== "signed-in")
        throw new Error("expected a sign-in");
      const request = (cookie?: string) =>
        new Request(`${TEST_ORIGIN}/account`, {
          headers: cookie === undefined ? {} : { cookie },
        });
      const sessionCookie = `${cookieName(made.deps.settings, "session")}=${signedIn.session.token}`;
      return {
        ctx: booted.ctx,
        deps: made.deps,
        id,
        session: signedIn.session.token,
        request,
        sessionCookie,
      };
    }

    it("names the account the session cookie belongs to, with whether it is verified", async () => {
      const { ctx, id, request, sessionCookie } = await boot();

      expect(
        await ctx.principals?.fromRequest(request(sessionCookie), ACCOUNT_KIND)
      ).toMatchObject({
        id,
        attributes: { verified: true },
      });
    });

    it("names nobody without the cookie, for a session signed out, or for a cookie of another name", async () => {
      const { ctx, deps, session, request, sessionCookie } = await boot();

      expect(
        await ctx.principals?.fromRequest(request(), ACCOUNT_KIND)
      ).toBeNull();
      expect(
        await ctx.principals?.fromRequest(
          request(`nx-account-signup=${session}`),
          ACCOUNT_KIND
        )
      ).toBeNull();
      await signOut(deps, { sessionToken: session });
      expect(
        await ctx.principals?.fromRequest(request(sessionCookie), ACCOUNT_KIND)
      ).toBeNull();
    });
  }
);
