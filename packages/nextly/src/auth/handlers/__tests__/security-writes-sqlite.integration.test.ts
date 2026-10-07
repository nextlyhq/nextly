/**
 * Security writes made while a plugin's `ctx.db.transaction` is open on SQLite.
 *
 * SQLite has one connection, and a plugin's transaction holds it for as long
 * as its work runs. A plain statement another request issues meanwhile runs
 * inside that transaction, and the plugin's rollback undoes it: a signed-out
 * refresh row comes back, a theft response's revocations come back, a
 * failed-attempt count returns to zero and a lockout is lifted. Each case here
 * runs the write during a plugin transaction that writes, waits (standing in
 * for a `ctx.fetch`) and throws, and checks that the write outlived the
 * rollback because it waited for the transaction to end.
 */

process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { nextlyPluginSettings } from "../../../schemas/plugin-settings/sqlite";
import { buildAuditLogWriter } from "../../../domains/audit/audit-log-writer";
import { ApiKeyService } from "../../../domains/auth/services/api-key-service";
import { ServiceContainer } from "../../../services/index";
import { consoleLogger } from "../../../services/shared";
import { passwordCredentialDeps } from "../../credentials/credential-deps";
import { verifyCredentials } from "../../credentials/verify-credentials";
import { hashRefreshToken } from "../../session/refresh";
import { buildAuthRouterDeps } from "../deps-bridge";
import { handleLogout } from "../logout";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const EMAIL = "window@example.com";
const PASSWORD = "Str0ng-P@ssw0rd!";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Db {
  select: (fields?: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Array<Record<string, unknown>>>;
    };
  };
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown> };
  update: (table: unknown) => {
    set: (data: unknown) => { where: (cond: unknown) => Promise<unknown> };
  };
}

/** The plugin's own table, which the typed surface writes to. */
const marks = defineTable("marks", { id: col.id(), key: col.shortText() });

/**
 * A plugin transaction that writes, waits and throws, through one of the two
 * handles a plugin holds, and what it left behind.
 */
interface PluginTx {
  /** Write, wait `ms` and throw; resolves with the moment it threw. */
  rollBackAfter(ms: number): Promise<number>;
  /** Rows the plugin's transaction left behind. */
  rowsLeft(): Promise<number>;
}

/** Write, wait `ms`, note the moment and throw. */
async function writeWaitThrow(
  write: () => Promise<unknown>,
  ms: number,
  threw: (at: number) => void
): Promise<never> {
  await write();
  await sleep(ms);
  threw(Date.now());
  throw new Error("provider failed");
}

/** The typed `ctx.db`, writing to the plugin's own table. */
function typedTx(ctx: PluginContext): PluginTx {
  return {
    async rollBackAfter(ms) {
      let threwAt = 0;
      await ctx.db
        .transaction(tx =>
          writeWaitThrow(
            () => tx.insert(marks, { key: "k" }),
            ms,
            at => (threwAt = at)
          )
        )
        .catch(() => undefined);
      return threwAt;
    },
    rowsLeft: async () => (await ctx.db.select(marks).all()).length,
  };
}

/** `ctx.db.raw`, writing to a core table through the builder. */
function rawTx(ctx: PluginContext, db: Db): PluginTx {
  return {
    async rollBackAfter(ms) {
      let threwAt = 0;
      await ctx.db.raw
        .transaction(tx =>
          writeWaitThrow(
            () =>
              tx.insert(nextlyPluginSettings).values({
                owner: "@test/long-tx",
                key: "k",
                value: '"v"',
                isSecret: false,
                updatedAt: new Date(),
                updatedBy: null,
              }),
            ms,
            at => (threwAt = at)
          )
        )
        .catch(() => undefined);
      return threwAt;
    },
    async rowsLeft() {
      const rows = await db
        .select()
        .from(nextlyPluginSettings)
        .where(eq(nextlyPluginSettings.owner, "@test/long-tx"));
      return rows.length;
    },
  };
}

/** Both handles: the rule holds for each. */
const SURFACES = [
  ["the typed ctx.db", "typed"],
  ["ctx.db.raw", "raw"],
] as const;
type SurfaceName = (typeof SURFACES)[number][1];

async function boot(surface: SurfaceName): Promise<{
  t: TestNextly;
  pluginDb: PluginTx;
  userId: string;
  db: Db;
}> {
  let pluginCtx: PluginContext | undefined;
  const plugin = definePlugin({
    name: "@test/long-tx",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { schema: { prefix: "lt", tables: [marks] } },
    init(ctx) {
      pluginCtx = ctx;
    },
  });
  current = await createTestNextly({ plugins: [plugin] });
  for (const statement of generateSqliteCoreTableStatements()) {
    await current.adapter.executeQuery(statement);
  }
  if (!pluginCtx) throw new Error("the plugin's init did not run");
  const created = await new ServiceContainer(
    current.adapter
  ).users.createLocalUser({
    email: EMAIL,
    name: "Window",
    password: PASSWORD,
    isActive: true,
    emailVerification: "admin-vouched",
  });
  const db = current.adapter.getDrizzle() as unknown as Db;
  return {
    t: current,
    pluginDb: surface === "typed" ? typedTx(pluginCtx) : rawTx(pluginCtx, db),
    userId: String(created.id),
    db,
  };
}

/** Run `write` during a plugin transaction; when it resolved, and when the transaction threw. */
async function duringPluginTransaction(
  pluginDb: PluginTx,
  ms: number,
  write: () => Promise<unknown>
): Promise<{ writeResolvedAt: number; threwAt: number }> {
  const plugin = pluginDb.rollBackAfter(ms);
  await sleep(25);
  await write();
  const writeResolvedAt = Date.now();
  return { writeResolvedAt, threwAt: await plugin };
}

async function refreshHashes(db: Db, userId: string): Promise<string[]> {
  const { refreshTokens } = getDialectTables();
  const rows = await db
    .select({ hash: refreshTokens.tokenHash })
    .from(refreshTokens)
    .where(eq(refreshTokens.userId, userId));
  return rows.map(r => String(r.hash)).sort();
}

async function storeRefreshRow(db: Db, userId: string, raw: string) {
  await db.insert(getDialectTables().refreshTokens).values({
    id: `rt-${raw}`,
    userId,
    tokenHash: hashRefreshToken(raw),
    userAgent: null,
    ipAddress: null,
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });
}

async function attemptState(db: Db, userId: string) {
  const { users } = getDialectTables();
  const [row] = await db
    .select({
      attempts: users.failedLoginAttempts,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row;
}

describe.each(SURFACES)(
  "security writes during another request's plugin transaction through %s (sqlite)",
  (_, surface) => {
    it("a sign-out's refresh-row delete survives the plugin's rollback", async () => {
      const { t, pluginDb, userId, db } = await boot(surface);
      await storeRefreshRow(db, userId, "signed-out");
      await storeRefreshRow(db, userId, "other-device");
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );

      const { writeResolvedAt, threwAt } = await duringPluginTransaction(
        pluginDb,
        150,
        async () => {
          const res = await handleLogout(
            new Request("http://localhost:3000/admin/api/auth/logout", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Origin: "http://localhost:3000",
                cookie: "nextly_csrf=tok; nextly_refresh=signed-out",
              },
              body: JSON.stringify({ csrfToken: "tok" }),
            }),
            deps
          );
          expect(res.status).toBe(200);
        }
      );

      expect(await pluginDb.rowsLeft()).toBe(0);
      expect(await refreshHashes(db, userId)).toEqual([
        hashRefreshToken("other-device"),
      ]);
      expect(writeResolvedAt).toBeGreaterThanOrEqual(threwAt);
    });

    it("a theft response's revocations survive the plugin's rollback", async () => {
      const { t, pluginDb, userId, db } = await boot(surface);
      await storeRefreshRow(db, userId, "presented");
      await storeRefreshRow(db, userId, "sibling");
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );

      // The two deletes the refresh handler makes on a hard binding mismatch.
      const { writeResolvedAt, threwAt } = await duringPluginTransaction(
        pluginDb,
        150,
        async () => {
          await deps.deleteRefreshToken("rt-presented");
          await deps.deleteAllRefreshTokensForUser(userId);
        }
      );

      expect(await pluginDb.rowsLeft()).toBe(0);
      expect(await refreshHashes(db, userId)).toEqual([]);
      expect(writeResolvedAt).toBeGreaterThanOrEqual(threwAt);
    });

    it("a wrong password's failed-attempt count survives the plugin's rollback", async () => {
      const { t, pluginDb, userId, db } = await boot(surface);
      const credentials = passwordCredentialDeps(() => t.adapter);

      // Long enough to cover the password hash comparison before the write.
      const { writeResolvedAt, threwAt } = await duringPluginTransaction(
        pluginDb,
        1500,
        () =>
          verifyCredentials(
            { email: EMAIL, password: "wrong-password" },
            credentials
          ).catch(() => undefined)
      );

      expect(await pluginDb.rowsLeft()).toBe(0);
      expect((await attemptState(db, userId)).attempts).toBe(1);
      expect(writeResolvedAt).toBeGreaterThanOrEqual(threwAt);
    });

    it("a lockout survives the plugin's rollback", async () => {
      const { t, pluginDb, userId, db } = await boot(surface);
      const credentials = passwordCredentialDeps(() => t.adapter);
      const { users } = getDialectTables();
      await db
        .update(users)
        .set({ failedLoginAttempts: credentials.maxLoginAttempts - 1 })
        .where(eq(users.id, userId));

      const { writeResolvedAt, threwAt } = await duringPluginTransaction(
        pluginDb,
        1500,
        () =>
          verifyCredentials(
            { email: EMAIL, password: "wrong-password" },
            credentials
          ).catch(() => undefined)
      );

      expect(await pluginDb.rowsLeft()).toBe(0);
      expect((await attemptState(db, userId)).lockedUntil).not.toBeNull();
      expect(writeResolvedAt).toBeGreaterThanOrEqual(threwAt);
    });
  }
);

describe.each(SURFACES)(
  "access and audit writes during another request's plugin transaction through %s (sqlite)",
  (_, surface) => {
    it("a role removal survives the plugin's rollback", async () => {
      const { t, pluginDb, userId, db } = await boot(surface);
      const services = new ServiceContainer(t.adapter);
      const { id: roleId } = await services.roles.ensureSuperAdminRole();
      if (!(await services.userRoles.listUserRoles(userId)).includes(roleId)) {
        await services.userRoles.assignRoleToUser(userId, roleId);
      }

      const { writeResolvedAt, threwAt } = await duringPluginTransaction(
        pluginDb,
        150,
        async () => {
          const result = await services.userRoles.unassignRoleFromUser(
            userId,
            roleId
          );
          expect(result.success).toBe(true);
        }
      );

      expect(await pluginDb.rowsLeft()).toBe(0);
      expect(await services.userRoles.listUserRoles(userId)).not.toContain(
        roleId
      );
      expect(writeResolvedAt).toBeGreaterThanOrEqual(threwAt);
    });

    it("a role assignment survives the plugin's rollback", async () => {
      const { t, pluginDb, userId, db } = await boot(surface);
      const services = new ServiceContainer(t.adapter);
      const { id: roleId } = await services.roles.ensureSuperAdminRole();
      if ((await services.userRoles.listUserRoles(userId)).includes(roleId)) {
        await services.userRoles.unassignRoleFromUser(userId, roleId);
      }

      const { writeResolvedAt, threwAt } = await duringPluginTransaction(
        pluginDb,
        150,
        async () => {
          const result = await services.userRoles.assignRoleToUser(
            userId,
            roleId
          );
          expect(result.success).toBe(true);
        }
      );

      expect(await pluginDb.rowsLeft()).toBe(0);
      expect(await services.userRoles.listUserRoles(userId)).toContain(roleId);
      expect(writeResolvedAt).toBeGreaterThanOrEqual(threwAt);
    });

    it("an update replacing a user's roles survives the plugin's rollback", async () => {
      const { t, pluginDb, userId, db } = await boot(surface);
      const services = new ServiceContainer(t.adapter);
      const { id: superId } = await services.roles.ensureSuperAdminRole();
      if (!(await services.userRoles.listUserRoles(userId)).includes(superId)) {
        await services.userRoles.assignRoleToUser(userId, superId);
      }
      const editorId = "role-editor-window";
      await db.insert(getDialectTables().roles).values({
        id: editorId,
        name: "Editor",
        slug: "editor-window",
        description: null,
        level: 1,
        isSystem: false,
      });

      const { writeResolvedAt, threwAt } = await duringPluginTransaction(
        pluginDb,
        150,
        () => services.users.updateUser(userId, { roles: [editorId] })
      );

      expect(await pluginDb.rowsLeft()).toBe(0);
      expect(await services.userRoles.listUserRoles(userId)).toEqual([
        editorId,
      ]);
      expect(writeResolvedAt).toBeGreaterThanOrEqual(threwAt);
    });

    it("an update to a user's fields survives the plugin's rollback", async () => {
      const { t, pluginDb, userId, db } = await boot(surface);
      const services = new ServiceContainer(t.adapter);

      const { writeResolvedAt, threwAt } = await duringPluginTransaction(
        pluginDb,
        150,
        () =>
          services.users.updateUser(userId, {
            email: "moved@example.com",
            emailVerified: null,
          })
      );

      const { users } = getDialectTables();
      const [row] = await db
        .select({ email: users.email, emailVerified: users.emailVerified })
        .from(users)
        .where(eq(users.id, userId));
      expect(await pluginDb.rowsLeft()).toBe(0);
      expect(row).toEqual({ email: "moved@example.com", emailVerified: null });
      expect(writeResolvedAt).toBeGreaterThanOrEqual(threwAt);
    });

    it("an API key revocation survives the plugin's rollback", async () => {
      const { t, pluginDb, userId, db } = await boot(surface);
      const keys = new ApiKeyService(t.adapter as never, consoleLogger);
      const { meta } = await keys.createApiKey(userId, {
        name: "k",
        tokenType: "full-access",
        expiresIn: "unlimited",
      });

      const { writeResolvedAt, threwAt } = await duringPluginTransaction(
        pluginDb,
        150,
        () => keys.revokeApiKey(meta.id, userId)
      );

      expect(await pluginDb.rowsLeft()).toBe(0);
      expect((await keys.getApiKeyById(meta.id, userId))?.isActive).toBe(false);
      expect(writeResolvedAt).toBeGreaterThanOrEqual(threwAt);
    });

    it("an audit entry survives the plugin's rollback", async () => {
      const { t, pluginDb, userId, db } = await boot(surface);
      const writer = buildAuditLogWriter(
        t.getService as unknown as (name: string) => unknown
      );

      const { writeResolvedAt, threwAt } = await duringPluginTransaction(
        pluginDb,
        150,
        () => writer.write({ kind: "login-failed", targetUserId: userId })
      );

      const { auditLog } = getDialectTables() as unknown as {
        auditLog: { targetUserId: unknown; kind: unknown };
      };
      const rows = await db
        .select({ kind: auditLog.kind })
        .from(auditLog)
        .where(eq(auditLog.targetUserId as never, userId));
      expect(await pluginDb.rowsLeft()).toBe(0);
      expect(rows.map(row => row.kind)).toEqual(["login-failed"]);
      expect(writeResolvedAt).toBeGreaterThanOrEqual(threwAt);
    });
  }
);
