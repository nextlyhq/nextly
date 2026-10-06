/**
 * A refresh rotation that something else reaches while it is in flight.
 *
 * Between reading the presented refresh row and replacing it, the handler
 * reads roles and custom fields, runs `customizeClaims` and signs. Two things
 * can remove the presented row in that time: an administrator ending the
 * account's sessions (a deactivation or a new password deletes every row),
 * and a second request rotating the same token. Each case runs that other
 * actor from inside `fetchRoleIds`, which is inside that window, against the
 * real deps-bridge and database.
 *
 * Run on every configured dialect: on PostgreSQL and MySQL the row lock the
 * session-row write takes is a statement of its own, and only a real server
 * runs it. The lock case starts the revocation while that lock is held and
 * checks it waits for the rotation rather than committing first.
 */

// The rotation signs with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDialectTables } from "../../../database/index";
import { setNextlyLogger } from "../../../observability/logger";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import { hashRefreshToken } from "../../session/refresh";
import { buildAuthRouterDeps } from "../deps-bridge";
import { handleRefresh } from "../refresh";

import { holdSessionRowLock } from "./session-row-lock-hold";

let handle: TestNextly | undefined;
afterEach(async () => {
  setNextlyLogger(undefined);
  await handle?.destroy();
  handle = undefined;
});

const RAW_TOKEN = "raw-refresh-token-for-the-race";

interface RefreshRow {
  id: string;
  tokenHash: string;
}

interface TestDb {
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown> };
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<RefreshRow[]>;
    };
  };
}

/** An active, verified account holding one refresh row for `RAW_TOKEN`. */
async function signedIn(
  dialect: TestDialect
): Promise<{ t: TestNextly; userId: string }> {
  handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  const created = await new ServiceContainer(
    handle.adapter
  ).users.createLocalUser({
    email: "race@example.com",
    name: "Race",
    password: "Str0ng-P@ssw0rd!",
    isActive: true,
    emailVerification: "admin-vouched",
  });
  const userId = String(created.id);
  const db = handle.adapter.getDrizzle() as unknown as TestDb;
  await db.insert(getDialectTables().refreshTokens).values({
    id: "rt-presented",
    userId,
    tokenHash: hashRefreshToken(RAW_TOKEN),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  });
  return { t: handle, userId };
}

async function refreshRows(t: TestNextly, userId: string) {
  const { refreshTokens } = getDialectTables();
  const db = t.adapter.getDrizzle() as unknown as TestDb;
  return db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.userId, userId));
}

function refreshRequest(rawToken: string): Request {
  return new Request("http://localhost:3000/admin/api/auth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `nextly_refresh=${rawToken}`,
    },
    body: JSON.stringify({}),
  });
}

/** The real bridge, with `during` run once inside the rotation's reads. */
function depsRunningDuringRotation(t: TestNextly, during: () => Promise<void>) {
  const deps = buildAuthRouterDeps(
    t.getService as unknown as (name: string) => unknown
  );
  const fetchRoleIds = deps.fetchRoleIds;
  let pending: (() => Promise<void>) | undefined = during;
  deps.fetchRoleIds = async userId => {
    const run = pending;
    pending = undefined;
    await run?.();
    return fetchRoleIds(userId);
  };
  return deps;
}

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  describe("a refresh in flight when the account's sessions are ended", () => {
    it.each([
      ["a new password", { password: "N3w-Str0ng-P@ss!" }],
      ["a deactivation", { isActive: false }],
    ])("does not survive %s", async (_, data) => {
      const { t, userId } = await signedIn(dialect);
      const deps = depsRunningDuringRotation(t, async () => {
        await t.nextly.users.update({ id: userId, data });
        // The revocation itself worked: the race is what follows it.
        expect(await refreshRows(t, userId)).toHaveLength(0);
      });

      const res = await handleRefresh(refreshRequest(RAW_TOKEN), deps);

      expect(res.status).toBe(401);
      expect(await refreshRows(t, userId)).toHaveLength(0);
    });

    it("still rotates when nothing ends the sessions", async () => {
      // The control: a rotation that always refused would pass both cases above.
      const { t, userId } = await signedIn(dialect);
      const deps = depsRunningDuringRotation(t, async () => {
        await t.nextly.users.update({ id: userId, data: { name: "Renamed" } });
      });

      const res = await handleRefresh(refreshRequest(RAW_TOKEN), deps);

      expect(res.status).toBe(200);
      const rows = await refreshRows(t, userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).not.toBe("rt-presented");
    });
  });

  describe("one refresh token presented twice at once", () => {
    it("rotates for one request and refuses the other", async () => {
      const { t, userId } = await signedIn(dialect);
      let second: Response | undefined;
      const deps = depsRunningDuringRotation(t, async () => {
        // The second request reads the same row and completes its rotation
        // while the first is still between its read and its write.
        second = await handleRefresh(
          refreshRequest(RAW_TOKEN),
          buildAuthRouterDeps(
            t.getService as unknown as (name: string) => unknown
          )
        );
      });

      const first = await handleRefresh(refreshRequest(RAW_TOKEN), deps);

      expect(second?.status).toBe(200);
      expect(first.status).toBe(401);
      // The loser leaves the browser's cookies alone: they are the ones the
      // winner has just set, and clearing them would sign that tab out too.
      expect(first.headers.getSetCookie()).toEqual([]);
      const refusal = (await first.json()) as { error: { code: string } };
      expect(refusal.error.code).toBe("REFRESH_SUPERSEDED");
      // Only the winner's row is left, so the token was spent once.
      const rows = await refreshRows(t, userId);
      expect(rows).toHaveLength(1);
      const { refreshToken } = (await second!.json()) as {
        refreshToken: string;
      };
      expect(rows[0].tokenHash).toBe(hashRefreshToken(refreshToken));
    });

    it("refuses the spent token presented again after the rotation, leaving the cookies alone", async () => {
      // The same token presented after the rotation committed finds no row. It
      // may be a second tab a round trip behind the one that rotated, whose
      // fresh cookies share this browser's jar: clearing cookies here would
      // wipe them. A replayed stolen token is refused the same way, and the
      // rotated session is untouched.
      const { t, userId } = await signedIn(dialect);
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );
      const rotated = await handleRefresh(refreshRequest(RAW_TOKEN), deps);
      expect(rotated.status).toBe(200);
      const before = await refreshRows(t, userId);
      const warn = vi.fn();
      setNextlyLogger({ error: vi.fn(), warn, info: vi.fn(), debug: vi.fn() });

      const replay = await handleRefresh(refreshRequest(RAW_TOKEN), deps);

      expect(replay.status).toBe(401);
      const refusal = (await replay.json()) as { error: { code: string } };
      expect(refusal.error.code).toBe("REFRESH_FAILED");
      expect(replay.headers.getSetCookie()).toEqual([]);
      expect(await refreshRows(t, userId)).toEqual(before);
      // Observable, so replays can be monitored, and without the token itself.
      expect(warn).toHaveBeenCalledWith({ kind: "refresh-token-not-found" });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(RAW_TOKEN);
    });

    it("still clears the cookies of an expired refresh row", async () => {
      // The control: an ended session is answered with cleared cookies, so the
      // case above is the not-found branch and not every refusal.
      const { t, userId } = await signedIn(dialect);
      const { refreshTokens } = getDialectTables();
      await (
        t.adapter.getDrizzle() as unknown as {
          update: (table: unknown) => {
            set: (data: unknown) => { where: (c: unknown) => Promise<unknown> };
          };
        }
      )
        .update(refreshTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(refreshTokens.id, "rt-presented"));
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );

      const res = await handleRefresh(refreshRequest(RAW_TOKEN), deps);

      expect(res.status).toBe(401);
      const cookies = res.headers.getSetCookie();
      expect(cookies.some(c => c.startsWith("nextly_refresh="))).toBe(true);
      expect(cookies.every(c => c.includes("Max-Age=0"))).toBe(true);
      expect(await refreshRows(t, userId)).toHaveLength(0);
    });
  });

  describe("a refresh whose user-row lock a deactivation meets", () => {
    it("makes the deactivation wait for the rotation, then end it", async () => {
      const { t, userId } = await signedIn(dialect);
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );
      const { lockHeld, probe } = holdSessionRowLock(deps);
      // Started from here, not from inside the request: nothing in the locked
      // transaction waits for it, so only the lock can hold it back.
      const revocation = lockHeld.then(async () => {
        await t.nextly.users.update({ id: userId, data: { isActive: false } });
        probe.revoked = true;
      });

      const res = await handleRefresh(refreshRequest(RAW_TOKEN), deps);
      await revocation;

      // The rotation read an active account and its presented row, so it
      // completes; the deactivation waited out the lock and then deleted the
      // row the rotation wrote. One that did not wait would have deleted the
      // presented row first, and the rotation would have been refused.
      expect(res.status).toBe(200);
      expect(probe.revokedDuringHold).toBe(false);
      expect(await refreshRows(t, userId)).toHaveLength(0);
    });
  });
});
