/**
 * The known-browser store on each dialect: a token's cap holds under a
 * burst, its own wait runs from the later of its cap and its last failed
 * check, and an account keeps at most its share of browsers.
 *
 * @module storage/known-browsers.integration.test
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { knownBrowsers } from "../schema/tables";
import { bootAccounts } from "../test-support/boot";

import { createAccount } from "./accounts";
import {
  cappedUntil,
  chargeKnownBrowser,
  forgetBrowsers,
  liveKnownBrowsers,
  recordFailedCheck,
  rememberBrowser,
  sweepKnownBrowsers,
} from "./known-browsers";

const DAY = 24 * 60 * 60 * 1000;
const start = new Date("2026-01-01T00:00:00.000Z");
const at = (ms: number) => new Date(start.getTime() + ms);
const hash = (n: number) => String(n).padStart(64, "0");

describe.each(getConfiguredTestDialects())(
  "the known-browser store (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<{
      db: PluginContext["db"];
      dana: string;
      lee: string;
    }> {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const { db } = booted.ctx;
      const make = async (address: string) => {
        const created = await createAccount(db, dialect, {
          address,
          name: "A",
          passwordHash: null,
        });
        if (created.status !== "created")
          throw new Error("expected an account");
        return created.account.id;
      };
      return {
        db,
        dana: await make("dana@example.com"),
        lee: await make("lee@example.com"),
      };
    }

    async function rowOf(db: PluginContext["db"], tokenHash: string) {
      const [row] = await liveKnownBrowsers(db, [tokenHash], start, 90);
      if (row === undefined) throw new Error("expected the browser");
      return row;
    }

    it("finds a browser by its token's hash while it is known, and forgets it after the days", async () => {
      const { db, dana } = await boot();
      await rememberBrowser(
        db,
        { accountId: dana, tokenHash: hash(1), now: start },
        10
      );

      expect(
        (await liveKnownBrowsers(db, [hash(1), hash(2)], at(89 * DAY), 90)).map(
          row => row.accountId
        )
      ).toEqual([dana]);
      expect(await liveKnownBrowsers(db, [hash(1)], at(90 * DAY), 90)).toEqual(
        []
      );
      expect(await sweepKnownBrowsers(db, at(89 * DAY), 90)).toBe(0);
      expect(await sweepKnownBrowsers(db, at(90 * DAY), 90)).toBe(1);
    });

    it("gives a token ten slots, records when it reached its cap, and none past it", async () => {
      const { db, dana } = await boot();
      await rememberBrowser(
        db,
        { accountId: dana, tokenHash: hash(1), now: start },
        10
      );
      const { id } = await rowOf(db, hash(1));

      for (let n = 1; n <= 10; n += 1)
        expect(await chargeKnownBrowser(db, id, at(n * 1000))).toBe(true);
      expect(await chargeKnownBrowser(db, id, at(11_000))).toBe(false);
      expect(await rowOf(db, hash(1))).toMatchObject({
        failuresInARow: 10,
        cappedAt: at(10_000),
      });
    });

    it("gives a burst of fifty attempts at once exactly ten slots", async () => {
      const { db, dana } = await boot();
      await rememberBrowser(
        db,
        { accountId: dana, tokenHash: hash(1), now: start },
        10
      );
      const { id } = await rowOf(db, hash(1));

      const taken = await Promise.all(
        Array.from({ length: 50 }, () => chargeKnownBrowser(db, id, at(1000)))
      );
      expect(taken.filter(Boolean)).toHaveLength(10);
    });

    it("runs a capped token's own wait from the later of its cap and its last failed check", async () => {
      const { db, dana } = await boot();
      await rememberBrowser(
        db,
        { accountId: dana, tokenHash: hash(1), now: start },
        10
      );
      const { id } = await rowOf(db, hash(1));
      for (let n = 1; n <= 9; n += 1) await chargeKnownBrowser(db, id, at(0));
      expect(cappedUntil(await rowOf(db, hash(1)))).toBeNull();

      await chargeKnownBrowser(db, id, at(5_000));
      expect(cappedUntil(await rowOf(db, hash(1)))).toEqual(at(65_000));
      await recordFailedCheck(db, id, at(30_000));
      expect(cappedUntil(await rowOf(db, hash(1)))).toEqual(at(90_000));
    });

    it("starts a browser's count again when it is known again, from a new expiry", async () => {
      const { db, dana } = await boot();
      await rememberBrowser(
        db,
        { accountId: dana, tokenHash: hash(1), now: start },
        10
      );
      const { id } = await rowOf(db, hash(1));
      for (let n = 1; n <= 10; n += 1) await chargeKnownBrowser(db, id, at(0));

      await rememberBrowser(
        db,
        { accountId: dana, tokenHash: hash(1), now: at(DAY) },
        10
      );
      expect(await rowOf(db, hash(1))).toMatchObject({
        id,
        failuresInARow: 0,
        cappedAt: null,
        knownAt: at(DAY),
      });
    });

    it("keeps at most the account's share of browsers, forgetting the longest unknown, and refuses another's token", async () => {
      const { db, dana, lee } = await boot();
      for (const n of [1, 2, 3])
        await rememberBrowser(
          db,
          { accountId: dana, tokenHash: hash(n), now: at(n) },
          2
        );
      await rememberBrowser(
        db,
        { accountId: lee, tokenHash: hash(9), now: start },
        2
      );

      const held = await db.select(knownBrowsers).all();
      expect(
        held
          .filter(row => row.accountId === dana)
          .map(row => row.tokenHash)
          .sort()
      ).toEqual([hash(2), hash(3)]);
      await expect(
        rememberBrowser(
          db,
          { accountId: lee, tokenHash: hash(2), now: start },
          2
        )
      ).rejects.toThrow(/another account/);
    });

    it("forgets every browser of an account, or every one but the one that made a change", async () => {
      const { db, dana, lee } = await boot();
      for (const n of [1, 2, 3])
        await rememberBrowser(
          db,
          { accountId: dana, tokenHash: hash(n), now: start },
          10
        );
      await rememberBrowser(
        db,
        { accountId: lee, tokenHash: hash(9), now: start },
        10
      );

      expect(await forgetBrowsers(db, dana, { except: hash(3) })).toBe(2);
      expect(await forgetBrowsers(db, dana)).toBe(1);
      expect(
        (await db.select(knownBrowsers).all()).map(row => row.accountId)
      ).toEqual([lee]);
    });
  }
);
