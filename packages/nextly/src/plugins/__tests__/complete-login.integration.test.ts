/**
 * A plugin finishes a login through the core session path.
 *
 * The unit tests cover `completeLogin` against stubs; this drives it from a
 * real booted instance, so the wiring that makes `ctx.auth` exist at all is
 * part of what is asserted — and the 2FA round trip goes through the real
 * challenge handler, with the token never leaving an HttpOnly cookie.
 */

process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { buildAuthRouterDeps } from "../../auth/handlers/deps-bridge";
import { handleChallengeResolve } from "../../auth/handlers/challenge-resolve";
import { getDialectTables } from "../../database/index";
import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";
import { ServiceContainer } from "../../services/index";
import type { AuthUserId } from "../../types/auth";
import type { PluginContext, PluginDefinition } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const ORIGIN = "http://localhost:3000";
const PASSWORD = "Str0ng-P@ssw0rd!";

/** Captured at init so the test can call ctx.auth exactly as a route would. */
let captured: PluginContext | undefined;

const capturingPlugin: PluginDefinition = {
  name: "@test/capture-ctx",
  version: "0.0.0",
  nextly: ">=0.0.1",
  init: ctx => {
    captured = ctx;
  },
};

function twoFactorPlugin(email: string): PluginDefinition {
  return {
    name: "@test/complete-login-2fa",
    version: "0.0.0",
    nextly: ">=0.0.1",
    init: ctx => {
      captured = ctx;
    },
    contributes: {
      auth: {
        hooks: {
          afterAuthenticate: user =>
            user.email === email
              ? { challenge: { id: "test-totp", userId: user.id } }
              : user,
        },
        challenges: [
          {
            id: "test-totp",
            resolve: async ({ response }) =>
              response.code === "999" ? { ok: true } : { ok: false },
          },
        ],
      },
    },
  };
}

async function boot(plugins: PluginDefinition[]): Promise<TestNextly> {
  captured = undefined;
  handle = await createTestNextly({ plugins });
  for (const statement of generateSqliteCoreTableStatements()) {
    await handle.adapter.executeQuery(statement);
  }
  return handle;
}

async function makeUser(t: TestNextly, email: string): Promise<string> {
  const created = await new ServiceContainer(t.adapter).users.createLocalUser({
    email,
    name: "External Person",
    password: PASSWORD,
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return String(created.id);
}

function ctx(): PluginContext {
  if (!captured) throw new Error("plugin init never ran");
  return captured;
}

const callbackRequest = new Request(
  `${ORIGIN}/admin/api/plugins/test/callback`
);

function cookieNames(res: Response): string[] {
  return res.headers.getSetCookie().map(c => c.split("=")[0]);
}

function cookieValue(res: Response, name: string): string | undefined {
  return res.headers
    .getSetCookie()
    .find(c => c.startsWith(`${name}=`))
    ?.split(";")[0];
}

interface AuditRow {
  kind: string;
  actorUserId: string | null;
  metadata: string | null;
}

async function auditRows(t: TestNextly, kind: string): Promise<AuditRow[]> {
  const db = t.adapter.getDrizzle() as unknown as {
    select: () => { from: (table: unknown) => Promise<AuditRow[]> };
  };
  const { auditLog } = getDialectTables();
  return (await db.select().from(auditLog)).filter(r => r.kind === kind);
}

describe("ctx.auth.completeLogin, end to end", () => {
  it("signs in an active user and records the strategy", async () => {
    const t = await boot([capturingPlugin]);
    const userId = await makeUser(t, "external@example.com");

    const res = await ctx().auth.completeLogin(userId, {
      request: callbackRequest,
      strategy: "oauth-test",
      next: "/admin/collections",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/collections");
    expect(cookieNames(res)).toEqual(
      expect.arrayContaining(["nextly_session", "nextly_refresh"])
    );

    const rows = await auditRows(t, "login-succeeded");
    expect(rows).toHaveLength(1);
    expect(rows[0].actorUserId).toBe(userId);
    expect(JSON.parse(rows[0].metadata ?? "{}")).toMatchObject({
      strategy: "oauth-test",
    });
  });

  it("carries a 2FA login to the resume page and back, with no token in any URL", async () => {
    const t = await boot([twoFactorPlugin("twofactor@example.com")]);
    const userId = await makeUser(t, "twofactor@example.com");

    const started = await ctx().auth.completeLogin(userId, {
      request: callbackRequest,
      strategy: "oauth-test",
      next: "/admin/collections",
    });

    expect(started.status).toBe(302);
    expect(started.headers.get("Location")).toBe("/admin/login?resume=1");
    expect(cookieNames(started)).toContain("nextly_pending");
    expect(cookieNames(started)).not.toContain("nextly_session");

    const pendingCookie = cookieValue(started, "nextly_pending");
    expect(pendingCookie).toBeDefined();

    // The browser now answers the challenge. It holds no token — only the
    // HttpOnly cookie — so the resolve request carries no pendingToken field.
    const deps = buildAuthRouterDeps(
      t.getService as unknown as (name: string) => unknown
    );
    const resolved = await handleChallengeResolve(
      new Request(`${ORIGIN}/admin/api/auth/challenge/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          cookie: `nextly_csrf=tok; ${pendingCookie}`,
        },
        body: JSON.stringify({ csrfToken: "tok", response: { code: "999" } }),
      }),
      deps
    );

    expect(resolved.status).toBe(200);
    expect(cookieNames(resolved)).toEqual(
      expect.arrayContaining(["nextly_session", "nextly_refresh"])
    );
    // Settled, so the pending cookie is expired rather than left replayable.
    expect(
      resolved.headers.getSetCookie().find(c => c.startsWith("nextly_pending="))
    ).toContain("Max-Age=0");

    const body = (await resolved.json()) as { next?: string };
    expect(body.next).toBe("/admin/collections");

    const rows = await auditRows(t, "login-succeeded");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].metadata ?? "{}")).toMatchObject({
      strategy: "oauth-test",
    });
  });

  it("refuses a deactivated account with a generic failure", async () => {
    const t = await boot([capturingPlugin]);
    const userId = await makeUser(t, "deactivated@example.com");
    await new ServiceContainer(t.adapter).users.updateUser(userId, {
      isActive: false,
    });

    const res = await ctx().auth.completeLogin(userId, {
      request: callbackRequest,
      strategy: "oauth-test",
    });

    expect(res.headers.get("Location")).toBe(
      "/admin/login?error=signin-failed"
    );
    expect(cookieNames(res)).not.toContain("nextly_session");

    const rows = await auditRows(t, "login-failed");
    expect(rows).toHaveLength(1);
    expect(rows[0].actorUserId).toBeNull();
  });

  it("reports the signed-in user through currentUser", async () => {
    const t = await boot([capturingPlugin]);
    const userId = await makeUser(t, "whoami@example.com");
    const login = await ctx().auth.completeLogin(userId, {
      request: callbackRequest,
      strategy: "oauth-test",
    });

    const withSession = new Request(`${ORIGIN}/admin/api/plugins/test/me`, {
      headers: { cookie: cookieValue(login, "nextly_session") ?? "" },
    });

    expect(await ctx().auth.currentUser(withSession)).toEqual({
      id: userId,
      email: "whoami@example.com",
    });
    expect(await ctx().auth.currentUser(callbackRequest)).toBeNull();
  });
});

// The typed AuthUserId is only needed to satisfy the challenge hook's shape.
export type { AuthUserId };
