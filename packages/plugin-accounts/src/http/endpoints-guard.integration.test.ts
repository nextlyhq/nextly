/**
 * The write endpoints' guard on each dialect: a write from another site,
 * from no page at all, or without the plugin's CSRF token is refused before
 * it does anything, even one the signed-in holder's cookies and password
 * would let through.
 *
 * @module http/endpoints-guard.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { signIn } from "../flows/sign-in";
import { accounts as accountsTable } from "../schema/tables";
import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import { TEST_ORIGIN } from "../test-support/boot";
import { json, refusal, type HeaderChanges } from "../test-support/browser";
import { bootEndpoints } from "../test-support/endpoints";

import { CSRF_HEADER } from "./guard";
import {
  cancelAddressEndpoint,
  changeAddressEndpoint,
  changePasswordEndpoint,
  confirmAddressEndpoint,
  deleteAccountEndpoint,
  meEndpoint,
  notMeEndpoint,
  resendEndpoint,
  resetEndpoint,
  resetRequestEndpoint,
  signInEndpoint,
  signOutEndpoint,
  signOutEverywhereEndpoint,
  signUpEndpoint,
  verifyEndpoint,
  type Endpoint,
} from "./handlers";

const NEW_PASSWORD = "a brand new passphrase";
const EVIL = "https://evil.example.com";

/** Every write, each with a body that would do something if it were let through. */
const WRITES: ReadonlyArray<
  readonly [string, Endpoint, Record<string, unknown>]
> = [
  [
    "sign-up",
    signUpEndpoint,
    { name: "Eve", address: "eve@example.com", password: TEST_PASSWORD },
  ],
  ["verify", verifyEndpoint, { address: "dana@example.com", code: "123456" }],
  ["resend", resendEndpoint, { address: "dana@example.com" }],
  ["not-me", notMeEndpoint, { token: "a-token" }],
  [
    "sign-in",
    signInEndpoint,
    { address: "dana@example.com", password: TEST_PASSWORD },
  ],
  ["sign-out", signOutEndpoint, {}],
  ["reset request", resetRequestEndpoint, { address: "dana@example.com" }],
  ["reset", resetEndpoint, { token: "a-token", password: NEW_PASSWORD }],
  ["cancel address", cancelAddressEndpoint, { token: "a-token" }],
  ["sign out everywhere", signOutEverywhereEndpoint, {}],
  [
    "change password",
    changePasswordEndpoint,
    { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
  ],
  [
    "change address",
    changeAddressEndpoint,
    { currentPassword: TEST_PASSWORD, newAddress: "new@example.com" },
  ],
  ["confirm address", confirmAddressEndpoint, { code: "123456" }],
  ["delete", deleteAccountEndpoint, { currentPassword: TEST_PASSWORD }],
];

/** The requests no page of the site sends. */
const CROSS_SITE: ReadonlyArray<readonly [string, HeaderChanges]> = [
  ["another origin", { origin: EVIL }],
  ["another site's referer", { origin: null, referer: `${EVIL}/page` }],
  ["no origin or referer", { origin: null }],
  ["no CSRF token", { [CSRF_HEADER]: null }],
  ["another CSRF token", { [CSRF_HEADER]: "not-the-cookie" }],
];

describe.each(getConfiguredTestDialects())(
  "the write guard (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot() {
      const booted = await bootEndpoints(dialect);
      current = booted.nextly;
      return booted;
    }

    it("refuses every write from another site, from no page, or without the CSRF token, before it does anything", async () => {
      const { ctx, deps, mail, browser: open } = await boot();
      await makeAccount(deps, "dana@example.com");
      const browser = await open();
      await browser.post(signInEndpoint, {
        address: "dana@example.com",
        password: TEST_PASSWORD,
      });
      const before = mail.queued.length;

      for (const [, endpoint, body] of WRITES) {
        for (const [, changes] of CROSS_SITE) {
          expect(
            await refusal(browser.post(endpoint, body, changes))
          ).toMatchObject({ code: "ACCOUNTS_CROSS_SITE", statusCode: 403 });
        }
      }

      expect(browser.answers).toHaveLength(2);
      expect(mail.queued).toHaveLength(before);
      expect(await ctx.db.select(accountsTable).all()).toHaveLength(1);
      expect(await json(await browser.get(meEndpoint))).toMatchObject({
        account: { address: "dana@example.com" },
      });
      expect(
        await signIn(deps, {
          address: "dana@example.com",
          password: TEST_PASSWORD,
          client: null,
        })
      ).toMatchObject({ status: "signed-in" });
    });

    it("makes no account and sends no email for a sign-up from another site", async () => {
      const { ctx, mail, browser: open } = await boot();
      const browser = await open();

      expect(
        await refusal(
          browser.post(
            signUpEndpoint,
            {
              name: "Eve",
              address: "eve@example.com",
              password: TEST_PASSWORD,
            },
            { origin: EVIL }
          )
        )
      ).toMatchObject({ code: "ACCOUNTS_CROSS_SITE" });
      expect(await ctx.db.select(accountsTable).all()).toEqual([]);
      expect(mail.queued).toEqual([]);
      expect(browser.cookie("signUp")).toBeUndefined();
    });

    it("lets a write through from the site's own page, by its origin or, without one, its referer", async () => {
      const { mail, browser: open } = await boot();
      const browser = await open();

      await browser.post(signUpEndpoint, {
        name: "Dana",
        address: "dana@example.com",
        password: TEST_PASSWORD,
      });
      await browser.post(
        resendEndpoint,
        { address: "dana@example.com" },
        { origin: null, referer: `${TEST_ORIGIN}/account/sign-up` }
      );

      expect(mail.ofKind("verify-address")).toHaveLength(2);
    });
  }
);
