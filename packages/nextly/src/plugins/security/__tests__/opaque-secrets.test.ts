/**
 * The opaque secrets a plugin receives as `ctx.security.opaque`.
 *
 * A secret is at least 256 random bits, its hash is the same however many
 * times and wherever it is asked for, and the comparison takes time that
 * depends only on the two lengths.
 *
 * That last is asserted by what the comparison calls, not by a clock: values
 * of one length go to Node's constant-time `timingSafeEqual` as buffers of one
 * length that carry every difference, and its answer is the answer. A timing measurement says the same thing only on an
 * idle machine, and fails by a fraction of a millisecond on a loaded one.
 */
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpaqueSecrets } from "../opaque-secrets";

/** What each constant-time comparison was given, and an answer to give in its place. */
const compared = vi.hoisted(() => ({
  calls: [] as { a: Buffer; b: Buffer }[],
  answer: undefined as boolean | undefined,
}));

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  const bytesOf = (view: NodeJS.ArrayBufferView) =>
    Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  return {
    ...actual,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      compared.calls.push({ a: bytesOf(a), b: bytesOf(b) });
      return compared.answer ?? actual.timingSafeEqual(a, b);
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  compared.calls.length = 0;
  compared.answer = undefined;
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

  it.each([
    ["at the first character", "bbcdef"],
    ["at the last character", "abcdeg"],
    ["nowhere", "abcdef"],
  ])(
    "hands values of one length to timingSafeEqual when they differ %s",
    (_where, other) => {
      createOpaqueSecrets().equal("abcdef", other);
      // Once, on buffers of one length, which differ exactly when the values
      // do: a comparison of a prefix would hand over equal buffers for values
      // that differ at the end, and one that stopped at a difference would not
      // call it at all.
      expect(compared.calls).toHaveLength(1);
      const [{ a, b }] = compared.calls;
      expect(a.length).toBe(b.length);
      expect(a.equals(b)).toBe(other === "abcdef");
    }
  );

  it("answers what timingSafeEqual answered, with nothing deciding before it", () => {
    // Swapping its answer is what tells a comparison that only calls it apart
    // from one it decides: an early `return false` at a difference, or `true`
    // on identical strings, would answer here without it.
    const opaque = createOpaqueSecrets();
    compared.answer = true;
    expect(opaque.equal("same-value", "same-valuf")).toBe(true);
    compared.answer = false;
    expect(opaque.equal("same-value", "same-value")).toBe(false);
  });
});
