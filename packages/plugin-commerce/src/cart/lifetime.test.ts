import { describe, expect, it } from "vitest";

import { cartDeadline, isCartExpired } from "./lifetime";

describe("the cart lifetime", () => {
  it("sets a deadline the lifetime after the change, in whole seconds", () => {
    const now = new Date("2026-10-14T05:00:00.750Z");
    expect(cartDeadline(now, 30).toISOString()).toBe(
      "2026-11-13T05:00:00.000Z"
    );
    expect(cartDeadline(now, 1).toISOString()).toBe("2026-10-15T05:00:00.000Z");
  });

  it("expires a cart at its deadline, not a moment later", () => {
    const expiresAt = new Date("2026-11-13T05:00:00.000Z");
    expect(
      isCartExpired({ expiresAt }, new Date("2026-11-13T04:59:59.999Z"))
    ).toBe(false);
    expect(isCartExpired({ expiresAt }, expiresAt)).toBe(true);
    expect(
      isCartExpired({ expiresAt }, new Date("2026-11-14T00:00:00.000Z"))
    ).toBe(true);
  });
});
