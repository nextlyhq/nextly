/**
 * The rule that ties a link from before links recorded their account to the
 * account holding its address.
 *
 * The integration suites drive it through the upgrade and the redemption;
 * these pin its edges, which a database run would only reach by chance: the
 * issue time read off each kind of link, a lifetime longer than the default,
 * and a change in the same second as the issue.
 */
import { describe, expect, it } from "vitest";

import {
  AUTH_TOKEN_LIFETIME_MS,
  earliestIssue,
  mayBindToAccount,
} from "../services/token-account-binding";

const ISSUED = new Date("2026-10-15T12:00:00.000Z");
const HOUR = 3600_000;

/** A link issued at `ISSUED` with the default lifetime. */
function link(overrides: { expires?: Date; createdAt?: Date } = {}) {
  return {
    identifier: "person@example.com",
    expires: new Date(ISSUED.getTime() + AUTH_TOKEN_LIFETIME_MS),
    createdAt: ISSUED,
    ...overrides,
  };
}

function holder(createdAt: Date, updatedAt: Date = createdAt) {
  return { email: "person@example.com", createdAt, updatedAt };
}

describe("earliestIssue", () => {
  it("reads a verification link's issue off its expiry, whatever its created_at says", () => {
    // created_at is stamped by the database, whose time zone may not be UTC.
    const skewed = link({ createdAt: new Date(ISSUED.getTime() + 5 * HOUR) });
    expect(earliestIssue("email-verification", skewed)).toEqual(ISSUED);
  });

  it("takes a reset link's created_at when its lifetime was longer than the default", () => {
    const longLived = link({
      expires: new Date(ISSUED.getTime() + 7 * 24 * HOUR),
    });
    expect(earliestIssue("password-reset", longLived)).toEqual(ISSUED);
  });

  it("takes the expiry's reading of a reset link when that is the earlier", () => {
    const skewed = link({ createdAt: new Date(ISSUED.getTime() + 5 * HOUR) });
    expect(earliestIssue("password-reset", skewed)).toEqual(ISSUED);
  });
});

describe("mayBindToAccount", () => {
  for (const kind of ["password-reset", "email-verification"] as const) {
    describe(kind, () => {
      it("binds to an account that held the address before the link", () => {
        expect(
          mayBindToAccount(
            kind,
            link(),
            holder(new Date(ISSUED.getTime() - HOUR))
          )
        ).toBe(true);
      });

      it("binds to an account created in the same second, as registration does", () => {
        // MySQL and SQLite keep these columns to the second.
        expect(mayBindToAccount(kind, link(), holder(ISSUED))).toBe(true);
      });

      it("refuses an account created after the link", () => {
        expect(
          mayBindToAccount(
            kind,
            link(),
            holder(new Date(ISSUED.getTime() + 1000))
          )
        ).toBe(false);
      });

      it("refuses an account changed after the link", () => {
        expect(
          mayBindToAccount(
            kind,
            link(),
            holder(
              new Date(ISSUED.getTime() - HOUR),
              new Date(ISSUED.getTime() + 1000)
            )
          )
        ).toBe(false);
      });

      it("refuses an account at another address", () => {
        expect(
          mayBindToAccount(kind, link(), {
            ...holder(new Date(ISSUED.getTime() - HOUR)),
            email: "someone-else@example.com",
          })
        ).toBe(false);
      });
    });
  }

  it("refuses a long-lived reset link's account changed after it, though before the default lifetime's reading", () => {
    // Without created_at bounding it, a 7-day link would read as issued six
    // days after it was, and a change in between would pass.
    const longLived = link({
      expires: new Date(ISSUED.getTime() + 7 * 24 * HOUR),
    });
    expect(
      mayBindToAccount(
        "password-reset",
        longLived,
        holder(
          new Date(ISSUED.getTime() - HOUR),
          new Date(ISSUED.getTime() + 24 * HOUR)
        )
      )
    ).toBe(false);
  });
});
