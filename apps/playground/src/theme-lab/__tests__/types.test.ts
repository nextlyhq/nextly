import { describe, expect, it } from "vitest";

import { MONO } from "../themes/mono";
import { OPTIONAL_TOKENS, REQUIRED_TOKENS } from "../types";

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

  it("declares no token outside the required or optional sets", () => {
    // Optional is enumerated, not open. A theme may state its chart slots
    // instead of having them derived, and nothing else -- so a typo in a
    // token name is still caught rather than waved through as "extra".
    const allowed = new Set<string>([...REQUIRED_TOKENS, ...OPTIONAL_TOKENS]);
    for (const token of Object.keys(MONO.light)) {
      expect(allowed.has(token), `unexpected token ${token}`).toBe(true);
    }
  });

  it("keeps the two sets disjoint", () => {
    // A token in both would be required AND derivable, and the derivation
    // would silently never run for it.
    const required = new Set<string>(REQUIRED_TOKENS);
    expect(OPTIONAL_TOKENS.filter(token => required.has(token))).toEqual([]);
  });
});
