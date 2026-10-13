/**
 * Every login audit row says which method authenticated it.
 *
 * A trail that records only "a login succeeded" cannot answer which strategy
 * let someone in, which is the first question after a provider is compromised.
 * The success and failure rows get there by different mechanisms — success
 * metadata is stored as given, failure metadata is projected through an
 * allowlist — so both are asserted end to end rather than at the seam, on
 * every configured dialect, since the column that holds the metadata is a
 * different type on each.
 */

// `issueSession` signs with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { buildAuthRouterDeps } from "../../auth/handlers/deps-bridge";
import { handleChallengeResolve } from "../../auth/handlers/challenge-resolve";
import { handleLogin } from "../../auth/handlers/login";
import { handleSetup } from "../../auth/handlers/setup";
import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";
import { getDialectTables } from "../../database/index";
import { ServiceContainer } from "../../services/index";
import type { AuthStrategy } from "../../auth/pipeline/types";
import type { AuthUserId } from "../../types/auth";
import type { PluginContext, PluginDefinition } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

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

/** Captured at init, so a test can call `ctx.auth` as the plugin's route would. */
let captured: PluginContext | undefined;

/** A plugin that finishes logins itself, under its own slug's strategy. */
const loginPlugin: PluginDefinition = {
  name: "@test/audit-sso",
  version: "0.0.0",
  nextly: ">=0.0.1",
  capabilities: { auth: { login: true } },
  init: ctx => {
    captured = ctx;
  },
};

function pluginCtx(): PluginContext {
  if (!captured) throw new Error("plugin init never ran");
  return captured;
}

async function boot(
  dialect: TestDialect,
  plugins: PluginDefinition[] = []
): Promise<TestNextly> {
  captured = undefined;
  handle = await createTestNextly(
    dialect === "sqlite" ? { plugins } : { dialect, plugins }
  );
  if (dialect === "sqlite") {
    // The SQLite runtime auto-sync does not create the core auth tables.
    for (const statement of generateSqliteCoreTableStatements()) {
      await handle.adapter.executeQuery(statement);
    }
  }
  return handle;
}

async function makeUser(
  t: TestNextly,
  email: string,
  isActive = true
): Promise<string> {
  const created = await new ServiceContainer(t.adapter).users.createLocalUser({
    email,
    name: "Test Person",
    password: PASSWORD,
    isActive,
    emailVerification: "admin-vouched",
  });
  return String(created.id);
}

function authRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`${ORIGIN}/admin/api/auth/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      cookie: "nextly_csrf=tok",
    },
    body: JSON.stringify({ csrfToken: "tok", ...body }),
  });
}

function loginRequest(body: Record<string, unknown>): Request {
  return authRequest("login", body);
}

/** Answer a challenge with `code`, the pending token in the body. */
function answerChallenge(pendingToken: string, code: string): Request {
  return authRequest("challenge/resolve", {
    pendingToken,
    response: { code },
  });
}

interface AuditRow {
  kind: string;
  actorUserId: string | null;
  targetUserId: string | null;
  metadata: unknown;
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

/**
 * A row's metadata as an object. It is text on SQLite and a JSON column on
 * PostgreSQL and MySQL, whose drivers hand it back already parsed.
 */
function metadataOf(row: AuditRow): Record<string, unknown> {
  if (typeof row.metadata === "string") {
    return JSON.parse(row.metadata) as Record<string, unknown>;
  }
  return (row.metadata ?? {}) as Record<string, unknown>;
}

/**
 * A failure row must not say whose account was tried: no actor, no target,
 * and neither the address nor the id anywhere on the row, metadata included.
 */
function expectNamesNoAccount(
  row: AuditRow,
  account: { email: string; id: string }
): void {
  expect(row.actorUserId).toBeNull();
  expect(row.targetUserId).toBeNull();
  const whole = JSON.stringify({ ...row, metadata: metadataOf(row) });
  expect(whole).not.toContain(account.email);
  expect(whole).not.toContain(account.id);
}

describe.each(getConfiguredTestDialects())(
  "login audit rows record the authenticating strategy (%s)",
  (dialect: TestDialect) => {
    it("records the built-in password strategy on a successful login", async () => {
      const t = await boot(dialect);
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
      const t = await boot(dialect);
      const id = await makeUser(t, "victim@example.com");
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
      expectNamesNoAccount(rows[0], { email: "victim@example.com", id });
      // The strategy's own words are its own and must not reach the trail.
      expect(JSON.stringify(metadataOf(rows[0]))).not.toContain(
        "no account for this person"
      );
    });

    it("records the built-in password strategy on a wrong password, naming no account", async () => {
      // The failure every install sees most. The account exists, so a row that
      // named it would tell whoever reads the trail that the address is real.
      const t = await boot(dialect);
      const id = await makeUser(t, "wrongpass@example.com");
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );

      const res = await handleLogin(
        loginRequest({
          email: "wrongpass@example.com",
          password: "Not-the-P@ssw0rd!",
        }),
        deps
      );
      expect(res.status).toBe(401);

      const rows = await auditRows(t, "login-failed");
      expect(rows).toHaveLength(1);
      expect(metadataOf(rows[0]).strategy).toBe("password");
      expectNamesNoAccount(rows[0], { email: "wrongpass@example.com", id });
    });

    it("records the setup route as the strategy of the first administrator's session", async () => {
      // Setup hands out a working session, so its row is a login like any
      // other, and says which way in it was: not `password`, since no password
      // was checked, but the setup route of an empty install.
      const t = await boot(dialect);
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );

      const res = await handleSetup(
        authRequest("setup", {
          email: "first@example.com",
          name: "First Admin",
          password: PASSWORD,
        }),
        deps
      );
      expect(res.status).toBe(201);

      const rows = await auditRows(t, "login-succeeded");
      expect(rows).toHaveLength(1);
      expect(rows[0].actorUserId).not.toBeNull();
      expect(metadataOf(rows[0]).strategy).toBe("setup");
    });

    it("keeps the original strategy across a challenge and its answer", async () => {
      // The session is minted by the challenge handler, but the method that
      // authenticated the person was chosen before the challenge existed.
      const t = await boot(dialect, [challengePlugin]);
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
        answerChallenge(challenge.pendingToken, "999"),
        deps
      );
      expect(resolved.status).toBe(200);

      const rows = await auditRows(t, "login-succeeded");
      expect(rows).toHaveLength(1);
      expect(metadataOf(rows[0]).strategy).toBe("custom-sso");
    });

    it("records every wrong second-factor answer with the strategy, the last permitted one included", async () => {
      // Two attempts allowed, both wrong: the first is answered with a retry
      // token, the second ends the flow by throwing. Each is its own row, so a
      // factor being guessed leaves a trace from the first guess, and the
      // answer that ends the flow is not lost to the error path.
      const t = await boot(dialect, [challengePlugin]);
      const id = await makeUser(t, "twofactor@example.com");
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );
      deps.authStrategies = [
        customSso(id as AuthUserId),
        ...deps.authStrategies,
      ];
      deps.maxChallengeAttempts = 2;

      const first = await handleLogin(
        loginRequest({ email: "twofactor@example.com", password: PASSWORD }),
        deps
      );
      const { pendingToken } = (await first.json()) as { pendingToken: string };

      const firstWrong = await handleChallengeResolve(
        answerChallenge(pendingToken, "000"),
        deps
      );
      expect(firstWrong.status).toBe(401);
      const retry = (
        (await firstWrong.json()) as {
          error?: { data?: { pendingToken?: string } };
        }
      ).error?.data?.pendingToken;
      expect(typeof retry).toBe("string");

      const lastWrong = await handleChallengeResolve(
        answerChallenge(retry as string, "000"),
        deps
      );
      expect(lastWrong.status).toBe(401);
      // The flow is over: the last answer offers no further round.
      const lastBody = (await lastWrong.json()) as {
        error?: { data?: { pendingToken?: string } };
      };
      expect(lastBody.error?.data?.pendingToken).toBeUndefined();

      const rows = await auditRows(t, "login-failed");
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(metadataOf(row).strategy).toBe("custom-sso");
        expectNamesNoAccount(row, { email: "twofactor@example.com", id });
      }
    });

    it("records the plugin's strategy on the row of a login it finishes", async () => {
      const t = await boot(dialect, [loginPlugin]);
      const id = await makeUser(t, "pluginuser@example.com");

      const res = await pluginCtx().auth.completeLogin(id, {
        request: new Request(`${ORIGIN}/admin/api/plugins/test-audit-sso/cb`),
        strategy: "test-audit-sso:oauth",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).not.toContain("error=");

      const rows = await auditRows(t, "login-succeeded");
      expect(rows).toHaveLength(1);
      expect(rows[0].actorUserId).toBe(id);
      expect(metadataOf(rows[0]).strategy).toBe("test-audit-sso:oauth");
    });

    it("records the plugin's strategy on the row of a login it fails, naming no account", async () => {
      // A deactivated account the plugin names is refused by the account gate.
      // The account exists, so the row must still not say whose it was; the
      // strategy is what tells an operator which plugin was turned away.
      const t = await boot(dialect, [loginPlugin]);
      const id = await makeUser(t, "deactivated@example.com", false);

      const res = await pluginCtx().auth.completeLogin(id, {
        request: new Request(`${ORIGIN}/admin/api/plugins/test-audit-sso/cb`),
        strategy: "test-audit-sso:oauth",
      });
      expect(res.headers.get("Location")).toBe(
        "/admin/login?error=signin-failed"
      );

      const rows = await auditRows(t, "login-failed");
      expect(rows).toHaveLength(1);
      expect(metadataOf(rows[0]).strategy).toBe("test-audit-sso:oauth");
      expectNamesNoAccount(rows[0], { email: "deactivated@example.com", id });
      expect(await auditRows(t, "login-succeeded")).toHaveLength(0);
    });
  }
);
