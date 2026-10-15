/**
 * The REST endpoints on each dialect, called as a browser on the site calls
 * them: the cookies each answer sets and clears, the account data an answer
 * carries or withholds, the codes a refusal is thrown with, and that no
 * answer is cached.
 *
 * @module http/endpoints.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import {
  json,
  refusal,
  setCookiesOf,
  type TestBrowser,
} from "../test-support/browser";
import { bootEndpoints } from "../test-support/endpoints";

import { cookieName } from "./cookies";
import {
  changeAddressEndpoint,
  changePasswordEndpoint,
  confirmAddressEndpoint,
  deleteAccountEndpoint,
  meEndpoint,
  resendEndpoint,
  resetEndpoint,
  resetRequestEndpoint,
  signInEndpoint,
  signOutEndpoint,
  signOutEverywhereEndpoint,
  signUpEndpoint,
  verifyEndpoint,
} from "./handlers";

const NEW_PASSWORD = "a brand new passphrase";

const dana = {
  name: "Dana Reyes",
  address: "dana@example.com",
  password: TEST_PASSWORD,
};

describe.each(getConfiguredTestDialects())(
  "the endpoints (%s)",
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

    /** Signs up as Dana and verifies by the emailed code, in the same browser. */
    async function signUpAndVerify(
      browser: TestBrowser,
      code: () => string
    ): Promise<void> {
      await browser.post(signUpEndpoint, dana);
      await browser.post(verifyEndpoint, {
        address: dana.address,
        code: code(),
      });
    }

    it("signs up, verifies by code in the same browser, names the account, and signs out", async () => {
      const { deps, mail, browser: open } = await boot();
      const browser = await open();

      const signedUp = await browser.post(signUpEndpoint, dana);
      expect(await json(signedUp)).toEqual({
        message: "Check your email to confirm your address.",
      });
      expect(browser.cookie("signUp")).toBeTruthy();
      expect(browser.cookie("session")).toBeUndefined();

      const code = mail.ofKind("verify-address")[0]?.code ?? "";
      const verified = await browser.post(verifyEndpoint, {
        address: dana.address,
        code,
      });
      expect(await json(verified)).toMatchObject({ signedIn: true });
      expect(browser.cookie("signUp")).toBeUndefined();
      const session = browser.cookie("session") ?? "";
      expect(session).not.toBe("");

      expect(await json(await browser.get(meEndpoint))).toMatchObject({
        account: { name: "Dana Reyes", address: dana.address, verified: true },
      });

      const signedOut = await browser.post(signOutEndpoint);
      expect(
        setCookiesOf(signedOut)
          .find(cookie => cookie.name === cookieName(deps.settings, "session"))
          ?.attributes.get("max-age")
      ).toBe("0");
      expect(browser.cookie("session")).toBeUndefined();
      expect(await json(await browser.get(meEndpoint))).toMatchObject({
        account: null,
      });

      // The session ended, not just its cookie: the old token names nobody.
      browser.hold("session", session);
      expect(await json(await browser.get(meEndpoint))).toMatchObject({
        account: null,
      });
    });

    it("sets the session and known-browser cookies on sign-in, HTTP-only, Lax, for the whole site, secure and host-only", async () => {
      const { deps, browser: open } = await boot();
      await makeAccount(deps, dana.address);
      const browser = await open();

      const answer = await browser.post(signInEndpoint, dana);
      const cookies = setCookiesOf(answer);

      for (const kind of ["session", "knownBrowsers"] as const) {
        const cookie = cookies.find(
          set => set.name === cookieName(deps.settings, kind)
        );
        expect(cookie?.name.startsWith("__Host-")).toBe(true);
        expect(cookie?.value).not.toBe("");
        expect(Object.fromEntries(cookie?.attributes ?? [])).toMatchObject({
          httponly: "",
          samesite: "Lax",
          path: "/",
          secure: "",
        });
        expect(Number(cookie?.attributes.get("max-age"))).toBeGreaterThan(0);
      }
    });

    it("sends a signed-in visitor back to a path on the site only", async () => {
      const { deps, browser: open } = await boot();
      await makeAccount(deps, dana.address);
      const browser = await open();
      const redirectTo = async (next?: string) =>
        (
          await json(
            await browser.post(signInEndpoint, {
              ...dana,
              ...(next === undefined ? {} : { next }),
            })
          )
        ).redirectTo;

      expect(await redirectTo("/orders?page=2")).toBe("/orders?page=2");
      expect(await redirectTo("//evil.example.com")).toBe("/");
      expect(await redirectTo("https://evil.example.com/orders")).toBe("/");
      expect(await redirectTo()).toBe("/");
    });

    it("throws a wrong password as wrong credentials, and a waiting address with its wait in seconds", async () => {
      const { deps, browser: open } = await boot();
      await makeAccount(deps, dana.address);
      const browser = await open();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(
          await refusal(
            browser.post(signInEndpoint, { ...dana, password: "wrong" })
          )
        ).toMatchObject({
          code: "ACCOUNTS_WRONG_CREDENTIALS",
          statusCode: 401,
        });
      }
      expect(await refusal(browser.post(signInEndpoint, dana))).toMatchObject({
        code: "ACCOUNTS_WAIT",
        statusCode: 429,
        publicData: { reason: "wait", retryAfterSeconds: 1 },
      });
    });

    it("throws a link that is not one as refused", async () => {
      const { browser: open } = await boot();
      const browser = await open();

      expect(
        await refusal(
          browser.post(resetEndpoint, {
            token: "not-a-token",
            password: NEW_PASSWORD,
          })
        )
      ).toMatchObject({ code: "ACCOUNTS_LINK_REFUSED", statusCode: 400 });
      expect(
        await refusal(browser.post(verifyEndpoint, { token: "not-a-token" }))
      ).toMatchObject({ code: "ACCOUNTS_LINK_REFUSED", statusCode: 400 });
    });

    it("throws sign-in needed from every holder's endpoint without a session", async () => {
      const { deps, browser: open } = await boot();
      await makeAccount(deps, dana.address);
      const browser = await open();
      const asks = [
        [signOutEverywhereEndpoint, {}],
        [
          changePasswordEndpoint,
          { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
        ],
        [
          changeAddressEndpoint,
          { currentPassword: TEST_PASSWORD, newAddress: "new@example.com" },
        ],
        [confirmAddressEndpoint, { code: "123456" }],
        [deleteAccountEndpoint, { currentPassword: TEST_PASSWORD }],
      ] as const;

      for (const [endpoint, body] of asks) {
        expect(await refusal(browser.post(endpoint, body))).toMatchObject({
          code: "ACCOUNTS_SIGN_IN_NEEDED",
          statusCode: 401,
        });
      }
    });

    it("answers every success with no-store, so no cache keeps account data", async () => {
      const { mail, browser: open } = await boot();
      const browser = await open();
      await signUpAndVerify(
        browser,
        () => mail.ofKind("verify-address")[0]?.code ?? ""
      );
      await browser.get(meEndpoint);
      await browser.post(changePasswordEndpoint, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      await browser.post(signInEndpoint, { ...dana, password: NEW_PASSWORD });
      await browser.post(resendEndpoint, { address: dana.address });
      await browser.post(resetRequestEndpoint, { address: dana.address });
      await browser.post(signOutEverywhereEndpoint);
      await browser.post(signOutEndpoint);
      await browser.get(meEndpoint);

      expect(browser.answers).toHaveLength(11);
      for (const answer of browser.answers)
        expect(answer.headers.get("cache-control")).toBe("no-store");
    });

    it("resets a password by the emailed link, marks the browser known, and signs in with the new password only", async () => {
      const { deps, mail, browser: open } = await boot();
      await makeAccount(deps, dana.address);
      const browser = await open();

      await browser.post(resetRequestEndpoint, { address: dana.address });
      const link = mail.ofKind("reset-password")[0]?.link ?? "";
      const token = new URL(link).searchParams.get("token") ?? "";
      expect(token).not.toBe("");
      expect(browser.cookie("knownBrowsers")).toBeUndefined();

      const reset = await browser.post(resetEndpoint, {
        token,
        password: NEW_PASSWORD,
      });
      expect(browser.cookie("knownBrowsers")).toBeTruthy();
      expect(browser.cookie("session")).toBeUndefined();
      expect(
        Number(
          setCookiesOf(reset)
            .find(
              cookie =>
                cookie.name === cookieName(deps.settings, "knownBrowsers")
            )
            ?.attributes.get("max-age")
        )
      ).toBeGreaterThan(0);

      expect(await refusal(browser.post(signInEndpoint, dana))).toMatchObject({
        code: "ACCOUNTS_WRONG_CREDENTIALS",
      });
      await browser.post(signInEndpoint, { ...dana, password: NEW_PASSWORD });
      expect(await json(await browser.get(meEndpoint))).toMatchObject({
        account: { address: dana.address },
      });
    });
  }
);
