import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import {
  HANDOFF_TTL_SECONDS,
  InvalidHandoffError,
  mintHandoff,
  resetRedeemedHandoffs,
  verifyHandoff,
} from "./handoff";
import { derivePurposeKey, HANDOFF_KEY_LABEL } from "./keys";

const SECRET = "test-secret-value-long-enough-to-be-realistic";

beforeEach(() => {
  resetRedeemedHandoffs();
});

describe("mintHandoff / verifyHandoff", () => {
  it("round-trips the verified identity", async () => {
    const token = await mintHandoff(
      { userId: "user-1", provider: "google" },
      SECRET
    );
    const claims = await verifyHandoff(token, SECRET);
    expect(claims.userId).toBe("user-1");
    expect(claims.provider).toBe("google");
    expect(claims.jti).toEqual(expect.any(String));
  });

  it("gives every token a distinct jti", async () => {
    const a = await mintHandoff({ userId: "u", provider: "google" }, SECRET);
    const b = await mintHandoff({ userId: "u", provider: "google" }, SECRET);
    const claimsA = await verifyHandoff(a, SECRET);
    const claimsB = await verifyHandoff(b, SECRET);
    expect(claimsA.jti).not.toBe(claimsB.jti);
  });

  it("defaults to a sixty-second lifetime", () => {
    expect(HANDOFF_TTL_SECONDS).toBe(60);
  });
});

describe("verifyHandoff rejects", () => {
  it("a token signed with a different secret", async () => {
    const token = await mintHandoff(
      { userId: "u", provider: "google" },
      SECRET
    );
    await expect(verifyHandoff(token, "another-secret")).rejects.toBeInstanceOf(
      InvalidHandoffError
    );
  });

  it("a tampered payload", async () => {
    const token = await mintHandoff(
      { userId: "u", provider: "google" },
      SECRET
    );
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ typ: "sso-handoff", sub: "admin", provider: "google" })
    ).toString("base64url");
    await expect(
      verifyHandoff(`${header}.${forged}.${signature}`, SECRET)
    ).rejects.toBeInstanceOf(InvalidHandoffError);
  });

  it("an expired token", async () => {
    const token = await mintHandoff(
      { userId: "u", provider: "google" },
      SECRET,
      -1
    );
    await expect(verifyHandoff(token, SECRET)).rejects.toBeInstanceOf(
      InvalidHandoffError
    );
  });

  it("a token carrying the wrong typ", async () => {
    const key = derivePurposeKey(SECRET, HANDOFF_KEY_LABEL);
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      typ: "something-else",
      sub: "u",
      provider: "google",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti("j1")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(key);
    await expect(verifyHandoff(token, SECRET)).rejects.toThrow(/wrong-type/);
  });

  it("a token missing required claims", async () => {
    const key = derivePurposeKey(SECRET, HANDOFF_KEY_LABEL);
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ typ: "sso-handoff", sub: "u" })
      .setProtectedHeader({ alg: "HS256" })
      .setJti("j2")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(key);
    await expect(verifyHandoff(token, SECRET)).rejects.toThrow(/malformed/);
  });

  it("a garbage string", async () => {
    await expect(verifyHandoff("not-a-jwt", SECRET)).rejects.toBeInstanceOf(
      InvalidHandoffError
    );
  });
});

describe("single use", () => {
  it("accepts a token once and refuses the replay", async () => {
    const token = await mintHandoff(
      { userId: "u", provider: "google" },
      SECRET
    );
    await expect(verifyHandoff(token, SECRET)).resolves.toMatchObject({
      userId: "u",
    });
    await expect(verifyHandoff(token, SECRET)).rejects.toThrow(
      /already-redeemed/
    );
  });

  it("does not let one token's redemption block another", async () => {
    const a = await mintHandoff({ userId: "a", provider: "google" }, SECRET);
    const b = await mintHandoff({ userId: "b", provider: "github" }, SECRET);
    await verifyHandoff(a, SECRET);
    await expect(verifyHandoff(b, SECRET)).resolves.toMatchObject({
      userId: "b",
    });
  });
});

describe("key separation from core sessions", () => {
  /**
   * Core resolves a session by verifying an HS256 JWT against the raw
   * application secret and rejecting only `typ: "pending-auth"`. A handoff token
   * signed with that same key would therefore be accepted as a session cookie,
   * which would defeat both its expiry and its single-use property. It must
   * verify under the derived key and nowhere else.
   */
  it("mints under a derived key, not the raw secret", async () => {
    const token = await mintHandoff(
      { userId: "u", provider: "google" },
      SECRET
    );
    const { jwtVerify } = await import("jose");
    const rawSecretKey = new TextEncoder().encode(SECRET);
    await expect(
      jwtVerify(token, rawSecretKey, { algorithms: ["HS256"] })
    ).rejects.toThrow();
  });

  it("refuses a token minted under the transaction key", async () => {
    const { TRANSACTION_KEY_LABEL } = await import("./keys");
    const key = derivePurposeKey(SECRET, TRANSACTION_KEY_LABEL);
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      typ: "sso-handoff",
      sub: "u",
      provider: "google",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti("j3")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(key);
    await expect(verifyHandoff(token, SECRET)).rejects.toBeInstanceOf(
      InvalidHandoffError
    );
  });
});
