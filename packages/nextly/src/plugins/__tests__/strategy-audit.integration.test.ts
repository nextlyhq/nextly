/**
 * Every login audit row says which method authenticated it.
 *
 * A trail that records only "a login succeeded" cannot answer which strategy
 * let someone in, which is the first question after a provider is compromised.
 * The success and failure rows get there by different mechanisms — success
 * metadata is stored as given, failure metadata is projected through an
 * allowlist — so both are asserted end to end rather than at the seam.
 */

// `issueSession` signs with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { buildAuthRouterDeps } from "../../auth/handlers/deps-bridge";
import { handleChallengeResolve } from "../../auth/handlers/challenge-resolve";
import { handleLogin } from "../../auth/handlers/login";
import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";
import { getDialectTables } from "../../database/index";
import { ServiceContainer } from "../../services/index";
import type { AuthStrategy } from "../../auth/pipeline/types";
import type { AuthUserId } from "../../types/auth";
import type { PluginDefinition } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const PASSWORD = "Str0ng-P@ssw0rd!";
const ORIGIN = "http://localhost:3000";

/**
 * A strategy that refuses every attempt, so the failure row names it.
 *
 * Strategies come from app config rather than from a plugin, and the harness
 * takes no app config, so it is prepended to the strategies the real bridge
 * built. The chain and the failure path under test are the production ones.
 */
const alwaysRefuses: AuthStrategy = {
  name: "always-refuses",
  authenticate: async () => ({
    type: "fail",
    reason: "no account for this person",
  }),
};

/**
 * Authenticates the 2FA address under a name that is NOT "password".
 *
 * The distinction matters: a pending token with no strategy claim falls back
 * to "password", so a challenge test run on the password path passes whether
 * or not the claim survives. Only a different name separates the two.
 */
function customSso(userId: AuthUserId): AuthStrategy {
  return {
    name: "custom-sso",
    authenticate: async () => ({
      type: "authenticated",
      user: { id: userId, email: "twofactor@example.com" },
    }),
  };
}

/** A plugin whose afterAuthenticate hook interrupts one address with a challenge. */
const challengePlugin: PluginDefinition = {
  name: "@test/challenge-strategy",
  version: "0.0.0",
  nextly: ">=0.0.1",
  contributes: {
    auth: {
      hooks: {
        afterAuthenticate: user =>
          user.email === "twofactor@example.com"
            ? { challenge: { id: "test-totp", userId: user.id as AuthUserId } }
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

async function boot(plugins: PluginDefinition[] = []): Promise<TestNextly> {
  handle = await createTestNextly({ plugins });
  for (const statement of generateSqliteCoreTableStatements()) {
    await handle.adapter.executeQuery(statement);
  }
  return handle;
}

async function makeUser(t: TestNextly, email: string): Promise<string> {
  const created = await new ServiceContainer(t.adapter).users.createLocalUser({
    email,
    name: "Test Person",
    password: PASSWORD,
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return String(created.id);
}

function loginRequest(body: Record<string, unknown>): Request {
  return new Request(`${ORIGIN}/admin/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      cookie: "nextly_csrf=tok",
    },
    body: JSON.stringify({ csrfToken: "tok", ...body }),
  });
}

interface AuditRow {
  kind: string;
  actorUserId: string | null;
  targetUserId: string | null;
  metadata: string | null;
}

/** Audit rows of one kind, newest first, read straight from the table. */
async function auditRows(t: TestNextly, kind: string): Promise<AuditRow[]> {
  const db = t.adapter.getDrizzle() as unknown as {
    select: () => {
      from: (table: unknown) => Promise<AuditRow[]>;
    };
  };
  const { auditLog } = getDialectTables();
  const rows = await db.select().from(auditLog);
  return rows.filter(r => r.kind === kind);
}

function metadataOf(row: AuditRow): Record<string, unknown> {
  return row.metadata
    ? (JSON.parse(row.metadata) as Record<string, unknown>)
    : {};
}

describe("login audit rows record the authenticating strategy", () => {
  it("records the built-in password strategy on a successful login", async () => {
    const t = await boot();
    await makeUser(t, "passworduser@example.com");
    const deps = buildAuthRouterDeps(
      t.getService as unknown as (name: string) => unknown
    );

    const res = await handleLogin(
      loginRequest({ email: "passworduser@example.com", password: PASSWORD }),
      deps
    );
    expect(res.status).toBe(200);

    const rows = await auditRows(t, "login-succeeded");
    expect(rows).toHaveLength(1);
    expect(metadataOf(rows[0]).strategy).toBe("password");
  });

  it("records the failing strategy, naming no account", async () => {
    // The failure row carries no actor on purpose, so the strategy is the only
    // thing on it that says what happened.
    const t = await boot();
    await makeUser(t, "victim@example.com");
    const deps = buildAuthRouterDeps(
      t.getService as unknown as (name: string) => unknown
    );
    deps.authStrategies = [alwaysRefuses, ...deps.authStrategies];

    const res = await handleLogin(
      loginRequest({ email: "victim@example.com", password: PASSWORD }),
      deps
    );
    expect(res.status).toBe(401);

    const rows = await auditRows(t, "login-failed");
    expect(rows).toHaveLength(1);
    expect(metadataOf(rows[0]).strategy).toBe("always-refuses");
    expect(rows[0].actorUserId).toBeNull();
    expect(rows[0].targetUserId).toBeNull();
    // The strategy's own words are its own and must not reach the trail.
    expect(rows[0].metadata ?? "").not.toContain("no account for this person");
  });

  it("keeps the original strategy across a challenge and its answer", async () => {
    // The session is minted by the challenge handler, but the method that
    // authenticated the person was chosen before the challenge existed.
    const t = await boot([challengePlugin]);
    const userId = await makeUser(t, "twofactor@example.com");
    const deps = buildAuthRouterDeps(
      t.getService as unknown as (name: string) => unknown
    );
    deps.authStrategies = [
      customSso(userId as AuthUserId),
      ...deps.authStrategies,
    ];

    const first = await handleLogin(
      loginRequest({ email: "twofactor@example.com", password: PASSWORD }),
      deps
    );
    expect(first.status).toBe(200);
    const challenge = (await first.json()) as {
      status: string;
      pendingToken: string;
    };
    expect(challenge.status).toBe("challenge");

    const resolved = await handleChallengeResolve(
      new Request(`${ORIGIN}/admin/api/auth/challenge/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          cookie: "nextly_csrf=tok",
        },
        body: JSON.stringify({
          csrfToken: "tok",
          pendingToken: challenge.pendingToken,
          response: { code: "999" },
        }),
      }),
      deps
    );
    expect(resolved.status).toBe(200);

    const rows = await auditRows(t, "login-succeeded");
    expect(rows).toHaveLength(1);
    expect(metadataOf(rows[0]).strategy).toBe("custom-sso");
  });
});
