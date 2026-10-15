/**
 * What staff read about accounts: the list, searched, filtered and paged,
 * and an account's page, on each dialect.
 *
 * @module flows/staff-reads.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { accounts as accountsTable } from "../schema/tables";
import { createAccount, writeAtVersion } from "../storage/accounts";
import { startSession } from "../storage/sessions";
import { bootAccounts } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";

import type { FlowDeps } from "./deps";
import { accountForStaff, listAccountsForStaff } from "./staff-reads";

const DAY = 24 * 60 * 60 * 1000;
const LIMITS = { idleMs: DAY, absoluteMs: 30 * DAY, perAccount: 20 };

describe.each(getConfiguredTestDialects())(
  "staff reading accounts (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot() {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      return flowDeps(booted.ctx);
    }

    /** Makes an account `minutes` after a fixed start, so the order is known. */
    async function make(
      deps: FlowDeps,
      address: string,
      name: string,
      minutes: number,
      state: {
        verified?: boolean;
        deactivated?: boolean;
        resetRequired?: boolean;
      } = {}
    ): Promise<string> {
      const at = new Date(Date.UTC(2026, 0, 1, 0, minutes));
      const created = await createAccount(deps.db, deps.dialect, {
        address,
        name,
        passwordHash: await deps.core.passwords.hash("a long passphrase"),
        createdAt: at,
      });
      if (created.status !== "created") throw new Error("expected an account");
      await writeAtVersion(deps.db, created.account, {
        verifiedAt: state.verified === true ? at : null,
        deactivatedAt: state.deactivated === true ? at : null,
        resetRequiredAt: state.resetRequired === true ? at : null,
      });
      return created.account.id;
    }

    it("lists accounts newest first, a page at a time, saying whether another page follows", async () => {
      const { deps } = await boot();
      const first = await make(deps, "a@example.com", "Ada", 1);
      const second = await make(deps, "b@example.com", "Ben", 2);
      const third = await make(deps, "c@example.com", "Cy", 3);

      const one = await listAccountsForStaff(deps, { page: 1, perPage: 2 });
      const two = await listAccountsForStaff(deps, { page: 2, perPage: 2 });

      expect(one.items.map(item => item.id)).toEqual([third, second]);
      expect(one.hasNext).toBe(true);
      expect(two.items.map(item => item.id)).toEqual([first]);
      expect(two.hasNext).toBe(false);
    });

    it("finds an account by part of its address in any case, and by part of its name", async () => {
      const { deps } = await boot();
      const dana = await make(deps, "Dana.Reyes@Example.com", "Dana", 1);
      const sam = await make(deps, "sam@example.com", "Samira Okafor", 2);
      await make(deps, "lee@example.com", "Lee", 3);

      const byAddress = await listAccountsForStaff(deps, {
        search: "  DANA.reyes ",
        page: 1,
        perPage: 10,
      });
      const byName = await listAccountsForStaff(deps, {
        search: "Okafor",
        page: 1,
        perPage: 10,
      });

      expect(byAddress.items.map(item => item.id)).toEqual([dana]);
      expect(byName.items.map(item => item.id)).toEqual([sam]);
    });

    it("filters by each state", async () => {
      const { deps } = await boot();
      const verified = await make(deps, "v@example.com", "V", 1, {
        verified: true,
      });
      const unverified = await make(deps, "u@example.com", "U", 2);
      const deactivated = await make(deps, "d@example.com", "D", 3, {
        verified: true,
        deactivated: true,
      });
      const locked = await make(deps, "r@example.com", "R", 4, {
        verified: true,
        resetRequired: true,
      });
      const ids = async (state: Parameters<typeof listAccountsForStaff>[1]) =>
        (await listAccountsForStaff(deps, state)).items.map(item => item.id);
      const page = { page: 1, perPage: 10 };

      expect(await ids({ ...page, state: "verified" })).toEqual([
        locked,
        deactivated,
        verified,
      ]);
      expect(await ids({ ...page, state: "unverified" })).toEqual([unverified]);
      expect(await ids({ ...page, state: "active" })).toEqual([
        locked,
        unverified,
        verified,
      ]);
      expect(await ids({ ...page, state: "deactivated" })).toEqual([
        deactivated,
      ]);
      expect(await ids({ ...page, state: "reset-required" })).toEqual([locked]);
    });

    // The second session idled out a day ago but is inside its absolute
    // expiry, so only a count that reads the idle expiry leaves it out.
    it("shows an account's page with its state and its live sessions alone", async () => {
      const { deps, core } = await boot();
      const id = await make(deps, "dana@example.com", "Dana", 1, {
        verified: true,
      });
      const now = new Date(core.clock.now());
      await startSession(
        deps.db,
        { accountId: id, tokenHash: "1".repeat(64), now },
        LIMITS
      );
      await startSession(
        deps.db,
        {
          accountId: id,
          tokenHash: "2".repeat(64),
          now: new Date(now.getTime() - 2 * DAY),
        },
        LIMITS
      );

      expect(await accountForStaff(deps, id)).toEqual({
        id,
        address: "dana@example.com",
        name: "Dana",
        verified: true,
        active: true,
        resetRequired: false,
        createdAt: "2026-01-01T00:01:00.000Z",
        lastSignedInAt: null,
        verifiedAt: "2026-01-01T00:01:00.000Z",
        verifiedBy: null,
        deactivatedAt: null,
        resetRequiredAt: null,
        passwordChangedAt: null,
        liveSessions: 1,
      });
      expect(
        await accountForStaff(deps, "00000000-0000-4000-8000-000000000000")
      ).toBeNull();
    });

    it("never carries the password hash or a session's token hash", async () => {
      const { deps, core } = await boot();
      const id = await make(deps, "dana@example.com", "Dana", 1);
      const tokenHash = "f".repeat(64);
      await startSession(
        deps.db,
        { accountId: id, tokenHash, now: new Date(core.clock.now()) },
        LIMITS
      );
      const hash = (await deps.db.select(accountsTable).all())[0]?.passwordHash;
      expect(hash).toEqual(expect.any(String));

      const read = JSON.stringify([
        await listAccountsForStaff(deps, { page: 1, perPage: 10 }),
        await accountForStaff(deps, id),
      ]);

      expect(read).not.toContain(hash);
      expect(read).not.toContain(tokenHash);
      expect(read).not.toMatch(/hash|token|password"/i);
    });
  }
);
