/**
 * A password sign-in that an account revocation reaches while it is minting.
 *
 * Between the session gate and the refresh row, the mint reads roles and
 * custom fields, runs `customizeClaims` and signs. A deactivation or a new
 * password committed there deletes every refresh row the account holds — and
 * a row written after it would survive the revocation it was meant to end.
 * Each case runs the revocation from inside `fetchRoleIds`, which is inside
 * that window, against the real deps-bridge and database.
 */

// The mint signs with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDialectTables } from "../../../database/index";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import {
  MUST_CHANGE_PASSWORD_CHALLENGE,
  mintPendingToken,
} from "../../pipeline/pending-token";
import { buildAuthRouterDeps } from "../deps-bridge";
import { handleLogin } from "../login";
import { handleRefresh } from "../refresh";
import { handleSetInitialPassword } from "../set-initial-password";

let handle: TestNextly | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await handle?.destroy();
  handle = undefined;
});

const ORIGIN = "http://localhost:3000";
const EMAIL = "mint@example.com";
const PASSWORD = "Str0ng-P@ssw0rd!";

interface TestDb {
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<unknown[]>;
    };
  };
}

/**
 * An active, verified account holding no session yet; with
 * `mustChangePassword`, one still holding the password an administrator set.
 */
async function account(
  opts: { mustChangePassword?: boolean } = {}
): Promise<{ t: TestNextly; userId: string }> {
  handle = await createTestNextly();
  const created = await new ServiceContainer(
    handle.adapter
  ).users.createLocalUser({
    email: EMAIL,
    name: "Mint",
    password: PASSWORD,
    isActive: true,
    emailVerification: "admin-vouched",
    ...opts,
  });
  return { t: handle, userId: String(created.id) };
}

async function refreshRows(t: TestNextly, userId: string) {
  const { refreshTokens } = getDialectTables();
  const db = t.adapter.getDrizzle() as unknown as TestDb;
  return db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.userId, userId));
}

function loginRequest(): Request {
  return new Request(`${ORIGIN}/admin/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      cookie: "nextly_csrf=tok",
    },
    body: JSON.stringify({
      csrfToken: "tok",
      email: EMAIL,
      password: PASSWORD,
    }),
  });
}

function refreshRequest(rawToken: string): Request {
  return new Request(`${ORIGIN}/admin/api/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `nextly_refresh=${rawToken}`,
    },
    body: "{}",
  });
}

function bridge(t: TestNextly) {
  return buildAuthRouterDeps(
    t.getService as unknown as (name: string) => unknown
  );
}

/** The real bridge, with `during` run once inside the mint's reads. */
function depsRunningDuringMint(t: TestNextly, during: () => Promise<void>) {
  const deps = bridge(t);
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

describe("a password sign-in minting when the account's sessions are ended", () => {
  it("does not survive a deactivation, even one undone afterwards", async () => {
    const { t, userId } = await account();
    const deps = depsRunningDuringMint(t, async () => {
      await t.nextly.users.update({ id: userId, data: { isActive: false } });
    });

    const res = await handleLogin(loginRequest(), deps);

    expect(res.status).toBe(401);
    expect(await refreshRows(t, userId)).toHaveLength(0);
    // Reactivating does not bring back a session the deactivation ended.
    await t.nextly.users.update({ id: userId, data: { isActive: true } });
    expect(await refreshRows(t, userId)).toHaveLength(0);
  });

  it("does not survive a new password", async () => {
    // The administrator's reset for a compromised account: whoever typed the
    // old password must not keep a session that renews.
    const { t, userId } = await account();
    const deps = depsRunningDuringMint(t, async () => {
      await t.nextly.users.update({
        id: userId,
        data: { password: "N3w-Str0ng-P@ss!" },
      });
    });

    const res = await handleLogin(loginRequest(), deps);

    expect(res.status).toBe(401);
    expect(await refreshRows(t, userId)).toHaveLength(0);
  });

  it("does not survive a new password set between the proof and the gate", async () => {
    // The password was checked against the hash read with the account row;
    // a reset after that read but before the session gate reads the account
    // is judged against the version the proof was made with.
    const { t, userId } = await account();
    const deps = bridge(t);
    const fetchAccountState = deps.fetchAccountState;
    let reset = false;
    deps.fetchAccountState = async id => {
      if (!reset) {
        reset = true;
        await t.nextly.users.update({
          id: userId,
          data: { password: "N3w-Str0ng-P@ss!" },
        });
      }
      return fetchAccountState(id);
    };

    const res = await handleLogin(loginRequest(), deps);

    expect(res.status).toBe(401);
    expect(await refreshRows(t, userId)).toHaveLength(0);
  });

  it("still signs in, and the session refreshes, when nothing ends the sessions", async () => {
    // The control: a mint that always refused would pass every case above.
    const { t, userId } = await account();
    const deps = depsRunningDuringMint(t, async () => {
      await t.nextly.users.update({ id: userId, data: { name: "Renamed" } });
    });

    const res = await handleLogin(loginRequest(), deps);

    expect(res.status).toBe(200);
    expect(await refreshRows(t, userId)).toHaveLength(1);
    const { refreshToken } = (await res.json()) as { refreshToken: string };
    const refreshed = await handleRefresh(
      refreshRequest(refreshToken),
      bridge(t)
    );
    expect(refreshed.status).toBe(200);
  });
});

describe("a forced password change minting when the password is set again", () => {
  /** The set-password step of `userId`'s paused sign-in. */
  async function setInitialPasswordRequest(userId: string): Promise<Request> {
    const pendingToken = await mintPendingToken(
      {
        userId,
        challengeId: MUST_CHANGE_PASSWORD_CHALLENGE,
        attempts: 0,
      },
      process.env.NEXTLY_SECRET as string,
      300
    );
    return new Request(`${ORIGIN}/admin/api/auth/set-initial-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        cookie: "nextly_csrf=tok",
      },
      body: JSON.stringify({
        csrfToken: "tok",
        pendingToken,
        newPassword: "Ch0sen-Str0ng-P@ss!",
      }),
    });
  }

  /**
   * The real bridge, with `after` run once the change has committed and
   * before the session is minted for it.
   */
  function depsRunningAfterChange(t: TestNextly, after: () => Promise<void>) {
    const deps = bridge(t);
    const setInitialPassword = deps.setInitialPassword;
    deps.setInitialPassword = async (userId, newPassword) => {
      const written = await setInitialPassword(userId, newPassword);
      await after();
      return written;
    };
    return deps;
  }

  it("does not survive a reset committed between the change and the session", async () => {
    // The person's own new password, then an administrator's reset. The
    // session the change goes on to mint was earned with the person's
    // password, which the reset replaced.
    vi.useFakeTimers({ toFake: ["Date"] });
    const { t, userId } = await account({ mustChangePassword: true });
    const deps = depsRunningAfterChange(t, async () => {
      // A later second: the column keeps whole seconds on SQLite and MySQL,
      // so a reset inside the same one is indistinguishable by design.
      vi.setSystemTime(Date.now() + 2000);
      await t.nextly.users.update({
        id: userId,
        data: { password: "N3w-Str0ng-P@ss!" },
      });
    });

    const res = await handleSetInitialPassword(
      await setInitialPasswordRequest(userId),
      deps
    );

    expect(res.status).toBe(401);
    expect(await refreshRows(t, userId)).toHaveLength(0);
  });

  it("signs in with the password it set when nothing sets another", async () => {
    // The control: a session judged against the written version must still
    // match the version the session-row lock reads back.
    const { t, userId } = await account({ mustChangePassword: true });
    const deps = depsRunningAfterChange(t, async () => {});

    const res = await handleSetInitialPassword(
      await setInitialPasswordRequest(userId),
      deps
    );

    expect(res.status).toBe(200);
    expect(await refreshRows(t, userId)).toHaveLength(1);
  });
});
