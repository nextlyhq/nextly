/**
 * The password version a password sign-in proves travels with the sign-in.
 *
 * The password is checked against the hash read with the account row, and a
 * session issued for that proof is refused if the password is set again
 * before its refresh row is written. So the version read beside the hash, not
 * one read later, is what the session — or the second factor that interrupts
 * it — carries.
 */
import { describe, expect, it, vi } from "vitest";

import { hashPassword } from "../../password";
import { verifyCredentials } from "../../credentials/verify-credentials";
import { AuthHookRegistry } from "../../pipeline/hooks";
import { createPasswordStrategy } from "../../pipeline/password-strategy";
import { verifyPendingToken } from "../../pipeline/pending-token";
import { handleLogin, type LoginHandlerDeps } from "../login";

import { fakeSessionRows, fixtureIdentity } from "./session-row-fake";

const SECRET = "test-secret-that-is-at-least-32-characters-long!!";
const ORIGIN = "http://localhost:3000";
const PROVEN = new Date("2026-01-01T00:00:00Z");
const LATER = new Date("2026-02-01T00:00:00Z");

/**
 * Login deps whose credential row says the password was set at `PROVEN`,
 * while every later read of the account says `gateReads`.
 */
async function loginDeps(
  gateReads: Date,
  hooks = new AuthHookRegistry(),
  gateEpoch = 0,
  // What the credential lookup reads beside the hash; "omitted" for a lookup
  // that does not select the column, as one an app assembled may not.
  rowEpoch: number | "omitted" = 0
) {
  const passwordHash = await hashPassword("Pass1234!");
  const credentials = {
    findUserByEmail: vi.fn().mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      name: "A",
      image: null,
      passwordHash,
      emailVerified: PROVEN,
      isActive: true,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      deactivatedAt: null,
      passwordUpdatedAt: PROVEN,
      ...(rowEpoch === "omitted" ? {} : { sessionEpoch: rowEpoch }),
    }),
    incrementFailedAttempts: vi.fn(),
    lockAccount: vi.fn(),
    resetFailedAttempts: vi.fn(),
    maxLoginAttempts: 5,
    lockoutDurationSeconds: 900,
    requireEmailVerification: true,
  };
  const state = async (userId: string) => ({
    userId,
    isActive: true,
    lockedUntil: null,
    emailVerified: PROVEN,
    passwordUpdatedAt: gateReads,
    ...fixtureIdentity,
    sessionEpoch: gateEpoch,
  });
  const rows = fakeSessionRows(state);
  const deps = {
    ...credentials,
    secret: SECRET,
    isProduction: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 604800,
    loginStallTimeMs: 0,
    allowedOrigins: [ORIGIN],
    trustProxy: false,
    trustedProxyIps: [],
    fetchAccountState: state,
    fetchSessionRoles: vi
      .fn()
      .mockResolvedValue({ roleIds: [], validUntil: undefined }),
    fetchCustomFields: vi.fn().mockResolvedValue({}),
    withSessionRowTransaction: rows.withSessionRowTransaction,
    authStrategies: [
      // As the bridge builds it: the verified row's version rides beside the
      // user the strategy returns.
      createPasswordStrategy({
        verify: async creds => {
          const u = await verifyCredentials(creds, credentials);
          return {
            id: u.id as never,
            email: u.email,
            name: u.name,
            image: u.image,
            mustChangePassword: u.mustChangePassword,
            passwordUpdatedAt: u.passwordUpdatedAt,
            sessionEpoch: u.sessionEpoch,
          };
        },
      }),
    ],
    authHooks: hooks,
    pluginCtx: {} as never,
    challengeTokenTTL: 300,
    auditLog: { write: vi.fn().mockResolvedValue(undefined) },
  } satisfies LoginHandlerDeps;
  return { deps, rows };
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
      email: "a@example.com",
      password: "Pass1234!",
    }),
  });
}

describe("the password version a sign-in proved", () => {
  it("refuses the session when the account's password was set after the proof", async () => {
    // Every read after the credential check sees the reset; only the version
    // read beside the hash shows the password proven is not the current one.
    const { deps, rows } = await loginDeps(LATER);

    const res = await handleLogin(loginRequest(), deps);

    expect(res.status).toBe(401);
    expect(rows.committed).toHaveLength(0);
  });

  it("refuses the session when the sessions were ended in the second the password was proven", async () => {
    // The password time reads the same, as a reset within the same second
    // leaves it on MySQL and SQLite; only the epoch read beside the hash
    // shows the proof is from before the reset.
    const { deps, rows } = await loginDeps(PROVEN, new AuthHookRegistry(), 1);

    const res = await handleLogin(loginRequest(), deps);

    expect(res.status).toBe(401);
    expect(rows.committed).toHaveLength(0);
  });

  it("issues no session when the lookup did not read the epoch beside the hash", async () => {
    // Read as zero, the epoch would refuse every sign-in of an account whose
    // sessions had ever been ended; taken from a later read instead, it would
    // be the epoch of a reset made in the same second as the proof, and sign
    // in the old password's holder. Neither is safe, so nothing is issued and
    // the log says what the lookup must return.
    const { deps, rows } = await loginDeps(
      PROVEN,
      new AuthHookRegistry(),
      3,
      "omitted"
    );

    const res = await handleLogin(loginRequest(), deps);

    expect(res.status).toBe(500);
    expect(rows.committed).toHaveLength(0);
  });

  it("signs the proven epoch into the token a second factor pauses on", async () => {
    const hooks = new AuthHookRegistry();
    hooks.add({
      afterAuthenticate: user => ({
        challenge: { id: "totp", userId: String(user.id) },
      }),
    });
    const { deps } = await loginDeps(PROVEN, hooks, 1);

    const res = await handleLogin(loginRequest(), deps);
    const body = (await res.json()) as { pendingToken: string };
    const claims = await verifyPendingToken(body.pendingToken, SECRET);

    expect(claims.sessionEpoch).toBe(0);
  });

  it("issues the session when the password proven is the current one", async () => {
    const { deps, rows } = await loginDeps(PROVEN);

    const res = await handleLogin(loginRequest(), deps);

    expect(res.status).toBe(200);
    expect(rows.committed).toHaveLength(1);
  });

  it("signs the proven version into the token a second factor pauses on", async () => {
    const hooks = new AuthHookRegistry();
    hooks.add({
      afterAuthenticate: user => ({
        challenge: { id: "totp", userId: String(user.id) },
      }),
    });
    const { deps } = await loginDeps(LATER, hooks);

    const res = await handleLogin(loginRequest(), deps);
    const body = (await res.json()) as { pendingToken: string };
    const claims = await verifyPendingToken(body.pendingToken, SECRET);

    expect(claims.passwordUpdatedAt).toBe(PROVEN.getTime());
  });
});
