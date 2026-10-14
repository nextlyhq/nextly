import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { FlowDeps } from "../flows/deps";
import { resolveAccountsSettings } from "../settings";
import { accountsWithCore, fakeAccountsCore } from "../testing";

import {
  accountsServices,
  forgetInstalled,
  fromInstalled,
  rememberInstalled,
} from "./installed";

const ORIGIN = "https://shop.example.com";

/** Deps whose settings say which boot recorded them, by the sign-in page. */
function depsWith(signIn: string): () => FlowDeps {
  const settings = resolveAccountsSettings({
    origin: ORIGIN,
    pages: { signIn },
  });
  return () => ({ settings }) as FlowDeps;
}

function codeOf(work: () => unknown): string | undefined {
  try {
    work();
  } catch (error) {
    if (NextlyError.is(error)) return error.code;
    throw error;
  }
  return undefined;
}

describe("the started plugin's deps", () => {
  it("are forgotten by the boot that recorded them, and by no other", () => {
    const first = depsWith("/first/sign-in");
    const second = depsWith("/second/sign-in");
    rememberInstalled(first);
    expect(fromInstalled().signInPath()).toBe("/first/sign-in");

    // A newer boot records its own before the older one's teardown runs.
    rememberInstalled(second);
    forgetInstalled(first);
    expect(fromInstalled().signInPath()).toBe("/second/sign-in");

    forgetInstalled(second);
    expect(codeOf(() => fromInstalled())).toBe("ACCOUNTS_NOT_STARTED");
  });

  it("are recorded when the plugin starts and forgotten when it stops", async () => {
    const plugin = accountsWithCore(
      { origin: ORIGIN, pages: { signIn: "/members/sign-in" } },
      fakeAccountsCore()
    );
    // Only what building the deps reads (the stand-ins watch its database);
    // no flow runs here.
    const ctx = { db: {} } as unknown as PluginContext;
    await plugin.init?.(ctx);
    expect(fromInstalled().signInPath("/orders")).toBe(
      "/members/sign-in?next=%2Forders"
    );

    await plugin.destroy?.(ctx);
    expect(codeOf(() => fromInstalled())).toBe("ACCOUNTS_NOT_STARTED");
  });
});

describe("the service another plugin reaches", () => {
  it("is refused, by code, where the accounts plugin is not installed", () => {
    const ctx = {
      services: { plugins: { other: { accounts: {} } } },
    } as unknown as PluginContext;

    expect(codeOf(() => accountsServices(ctx))).toBe("ACCOUNTS_NOT_STARTED");
  });
});

describe("the sign-in page a visitor is sent to", () => {
  it("carries a path on the site to come back to, and nothing else", () => {
    rememberInstalled(depsWith("/account/sign-in"));
    const server = fromInstalled();

    expect(server.signInPath("/orders/7?tab=items")).toBe(
      "/account/sign-in?next=%2Forders%2F7%3Ftab%3Ditems"
    );
    expect(server.signInPath("//evil.example/x")).toBe("/account/sign-in");
    expect(server.signInPath("https://evil.example/x")).toBe(
      "/account/sign-in"
    );
    expect(server.signInPath()).toBe("/account/sign-in");
  });
});
