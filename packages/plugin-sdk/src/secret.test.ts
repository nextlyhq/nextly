import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { isSecret, secret, Secret } from "./secret";

describe("secret()", () => {
  it("redacts in JSON.stringify", () => {
    expect(JSON.stringify({ apiKey: secret("sk-123") })).toBe(
      '{"apiKey":"[redacted]"}'
    );
  });
  it("redacts in String() and template interpolation", () => {
    const s = secret("sk-123");
    expect(String(s)).toBe("[redacted]");
    expect(`${s}`).toBe("[redacted]");
  });
  it("redacts under util.inspect (console.log)", () => {
    expect(inspect(secret("sk-123"))).toBe("[redacted]");
  });
  it("reveals the real value explicitly", () => {
    expect(secret("sk-123").reveal()).toBe("sk-123");
  });
  it("preserves non-string value types via reveal", () => {
    expect(secret({ token: 1 }).reveal()).toEqual({ token: 1 });
  });
  it("isSecret distinguishes wrapped from raw", () => {
    expect(isSecret(secret("x"))).toBe(true);
    expect(isSecret("x")).toBe(false);
    expect(isSecret(new Secret("x"))).toBe(true);
  });
});
