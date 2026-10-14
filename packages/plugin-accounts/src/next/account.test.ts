/**
 * The signed-in account for a server component, and the link pages' header
 * and metadata, with Next.js's request APIs stood in for.
 *
 * @module next/account.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowDeps } from "../flows/deps";
import type { SignedInAccount } from "../flows/sessions";
import type { AccountsServer } from "../server/contract";
import { accountsService } from "../server/service";
import { resolveAccountsSettings } from "../settings";
import { fakeAccountsCore } from "../testing";

import { currentAccount, requireAccount } from "./account";
import { linkPageHeaders, linkPageMetadata } from "./link-page";

const ORIGIN = "https://shop.example.com";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirected to ${to}`);
  }
}

const next = vi.hoisted(() => ({
  headers: new Headers(),
  server: undefined as unknown,
}));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(next.headers),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("../server/installed", () => ({
  accountsServer: () => Promise.resolve(next.server),
}));

const dana: SignedInAccount = {
  id: "acc_1",
  name: "Dana",
  address: "dana@example.com",
  verified: true,
};

/** The plugin's real functions over settings alone, answering `account` for the session `held`. */
function serve(held: string, account: SignedInAccount): AccountsServer {
  // Only what the helpers over settings read: every flow a test reaches is
  // replaced, so no database is needed.
  const deps = {
    settings: resolveAccountsSettings({
      origin: ORIGIN,
      pages: { signIn: "/members/sign-in" },
    }),
    core: fakeAccountsCore(),
    now: () => new Date(),
  } as unknown as FlowDeps;
  const server: AccountsServer = {
    ...accountsService(() => deps),
    currentAccount: ({ visitor }) =>
      Promise.resolve(visitor.sessionToken === held ? account : null),
  };
  next.server = server;
  return server;
}

beforeEach(() => {
  next.headers = new Headers();
  serve("live", dana);
});

describe("the signed-in account for a server component", () => {
  it("is the account the request's session cookie names", async () => {
    next.headers = new Headers({ cookie: "__Host-nx-account=live" });

    expect(await currentAccount()).toEqual(dana);
    expect(await requireAccount({ returnTo: "/orders" })).toEqual(dana);
  });

  it("is nobody without a session, and the page that requires one sends the visitor to sign in and back", async () => {
    next.headers = new Headers({ cookie: "__Host-nx-account=ended" });

    expect(await currentAccount()).toBeNull();
    await expect(
      requireAccount({ returnTo: "/orders/7?tab=items" })
    ).rejects.toMatchObject({
      to: "/members/sign-in?next=%2Forders%2F7%3Ftab%3Ditems",
    });
  });

  it("drops a return address that is not a path on the site", async () => {
    for (const unsafe of [
      "https://evil.example/x",
      "//evil.example/x",
      "/%2F%2Fevil.example",
    ]) {
      await expect(requireAccount({ returnTo: unsafe })).rejects.toMatchObject({
        to: "/members/sign-in",
      });
    }
    await expect(requireAccount()).rejects.toMatchObject({
      to: "/members/sign-in",
    });
  });
});

describe("a page a link from an email lands on", () => {
  it("sends no referrer, by its metadata and by its header", () => {
    expect(linkPageMetadata).toEqual({ referrer: "no-referrer" });
    expect(
      linkPageHeaders({
        origin: ORIGIN,
        pages: { reset: "/members/reset" },
      })
    ).toEqual(
      [
        "/account/verify",
        "/account/not-me",
        "/members/reset",
        "/account/address",
        "/account/address/cancel",
      ].map(source => ({
        source,
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      }))
    );
  });
});
