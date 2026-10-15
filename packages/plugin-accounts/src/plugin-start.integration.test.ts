/**
 * The plugin starting on core, on each dialect: on core's own helpers, with
 * nothing standing in for them; refused at start by a core that does not
 * lend every helper; and refused in production by limit counts each
 * instance keeps apart.
 *
 * @module plugin-start.integration.test
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { readAccountsCore } from "./core/adapter";
import { accountsLimitRules } from "./core/limit-rules";
import { buildAccounts } from "./plugin";
import { accountsServices } from "./server/installed";
import { resolveAccountsSettings } from "./settings";
import { accountByAddress } from "./storage/accounts";
import { bootAccounts, TEST_ORIGIN } from "./test-support/boot";
import { fakeAccountsCore } from "./testing";

const VISITOR = {
  client: null,
  sessionToken: null,
  knownTokens: [],
  signUpToken: null,
};

describe.each(getConfiguredTestDialects())(
  "the plugin starting on core (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    it("starts on core's own helpers, and signs up and refuses a wrong password through them", async () => {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const service = accountsServices(booted.ctx);

      const signedUp = await service.signUp({
        visitor: VISITOR,
        name: "Dana Reyes",
        address: "dana@example.com",
        password: "a long passphrase",
      });
      expect(signedUp.cookies.map(change => change.cookie)).toContain("signUp");
      expect(
        (await accountByAddress(booted.ctx.db, "dana@example.com"))
          ?.passwordHash
      ).toMatch(/^\S+$/);
      await expect(
        service.signIn({
          visitor: VISITOR,
          address: "dana@example.com",
          password: "not the passphrase",
        })
      ).rejects.toMatchObject({ code: "ACCOUNTS_WRONG_CREDENTIALS" });
    });

    it("refuses to start on a core that does not lend every helper", async () => {
      // Core as it stood before the other helpers landed: passwords alone.
      const plugin = buildAccounts({ origin: TEST_ORIGIN }, ctx =>
        readAccountsCore({ security: { passwords: ctx.security.passwords } })
      );

      await expect(
        createTestNextly({ dialect, plugins: [plugin] }).then(started => {
          current = started;
        })
      ).rejects.toThrow(/cannot start on this version of Nextly/);
    });

    it("refuses to start in production on limit counts each instance keeps apart, and starts once the site runs one instance", async () => {
      const rules = accountsLimitRules(
        resolveAccountsSettings({ origin: TEST_ORIGIN })
      );
      /** The plugin in production, on a limiter whose store is as given. */
      const inProduction = (store: {
        shared: boolean;
        singleInstance: boolean;
      }) => {
        const core = fakeAccountsCore({ rules, store });
        return buildAccounts(
          { origin: TEST_ORIGIN },
          () => core,
          ctx => core.watch(ctx.db),
          () => true
        );
      };

      await expect(
        createTestNextly({
          dialect,
          plugins: [inProduction({ shared: false, singleInstance: false })],
        }).then(started => {
          current = started;
        })
      ).rejects.toThrow(/needs limit counts every instance shares/);

      current = await createTestNextly({
        dialect,
        plugins: [inProduction({ shared: false, singleInstance: true })],
      });
    });
  }
);
