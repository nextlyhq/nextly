import { describe, expect, it } from "vitest";

import { detectPmFromUserAgent } from "../utils/detect-pm-from-user-agent";

describe("detectPmFromUserAgent", () => {
  it("detects pnpm", () => {
    expect(
      detectPmFromUserAgent("pnpm/9.15.0 npm/? node/v22.10.0 darwin arm64")
    ).toBe("pnpm");
  });

  it("detects yarn (classic)", () => {
    expect(
      detectPmFromUserAgent("yarn/1.22.22 npm/? node/v22.10.0 darwin arm64")
    ).toBe("yarn");
  });

  it("detects bun", () => {
    expect(
      detectPmFromUserAgent("bun/1.1.30 npm/? node/v22.10.0 darwin arm64")
    ).toBe("bun");
  });

  it("detects npm", () => {
    expect(detectPmFromUserAgent("npm/10.9.0 node/v22.10.0 darwin arm64")).toBe(
      "npm"
    );
  });

  it("returns null for undefined", () => {
    expect(detectPmFromUserAgent(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(detectPmFromUserAgent(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectPmFromUserAgent("")).toBeNull();
  });

  it("returns null for unknown tools", () => {
    expect(detectPmFromUserAgent("unknown-tool/1.0")).toBeNull();
    expect(detectPmFromUserAgent("randomstring")).toBeNull();
  });

  it("matches by prefix only — does not match 'npm/' embedded mid-string", () => {
    // pnpm UA includes "npm/?" later in the string but still starts with pnpm/.
    // A bare "node/v22.10.0 npm/10" string does not start with any PM, so null.
    expect(detectPmFromUserAgent("node/v22.10.0 npm/10")).toBeNull();
  });
});
