/**
 * The sign-up switch on every entry a visitor or another plugin signs up
 * through, on each dialect: open, each makes an account; closed, each is
 * refused alike, for a free address and a taken one, and nothing is made,
 * counted or emailed.
 *
 * @module server/sign-up-switch.integration.test
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accountsLimitRules } from "../core/limit-rules";
import type { FlowDeps } from "../flows/deps";
import { CSRF_HEADER } from "../http/guard";
import { initialAccountFormState, signUpAction } from "../next/actions";
import { PLUGIN_NAME } from "../schema/definition";
import { resolveAccountsSettings } from "../settings";
import { accountByAddress } from "../storage/accounts";
import { makeAccount } from "../test-support/accounts";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { fakeAccountsCore, type FakeAccountsMail } from "../testing";

import type { AccountsServer } from "./contract";
import { accountsServer, accountsServices } from "./installed";
import { accountsService } from "./service";

/** The headers a server action's request carries: from the site, with no cookies. */
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ origin: TEST_ORIGIN })),
  cookies: () => Promise.resolve({ set: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
}));

const PASSWORD = "a long passphrase";
/** An address that already has an account, which a closed sign-up must answer as it answers any other. */
const TAKEN = "taken@example.com";

/** The four ways in, each signing up `address` and answering its refusal's code, or null when accepted. */
type Entry = (address: string) => Promise<string | null>;

/** The code a refusal was thrown with, or null when nothing was refused. */
async function codeOf(work: Promise<unknown>): Promise<string | null> {
  try {
    await work;
  } catch (error) {
    if (NextlyError.is(error)) return error.code;
    throw error;
  }
  return null;
}

/** A REST sign-up from a browser on the site, holding the plugin's CSRF token. */
async function restSignUp(address: string): Promise<string | null> {
  const handlers = createDynamicHandlers();
  const call = (method: "GET" | "POST", path: string, init: RequestInit) => {
    const url = new URL(`${TEST_ORIGIN}/api/plugins/${PLUGIN_NAME}${path}`);
    return handlers[method](new Request(url, { method, ...init }), {
      params: Promise.resolve({
        params: url.pathname.split("/").filter(Boolean).slice(1),
      }),
    });
  };
  const issued = await call("GET", "/csrf", {});
  const csrfCookie = (issued.headers.get("set-cookie") ?? "").split(";")[0];
  const { csrfToken } = (await issued.json()) as { csrfToken: string };
  const answered = await call("POST", "/sign-up", {
    headers: {
      origin: TEST_ORIGIN,
      cookie: csrfCookie ?? "",
      [CSRF_HEADER]: csrfToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Dana Reyes", address, password: PASSWORD }),
  });
  if (answered.status === 200) return null;
  const body = (await answered.json()) as { error?: { code?: string } };

  return `${answered.status} ${body.error?.code ?? ""}`;
}

describe.each(getConfiguredTestDialects())(
  "the sign-up switch (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(signUp: "open" | "closed"): Promise<{
      ctx: PluginContext;
      deps: FlowDeps;
      mail: FakeAccountsMail;
      server: AccountsServer;
      entries: Record<string, Entry>;
    }> {
      // The running plugin reads real time, so the fake core's clock starts there too.
      const settings = resolveAccountsSettings({ origin: TEST_ORIGIN, signUp });
      const core = fakeAccountsCore({
        start: new Date(),
        rules: accountsLimitRules(settings),
      });
      const booted = await bootAccounts(dialect, {
        core,
        settings: { signUp },
      });
      current = booted.nextly;
      const { deps, mail } = flowDeps(booted.ctx, { signUp }, core);
      const server = await accountsServer();
      const visitor = server.visitorFrom(new Headers());
      const signUpAs =
        (on: AccountsServer): Entry =>
        address =>
          codeOf(
            on.signUp({
              visitor,
              name: "Dana Reyes",
              address,
              password: PASSWORD,
            })
          );

      return {
        ctx: booted.ctx,
        deps,
        mail,
        server,
        entries: {
          "the server function": signUpAs(server),
          "another plugin's service": signUpAs(accountsServices(booted.ctx)),
          "the REST endpoint": restSignUp,
          "the server action": async address => {
            const state = await signUpAction(
              initialAccountFormState,
              formOf({ name: "Dana Reyes", address, password: PASSWORD })
            );
            return state.status === "refused" ? state.code : null;
          },
        },
      };
    }

    it("is open by default: a site that never sets it signs people up through every entry", async () => {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const { deps } = flowDeps(booted.ctx);

      expect(deps.settings.signUp).toBe("open");
      const server = await accountsServer();
      await server.signUp({
        visitor: server.visitorFrom(new Headers()),
        name: "Dana Reyes",
        address: "default@example.com",
        password: PASSWORD,
      });
      expect(
        await accountByAddress(deps.db, "default@example.com")
      ).not.toBeNull();
    });

    it("open, makes an account through each entry", async () => {
      const { deps, entries } = await boot("open");

      for (const [entry, signUp] of Object.entries(entries)) {
        const address = `${entry.replaceAll(/\W+/g, "-")}@example.com`;
        expect(await signUp(address), entry).toBeNull();
        expect(await accountByAddress(deps.db, address), entry).not.toBeNull();
      }
    });

    it("closed, refuses each entry alike for a free address and a taken one, and makes nothing", async () => {
      const { deps, entries } = await boot("closed");
      await makeAccount(deps, TAKEN);

      for (const [entry, signUp] of Object.entries(entries)) {
        const free = `${entry.replaceAll(/\W+/g, "-")}@example.com`;
        const expected =
          entry === "the REST endpoint"
            ? "403 ACCOUNTS_SIGN_UP_CLOSED"
            : "ACCOUNTS_SIGN_UP_CLOSED";
        expect(await signUp(free), entry).toBe(expected);
        expect(await signUp(TAKEN), entry).toBe(expected);
        expect(await accountByAddress(deps.db, free), entry).toBeNull();
      }
    });

    it("closed, emails nobody and counts nothing, so a taken address learns of no attempt", async () => {
      const { deps, mail, server } = await boot("closed");
      await makeAccount(deps, TAKEN);
      const watched = accountsService(() => deps);
      const visitor = server.visitorFrom(new Headers());

      // Past the address's own limit, which an open sign-up would reach.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(
          await codeOf(
            watched.signUp({
              visitor,
              name: "Dana Reyes",
              address: TAKEN,
              password: PASSWORD,
            })
          )
        ).toBe("ACCOUNTS_SIGN_UP_CLOSED");
      }
      expect(mail.queued).toEqual([]);
    });
  }
);

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}
