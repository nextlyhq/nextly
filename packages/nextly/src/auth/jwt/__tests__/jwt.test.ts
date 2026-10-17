import { jwtVerify } from "jose";
import { afterEach, describe, it, expect, vi } from "vitest";

import { buildClaims } from "../claims";
import {
  signAccessToken,
  signAccessTokenWithExpiry,
  secretToKey,
} from "../sign";
import { verifyAccessToken } from "../verify";

const TEST_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

describe("buildClaims", () => {
  it("should build claims with all required fields", () => {
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test User",
      image: "/avatar.jpg",
      roleIds: ["role_admin"],
      sessionEpoch: 0,
    });

    expect(claims.sub).toBe("user_123");
    expect(claims.email).toBe("test@example.com");
    expect(claims.name).toBe("Test User");
    expect(claims.image).toBe("/avatar.jpg");
    expect(claims.roleIds).toEqual(["role_admin"]);
  });

  it("should include custom fields", () => {
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
      customFields: { department: "Engineering", level: 5 },
    });

    expect(claims.department).toBe("Engineering");
    expect(claims.level).toBe(5);
  });

  it("should not allow custom fields to overwrite standard claims", () => {
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
      customFields: { sub: "hacked", email: "hacked@evil.com", iat: 999 },
    });

    expect(claims.sub).toBe("user_123");
    expect(claims.email).toBe("test@example.com");
    // iat is a JWT internal claim, should be excluded
    expect(claims.iat).toBeUndefined();
  });

  it("carries the account's session epoch", () => {
    // What the session check compares with the row: a token without it would
    // read as epoch zero, and outlive the account's first change.
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test",
      image: null,
      roleIds: [],
      sessionEpoch: 4,
    });

    expect(claims.nx_sev).toBe(4);
  });

  it("signs epoch zero when the caller gives none", () => {
    // Code that builds its own claims predates the epoch. Zero is where every
    // account starts, so its token works until the account's sessions are
    // first ended, and not after.
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test",
      image: null,
      roleIds: [],
    });

    expect(claims.nx_sev).toBe(0);
  });

  it("leaves a custom field named `sev` to the app", () => {
    // An app's own claim of that name predates the epoch. Reserving it would
    // drop the field from every new session, and reading it as the epoch would
    // refuse every session signed before the upgrade.
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test",
      image: null,
      roleIds: [],
      sessionEpoch: 4,
      customFields: { sev: "gold" },
    });

    expect(claims.sev).toBe("gold");
    expect(claims.nx_sev).toBe(4);
  });

  it("lets no custom field replace the session epoch", () => {
    // A custom user field named like the claim would otherwise decide which
    // of the account's tokens stay valid.
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test",
      image: null,
      roleIds: [],
      sessionEpoch: 4,
      customFields: { nx_sev: 0 },
    });

    expect(claims.nx_sev).toBe(4);
  });
});

describe("signAccessToken", () => {
  it("should create a valid JWT with 3 parts", async () => {
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test User",
      image: null,
      roleIds: ["role_admin"],
      sessionEpoch: 0,
    });

    const token = await signAccessToken(claims, TEST_SECRET, 900);
    expect(typeof token).toBe("string");
    // JWT has 3 parts: header.payload.signature
    expect(token.split(".")).toHaveLength(3);
  });

  it("should create a token verifiable by jose directly", async () => {
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test User",
      image: null,
      roleIds: ["role_admin"],
      sessionEpoch: 0,
    });

    const token = await signAccessToken(claims, TEST_SECRET, 900);
    const key = secretToKey(TEST_SECRET);
    const { payload } = await jwtVerify(token, key);

    expect(payload.sub).toBe("user_123");
    expect(payload.email).toBe("test@example.com");
    expect(payload.roleIds).toEqual(["role_admin"]);
    expect(payload.exp).toBeDefined();
    expect(payload.iat).toBeDefined();
    expect(payload.jti).toBeDefined();
  });

  it("should include custom fields in the token", async () => {
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
      customFields: { department: "Engineering", level: 5 },
    });

    const token = await signAccessToken(claims, TEST_SECRET);
    const key = secretToKey(TEST_SECRET);
    const { payload } = await jwtVerify(token, key);

    expect(payload.department).toBe("Engineering");
    expect(payload.level).toBe(5);
  });
});

describe("verifyAccessToken", () => {
  it("should verify a valid token", async () => {
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test User",
      image: null,
      roleIds: ["role_admin"],
      sessionEpoch: 0,
    });

    const token = await signAccessToken(claims, TEST_SECRET, 900);
    const result = await verifyAccessToken(token, TEST_SECRET);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe("user_123");
      expect(result.payload.email).toBe("test@example.com");
      expect(result.payload.roleIds).toEqual(["role_admin"]);
    }
  });

  it("should reject a token signed with a different secret", async () => {
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    });

    const token = await signAccessToken(claims, TEST_SECRET);
    const result = await verifyAccessToken(
      token,
      "different-secret-that-is-also-32-characters!!"
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("invalid");
    }
  });

  it("should return expired for an expired token", async () => {
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    });

    // Sign with 0 second TTL (immediately expired)
    const token = await signAccessToken(claims, TEST_SECRET, 0);

    // Small delay to ensure the token is past its exp claim
    await new Promise(resolve => setTimeout(resolve, 1100));

    const result = await verifyAccessToken(token, TEST_SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("expired");
    }
  });

  it("should reject garbage input", async () => {
    const result = await verifyAccessToken("not.a.jwt", TEST_SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("invalid");
    }
  });

  it("should reject empty string", async () => {
    const result = await verifyAccessToken("", TEST_SECRET);
    expect(result.valid).toBe(false);
  });
});

/**
 * A caller that reports when the access token expires must report the token's
 * OWN expiry. Deriving it from a second clock reading — after the awaits that
 * follow signing — reports a later moment than the token actually holds, and a
 * client trusting it keeps using a token the server has already rejected.
 */
describe("signAccessTokenWithExpiry", () => {
  it("returns the expiry the token itself carries", async () => {
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test User",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    });

    const { token, expiresAt } = await signAccessTokenWithExpiry(
      claims,
      TEST_SECRET,
      900
    );

    const key = secretToKey(TEST_SECRET);
    const { payload } = await jwtVerify(token, key);
    expect(expiresAt.getTime()).toBe((payload.exp as number) * 1000);
  });

  it("does not drift when the caller waits before reading the expiry", async () => {
    const claims = buildClaims({
      userId: "user_123",
      email: "test@example.com",
      name: "Test User",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    });

    const { token, expiresAt } = await signAccessTokenWithExpiry(
      claims,
      TEST_SECRET,
      1
    );
    // Stand in for the awaited work every session-issuing path does between
    // signing and responding: storing the refresh token, running plugin
    // afterLogin hooks, writing the audit record.
    await new Promise(resolve => setTimeout(resolve, 1100));

    const key = secretToKey(TEST_SECRET);
    const { payload } = await jwtVerify(token, key).catch(() => ({
      payload: null,
    }));
    // The token is expired by now, and the reported expiry says so rather than
    // claiming validity the token no longer has.
    expect(payload).toBeNull();
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

/**
 * A session's token must stop being accepted no later than the first of its
 * roles lapses: the stateless session readers answer from the token's claims
 * until it expires. The clock is fixed so the second the token is issued in,
 * and where the bound falls within it, are chosen rather than raced for.
 */
describe("signAccessTokenWithExpiry with a bound", () => {
  /** A whole second, so offsets within it are exact. */
  const SECOND = Date.UTC(2026, 9, 13, 12, 0, 0);
  const claims = buildClaims({
    userId: "user_123",
    email: "test@example.com",
    name: "Test User",
    image: null,
    roleIds: ["role_brief"],
    sessionEpoch: 0,
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends the token at the bound when that is sooner than the TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SECOND + 400);
    const notAfter = SECOND + 120_700;

    const { token, expiresAt } = await signAccessTokenWithExpiry(
      claims,
      TEST_SECRET,
      900,
      "session",
      notAfter
    );

    expect(expiresAt.getTime()).toBe(SECOND + 120_000);
    const { payload } = await jwtVerify(token, secretToKey(TEST_SECRET));
    expect((payload.exp as number) * 1000).toBeLessThanOrEqual(notAfter);
  });

  it("keeps the TTL when the bound is later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SECOND + 400);

    const { expiresAt } = await signAccessTokenWithExpiry(
      claims,
      TEST_SECRET,
      900,
      "session",
      SECOND + 3_600_000
    );

    expect(expiresAt.getTime()).toBe(SECOND + 900_000);
  });

  it("gives a token that is refused at once when the bound falls in the current second", async () => {
    // A floor of one second here signed a token accepted until the next
    // whole second, past the bound, carrying a role that had lapsed.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SECOND + 300);
    const notAfter = SECOND + 800;

    const { token, expiresAt } = await signAccessTokenWithExpiry(
      claims,
      TEST_SECRET,
      900,
      "session",
      notAfter
    );

    expect(expiresAt.getTime()).toBeLessThanOrEqual(notAfter);
    const result = await verifyAccessToken(token, TEST_SECRET);
    expect(result).toMatchObject({ valid: false, reason: "expired" });
  });

  it("gives a token that is refused at once when the bound has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SECOND + 300);
    const notAfter = SECOND - 5_000;

    const { token, expiresAt } = await signAccessTokenWithExpiry(
      claims,
      TEST_SECRET,
      900,
      "session",
      notAfter
    );

    expect(expiresAt.getTime()).toBeLessThanOrEqual(notAfter);
    const result = await verifyAccessToken(token, TEST_SECRET);
    expect(result).toMatchObject({ valid: false, reason: "expired" });
  });
});
