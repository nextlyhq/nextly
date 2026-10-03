import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { assertAccountUsable, type AccountState } from "../account-state";

const now = new Date("2026-09-18T12:00:00Z");
const ok: AccountState = {
  userId: "u1",
  isActive: true,
  lockedUntil: null,
  emailVerified: new Date("2026-01-01T00:00:00Z"),
  passwordUpdatedAt: null,
};

function reasonOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    if (NextlyError.is(err)) {
      return (err.logContext as { reason?: string } | undefined)?.reason;
    }
    throw err;
  }
  return undefined;
}

describe("assertAccountUsable", () => {
  it("accepts an active, unlocked, verified account", () => {
    expect(() =>
      assertAccountUsable(ok, {
        requireEmailVerification: true,
        enforcePasswordLockout: true,
        now,
      })
    ).not.toThrow();
  });

  it("refuses a locked account with the generic public error", () => {
    const state = { ...ok, lockedUntil: new Date("2026-09-18T12:05:00Z") };
    expect(
      reasonOf(() =>
        assertAccountUsable(state, {
          requireEmailVerification: true,
          enforcePasswordLockout: true,
          now,
        })
      )
    ).toBe("locked");
  });

  it("accepts an account whose lock has expired", () => {
    const state = { ...ok, lockedUntil: new Date("2026-09-18T11:59:59Z") };
    expect(() =>
      assertAccountUsable(state, {
        requireEmailVerification: true,
        enforcePasswordLockout: true,
        now,
      })
    ).not.toThrow();
  });

  it("refuses an unverified account only when verification is required", () => {
    const state = { ...ok, emailVerified: null };
    expect(
      reasonOf(() =>
        assertAccountUsable(state, {
          requireEmailVerification: true,
          enforcePasswordLockout: true,
          now,
        })
      )
    ).toBe("unverified");
    expect(() =>
      assertAccountUsable(state, {
        requireEmailVerification: false,
        enforcePasswordLockout: true,
        now,
      })
    ).not.toThrow();
  });

  it("ignores the password lockout when the caller says it does not apply", () => {
    const state = { ...ok, lockedUntil: new Date("2026-09-18T12:05:00Z") };
    expect(() =>
      assertAccountUsable(state, {
        requireEmailVerification: true,
        enforcePasswordLockout: false,
        now,
      })
    ).not.toThrow();
  });

  it("refuses an inactive account", () => {
    const state = { ...ok, isActive: false };
    expect(
      reasonOf(() =>
        assertAccountUsable(state, {
          requireEmailVerification: true,
          enforcePasswordLockout: true,
          now,
        })
      )
    ).toBe("inactive");
  });

  it("uses the same public code for every refusal (no enumeration)", () => {
    const codes = [
      { ...ok, isActive: false },
      { ...ok, emailVerified: null },
      { ...ok, lockedUntil: new Date("2026-09-19T00:00:00Z") },
    ].map(state => {
      try {
        assertAccountUsable(state, {
          requireEmailVerification: true,
          enforcePasswordLockout: true,
          now,
        });
      } catch (err) {
        return NextlyError.is(err) ? err.code : "not-nextly";
      }
      return "no-throw";
    });
    expect(new Set(codes).size).toBe(1);
  });

  describe("an unverified address once the password is proven", () => {
    const unverified = { ...ok, emailVerified: null };
    const codeOf = (state: AccountState, passwordProven?: boolean) => {
      try {
        assertAccountUsable(state, {
          requireEmailVerification: true,
          enforcePasswordLockout: true,
          passwordProven,
          now,
        });
      } catch (err) {
        return NextlyError.is(err) ? err.code : undefined;
      }
      return undefined;
    };

    it("is named, so the login page can offer the link again", () => {
      expect(codeOf(unverified, true)).toBe("EMAIL_NOT_VERIFIED");
    });

    it("stays generic on every path that did not prove the password", () => {
      // The session gates behind other strategies and refresh.
      expect(codeOf(unverified)).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("stays generic for an account an administrator deactivated", () => {
      // Such an account is sent no verification link, so naming the state
      // would send its owner to a resend that never arrives.
      const deactivated = {
        ...unverified,
        isActive: false,
        deactivatedAt: new Date("2026-09-01T00:00:00Z"),
      };
      expect(codeOf(deactivated, true)).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("stays generic when the account is also locked", () => {
      // The lockout is judged first: a correct password must not reveal
      // anything about an account locked against guessing.
      const locked = {
        ...unverified,
        lockedUntil: new Date("2026-09-18T12:05:00Z"),
      };
      expect(codeOf(locked, true)).toBe("AUTH_INVALID_CREDENTIALS");
    });
  });
});
