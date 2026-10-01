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
