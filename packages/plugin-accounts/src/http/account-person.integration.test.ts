/**
 * A signed-in account as core sees it, on each dialect: the person the
 * plugin's own session cookie names, found again by id through the plugin's
 * lookup, and admitted only by a collection rule written for its kind:
 * a collection with no rule, or a rule written for staff, refuses it. Core's
 * media and user operations take no person at all, which their types hold.
 *
 * @module http/account-person.integration.test
 */
import { text } from "@nextlyhq/plugin-sdk";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { accountsLimitRules } from "../core/limit-rules";
import { signIn } from "../flows/sign-in";
import { resolveAccountsSettings } from "../settings";
import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { fakeAccountsCore } from "../testing";

import { cookieName } from "./cookies";
import { ACCOUNT_PRINCIPAL } from "./routes";

const ADDRESS = "dana@example.com";

/** The site's collections: one whose rules admit an account, one with no rule, one whose rule is written for staff. */
const COLLECTIONS = [
  {
    slug: "member_notes",
    fields: [text({ name: "title" })],
    access: {
      read: ({ principal }: { principal?: { kind: string } | null }) =>
        principal?.kind === ACCOUNT_PRINCIPAL,
    },
  },
  { slug: "plain_notes", fields: [text({ name: "title" })] },
  {
    slug: "staff_notes",
    fields: [text({ name: "title" })],
    access: { read: ({ user }: { user?: unknown }) => !!user },
  },
];

describe.each(getConfiguredTestDialects())(
  "a signed-in account as core sees it (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Boots the site, makes Dana's verified account and signs her in: her session cookie, as a browser sends it. */
    async function boot() {
      const settings = resolveAccountsSettings({ origin: TEST_ORIGIN });
      const core = fakeAccountsCore({
        start: new Date(),
        rules: accountsLimitRules(settings),
      });
      const booted = await bootAccounts(dialect, {
        core,
        collections: COLLECTIONS,
      });
      current = booted.nextly;
      const { deps } = flowDeps(booted.ctx, {}, core);
      const id = await makeAccount(deps, ADDRESS);
      const signedIn = await signIn(deps, {
        address: ADDRESS,
        password: TEST_PASSWORD,
        client: null,
      });
      if (signedIn.status !== "signed-in")
        throw new Error("expected a sign-in");
      const cookie = `${cookieName(settings, "session")}=${signedIn.session.token}`;
      const request = (withCookie: boolean) =>
        new Request(`${TEST_ORIGIN}/`, {
          headers: withCookie ? { cookie } : {},
        });
      for (const collection of ["member_notes", "plain_notes", "staff_notes"])
        await booted.nextly.nextly.create({
          collection,
          data: { title: "a note" },
          overrideAccess: true,
        });

      return { nextly: booted.nextly.nextly, deps, id, request };
    }

    it("is the person the plugin's session cookie names, and nobody without it", async () => {
      const { nextly, id, request } = await boot();

      expect(
        await nextly.principals.fromRequest(request(true), ACCOUNT_PRINCIPAL)
      ).toMatchObject({
        kind: ACCOUNT_PRINCIPAL,
        id,
        attributes: { verified: true },
      });
      expect(
        await nextly.principals.fromRequest(request(false), ACCOUNT_PRINCIPAL)
      ).toBeNull();
    });

    it("is found again by id through the plugin's lookup, and an unknown id is nobody", async () => {
      const { nextly, id } = await boot();

      expect(await nextly.principals.byId(ACCOUNT_PRINCIPAL, id)).toMatchObject(
        { kind: ACCOUNT_PRINCIPAL, id }
      );
      expect(
        await nextly.principals.byId(
          ACCOUNT_PRINCIPAL,
          "00000000-0000-4000-8000-000000000000"
        )
      ).toBeNull();
    });

    it("reads a collection whose rule admits its kind, and no collection with no rule or a staff rule", async () => {
      const { nextly, request } = await boot();
      const account = await nextly.principals.fromRequest(
        request(true),
        ACCOUNT_PRINCIPAL
      );
      if (account === null) throw new Error("expected the account");

      expect(
        (await nextly.find({ collection: "member_notes", principal: account }))
          .items
      ).toHaveLength(1);
      for (const collection of ["plain_notes", "staff_notes"])
        await expect(
          nextly.find({ collection, principal: account }),
          collection
        ).rejects.toThrow();
    });
  }
);
