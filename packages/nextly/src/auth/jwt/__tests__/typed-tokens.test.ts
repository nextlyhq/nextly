import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { mintPendingToken } from "../../pipeline/pending-token";
import { buildClaims } from "../claims";
import { secretToKey, signAccessTokenWithExpiry, TOKEN_TYP } from "../sign";
import { verifyToken } from "../verify";

import { signUnmarkedPendingToken, signUnmarkedToken } from "./unmarked-tokens";

const secret = "s".repeat(32);

describe("typed tokens", () => {
  it("stamps the session typ header on access tokens", async () => {
    const { token } = await signAccessTokenWithExpiry(
      { sub: "u1" },
      secret,
      60
    );
    const header = JSON.parse(
      Buffer.from(token.split(".")[0], "base64url").toString()
    ) as { typ?: string };
    expect(header.typ).toBe(TOKEN_TYP.session);
  });

  it("refuses a session token with no typ header", async () => {
    // The named release. Tokens signed before the header existed were
    // accepted while they could still be in circulation; this release stops
    // accepting them, and a token without the header is refused wherever a
    // session is read — Direct API tokens from before the header included,
    // which lived 30 days and have had longer than that to expire.
    const legacy = await signUnmarkedToken({ sub: "u1" }, secret, 60);
    const r = await verifyToken(legacy, secret, "session");
    expect(r).toEqual({ valid: false, reason: "invalid" });
  });

  it("refuses a pending token presented as a session", async () => {
    const pending = await mintPendingToken(
      { userId: "u1", challengeId: "c", attempts: 0 },
      secret,
      60
    );
    const r = await verifyToken(pending, secret, "session");
    expect(r).toEqual({ valid: false, reason: "invalid" });
  });

  it("refuses a LEGACY pending token, which carries no typ header, as a session", async () => {
    // A pending token minted before the header existed carries no header typ,
    // so the required-header rule refuses it before its claim is read; the
    // payload-claim check behind that still refuses a token carrying the
    // session header alongside a pending claim.
    const legacyPending = await signUnmarkedPendingToken("u1", secret);
    expect((await verifyToken(legacyPending, secret, "session")).valid).toBe(
      false
    );
  });

  it("refuses a token with no typ header for the pending purpose", async () => {
    // A pending token signed before the header existed is marked only by its
    // claim. The header is required now, so one is refused as a pending token
    // too, before the claim is read: it expired within minutes of being
    // minted, and no reader needs the claim's word for what the header no
    // longer names.
    const legacyPending = await signUnmarkedPendingToken("u1", secret);
    expect(await verifyToken(legacyPending, secret, "pending")).toEqual({
      valid: false,
      reason: "invalid",
    });
  });

  it("refuses a token of an unknown typ as a session", async () => {
    const other = await new SignJWT({ sub: "u1" })
      .setProtectedHeader({ alg: "HS256", typ: "sso-handoff" })
      .setIssuedAt()
      .setExpirationTime("1m")
      .sign(secretToKey(secret));
    expect((await verifyToken(other, secret, "session")).valid).toBe(false);
  });

  it("refuses a session token presented as a pending token", async () => {
    const { token } = await signAccessTokenWithExpiry(
      { sub: "u1" },
      secret,
      60
    );
    expect((await verifyToken(token, secret, "pending")).valid).toBe(false);
  });

  it("never lets a custom field named typ reach the claims", () => {
    const claims = buildClaims({
      userId: "u1",
      email: "a@b.c",
      name: "",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
      customFields: { typ: "pending-auth" },
    });
    expect("typ" in claims).toBe(false);
  });

  it("pins the signing algorithm, refusing an unsigned token", async () => {
    // `alg: "none"` is the classic forgery: without an explicit algorithm list
    // the verifier can be talked out of checking the signature at all.
    const unsigned = `${Buffer.from(
      JSON.stringify({ alg: "none", typ: TOKEN_TYP.session })
    ).toString("base64url")}.${Buffer.from(
      JSON.stringify({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 })
    ).toString("base64url")}.`;
    expect((await verifyToken(unsigned, secret, "session")).valid).toBe(false);
  });

  it("pins the signing algorithm, refusing another HMAC under the same secret", async () => {
    // The separating case for the algorithm list. `jose` refuses `alg: none`
    // even without one, so the case above passes with the list removed; a
    // token signed HS512 with the very same secret is accepted unless the
    // list names HS256 alone.
    const hs512 = await new SignJWT({ sub: "u1" })
      .setProtectedHeader({ alg: "HS512", typ: TOKEN_TYP.session })
      .setIssuedAt()
      .setExpirationTime("1m")
      .sign(secretToKey(secret));
    expect((await verifyToken(hs512, secret, "session")).valid).toBe(false);
  });
});

describe("the window for session tokens with no typ header", () => {
  it("is closed: the header is required", async () => {
    // This is the release the typed-tokens change named in advance. While
    // tokens signed before the header existed could still be live, a session
    // token carrying no purpose was accepted, watched by a test that failed
    // once the named release arrived with the allowance still in place. That
    // release stops accepting one, so the allowance is gone from the verifier
    // and this test holds its place: an unmarked token is refused, and the
    // test beside the verifier's other refusals keeps the release honest if
    // anyone restores the allowance.
    const untyped = await signUnmarkedToken({ sub: "u1" }, secret, 60);

    expect(await verifyToken(untyped, secret, "session")).toEqual({
      valid: false,
      reason: "invalid",
    });
  });
});
