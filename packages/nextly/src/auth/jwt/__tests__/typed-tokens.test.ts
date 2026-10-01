import { readFileSync } from "node:fs";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { mintPendingToken } from "../../pipeline/pending-token";
import { buildClaims } from "../claims";
import { secretToKey, signAccessTokenWithExpiry, TOKEN_TYP } from "../sign";
import { verifyToken } from "../verify";

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

  it("accepts a legacy session token with no typ header (release 1)", async () => {
    const legacy = await new SignJWT({ sub: "u1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1m")
      .sign(secretToKey(secret));
    const r = await verifyToken(legacy, secret, "session");
    expect(r.valid).toBe(true);
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
    // The case the payload-claim check exists for. A pending token minted
    // before the header existed is accepted by the header rule, which lets an
    // absent typ through, so only the claim stands between it and a session.
    const legacyPending = await new SignJWT({
      typ: "pending-auth",
      sub: "u1",
      challengeId: "totp",
      attempts: 0,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(secretToKey(secret));
    expect((await verifyToken(legacyPending, secret, "session")).valid).toBe(
      false
    );
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
  /** `major.minor` of this package's version, prerelease tags ignored. */
  function packageMinorVersion(): [number, number] {
    const pkg = JSON.parse(
      readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")
    ) as { version: string };
    const [major, minor] = pkg.version
      .split(".")
      .map(part => parseInt(part, 10));
    return [major, minor];
  }

  it("closes at 0.1.0", async () => {
    // The acceptance of untyped tokens is a transition, and nothing but this
    // test ends it: once the package reaches 0.1.0 an untyped token must stop
    // verifying, so reaching that version with the allowance still in place
    // fails here rather than leaving the window open until someone remembers.
    const [major, minor] = packageMinorVersion();
    const windowClosed = major > 0 || minor >= 1;
    const untyped = await new SignJWT({ sub: "u1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1m")
      .sign(secretToKey(secret));

    expect((await verifyToken(untyped, secret, "session")).valid).toBe(
      !windowClosed
    );
  });
});
