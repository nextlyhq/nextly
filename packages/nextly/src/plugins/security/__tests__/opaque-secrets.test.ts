/**
 * The opaque secrets a plugin receives as `ctx.security.opaque`.
 *
 * A secret is at least 256 random bits, its hash is the same however many
 * times and wherever it is asked for, and the comparison takes time that
 * depends only on the two lengths.
 */
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpaqueSecrets } from "../opaque-secrets";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("create", () => {
  it("makes 32 random bytes by default, base64url, with their SHA-256", () => {
    const { secret, hash } = createOpaqueSecrets().create();
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(secret, "base64url")).toHaveLength(32);
    expect(hash).toBe(createHash("sha256").update(secret).digest("hex"));
  });

  it("makes a fresh value every time", () => {
    const opaque = createOpaqueSecrets();
    const seen = new Set(
      Array.from({ length: 50 }, () => opaque.create().secret)
    );
    expect(seen.size).toBe(50);
  });

  it.each([32, 64, 1024])("accepts %i bytes", bytes => {
    const { secret } = createOpaqueSecrets().create({ bytes });
    expect(Buffer.from(secret, "base64url")).toHaveLength(bytes);
  });

  it.each([1, 31, 1025, 2.5])(
    "refuses %s bytes with an error naming the bounds, and issues nothing",
    bytes => {
      let issued: unknown;
      let caught: unknown;
      try {
        issued = createOpaqueSecrets().create({ bytes });
      } catch (error) {
        caught = error;
      }
      expect(issued).toBeUndefined();
      expect(JSON.stringify(caught)).toMatch(
        /bytes must be a whole number from 32 to 1024/
      );
    }
  );
});

describe("hash", () => {
  it("gives the hash create gave, every time, whatever the install's secret", () => {
    const { secret, hash } = createOpaqueSecrets().create();
    vi.stubEnv("NEXTLY_SECRET", "a-rotated-secret-that-is-long-enough-to-pass");
    expect(createOpaqueSecrets().hash(secret)).toBe(hash);
    expect(createOpaqueSecrets().hash(secret)).toBe(hash);
  });
});

describe("equal", () => {
  it("answers true for equal values and false for different ones", () => {
    const opaque = createOpaqueSecrets();
    expect(opaque.equal("same-value", "same-value")).toBe(true);
    expect(opaque.equal("same-value", "same-valuf")).toBe(false);
    expect(opaque.equal("same-value", "same-value-and-more")).toBe(false);
    expect(opaque.equal("", "")).toBe(true);
    // One UTF-16 length, different characters, different UTF-8 lengths.
    expect(opaque.equal("é", "e")).toBe(false);
  });

  it("takes as long when values differ at the first character as at the last", () => {
    const opaque = createOpaqueSecrets();
    const base = "a".repeat(200_000);
    const first = `b${base.slice(1)}`;
    const last = `${base.slice(0, -1)}b`;
    const time = (other: string) => {
      const start = performance.now();
      for (let round = 0; round < 50; round++) opaque.equal(base, other);
      return performance.now() - start;
    };
    time(first);
    time(last);
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
    const atFirst = median(Array.from({ length: 7 }, () => time(first)));
    const atLast = median(Array.from({ length: 7 }, () => time(last)));
    // Stated tolerance: the two medians within 50% of the larger. An early
    // exit at the first difference would make the first far faster.
    expect(Math.abs(atFirst - atLast)).toBeLessThanOrEqual(
      0.5 * Math.max(atFirst, atLast)
    );
  });
});
