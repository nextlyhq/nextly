/**
 * The fakes' transaction rules on a real `ctx.db`: what they hold the
 * plugin to is what core promises, so a flow tested against them meets core
 * the same way.
 *
 * @module testing/fake-core.integration.test
 */
import { eq } from "@nextlyhq/plugin-sdk/db";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { accounts as accountsTable } from "../schema/tables";
import { bootAccounts } from "../test-support/boot";

import { fakeAccountsCore } from "./fake-core";
import { FakeCoreMisuse } from "./fake-transactions";

const MINUTE = 60_000;

describe.each(getConfiguredTestDialects())(
  "the fake core on a real database (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Boot with the plugin, and hand back a fake core watching its database. */
    async function boot() {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const core = fakeAccountsCore({
        rules: {
          tries: { type: "window", windows: [{ max: 5, perMs: MINUTE }] },
        },
      });
      return { core, db: core.watch(booted.ctx.db) };
    }

    const account = {
      id: "a-1",
      address: "dana@example.com",
      addressNormalised: "dana@example.com",
      name: "Dana Reyes",
    };

    it("spends a token with the flow's transaction only when it commits, and never on its rollback", async () => {
      const { core, db } = await boot();
      const { token } = await core.secrets.mintToken({
        purpose: "verify",
        subject: "a-1",
        expiresInMs: MINUTE,
      });

      // Rolled back: the row and the spend go together, and the token is live again.
      await expect(
        db.transaction(async tx => {
          await tx.insert(accountsTable, account);
          expect(
            await core.secrets.consumeToken(
              { purpose: "verify", token },
              { tx }
            )
          ).toMatchObject({ ok: true });
          throw new Error("the session write failed");
        })
      ).rejects.toThrow("the session write failed");
      expect(
        await db
          .select(accountsTable)
          .where(eq(db.table(accountsTable).id, "a-1"))
          .all()
      ).toEqual([]);

      // Committed: the spend lands with the row.
      await db.transaction(async tx => {
        await tx.insert(accountsTable, account);
        // Live again after the rollback, so this spend wins.
        expect(
          await core.secrets.consumeToken({ purpose: "verify", token }, { tx })
        ).toMatchObject({ ok: true });
      });
      expect(
        await core.secrets.consumeToken({ purpose: "verify", token })
      ).toEqual({ ok: false, reason: "spent" });
    });

    it("refuses a code's spend, a count and a write without the tx inside the flow's transaction", async () => {
      const { core, db } = await boot();
      await core.secrets.mintCode({
        purpose: "verify",
        subject: "a-1",
        expiresInMs: MINUTE,
        maxWrongTries: 5,
      });

      await db.transaction(async () => {
        await expect(
          core.secrets.consumeCode({
            purpose: "verify",
            subject: "a-1",
            code: "000000",
          })
        ).rejects.toThrow(FakeCoreMisuse);
        await expect(
          core.limits.reserve([{ rule: "tries", key: "dana@example.com" }])
        ).rejects.toThrow(FakeCoreMisuse);
        await expect(core.secrets.voidFor({ subject: "a-1" })).rejects.toThrow(
          FakeCoreMisuse
        );
      });
      // Outside it, the same calls are core's to answer.
      expect(
        await core.secrets.consumeCode({
          purpose: "verify",
          subject: "a-1",
          code: "000000",
        })
      ).toMatchObject({
        ok: false,
      });
      expect(
        (
          await core.limits.reserve([
            { rule: "tries", key: "dana@example.com" },
          ])
        ).status
      ).toBe("admitted");
    });

    it("judges an open transaction per flow: another flow reserves while this one holds a transaction open", async () => {
      const { core, db } = await boot();
      let release = () => {};
      const held = new Promise<void>(resolve => (release = resolve));
      let opened = () => {};
      const isOpen = new Promise<void>(resolve => (opened = resolve));

      const holding = db.transaction(async () => {
        opened();
        await held;
      });
      await isOpen;
      // A second request, outside any transaction of its own.
      expect(
        (await core.limits.reserve([{ rule: "tries", key: "lee@example.com" }]))
          .status
      ).toBe("admitted");
      release();
      await holding;
    });

    it("refuses a transaction opened inside another", async () => {
      const { db } = await boot();
      await expect(
        db.transaction(async () => db.transaction(async () => undefined))
      ).rejects.toThrow(FakeCoreMisuse);
    });
  }
);
