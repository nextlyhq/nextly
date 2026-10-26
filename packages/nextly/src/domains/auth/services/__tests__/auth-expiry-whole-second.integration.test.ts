/**
 * An auth expiry, read back after it is written, held against the whole
 * second the issuer computed.
 *
 * An expiry computed as `now + lifetime` carries milliseconds, and MySQL's
 * `DATETIME` keeps whole seconds and rounds — so the stored instant could
 * sit up to half a second after the one the code computed, and a check
 * comparing that stored value with a millisecond clock accepted a
 * password-reset token briefly past its end. Each write below parks the
 * clock on an instant whose fractional part is `.700` — past the rounding
 * midpoint — before it runs: a value stored as the whole second it was
 * computed to arrives as the computed second itself, while a value stored
 * with the rounding's help arrives three tenths of a second later than the
 * instant its issuer computed, which is what the assertions hold it
 * against. The consumption case parks the clock exactly on the boundary the
 * issuer computed and demands the refusal, which the rounding's extension
 * defeats on any dialect that kept the milliseconds.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { newRefreshToken } from "../../../../auth/handlers/issue-session";
import { getDialectTables } from "../../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { consoleLogger } from "../../../../services/shared";
import { INVITE_TOKEN_EXPIRY_HOURS } from "../../lib/invite-token";
import { AuthService } from "../auth-service";
import { AUTH_TOKEN_LIFETIME_MS } from "../token-account-binding";

const EMAIL = "expiry-whole@example.com";
const USER_ID = "expiry-whole-user-1";
/** Past MySQL's rounding midpoint, so a rounding column moves the value. */
const PARKED = new Date("2026-06-01T12:00:00.700Z");
const REFRESH_TTL_SECONDS = 24 * 60 * 60;
const INVITE_LIFETIME_MS = INVITE_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;

interface TestDb {
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown> };
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
}

let current: TestNextly | undefined;
let tables: ReturnType<typeof getDialectTables>;

function parkClock(at: Date): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at.getTime());
}

/** The computed instant, brought down to the whole second it falls in. */
function wholeSecond(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 1000) * 1000);
}

/** What the parked clock plus a lifetime computes to. */
function computedFrom(lifetimeMs: number): Date {
  return new Date(PARKED.getTime() + lifetimeMs);
}

afterEach(async () => {
  vi.useRealTimers();
  await current?.destroy();
  current = undefined;
});

async function setup(dialect: TestDialect): Promise<{
  auth: AuthService;
  db: TestDb;
}> {
  current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  tables = getDialectTables(dialect);
  const auth = current.getService("authService") as unknown as AuthService;
  const db = current.adapter.getDrizzle() as unknown as TestDb;

  // An account that awaits a verification link: no verified address yet.
  await db.insert(tables.users).values({
    id: USER_ID,
    email: EMAIL,
    name: "Expiry Whole Second User",
    isActive: true,
    passwordHash: null,
    mustChangePassword: true,
  });

  return { auth, db };
}

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  describe("an expiry written with its milliseconds", () => {
    it("stores a password-reset expiry as the whole second computed", async () => {
      const { auth, db } = await setup(dialect);
      parkClock(PARKED);

      await auth.generatePasswordResetToken(EMAIL, { disableEmail: true });

      const [row] = await db
        .select()
        .from(tables.passwordResetTokens)
        .where(eq(tables.passwordResetTokens.identifier, EMAIL));
      const stored = row.expires as Date;
      expect(stored.getTime()).toBe(
        wholeSecond(computedFrom(AUTH_TOKEN_LIFETIME_MS)).getTime()
      );
    });

    it("stores an email-verification expiry as the whole second computed", async () => {
      const { auth, db } = await setup(dialect);
      parkClock(PARKED);

      await auth.generateEmailVerificationToken(EMAIL, {
        disableEmail: true,
      });

      const [row] = await db
        .select()
        .from(tables.emailVerificationTokens)
        .where(eq(tables.emailVerificationTokens.identifier, EMAIL));
      const stored = row.expires as Date;
      expect(stored.getTime()).toBe(
        wholeSecond(computedFrom(AUTH_TOKEN_LIFETIME_MS)).getTime()
      );
    });

    it("stores an invite expiry as the whole second computed", async () => {
      const { auth, db } = await setup(dialect);
      parkClock(PARKED);

      await auth.generateInviteToken(USER_ID);

      const [row] = await db
        .select()
        .from(tables.userInviteTokens)
        .where(eq(tables.userInviteTokens.userId, USER_ID));
      const stored = row.expires as Date;
      expect(stored.getTime()).toBe(
        wholeSecond(computedFrom(INVITE_LIFETIME_MS)).getTime()
      );
    });

    it("stores a refresh-session expiry as the whole second computed", async () => {
      const { auth, db } = await setup(dialect);
      parkClock(PARKED);

      // The record every session-writing path stores, built the way the
      // handler builds it, then written the way its store writes it: one
      // plain insert of the record.
      const { record } = newRefreshToken(
        {
          refreshTokenTTL: REFRESH_TTL_SECONDS,
          trustProxy: false,
          trustedProxyIps: [],
        },
        USER_ID,
        new Request("http://localhost/sign-in", { method: "POST" })
      );
      await db.insert(tables.refreshTokens).values(record);

      const [row] = await db
        .select()
        .from(tables.refreshTokens)
        .where(eq(tables.refreshTokens.userId, USER_ID));
      const stored = row.expiresAt as Date;
      expect(stored.getTime()).toBe(
        wholeSecond(computedFrom(REFRESH_TTL_SECONDS * 1000)).getTime()
      );
    });
  });

  describe("consuming a reset at the boundary its issuer computed", () => {
    it("answers TOKEN_EXPIRED when the clock sits exactly on it", async () => {
      const { auth } = await setup(dialect);
      parkClock(PARKED);
      const { token } = await auth.generatePasswordResetToken(EMAIL, {
        disableEmail: true,
      });

      // Park exactly on the boundary the issuer computed: the claim must
      // refuse here, whatever the column keeps.
      vi.setSystemTime(
        wholeSecond(computedFrom(AUTH_TOKEN_LIFETIME_MS)).getTime()
      );

      await expect(
        auth.resetPasswordWithToken(token as string, "Passw0rdA123!")
      ).rejects.toMatchObject({ code: "TOKEN_EXPIRED", statusCode: 401 });
    });
  });
});
