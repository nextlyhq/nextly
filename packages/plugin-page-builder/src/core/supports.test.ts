import { describe, expect, it } from "vitest";

import { normalizeSupports } from "./supports";

describe("normalizeSupports", () => {
  it("expands `true` shorthand into an all-on group", () => {
    expect(normalizeSupports({ typography: true }).typography).toEqual({
      fontFamily: true,
      fontSize: true,
      fontWeight: true,
      lineHeight: true,
      letterSpacing: true,
      wordSpacing: true,
      textTransform: true,
      fontStyle: true,
      textDecoration: true,
      textAlign: true,
      textShadow: true,
    });
  });

  it("passes through granular objects and defaults customCss/visibility on", () => {
    const n = normalizeSupports({ border: { radius: true } });
    expect(n.border).toEqual({
      width: false,
      style: false,
      color: false,
      radius: true,
    });
    expect(n.customCss).toBe(true);
    expect(n.visibility).toBe(true);
    expect(n.customAttributes).toBe(true);
  });

  it("treats an omitted key as off", () => {
    expect(normalizeSupports({}).typography).toBe(false);
  });
});
