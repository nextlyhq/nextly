import { decodeJwt } from "jose";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { AuthUser } from "../../../types/auth";
import {
  issueSession,
  mintSession,
  type IssueSessionDeps,
} from "../issue-session";

import { fakeSessionRows, type FakeSessionRows } from "./session-row-fake";

/** The identity the user row holds: what the session claims are judged against. */
const CHECKED = {
  email: "a@b.c",
  name: "Ada",
  image: "/avatars/ada.png",
  sessionEpoch: 0,
};

interface State {
  isActive: boolean;
  lockedUntil: Date | null;
  emailVerified: Date | null;
  passwordUpdatedAt?: Date | null;
  sessionEpoch?: number;
}

/**
 * Deps over an account whose state is `state` at the first read and, when
 * given, `lockedState` under the session-row lock — the state a revocation
 * committed in between leaves behind.
 */
function deps(
  state: State,
  lockedState: State = state
): IssueSessionDeps & { rows: FakeSessionRows } {
  const rows = fakeSessionRows(async userId => ({
    userId,
    passwordUpdatedAt: null,
    ...CHECKED,
    ...lockedState,
  }));
  return {
    rows,
    withSessionRowTransaction: rows.withSessionRowTransaction,
    secret: "x".repeat(32),
    isProduction: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 604800,
    trustProxy: false,
    trustedProxyIps: [],
    requireEmailVerification: true,
    fetchAccountState: vi.fn(async (userId: string) => ({
      userId,
      passwordUpdatedAt: null,
      ...CHECKED,
      ...state,
    })),
    fetchSessionRoles: vi.fn(async () => ({
      roleIds: [],
      validUntil: undefined,
    })),
    fetchCustomFields: vi.fn(async () => ({})),
    authHooks: {
      runCustomizeClaims: async (c: unknown) => c,
      runAfterLogin: async () => {},
    } as never,
    pluginCtx: {} as never,
    auditLog: { write: vi.fn(async () => {}) } as never,
  };
}

const user = { id: "u1", email: "a@b.c" } as AuthUser;
const req = new Request("http://localhost/admin/api/auth/login", {
  method: "POST",
});

describe("issueSession account-state gate", () => {
  it("refuses a locked account before minting anything", async () => {
    const d = deps({
      isActive: true,
      lockedUntil: new Date(Date.now() + 60_000),
      emailVerified: new Date(),
    });
    await expect(issueSession(user, d, req, "r1")).rejects.toSatisfy(
      NextlyError.is
    );
    expect(d.rows.insertRefreshToken).not.toHaveBeenCalled();
  });

  it("refuses a deactivated account", async () => {
    const d = deps({
      isActive: false,
      lockedUntil: null,
      emailVerified: new Date(),
    });
    await expect(issueSession(user, d, req, "r1")).rejects.toSatisfy(
      NextlyError.is
    );
  });

  it("issues a session for a usable account", async () => {
    const d = deps({
      isActive: true,
      lockedUntil: null,
      emailVerified: new Date(),
    });
    const res = await issueSession(user, d, req, "r1");
    expect(res.status).toBe(200);
    expect(d.rows.committed).toHaveLength(1);
  });
});

/** The cookie's name and attributes, with the value dropped. */
function cookieShape(setCookie: string): string {
  const [pair, ...attributes] = setCookie.split(";");
  return [pair.split("=")[0], ...attributes.map(a => a.trim())].join("; ");
}

describe("mintSession", () => {
  const usable = {
    isActive: true,
    lockedUntil: null,
    emailVerified: new Date(),
  };

  it("returns the cookies and body a login response is built from", async () => {
    const d = deps(usable);
    const minted = await mintSession(user, d, req, { strategy: "test" });

    // The access and refresh cookies, and the clearing of a refresh cookie
    // left at its legacy path.
    expect(minted.cookies.map(c => c.split("=")[0])).toEqual([
      "nextly_session",
      "nextly_refresh",
      "nextly_refresh",
    ]);
    expect(minted.body.user).toMatchObject({ id: "u1", email: "a@b.c" });
    expect(typeof minted.body.accessToken).toBe("string");
    expect(typeof minted.body.refreshToken).toBe("string");
    expect(typeof minted.body.expiresAt).toBe("string");
    expect(d.rows.committed).toHaveLength(1);
  });

  it("runs the account-state gate before storing anything", async () => {
    const d = deps({ ...usable, isActive: false });
    await expect(
      mintSession(user, d, req, { strategy: "test" })
    ).rejects.toSatisfy(NextlyError.is);
    expect(d.rows.insertRefreshToken).not.toHaveBeenCalled();
  });

  it("produces the same cookies the JSON response carries", async () => {
    // The point of the split: one implementation mints, and the JSON response
    // and the redirect are thin wrappers. Compare the two OUTPUTS rather than
    // spying, since a same-module call cannot be intercepted — and compare
    // names and attributes, because the token values differ per call.
    const minted = await mintSession(user, deps(usable), req, {
      strategy: "test",
    });
    const res = await issueSession(user, deps(usable), req, "r1", {
      strategy: "test",
    });

    expect(res.headers.getSetCookie().map(cookieShape)).toEqual(
      minted.cookies.map(cookieShape)
    );
  });
});

describe("mintSession's identity claims", () => {
  const usable = {
    isActive: true,
    lockedUntil: null,
    emailVerified: new Date(),
  };

  it.each([
    ["email", { email: "someone-else@evil.test" }],
    ["name", { name: "Not Ada" }],
    ["image", { image: "https://evil.test/a.png" }],
  ] as const)(
    "signs the checked account's %s, not the one an afterAuthenticate hook returned",
    async (claim, altered) => {
      // The user handed to the mint is what the hooks returned. The account
      // the gate checked is the row, so a hook rewriting a detail must not
      // put it into the session readers trust as the signed-in person.
      const minted = await mintSession(
        { ...user, name: "Ada", image: CHECKED.image, ...altered },
        deps(usable),
        req,
        { strategy: "test" }
      );

      const claims = decodeJwt(minted.body.accessToken);
      expect(claims[claim]).toBe(CHECKED[claim]);
      expect(minted.body.user[claim]).toBe(CHECKED[claim]);
    }
  );

  it("signs the checked account's details when the hook changed none", async () => {
    // The control: the same values arrive whichever copy is read, so the
    // cases above fail only where the two copies differ.
    const minted = await mintSession(
      { ...user, name: CHECKED.name, image: CHECKED.image },
      deps(usable),
      req,
      { strategy: "test" }
    );

    expect(decodeJwt(minted.body.accessToken)).toMatchObject({
      sub: "u1",
      email: CHECKED.email,
      name: CHECKED.name,
      image: CHECKED.image,
    });
  });
});

describe("mintSession and an account read without the session identity", () => {
  it("refuses, rather than signing a session with no identity or epoch", async () => {
    // A caller assembling the auth deps may still return the older account
    // shape. Signed anyway, the session would carry no email and epoch zero,
    // and every check after the account's first change would refuse it.
    const d = deps({
      isActive: true,
      lockedUntil: null,
      emailVerified: new Date(),
    });
    d.fetchAccountState = vi.fn(async (userId: string) => ({
      userId,
      isActive: true,
      lockedUntil: null,
      emailVerified: new Date(),
      passwordUpdatedAt: null,
    })) as never;

    await expect(
      mintSession(user, d, req, { strategy: "test" })
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(d.rows.insertRefreshToken).not.toHaveBeenCalled();
  });
});

describe("mintSession against a revocation during the mint", () => {
  const usable = {
    isActive: true,
    lockedUntil: null,
    emailVerified: new Date(),
    passwordUpdatedAt: new Date("2026-01-01T00:00:00Z"),
  };

  it("locks and re-reads the account before inserting the row", async () => {
    // The order is the mechanism: a revocation updates the user row before it
    // deletes refresh rows, so the lock taken first makes it either visible to
    // the re-read or wait until the row is in place for it to delete.
    const d = deps(usable);
    await mintSession(user, d, req, { strategy: "test" });

    expect(d.rows.calls).toEqual(["lock", "insert", "commit"]);
    expect(d.rows.lockAccountState).toHaveBeenCalledWith("u1");
  });

  it("refuses an account deactivated after the first gate, and writes nothing", async () => {
    const d = deps(usable, { ...usable, isActive: false });

    await expect(
      mintSession(user, d, req, { strategy: "test" })
    ).rejects.toSatisfy(NextlyError.is);
    expect(d.rows.insertRefreshToken).not.toHaveBeenCalled();
    expect(d.rows.committed).toHaveLength(0);
    // Refused before the post-login steps: no success is recorded for a
    // session that was never issued.
    expect(d.auditLog.write).not.toHaveBeenCalled();
  });

  it("refuses when the password was set after the first gate", async () => {
    const d = deps(usable, {
      ...usable,
      passwordUpdatedAt: new Date("2026-02-01T00:00:00Z"),
    });

    const refusal = await mintSession(user, d, req, { strategy: "test" }).then(
      () => null,
      (err: unknown) => err
    );

    expect((refusal as NextlyError).code).toBe("AUTH_INVALID_CREDENTIALS");
    expect((refusal as NextlyError).logContext?.reason).toBe(
      "password-changed"
    );
    expect(d.rows.committed).toHaveLength(0);
  });

  it("refuses when the sessions were ended after the first gate, within the same second", async () => {
    // A password set in the same second as the first read leaves the stored
    // time unchanged on MySQL and SQLite, so the epoch is what shows the
    // revocation. Missed, the refresh row written here would outlive it.
    const d = deps(usable, { ...usable, sessionEpoch: 1 });

    await expect(
      mintSession(user, d, req, { strategy: "test" })
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(d.rows.committed).toHaveLength(0);
  });

  it("judges against the epoch the sign-in proved, not a later read", async () => {
    // The password was proven at epoch 0; the gate's own read already sees
    // the epoch a same-second reset raised. Comparing with the gate's read
    // would pass, and sign in the old password's holder.
    const d = deps({ ...usable, sessionEpoch: 1 });

    await expect(
      mintSession(user, d, req, {
        strategy: "password",
        passwordUpdatedAt: usable.passwordUpdatedAt,
        sessionEpoch: 0,
      })
    ).rejects.toSatisfy(NextlyError.is);
    expect(d.rows.committed).toHaveLength(0);
  });

  it("signs the epoch it compares under the lock", async () => {
    // The control: unchanged, the session is issued, carrying that epoch.
    const d = deps({ ...usable, sessionEpoch: 3 });

    const minted = await mintSession(user, d, req, { strategy: "test" });

    expect(decodeJwt(minted.body.accessToken).sev).toBe(3);
    expect(d.rows.committed).toHaveLength(1);
  });

  it("judges against the password version the sign-in proved, not a later read", async () => {
    // The password was proven against the January value; the gate's own read
    // already sees February's reset. Comparing with the gate's read would
    // pass, and the old password's holder would be signed in.
    const reset = { ...usable, passwordUpdatedAt: new Date("2026-02-01") };
    const d = deps(reset);

    await expect(
      mintSession(user, d, req, {
        strategy: "password",
        passwordUpdatedAt: usable.passwordUpdatedAt,
      })
    ).rejects.toSatisfy(NextlyError.is);
    expect(d.rows.committed).toHaveLength(0);
  });
});
