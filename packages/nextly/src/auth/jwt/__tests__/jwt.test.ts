import { jwtVerify } from "jose";
import { describe, it, expect } from "vitest";

import { buildClaims } from "../claims";
import { signAccessToken, secretToKey } from "../sign";
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
      customFields: { sub: "hacked", email: "hacked@evil.com", iat: 999 },
    });

    expect(claims.sub).toBe("user_123");
    expect(claims.email).toBe("test@example.com");
    // iat is a JWT internal claim, should be excluded
    expect(claims.iat).toBeUndefined();
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
