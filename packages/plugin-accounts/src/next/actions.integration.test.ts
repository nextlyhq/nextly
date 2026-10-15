/**
 * The server actions and the signed-in account helper on the started
 * plugin, on each dialect, with only Next.js's request APIs stood in for: a
 * browser signs in by a form, its cookies carry it to a page that requires
 * an account, and it signs out of it; a form from another site changes
 * nothing.
 *
 * @module next/actions.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accountsLimitRules } from "../core/limit-rules";
import { resolveAccountsSettings } from "../settings";
import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { fakeAccountsCore } from "../testing";

import { requireAccount } from "./account";
import {
  initialAccountFormState,
  signInAction,
  signOutAction,
} from "./actions";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirected to ${to}`);
  }
}

/** The browser: the cookies it holds, and the headers of its next request. */
const browser = vi.hoisted(() => {
  const held = new Map<string, string>();
  return {
    held,
    origin: null as string | null,
    jar: {
      set(name: string, value: string, options: { maxAge: number }) {
        if (options.maxAge === 0) held.delete(name);
        else held.set(name, value);
      },
    },
  };
});

vi.mock("next/headers", () => ({
  headers: () => {
    const sent = new Headers();
    if (browser.origin !== null) sent.set("origin", browser.origin);
    const cookie = [...browser.held]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("; ");
    if (cookie !== "") sent.set("cookie", cookie);
    return Promise.resolve(sent);
  },
  cookies: () => Promise.resolve(browser.jar),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function sentTo(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  throw new Error("expected a redirect");
}

describe.each(getConfiguredTestDialects())(
  "the server actions (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    beforeEach(() => {
      browser.held.clear();
      browser.origin = null;
    });

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<string> {
      // The running plugin reads real time, so the fake core's clock starts there too.
      const core = fakeAccountsCore({
        start: new Date(),
        rules: accountsLimitRules(
          resolveAccountsSettings({ origin: TEST_ORIGIN })
        ),
      });
      const booted = await bootAccounts(dialect, { core });
      current = booted.nextly;

      return makeAccount(
        flowDeps(booted.ctx, {}, core).deps,
        "dana@example.com"
      );
    }

    it("signs a browser in by a form, carries it to a page that requires an account, and signs it out", async () => {
      const id = await boot();
      browser.origin = TEST_ORIGIN;

      expect(
        await sentTo(
          signInAction(
            initialAccountFormState,
            form({
              address: "dana@example.com",
              password: TEST_PASSWORD,
              next: "/orders",
            })
          )
        )
      ).toBe("/orders");
      expect([...browser.held.keys()]).toEqual([
        "__Host-nx-account",
        "__Host-nx-account-known",
      ]);

      // The page the visitor lands on is a GET, which sends no Origin.
      browser.origin = null;
      expect(await requireAccount({ returnTo: "/orders" })).toMatchObject({
        id,
        address: "dana@example.com",
        verified: true,
      });

      browser.origin = TEST_ORIGIN;
      expect(
        await signOutAction(initialAccountFormState, new FormData())
      ).toMatchObject({ status: "done", message: "Signed out." });
      // The known-browser cookie outlives a sign-out; the session does not.
      expect([...browser.held.keys()]).toEqual(["__Host-nx-account-known"]);
      expect(await sentTo(requireAccount({ returnTo: "/orders" }))).toBe(
        "/account/sign-in?next=%2Forders"
      );
    });

    it("refuses a sign-in posted from another site, setting no cookie", async () => {
      await boot();
      browser.origin = "https://evil.example";

      expect(
        await signInAction(
          initialAccountFormState,
          form({ address: "dana@example.com", password: TEST_PASSWORD })
        )
      ).toMatchObject({ status: "refused", code: "ACCOUNTS_CROSS_SITE" });
      expect(browser.held.size).toBe(0);
    });

    it("answers a wrong password on the form, by its code", async () => {
      await boot();
      browser.origin = TEST_ORIGIN;

      expect(
        await signInAction(
          initialAccountFormState,
          form({ address: "dana@example.com", password: "not it at all" })
        )
      ).toMatchObject({
        status: "refused",
        code: "ACCOUNTS_WRONG_CREDENTIALS",
        message: "The email address or the password is wrong.",
      });
      expect(browser.held.size).toBe(0);
    });
  }
);
