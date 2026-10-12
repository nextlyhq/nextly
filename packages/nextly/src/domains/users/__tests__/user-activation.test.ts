import { describe, expect, it } from "vitest";

import { activationChanges } from "../services/user-activation";

const EARLIER = new Date("2026-01-01T00:00:00Z");

describe("activationChanges", () => {
  it("writes isActive false with the deactivation even when the read said inactive", () => {
    // The read can be stale: a verification link followed between the read
    // and this write may have activated the account. Writing only the
    // timestamp would leave it active with a deactivation on record.
    const out = activationChanges(false, {
      isActive: false,
      deactivatedAt: null,
    });

    expect(out.isActive).toBe(false);
    expect(out.deactivatedAt).toBeInstanceOf(Date);
  });

  it("keeps the first deactivation's time", () => {
    expect(
      activationChanges(false, { isActive: true, deactivatedAt: EARLIER })
    ).toEqual({ isActive: false });
    expect(
      activationChanges(false, { isActive: false, deactivatedAt: EARLIER })
    ).toEqual({});
  });

  it("clears the record when the account is activated", () => {
    expect(
      activationChanges(true, { isActive: false, deactivatedAt: EARLIER })
    ).toEqual({ isActive: true, deactivatedAt: null });
  });

  it("writes nothing when activating an account already active", () => {
    // The control: an update repeating the current state stays a no-op.
    expect(
      activationChanges(true, { isActive: true, deactivatedAt: null })
    ).toEqual({});
  });
});
