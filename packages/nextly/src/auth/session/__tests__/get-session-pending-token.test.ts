import { vi, describe, it, expect } from "vitest";

// These tests read a session with no database behind it. Whether the account
// may still use its token is the session check's own question, covered by
// `auth/session/__tests__/session-standing.test.ts` and, on each dialect,
// `session-cutoff.integration.test.ts`; here every account may.
vi.mock("../session-standing", async importOriginal => ({
  ...(await importOriginal<typeof import("../session-standing")>()),
  sessionTokenIsCurrent: async () => true,
}));

import { COOKIE_NAMES } from "../../cookies/cookie-config";
import { signUnmarkedPendingToken } from "../../jwt/__tests__/unmarked-tokens";
import { signAccessToken } from "../../jwt/sign";
import { mintPendingToken } from "../../pipeline/pending-token";
import { getSession } from "../get-session";

const secret = "test-secret-at-least-32-chars-long-bbbb";

function withAccessCookie(token: string): Request {
  return new Request("http://x/api", {
    headers: { cookie: `${COOKIE_NAMES.accessToken}=${token}` },
  });
}

describe("getSession rejects pending-auth tokens (D71 security gate)", () => {
  it("does NOT authenticate a pending-auth token", async () => {
    const pending = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0 },
      secret,
      300
    );
    const res = await getSession(withAccessCookie(pending), secret);
    expect(res.authenticated).toBe(false);
  });

  it("still authenticates a normal access token (no regression)", async () => {
    const access = await signAccessToken(
      { sub: "u1", email: "a@b.c", name: "A", image: null, roleIds: [] },
      secret,
      300
    );
    const res = await getSession(withAccessCookie(access), secret);
    expect(res.authenticated).toBe(true);
  });
});

describe("getSession and pending tokens minted before tokens named their purpose", () => {
  // Such a token has no header `typ`. Since the release that made the header
  // required, the verifier refuses it before its claim is read, and this
  // reader answers the refusal as invalid. The control beside this test while
  // unmarked tokens were still accepted — the same shape without the pending
  // claim opening a session — went with that allowance, as its comment said
  // it would.
  it("does NOT authenticate one", async () => {
    const pending = await signUnmarkedPendingToken("u1", secret);
    const res = await getSession(withAccessCookie(pending), secret);
    expect(res).toEqual({ authenticated: false, reason: "invalid" });
  });
});
