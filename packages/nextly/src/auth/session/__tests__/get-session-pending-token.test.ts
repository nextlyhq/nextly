import { describe, it, expect } from "vitest";

import { COOKIE_NAMES } from "../../cookies/cookie-config";
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
