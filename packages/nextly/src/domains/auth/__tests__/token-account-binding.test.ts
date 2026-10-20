/**
 * The rule that ties a link from before links recorded their account to the
 * account holding its address.
 *
 * The integration suites drive it through the upgrade; these pin its edges,
 * which a database run would only reach by chance: the issue time read off a
 * verification link, a reset link that never has one, and a change in the
 * same second as the issue. Every case the rule cannot decide is refused.
 */
import { describe, expect, it } from "vitest";

import {
  AUTH_TOKEN_LIFETIME_MS,
  issuedNoLaterThan,
  mayBindToAccount,
} from "../services/token-account-binding";

const ISSUED = new Date("2026-10-15T12:00:00.000Z");
const HOUR = 3600_000;

const at = (offset: number): Date => new Date(ISSUED.getTime() + offset);

/** A link issued at `ISSUED` with the default lifetime. */
function link(overrides: { expires?: Date } = {}) {
  return {
    identifier: "person@example.com",
    expires: at(AUTH_TOKEN_LIFETIME_MS),
    ...overrides,
  };
}

function holder(createdAt: Date, updatedAt: Date = createdAt) {
  return { email: "person@example.com", createdAt, updatedAt };
}

describe("issuedNoLaterThan", () => {
  it("reads a verification link's issue off its expiry", () => {
    expect(issuedNoLaterThan("email-verification", link())).toEqual(ISSUED);
  });

  it("knows no issue time for a reset link, whatever its lifetime", () => {
    // A lifetime other than a day can offset a database clock that is ahead,
    // so no reading of a reset link bounds its issue.
    expect(issuedNoLaterThan("password-reset", link())).toBeNull();
    expect(
      issuedNoLaterThan("password-reset", link({ expires: at(25 * HOUR) }))
    ).toBeNull();
  });
});

describe("mayBindToAccount", () => {
  for (const kind of ["email-verification"] as const) {
    describe(kind, () => {
      it("binds to an account that held the address before the link", () => {
        expect(mayBindToAccount(kind, link(), holder(at(-HOUR)))).toBe(true);
      });

      it("refuses an account created in the same second as the link", () => {
        // MySQL and SQLite keep these columns to the second, so the same
        // second cannot be told from a moment after.
        expect(mayBindToAccount(kind, link(), holder(at(0)))).toBe(false);
      });

      it("refuses an account created after the link", () => {
        expect(mayBindToAccount(kind, link(), holder(at(1000)))).toBe(false);
      });

      it("refuses an account changed after the link", () => {
        expect(
          mayBindToAccount(kind, link(), holder(at(-HOUR), at(1000)))
        ).toBe(false);
      });

      it("refuses an account at another address", () => {
        expect(
          mayBindToAccount(kind, link(), {
            ...holder(at(-HOUR)),
            email: "someone-else@example.com",
          })
        ).toBe(false);
      });
    });
  }

  it("refuses every reset link, however long its account held the address", () => {
    expect(
      mayBindToAccount("password-reset", link(), holder(at(-24 * HOUR)))
    ).toBe(false);
  });
});
