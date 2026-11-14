/**
 * A refresh that arrives from another network address than the session's last
 * request, behind a proxy the app trusts (`security.trustProxy`).
 *
 * Ordinary networks do this between two requests of one browser: a
 * carrier-grade NAT or a connection with several uplinks sends each new
 * connection out through whichever public address it picks, often in another
 * /24, and a dual-stack browser reaches a site over IPv4 or IPv6 by whichever
 * connects first. A refresh comes after the tab has been idle for the access
 * token's lifetime, on a new connection, so it is the request most likely to
 * arrive from a new address. Refusing it signed editors out within half an
 * hour of signing in, and ended the account's sessions on every device.
 *
 * Run on every configured dialect, against the real deps-bridge and database.
 */

// The rotation signs with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDialectTables } from "../../../database/index";
import { setNextlyLogger } from "../../../observability/logger";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import { hashRefreshToken } from "../../session/refresh";
import { buildAuthRouterDeps } from "../deps-bridge";
import { handleRefresh } from "../refresh";

let handle: TestNextly | undefined;
afterEach(async () => {
  setNextlyLogger(undefined);
  await handle?.destroy();
  handle = undefined;
});

const RAW_TOKEN = "raw-refresh-token-of-this-browser";
const OTHER_DEVICE_TOKEN = "raw-refresh-token-of-another-device";
const USER_AGENT = "Mozilla/5.0 (Macintosh) Chrome/131.0.0.0 Safari/537.36";

interface RefreshRow {
  id: string;
  tokenHash: string;
  ipAddress: string | null;
}

interface TestDb {
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown> };
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<RefreshRow[]>;
    };
  };
}

/**
 * An account signed in from `signedInFrom` in this browser, and holding a
 * second session on another device.
 */
async function signedIn(
  dialect: TestDialect,
  signedInFrom: string
): Promise<{ t: TestNextly; userId: string }> {
  handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  const users = new ServiceContainer(handle.adapter).users;
  const created = await users.createLocalUser({
    email: "editor@example.com",
    name: "Editor",
    password: "Str0ng-P@ssw0rd!",
    isActive: true,
    emailVerification: "admin-vouched",
  });
  const userId = String(created.id);
  const db = handle.adapter.getDrizzle() as unknown as TestDb;
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await db.insert(getDialectTables().refreshTokens).values([
    {
      id: "rt-this-browser",
      userId,
      tokenHash: hashRefreshToken(RAW_TOKEN),
      userAgent: USER_AGENT,
      ipAddress: signedInFrom,
      expiresAt,
    },
    {
      id: "rt-other-device",
      userId,
      tokenHash: hashRefreshToken(OTHER_DEVICE_TOKEN),
      userAgent: "Mozilla/5.0 (iPhone) Mobile Safari/604.1",
      ipAddress: "192.0.2.50",
      expiresAt,
    },
  ]);
  return { t: handle, userId };
}

async function refreshRows(t: TestNextly, userId: string) {
  const { refreshTokens } = getDialectTables();
  const db = t.adapter.getDrizzle() as unknown as TestDb;
  return db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.userId, userId));
}

/** This browser's refresh, as Vercel's edge forwards it from `from`. */
function refreshFrom(from: string): Request {
  return new Request("https://example.com/admin/api/auth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `nextly_refresh=${RAW_TOKEN}`,
      "user-agent": USER_AGENT,
      "x-forwarded-for": from,
    },
    body: JSON.stringify({}),
  });
}

/** The real bridge, reading client addresses as `security.trustProxy` does. */
function trustingProxyDeps(t: TestNextly) {
  const deps = buildAuthRouterDeps(
    t.getService as unknown as (name: string) => unknown
  );
  deps.trustProxy = true;
  deps.trustedProxyIps = [];
  return deps;
}

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  describe("a refresh from another address of the same browser", () => {
    it.each([
      // Carrier-grade NAT or several uplinks: another public IPv4 address,
      // in another /24.
      ["another IPv4 network", "198.51.100.7", "203.0.113.9"],
      // A dual-stack browser connecting over IPv6 this time.
      ["the other IP family", "198.51.100.7", "2001:db8:85a3::8a2e:370:7334"],
      // Another IPv6 prefix, as a phone moving between networks gets.
      ["another IPv6 network", "2001:db8:1::10", "2001:db9:2::20"],
    ])(
      "rotates the session from %s and keeps the account's other sessions",
      async (_, signedInFrom, refreshingFrom) => {
        const { t, userId } = await signedIn(dialect, signedInFrom);
        const warn = vi.fn();
        setNextlyLogger({
          error: vi.fn(),
          warn,
          info: vi.fn(),
          debug: vi.fn(),
        });

        const res = await handleRefresh(
          refreshFrom(refreshingFrom),
          trustingProxyDeps(t)
        );

        expect(res.status).toBe(200);
        const { refreshToken } = (await res.json()) as {
          refreshToken: string;
        };
        const rows = await refreshRows(t, userId);
        // The presented row is spent and replaced by the one the answer's
        // token names; the other device's session is untouched.
        expect(rows).toHaveLength(2);
        expect(rows.some(row => row.id === "rt-other-device")).toBe(true);
        const rotated = rows.find(row => row.id !== "rt-other-device");
        expect(rotated?.id).not.toBe("rt-this-browser");
        expect(rotated?.tokenHash).toBe(hashRefreshToken(refreshToken));
        // Read through the trusted proxy header: the row records the new
        // address, so the comparison above was made against a real one.
        expect(rotated?.ipAddress).toBe(refreshingFrom);
        // Still observable, for an operator watching for a stolen cookie.
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "refresh-client-changed" })
        );
      }
    );

    it("rotates quietly from the same network", async () => {
      // The control: nothing to report when the address stays in its /24.
      const { t, userId } = await signedIn(dialect, "198.51.100.7");
      const warn = vi.fn();
      setNextlyLogger({ error: vi.fn(), warn, info: vi.fn(), debug: vi.fn() });

      const res = await handleRefresh(
        refreshFrom("198.51.100.42"),
        trustingProxyDeps(t)
      );

      expect(res.status).toBe(200);
      expect(await refreshRows(t, userId)).toHaveLength(2);
      expect(warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ kind: "refresh-client-changed" })
      );
    });
  });
});
