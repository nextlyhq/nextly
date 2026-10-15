/**
 * An uninstall that drops the plugin's tables, on each dialect: every
 * account is reported deleted to core first, so none stays named in the
 * audit trail; one that keeps the data reports nothing.
 *
 * @module flows/uninstall.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { accounts } from "../plugin";
import { makeAccount } from "../test-support/accounts";
import { auditRowAbout, auditRowsAbout } from "../test-support/audit";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";

import { reportEveryAccountDeleted } from "./uninstall";

describe.each(getConfiguredTestDialects())(
  "uninstalling the plugin (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Boots, with three accounts and an audit row about each. */
    async function boot() {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const made = flowDeps(booted.ctx);
      const ids: string[] = [];
      for (const address of [
        "a@example.com",
        "b@example.com",
        "c@example.com",
      ]) {
        const id = await makeAccount(made.deps, address);
        await auditRowAbout(booted.ctx, id);
        ids.push(id);
      }
      /** How many of the accounts an audit row still names, of how many rows. */
      const named = async () => {
        let naming = 0;
        let all = 0;
        for (const id of ids) {
          const rows = await auditRowsAbout(booted.nextly, id);
          naming += rows.naming;
          all = rows.all;
        }
        return { naming, all };
      };

      return { ctx: booted.ctx, ...made, ids, named };
    }

    it("reports every account deleted when the data goes, and nothing when it is kept", async () => {
      const { ctx, named } = await boot();
      const plugin = accounts({ origin: TEST_ORIGIN });

      await plugin.onUninstall?.(ctx, { keepData: true });
      expect(await named()).toEqual({ naming: 3, all: 3 });

      await plugin.onUninstall?.(ctx, { keepData: false });
      expect(await named()).toEqual({ naming: 0, all: 3 });
    });

    it("reports a page of accounts to a transaction until none are left, telling other plugins of each", async () => {
      const { deps, emitted, ids, named } = await boot();

      expect(await reportEveryAccountDeleted(deps, { batch: 2 })).toBe(3);
      expect(await named()).toEqual({ naming: 0, all: 3 });
      expect(
        emitted
          .filter(
            event => event.name === "nextlyhq-plugin-accounts.account.deleted"
          )
          .map(event => (event.payload as { accountId: string }).accountId)
          .sort()
      ).toEqual([...ids].sort());
    });
  }
);
