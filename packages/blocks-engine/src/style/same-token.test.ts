/**
 * Whether two stored tokens are the same token: a fluid size's two sizes
 * count, so a change of them alone is a change a save keeps.
 */
import { describe, expect, it } from "vitest";

import { sameSiteToken } from "./same-token";
import type { SiteToken } from "./site-tokens";

describe("a fluid size's two sizes", () => {
  const base = {
    name: "font-size.lead",
    kind: "dimension" as const,
    values: { light: "clamp(1rem, 0.9022rem + 0.4348vw, 1.25rem)" },
  };

  it("make a token different, so a change of them alone is saved", () => {
    expect(
      sameSiteToken(base, { ...base, fluid: { small: 16, large: 20 } })
    ).toBe(false);
    expect(
      sameSiteToken(
        { ...base, fluid: { small: 16, large: 20 } },
        { ...base, fluid: { small: 16, large: 24 } }
      )
    ).toBe(false);
  });

  it("are the same where both tokens hold the same two, or neither holds any", () => {
    expect(
      sameSiteToken(
        { ...base, fluid: { small: 16, large: 20 } },
        { ...base, fluid: { small: 16, large: 20 } }
      )
    ).toBe(true);
    expect(sameSiteToken(base, { ...base })).toBe(true);
  });
});

describe("a colour's group", () => {
  const base: SiteToken = {
    name: "color.brand",
    kind: "color",
    values: { light: "#123456" },
  };

  it("makes a token different, so moving a supplied colour to a group is saved", () => {
    expect(sameSiteToken(base, { ...base, group: "Accents" })).toBe(false);
    expect(
      sameSiteToken({ ...base, group: "Brand" }, { ...base, group: "Brand" })
    ).toBe(true);
  });
});
