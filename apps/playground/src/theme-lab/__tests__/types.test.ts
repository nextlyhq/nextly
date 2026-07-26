import { describe, expect, it } from "vitest";

import { MONO } from "../themes/mono";
import { REQUIRED_TOKENS } from "../types";

describe("theme definition", () => {
  it("Mono declares every required token in both modes", () => {
    for (const token of REQUIRED_TOKENS) {
      expect(MONO.light[token], `light ${token}`).toBeDefined();
      expect(MONO.dark[token], `dark ${token}`).toBeDefined();
    }
  });

  it("Mono is the nextly-group control", () => {
    expect(MONO.id).toBe("mono");
    expect(MONO.group).toBe("nextly");
  });

  it("declares no token outside the required set", () => {
    const allowed = new Set<string>(REQUIRED_TOKENS);
    for (const token of Object.keys(MONO.light)) {
      expect(allowed.has(token), `unexpected token ${token}`).toBe(true);
    }
  });
});
