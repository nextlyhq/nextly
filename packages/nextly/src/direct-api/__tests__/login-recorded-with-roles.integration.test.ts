/**
 * A Direct API login is held to what every other sign-in is: it is recorded
 * on the audit trail, a success naming the account and a failure naming none,
 * each with the strategy that authenticated it; and its token carries the
 * account's roles in force, ending no later than the first of them lapses.
 *
 * Each case runs the real `nextly.login()` against a real database, and reads
 * back the stored audit rows and the session the token is read as.
 */

// The login signs with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { decodeJwt } from "jose";
import { afterEach, describe, expect, it } from "vitest";

import { COOKIE_NAMES } from "../../auth/cookies/cookie-config";
import { getSession } from "../../auth/session/get-session";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { getDialectTables } from "../../database/index";
import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { ServiceContainer } from "../../services/index";

const SECRET = process.env.NEXTLY_SECRET;
const EMAIL = "direct@example.com";
const PASSWORD = "Str0ng-P@ssw0rd!";
const HOUR_MS = 60 * 60 * 1000;

let current: TestNextly | undefined;
afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
});

/** The drizzle calls these cases make, typed only as far as they use them. */
interface RawDb {
  select(): { from(table: unknown): Promise<Array<Record<string, unknown>>> };
  insert(table: unknown): {
    values(values: Record<string, unknown>): Promise<unknown>;
  };
}

function raw(t: TestNextly): RawDb {
  return t.adapter.getDrizzle() as unknown as RawDb;
}

interface Signed {
  t: TestNextly;
  userId: string;
}

/** An audit row as the cases read it, its metadata parsed on every dialect. */
interface ReadRow {
  kind: unknown;
  actorUserId: unknown;
  targetUserId: unknown;
  metadata: Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a Direct API login (%s)",
  (dialect: TestDialect) => {
    async function signedUp(): Promise<Signed> {
      current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      if (dialect === "sqlite") {
        for (const statement of generateSqliteCoreTableStatements()) {
          await current.adapter.executeQuery(statement);
        }
      }
      const users = new ServiceContainer(current.adapter).users;
      // The install's first account is made its super-admin. The account
      // under test is another, so the roles it holds are the ones each case
      // gives it.
      await users.createLocalUser({
        email: "owner@example.com",
        name: "Owner",
        password: PASSWORD,
        isActive: true,
        emailVerification: "admin-vouched",
      });
      const created = await users.createLocalUser({
        email: EMAIL,
        name: "Direct",
        password: PASSWORD,
        isActive: true,
        emailVerification: "admin-vouched",
      });
      return { t: current, userId: String(created.id) };
    }

    /** Every audit row of a kind, with metadata read the same on each dialect. */
    async function auditRows({ t }: Signed, kind: string): Promise<ReadRow[]> {
      const rows = await raw(t).select().from(getDialectTables().auditLog);
      return rows
        .filter(r => r.kind === kind)
        .map(r => ({
          kind: r.kind,
          actorUserId: r.actorUserId,
          targetUserId: r.targetUserId,
          metadata:
            typeof r.metadata === "string"
              ? (JSON.parse(r.metadata) as Record<string, unknown>)
              : ((r.metadata ?? {}) as Record<string, unknown>),
        }));
    }

    /** Makes a role and gives it to the account, lapsing at `expiresAt`. */
    async function give(
      { t, userId }: Signed,
      slug: string,
      expiresAt: Date | null
    ): Promise<string> {
      const db = raw(t);
      const tables = getDialectTables();
      const roleId = `role-${slug}`;
      await db.insert(tables.roles).values({
        id: roleId,
        name: slug,
        slug,
        level: 10,
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.insert(tables.userRoles).values({
        id: `${userId}-${roleId}`,
        userId,
        roleId,
        expiresAt,
        createdAt: new Date(),
      });
      return roleId;
    }

    function carrying(token: string): Request {
      return new Request("http://localhost:3000/admin/api/x", {
        headers: { cookie: `${COOKIE_NAMES.accessToken}=${token}` },
      });
    }

    it("records a success naming the account and the strategy", async () => {
      const s = await signedUp();

      await s.t.nextly.login({ email: EMAIL, password: PASSWORD });

      const rows = await auditRows(s, "login-succeeded");
      expect(rows).toHaveLength(1);
      expect(rows[0].actorUserId).toBe(s.userId);
      expect(rows[0].metadata).toMatchObject({
        strategy: "password",
        via: "direct-api",
      });
    });

    it("records a failure naming no account, with the strategy", async () => {
      const s = await signedUp();

      await expect(
        s.t.nextly.login({ email: EMAIL, password: "wrong-password" })
      ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });

      const rows = await auditRows(s, "login-failed");
      expect(rows).toHaveLength(1);
      // Neither column names the account the attempt reached.
      expect(rows[0].actorUserId ?? null).toBeNull();
      expect(rows[0].targetUserId ?? null).toBeNull();
      expect(rows[0].metadata).toMatchObject({
        code: "AUTH_INVALID_CREDENTIALS",
        strategy: "password",
        via: "direct-api",
      });
      // No address or id is kept in the details either.
      expect(JSON.stringify(rows[0].metadata)).not.toContain(EMAIL);
      expect(JSON.stringify(rows[0].metadata)).not.toContain(s.userId);
      expect(await auditRows(s, "login-succeeded")).toHaveLength(0);
    });

    it("reads its session with the account's roles in force", async () => {
      const s = await signedUp();
      const editor = await give(s, "editor", null);
      const author = await give(
        s,
        "author",
        new Date(Date.now() + 4 * HOUR_MS)
      );
      // Lapsed yesterday: granted nothing, so the token must not carry it.
      await give(s, "lapsed", new Date(Date.now() - 24 * HOUR_MS));

      const { token } = await s.t.nextly.login({
        email: EMAIL,
        password: PASSWORD,
      });

      const session = await getSession(carrying(token), SECRET);
      expect(session.authenticated).toBe(true);
      if (!session.authenticated) return;
      expect([...session.user.roleIds].sort()).toEqual([author, editor].sort());
    });

    it("ends no later than the first of its roles lapses", async () => {
      const s = await signedUp();
      // Hours away, well inside the token's day, so only the bound can bring
      // the expiry this close; the role that never lapses changes nothing.
      // A whole second, because MySQL stores a timestamp rounded to the
      // nearest second: a fractional instant would be stored, and so lapse,
      // up to half a second later than the one given here.
      const lapses = new Date(
        Math.floor((Date.now() + 2 * HOUR_MS) / 1000) * 1000
      );
      await give(s, "permanent", null);
      await give(s, "temporary", lapses);

      const { token, exp } = await s.t.nextly.login({
        email: EMAIL,
        password: PASSWORD,
      });

      // Exactly the second the role lapses: the bound, not the day.
      expect(Number(decodeJwt(token).exp)).toBe(lapses.getTime() / 1000);
      expect(exp).toBe(decodeJwt(token).exp);
    });

    it("lives a day when none of its roles lapses", async () => {
      // The control for the bound: with no expiring role, the token keeps
      // the full day.
      const s = await signedUp();
      await give(s, "permanent", null);

      const { token } = await s.t.nextly.login({
        email: EMAIL,
        password: PASSWORD,
      });

      const claims = decodeJwt(token);
      expect(Number(claims.exp) - Number(claims.iat)).toBe(24 * 60 * 60);
    });
  }
);
