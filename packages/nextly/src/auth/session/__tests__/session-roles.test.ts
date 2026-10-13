/**
 * How long an access token may carry the roles it was signed with.
 */
import { describe, expect, it } from "vitest";

import { accessTokenLifetime } from "../session-roles";

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);

describe("accessTokenLifetime", () => {
  it("keeps the configured lifetime when no role expires", () => {
    expect(accessTokenLifetime(900, { validUntil: undefined }, NOW)).toBe(900);
  });

  it("ends the token when the first role lapses, if that is sooner", () => {
    expect(accessTokenLifetime(900, { validUntil: NOW + 120_000 }, NOW)).toBe(
      120
    );
  });

  it("keeps the configured lifetime when the first lapse is later", () => {
    expect(accessTokenLifetime(900, { validUntil: NOW + 3_600_000 }, NOW)).toBe(
      900
    );
  });

  it("never signs for less than a second", () => {
    // A role lapsing within the second still yields a well-formed token,
    // which a client refreshes at once.
    expect(accessTokenLifetime(900, { validUntil: NOW + 400 }, NOW)).toBe(1);
    expect(accessTokenLifetime(900, { validUntil: NOW - 5_000 }, NOW)).toBe(1);
  });
});
