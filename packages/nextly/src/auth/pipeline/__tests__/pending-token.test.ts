import { SignJWT } from "jose";
import { describe, it, expect } from "vitest";

import {
  mintPendingToken,
  verifyPendingToken,
  InvalidPendingTokenError,
  PENDING_AUTH_TYP,
  MUST_CHANGE_PASSWORD_CHALLENGE,
} from "../pending-token";

const secret = "test-secret-at-least-32-chars-long-aaaa";

describe("pending-auth token", () => {
  it("round-trips userId + challengeId + attempts", async () => {
    const t = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0 },
      secret,
      300
    );
    const v = await verifyPendingToken(t, secret);
    expect(v).toMatchObject({ userId: "u1", challengeId: "totp", attempts: 0 });
  });

  it("rejects a tampered token", async () => {
    const t = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0 },
      secret,
      300
    );
    await expect(verifyPendingToken(t + "x", secret)).rejects.toThrow(
      /invalid pending-auth token/
    );
  });

  it("rejects an expired token", async () => {
    const t = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0 },
      secret,
      -1
    );
    await expect(verifyPendingToken(t, secret)).rejects.toThrow(/expired/);
  });

  it("rejects a normal access token (wrong typ)", async () => {
    // A token WITHOUT the pending typ must not pass verifyPendingToken. The
    // session typ in its JWS header is what refuses it now, one step before
    // the claim check that used to, hence the reason rather than "wrong-type".
    const { signAccessToken } = await import("../../jwt/sign");
    const access = await signAccessToken(
      { sub: "u1", email: "a@b.c" },
      secret,
      300
    );
    await expect(verifyPendingToken(access, secret)).rejects.toThrow(
      InvalidPendingTokenError
    );
  });

  it("still rejects a claim-only pending impostor with no header typ", async () => {
    // The claim check remains load-bearing: a token minted before the header
    // existed carries no typ to refuse, so nothing else would catch this.
    const untyped = await new SignJWT({ sub: "u1", email: "a@b.c" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(secret));
    await expect(verifyPendingToken(untyped, secret)).rejects.toThrow(
      /wrong-type/
    );
  });

  it("exposes the typ constant", () => {
    expect(PENDING_AUTH_TYP).toBe("pending-auth");
  });
});

describe("the forced-password-change challenge id", () => {
  it("is exactly the string the admin login page matches on", () => {
    // A WIRE value, not an internal name. It reaches the browser as the
    // `challengeId` of the pending cookie, and the login page has to tell it
    // apart from a plugin challenge by name — no view is registered for it
    // and none can be, since the step it names is core's own set-password
    // flow. That module is browser code and cannot import this one, so the
    // spelling is pinned here, where the constant lives.
    //
    // Changing it means changing `use-resume-login.ts` in `@nextlyhq/admin`
    // in the same commit; otherwise a forced password change resumed from an
    // external provider renders the missing-view fallback and the login can
    // never be completed.
    expect(MUST_CHANGE_PASSWORD_CHALLENGE).toBe("must-change-password");
  });
});
