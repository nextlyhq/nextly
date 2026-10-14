/**
 * The session store on each dialect: sessions found by their token's hash,
 * ended by idle time, by age, by the per-account cap, by signing out and by
 * the sweep.
 *
 * @module storage/sessions.integration.test
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { bootAccounts } from "../test-support/boot";

import { createAccount } from "./accounts";
import {
  endAccountSessions,
  endSession,
  liveSession,
  startSession,
  sweepSessions,
  touchSession,
} from "./sessions";

const HOUR = 60 * 60 * 1000;
const limits = { idleMs: 10 * HOUR, absoluteMs: 30 * HOUR, perAccount: 2 };
const start = new Date("2026-01-01T00:00:00.000Z");
const at = (hours: number) => new Date(start.getTime() + hours * HOUR);
const hash = (n: number) => String(n).padStart(64, "0");

describe.each(getConfiguredTestDialects())(
  "the session store (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Boot, and make an account to hold sessions. */
    async function boot(): Promise<{
      db: PluginContext["db"];
      accountId: string;
      otherId: string;
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
        accountId: await make("dana@example.com"),
        otherId: await make("lee@example.com"),
      };
    }

    it("keeps only the token's hash, and finds the session by it until it idles out", async () => {
      const { db, accountId } = await boot();
      const session = await startSession(
        db,
        { accountId, tokenHash: hash(1), now: start },
        limits
      );

      expect(session).toMatchObject({
        tokenHash: hash(1),
        idleExpiresAt: at(10),
        absoluteExpiresAt: at(30),
      });
      expect((await liveSession(db, hash(1), at(9.9)))?.id).toBe(session.id);
      expect(await liveSession(db, hash(1), at(10))).toBeNull();
      expect(await liveSession(db, hash(2), start)).toBeNull();
    });

    it("moves the idle expiry on with use, at most once a tenth of the period, never past the absolute expiry", async () => {
      const { db, accountId } = await boot();
      const session = await startSession(
        db,
        { accountId, tokenHash: hash(1), now: start },
        limits
      );

      expect(await touchSession(db, session, at(0.9), limits)).toBe(false);
      expect(await touchSession(db, session, at(1), limits)).toBe(true);
      expect((await liveSession(db, hash(1), at(10.5)))?.idleExpiresAt).toEqual(
        at(11)
      );

      // Used through the night, it still ends at its absolute expiry.
      let used = (await liveSession(db, hash(1), at(25))) ?? session;
      expect(await touchSession(db, used, at(25), limits)).toBe(true);
      used = (await liveSession(db, hash(1), at(25))) ?? session;
      expect(used.idleExpiresAt).toEqual(at(30));
      expect(await liveSession(db, hash(1), at(30))).toBeNull();
    });

    it("ends the account's oldest session past the cap, and no other account's", async () => {
      const { db, accountId, otherId } = await boot();
      await startSession(
        db,
        { accountId: otherId, tokenHash: hash(9), now: start },
        limits
      );
      for (const n of [1, 2, 3]) {
        await startSession(
          db,
          { accountId, tokenHash: hash(n), now: at(n) },
          limits
        );
      }

      expect(await liveSession(db, hash(1), at(3))).toBeNull();
      expect(await liveSession(db, hash(2), at(3))).not.toBeNull();
      expect(await liveSession(db, hash(3), at(3))).not.toBeNull();
      expect(await liveSession(db, hash(9), at(3))).not.toBeNull();
    });

    it("signs one session out, every session out, or every one but the one that made a change", async () => {
      const { db, accountId, otherId } = await boot();
      const big = { ...limits, perAccount: 5 };
      for (const n of [1, 2, 3])
        await startSession(
          db,
          { accountId, tokenHash: hash(n), now: start },
          big
        );
      await startSession(
        db,
        { accountId: otherId, tokenHash: hash(9), now: start },
        big
      );

      await endSession(db, hash(1));
      expect(await liveSession(db, hash(1), start)).toBeNull();

      expect(await endAccountSessions(db, accountId, { except: hash(3) })).toBe(
        1
      );
      expect(await liveSession(db, hash(2), start)).toBeNull();
      expect(await liveSession(db, hash(3), start)).not.toBeNull();

      expect(await endAccountSessions(db, accountId)).toBe(1);
      expect(await liveSession(db, hash(3), start)).toBeNull();
      expect(await liveSession(db, hash(9), start)).not.toBeNull();
    });

    it("sweeps sessions past either expiry, and leaves the live ones", async () => {
      const { db, accountId } = await boot();
      const big = { ...limits, perAccount: 5 };
      await startSession(
        db,
        { accountId, tokenHash: hash(1), now: start },
        big
      );
      await startSession(
        db,
        { accountId, tokenHash: hash(2), now: at(5) },
        big
      );

      expect(await sweepSessions(db, at(10))).toBe(1);
      expect(await liveSession(db, hash(2), at(10))).not.toBeNull();
    });
  }
);
