/**
 * The rule that ties a link from before links recorded their account to the
 * account holding its address.
 *
 * The integration suites drive it through the upgrade; these pin its edges,
 * which a database run would only reach by chance: the issue time read off
 * each kind of link, a reset link whose two clocks disagree, and a change in
 * the same second as the issue. Every case the rule cannot decide is refused.
 */
import { describe, expect, it } from "vitest";

import {
  AUTH_TOKEN_LIFETIME_MS,
  CLOCK_AGREEMENT_MS,
  issuedNoLaterThan,
  mayBindToAccount,
} from "../services/token-account-binding";

const ISSUED = new Date("2026-10-15T12:00:00.000Z");
const HOUR = 3600_000;

const at = (offset: number): Date => new Date(ISSUED.getTime() + offset);

/** A link issued at `ISSUED` with the default lifetime, clocks in step. */
function link(overrides: { expires?: Date; createdAt?: Date } = {}) {
  return {
    identifier: "person@example.com",
    expires: at(AUTH_TOKEN_LIFETIME_MS),
    createdAt: ISSUED,
    ...overrides,
  };
}

function holder(createdAt: Date, updatedAt: Date = createdAt) {
  return { email: "person@example.com", createdAt, updatedAt };
}

describe("issuedNoLaterThan", () => {
  it("reads a verification link's issue off its expiry, whatever its created_at says", () => {
    // created_at is stamped by the database, whose time zone may not be UTC.
    expect(
      issuedNoLaterThan("email-verification", link({ createdAt: at(5 * HOUR) }))
    ).toEqual(ISSUED);
  });

  it("puts a reset link's issue before both readings when they agree", () => {
    expect(issuedNoLaterThan("password-reset", link())).toEqual(
      at(-CLOCK_AGREEMENT_MS)
    );
  });

  it("knows no issue time for a reset link given a longer lifetime", () => {
    expect(
      issuedNoLaterThan("password-reset", link({ expires: at(7 * 24 * HOUR) }))
    ).toBeNull();
  });

  it("knows no issue time for a reset link stamped by a database in another time zone", () => {
    expect(
      issuedNoLaterThan("password-reset", link({ createdAt: at(5 * HOUR) }))
    ).toBeNull();
    expect(
      issuedNoLaterThan("password-reset", link({ createdAt: at(-5 * HOUR) }))
    ).toBeNull();
  });
});

describe("mayBindToAccount", () => {
  for (const kind of ["password-reset", "email-verification"] as const) {
    describe(kind, () => {
      it("binds to an account that held the address before the link", () => {
        expect(mayBindToAccount(kind, link(), holder(at(-HOUR)))).toBe(true);
      });

      it("refuses an account created in the same second as the link", () => {
        // MySQL and SQLite keep these columns to the second, so the same
        // second cannot be told from a moment after.
        expect(
          mayBindToAccount(
            kind,
            link(),
            holder(at(kind === "password-reset" ? -CLOCK_AGREEMENT_MS : 0))
          )
        ).toBe(false);
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

  it("refuses a reset link's account whenever the link's issue time is unknown", () => {
    expect(
      mayBindToAccount(
        "password-reset",
        link({ expires: at(7 * 24 * HOUR) }),
        holder(at(-HOUR))
      )
    ).toBe(false);
  });

  it("refuses a reset link's account changed within the clocks' margin before it", () => {
    expect(
      mayBindToAccount(
        "password-reset",
        link(),
        holder(at(-HOUR), at(-CLOCK_AGREEMENT_MS / 2))
      )
    ).toBe(false);
  });
});
