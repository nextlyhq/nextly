/**
 * Tests for the determineUser branch of handleSession.
 *
 * A plugin's resolution is a claim about the account, not proof of it, so
 * the account row is re-read and the shared account gate decides whether
 * the claim may be answered as a session. The invariants:
 *
 *   1. An account that may hold a session (active, verified where sign-in
 *      requires it) is answered as the session user.
 *   2. A deactivated account, an unverified account where sign-in requires
 *      verification, and an account the lookup cannot find are NOT answered:
 *      the credential falls through to the stateless path, which returns 401
 *      for a request carrying no cookie/JWT.
 *   3. A password lockout does not disqualify — someone else's wrong guesses
 *      must not end a session the credential itself still holds.
 *   4. Without an account lookup wired, a plugin identity is not trusted.
 *   5. A refused credential does not poison the stateless path: a request
 *      with a valid access-token cookie still answers from the JWT.
 */
import { describe, expect, it, vi } from "vitest";

import { COOKIE_NAMES } from "../../cookies/cookie-config";
import { buildClaims } from "../../jwt/claims";
import { signAccessToken } from "../../jwt/sign";
import { AuthHookRegistry } from "../../pipeline/hooks";
import type { AccountState } from "../../session/account-state";
import type { AuthUser, AuthUserId } from "../../../types/auth";

import { handleSession, type SessionHandlerDeps } from "../session";

const SECRET = "test-secret-32-chars-minimum-padding-padding";
const URL = "http://localhost:3000/admin/api/auth/session";

const PLUGIN_USER: AuthUser = {
  id: "user-1" as AuthUserId,
  email: "plugin@nextly.local",
  name: "Plugin User",
  image: null,
};

function usableState(overrides: Partial<AccountState> = {}): AccountState {
  return {
    userId: "user-1",
    isActive: true,
    lockedUntil: null,
    emailVerified: new Date("2026-01-01T00:00:00Z"),
    passwordUpdatedAt: null,
    ...overrides,
  };
}

function registryResolving(user: AuthUser | null): AuthHookRegistry {
  const registry = new AuthHookRegistry();
  registry.add({ determineUser: async () => user });
  return registry;
}

function makeDeps(
  overrides: Partial<SessionHandlerDeps> = {}
): SessionHandlerDeps {
  return {
    secret: SECRET,
    isProduction: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 7 * 24 * 60 * 60,
    devAutoLogin: false,
    findUserByEmail: vi.fn().mockResolvedValue(null),
    fetchRoleIds: vi.fn().mockResolvedValue([]),
    fetchCustomFields: vi.fn().mockResolvedValue({}),
    storeRefreshToken: vi.fn().mockResolvedValue(undefined),
    fetchAccountState: vi.fn().mockResolvedValue(usableState()),
    requireEmailVerification: true,
    authHooks: registryResolving(PLUGIN_USER),
    pluginCtx: {} as never,
    ...overrides,
  };
}

function makeRequest(cookie?: string): Request {
  return new Request(URL, {
    headers: cookie ? { cookie } : undefined,
  });
}

async function bodyOf(res: Response): Promise<{
  user?: { id?: string; email?: string };
  accessToken?: string | null;
  error?: { code?: string };
}> {
  return (await res.json()) as never;
}

describe("handleSession determineUser gate", () => {
  it("answers a plugin-resolved user whose account may hold a session", async () => {
    const fetchAccountState = vi.fn().mockResolvedValue(usableState());

    const res = await handleSession(
      makeRequest(),
      makeDeps({ fetchAccountState })
    );
    const body = await bodyOf(res);

    expect(res.status).toBe(200);
    expect(fetchAccountState).toHaveBeenCalledWith("user-1");
    expect(body.user).toEqual({
      id: "user-1",
      email: "plugin@nextly.local",
      name: "Plugin User",
      image: null,
    });
    expect(body.accessToken).toBeNull();
  });

  it("does not answer a deactivated account: the credential falls through to the 401", async () => {
    const res = await handleSession(
      makeRequest(),
      makeDeps({
        fetchAccountState: vi
          .fn()
          .mockResolvedValue(usableState({ isActive: false })),
      })
    );
    const body = await bodyOf(res);

    expect(res.status).toBe(401);
    expect(body.error?.code).toBe("AUTH_REQUIRED");
    expect(body.user).toBeUndefined();
  });

  it("does not answer an unverified account while sign-in requires verification", async () => {
    const res = await handleSession(
      makeRequest(),
      makeDeps({
        fetchAccountState: vi
          .fn()
          .mockResolvedValue(usableState({ emailVerified: null })),
      })
    );

    expect(res.status).toBe(401);
  });

  it("answers an unverified account when sign-in does not require verification", async () => {
    const res = await handleSession(
      makeRequest(),
      makeDeps({
        fetchAccountState: vi
          .fn()
          .mockResolvedValue(usableState({ emailVerified: null })),
        requireEmailVerification: false,
      })
    );
    const body = await bodyOf(res);

    expect(res.status).toBe(200);
    expect(body.user?.id).toBe("user-1");
  });

  it("does not answer an account the lookup cannot find", async () => {
    const res = await handleSession(
      makeRequest(),
      makeDeps({ fetchAccountState: vi.fn().mockResolvedValue(null) })
    );

    expect(res.status).toBe(401);
  });

  it("answers a locked account: a password lockout is not this credential's", async () => {
    const res = await handleSession(
      makeRequest(),
      makeDeps({
        fetchAccountState: vi
          .fn()
          .mockResolvedValue(
            usableState({ lockedUntil: new Date(Date.now() + 60_000) })
          ),
      })
    );
    const body = await bodyOf(res);

    expect(res.status).toBe(200);
    expect(body.user?.id).toBe("user-1");
  });

  it("does not trust a plugin identity with no account lookup wired", async () => {
    const deps = makeDeps();
    delete deps.fetchAccountState;

    const res = await handleSession(makeRequest(), deps);

    expect(res.status).toBe(401);
  });

  it("a refused credential falls through to the cookie path, not an error", async () => {
    // The plugin resolves a deactivated account, but the request also
    // carries a valid access-token cookie: the stateless path answers from
    // the JWT, on the same terms it would have without the plugin at all.
    const claims = buildClaims({
      userId: "user-2",
      email: "cookie@nextly.local",
      name: "Cookie User",
      image: null,
      roleIds: [],
    });
    const token = await signAccessToken(claims, SECRET, 900);

    const res = await handleSession(
      makeRequest(`${COOKIE_NAMES.accessToken}=${token}`),
      makeDeps({
        fetchAccountState: vi
          .fn()
          .mockResolvedValue(usableState({ isActive: false })),
      })
    );
    const body = await bodyOf(res);

    expect(res.status).toBe(200);
    expect(body.user?.id).toBe("user-2");
    expect(body.accessToken).toBe(token);
  });

  it("a null resolution falls through to the stateless path", async () => {
    const res = await handleSession(
      makeRequest(),
      makeDeps({ authHooks: registryResolving(null) })
    );

    expect(res.status).toBe(401);
  });
});
