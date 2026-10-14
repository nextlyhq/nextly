/**
 * The account store on each dialect: one account per address however two
 * sign-ups race, and a guarded write that lands only at the version its flow
 * read.
 *
 * @module storage/accounts.integration.test
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { bootAccounts } from "../test-support/boot";

import {
  accountByAddress,
  accountById,
  createAccount,
  writeAtVersion,
} from "./accounts";

describe.each(getConfiguredTestDialects())(
  "the account store (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<PluginContext> {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      return booted.ctx;
    }

    const dana = {
      address: " Dana@Example.com ",
      name: "Dana Reyes",
      passwordHash: null,
    };

    it("creates an unverified account, keeping the address as given and finding it however it is cased", async () => {
      const { db } = await boot();
      const created = await createAccount(db, dialect, dana);
      if (created.status !== "created")
        throw new Error("expected the account to be created");

      expect(created.account).toMatchObject({
        address: "Dana@Example.com",
        addressNormalised: "dana@example.com",
        verifiedAt: null,
        securityVersion: 0,
      });
      expect(created.account.id).toMatch(/^[0-9a-f-]{36}$/);
      expect((await accountByAddress(db, "DANA@example.COM"))?.id).toBe(
        created.account.id
      );
      expect((await accountById(db, created.account.id))?.name).toBe(
        "Dana Reyes"
      );
      expect(await accountByAddress(db, "lee@example.com")).toBeNull();
    });

    it("answers taken for an address that has an account, however it is cased or spaced", async () => {
      const { db } = await boot();
      await createAccount(db, dialect, dana);

      expect(
        await createAccount(db, dialect, {
          ...dana,
          address: "DANA@EXAMPLE.COM",
        })
      ).toEqual({ status: "taken" });
    });

    it("creates one account of two sign-ups that race for one address", async () => {
      const { db } = await boot();
      const results = await Promise.all([
        createAccount(db, dialect, dana),
        createAccount(db, dialect, { ...dana, address: "dana@example.com" }),
      ]);

      expect(results.map(result => result.status).sort()).toEqual([
        "created",
        "taken",
      ]);
    });

    it("writes at the version the flow read, and moves it when the change ends sessions", async () => {
      const { db } = await boot();
      const created = await createAccount(db, dialect, dana);
      if (created.status !== "created")
        throw new Error("expected the account to be created");
      const read = created.account;

      expect(await writeAtVersion(db, read, { name: "Dana R." })).toBe(true);
      expect(await accountById(db, read.id)).toMatchObject({
        name: "Dana R.",
        securityVersion: 0,
      });

      expect(
        await writeAtVersion(
          db,
          read,
          { passwordHash: "new-hash" },
          { endsSessions: true }
        )
      ).toBe(true);
      expect(await accountById(db, read.id)).toMatchObject({
        passwordHash: "new-hash",
        securityVersion: 1,
      });
    });

    it("writes nothing for a flow whose version a change that ends sessions has moved", async () => {
      const { db } = await boot();
      const created = await createAccount(db, dialect, dana);
      if (created.status !== "created")
        throw new Error("expected the account to be created");
      const readByReset = created.account;

      // Another flow ends the account's sessions first.
      expect(
        await writeAtVersion(
          db,
          readByReset,
          { passwordHash: "theirs" },
          { endsSessions: true }
        )
      ).toBe(true);

      expect(
        await writeAtVersion(
          db,
          readByReset,
          { passwordHash: "late" },
          { endsSessions: true }
        )
      ).toBe(false);
      expect(await accountById(db, readByReset.id)).toMatchObject({
        passwordHash: "theirs",
        securityVersion: 1,
      });
    });
  }
);
