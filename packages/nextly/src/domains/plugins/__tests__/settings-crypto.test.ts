/**
 * Where a secret is stored is part of what authenticates it.
 */
import { describe, expect, it } from "vitest";

import { openSetting, sealSetting } from "../settings-crypto";

const SECRET = "k".repeat(32);

describe("the associated data a sealed setting is bound to", () => {
  it("tells a dotted key from a nested path", () => {
    // `["k", "a.b"]` and `["k", "a", "b"]` are different places; joining the
    // path with dots gave them one encoding.
    const sealed = sealSetting("value", SECRET, "@t/p", ["k", "a.b"]);
    expect(openSetting(sealed, [SECRET], "@t/p", ["k", "a", "b"])).toEqual({
      readable: false,
      reason: "auth-failed",
    });
  });

  it("opens where it was sealed", () => {
    const sealed = sealSetting("value", SECRET, "@t/p", ["k", "a.b"]);
    expect(openSetting(sealed, [SECRET], "@t/p", ["k", "a.b"])).toEqual({
      readable: true,
      plaintext: "value",
      stale: false,
    });
  });
});

/**
 * Why an envelope did not open, which decides where the operator looks: the
 * configured secrets, the row, or whoever changed it.
 */
describe("an envelope that does not open", () => {
  it("is malformed when it is not an envelope this module writes", () => {
    const sealed = sealSetting("value", SECRET, "@t/p", ["k"]);
    expect(openSetting(sealed.slice(0, 10), [SECRET], "@t/p", ["k"])).toEqual({
      readable: false,
      reason: "malformed",
    });
  });

  it("names an unknown key when no configured secret sealed it", () => {
    const sealed = sealSetting("value", SECRET, "@t/p", ["k"]);
    expect(openSetting(sealed, ["o".repeat(32)], "@t/p", ["k"])).toEqual({
      readable: false,
      reason: "unknown-key",
    });
  });

  it("fails authentication when the configured key meets a changed value", () => {
    const sealed = sealSetting("value", SECRET, "@t/p", ["k"]);
    expect(openSetting(sealed, [SECRET], "@t/other", ["k"])).toEqual({
      readable: false,
      reason: "auth-failed",
    });
  });
});
