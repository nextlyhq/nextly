/**
 * Dependency bridge: maps Nextly DI container services to AuthRouterDeps.
 *
 * This bridge connects our new auth handlers (which expect an explicit deps interface)
 * with the existing service layer (registered in the DI container). It provides the
 * database operations needed for login, refresh tokens, and brute-force protection.
 *
 * For operations that already exist on AuthService (register, password reset, etc.),
 * we delegate directly. For new operations (refresh tokens, brute-force tracking),
 * we use the database adapter directly.
 */
import { getDialectTables } from "../../database/index.js";
import { NextlyError } from "../../errors";
import { env } from "../../lib/env";

import type { AuthRouterDeps } from "./router.js";

/**
 * Build AuthRouterDeps from the DI container services.
 * Call this after services are initialized (ensureServicesInitialized).
 *
 * @param getService - The DI container's getService function
 */
export function buildAuthRouterDeps(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getService: (name: string) => any
): AuthRouterDeps {
  return {
    secret: env.NEXTLY_SECRET_RESOLVED || "",
    isProduction: env.NODE_ENV === "production",
    accessTokenTTL: 900, // 15 minutes (TODO: read from defineConfig({ auth }) when implemented)
    refreshTokenTTL: 7 * 24 * 60 * 60, // 7 days
    maxLoginAttempts: 5,
    lockoutDurationSeconds: 15 * 60, // 15 minutes
    loginStallTimeMs: 500,
    requireEmailVerification: true,
    allowedOrigins: env.NEXTLY_ALLOWED_ORIGINS_PARSED || [],

    findUserByEmail: async (email: string) => {
      try {
        const adapter = getService("adapter");
        const db = adapter.getDrizzle();
        const schema = getDialectTables();
        const { eq } = await import("drizzle-orm");
        const result = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email.trim().toLowerCase()))
          .limit(1);
        return result[0] || null;
      } catch {
        return null;
      }
    },

    findUserById: async (userId: string) => {
      try {
        const adapter = getService("adapter");
        const db = adapter.getDrizzle();
        const schema = getDialectTables();
        const { eq } = await import("drizzle-orm");
        const result = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .limit(1);
        return result[0] || null;
      } catch {
        return null;
      }
    },

    incrementFailedAttempts: async (userId: string) => {
      const adapter = getService("adapter");
      const db = adapter.getDrizzle();
      const schema = getDialectTables();
      const { eq, sql } = await import("drizzle-orm");
      await db
        .update(schema.users)
        .set({
          failedLoginAttempts: sql`${schema.users.failedLoginAttempts} + 1`,
        })
        .where(eq(schema.users.id, userId));
    },

    lockAccount: async (userId: string, lockedUntil: Date) => {
      const adapter = getService("adapter");
      const db = adapter.getDrizzle();
      const schema = getDialectTables();
      const { eq } = await import("drizzle-orm");
      await db
        .update(schema.users)
        .set({ lockedUntil, failedLoginAttempts: 0 })
        .where(eq(schema.users.id, userId));
    },

    resetFailedAttempts: async (userId: string) => {
      const adapter = getService("adapter");
      const db = adapter.getDrizzle();
      const schema = getDialectTables();
      const { eq } = await import("drizzle-orm");
      await db
        .update(schema.users)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(schema.users.id, userId));
    },

    fetchRoleIds: async (userId: string) => {
      try {
        const adapter = getService("adapter");
        const db = adapter.getDrizzle();
        const schema = getDialectTables();
        const { eq, isNull, or, gt } = await import("drizzle-orm");
        const rows = await db
          .select({ roleId: schema.userRoles.roleId })
          .from(schema.userRoles)
          .where(
            eq(schema.userRoles.userId, userId),
            // Only non-expired roles
            or(
              isNull(schema.userRoles.expiresAt),
              gt(schema.userRoles.expiresAt, new Date())
            )
          );
        return rows.map((r: { roleId: string }) => r.roleId);
      } catch {
        return [];
      }
    },

    fetchCustomFields: async (userId: string) => {
      try {
        // user_ext is a dynamic table created at runtime when custom user
        // fields are configured via defineConfig({ users: { fields: [...] } }).
        // We use the same approach as the old Auth.js JWT callback:
        // generate the Drizzle table schema at runtime and query with it.
        const { container } = await import("../../di/container.js");
        if (
          !container.has("config") ||
          !container.has("userExtSchemaService")
        ) {
          return {};
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const config = container.get<any>("config");
        const userFields = config?.users?.fields;
        if (!userFields?.length) return {};

        const userExtSchemaService = getService("userExtSchemaService");
        if (!userExtSchemaService?.hasMergedFields()) return {};

        const extTable = userExtSchemaService.generateRuntimeSchema(userFields);
        const { eq } = await import("drizzle-orm");
        const adapter = getService("adapter");

        const db = adapter.getDrizzle();

        const rows = (await db
          .select()
          .from(extTable)

          .where(eq(extTable.user_id, userId))
          .limit(1)) as Record<string, unknown>[];

        if (!rows[0]) return {};

        // Remove internal fields (id, user_id), return only custom fields
        const { id: _id, user_id: _uid, ...customFields } = rows[0];
        return customFields;
      } catch {
        return {};
      }
    },

    storeRefreshToken: async record => {
      const adapter = getService("adapter");
      const db = adapter.getDrizzle();
      const schema = getDialectTables();
      await db.insert(schema.refreshTokens).values(record);
    },

    findRefreshTokenByHash: async (tokenHash: string) => {
      const adapter = getService("adapter");
      const db = adapter.getDrizzle();
      const schema = getDialectTables();
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, tokenHash))
        .limit(1);
      return rows[0] || null;
    },

    deleteRefreshToken: async (id: string) => {
      const adapter = getService("adapter");
      const db = adapter.getDrizzle();
      const schema = getDialectTables();
      const { eq } = await import("drizzle-orm");
      await db
        .delete(schema.refreshTokens)
        .where(eq(schema.refreshTokens.id, id));
    },

    deleteRefreshTokenByHash: async (tokenHash: string) => {
      const adapter = getService("adapter");
      const db = adapter.getDrizzle();
      const schema = getDialectTables();
      const { eq } = await import("drizzle-orm");
      await db
        .delete(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, tokenHash));
    },

    deleteAllRefreshTokensForUser: async (userId: string) => {
      const adapter = getService("adapter");
      const db = adapter.getDrizzle();
      const schema = getDialectTables();
      const { eq } = await import("drizzle-orm");
      await db
        .delete(schema.refreshTokens)
        .where(eq(schema.refreshTokens.userId, userId));
    },

    getUserCount: async () => {
      try {
        const adapter = getService("adapter");
        const db = adapter.getDrizzle();
        const schema = getDialectTables();
        const { count } = await import("drizzle-orm");
        const result = await db.select({ count: count() }).from(schema.users);
        return Number(result[0]?.count || 0);
      } catch {
        return 0;
      }
    },

    createSuperAdmin: async data => {
      const { seedPermissions } = await import(
        "../../database/seeders/permissions"
      );
      const { seedSuperAdmin } = await import(
        "../../database/seeders/super-admin"
      );
      const adapter = getService("adapter");

      // Seed permissions first (seedSuperAdmin needs them to assign to the admin)
      await seedPermissions(adapter, { silent: true });

      // seedSuperAdmin handles password hashing internally
      const result = await seedSuperAdmin(adapter, {
        email: data.email,
        password: data.password,
        name: data.name,
        silent: true,
      });

      if (!result.success) {
        throw new Error(
          result.errorMessages?.[0] || "Failed to create admin account"
        );
      }

      const db = adapter.getDrizzle();
      const schema = getDialectTables();
      const { eq } = await import("drizzle-orm");
      const users = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, data.email.trim().toLowerCase()))
        .limit(1);

      return {
        id: users[0]?.id || "",
        email: data.email,
        name: data.name,
      };
    },

    seedPermissions: async () => {
      const { seedPermissions } = await import(
        "../../database/seeders/permissions"
      );
      const adapter = getService("adapter");
      await seedPermissions(adapter, { silent: true });
    },

    registerUser: async data => {
      // PR 4 (unified-error-system): authService.registerUser now returns
      // the created user directly and throws NextlyError on failure.
      // Adapt to the bridge's `{ success, error?, user? }` contract by
      // catching errors and surfacing the public message.
      const authService = getService("authService");
      try {
        const user = await authService.registerUser(data);
        return {
          success: true,
          user: user
            ? {
                id: user.id,
                email: user.email,
                name: user.name,
              }
            : undefined,
        };
      } catch (err) {
        // Public-surface safety: only NextlyError carries a vetted §13.8
        // public message. For anything else (assertion bugs, third-party
        // SDK errors that escaped the service layer) fall back to a generic
        // string so raw driver / stack text never reaches the wire.
        return {
          success: false,
          error: NextlyError.is(err)
            ? err.publicMessage
            : "Failed to register user",
        };
      }
    },

    generatePasswordResetToken: async (email, redirectPath) => {
      const authService = getService("authService");
      const result = await authService.generatePasswordResetToken(email, {
        redirectPath,
      });
      return { success: true, token: result.token };
    },

    resetPasswordWithToken: async (token, newPassword) => {
      // PR 4: resetPasswordWithToken returns `{ email }` and throws
      // NextlyError on invalid/expired tokens. Translate to the bridge
      // contract by catching the error.
      const authService = getService("authService");
      try {
        const result = await authService.resetPasswordWithToken(
          token,
          newPassword
        );
        return {
          success: true,
          email: result.email,
        };
      } catch (err) {
        // §13.8 public-surface safety — only NextlyError.publicMessage is
        // vetted; fall back to a generic string for anything else.
        return {
          success: false,
          error: NextlyError.is(err)
            ? err.publicMessage
            : "Failed to reset password",
        };
      }
    },

    changePassword: async (userId, currentPassword, newPassword) => {
      // PR 4: changePassword returns void and throws NextlyError.
      const authService = getService("authService");
      try {
        await authService.changePassword(userId, currentPassword, newPassword);
        return { success: true };
      } catch (err) {
        // §13.8 public-surface safety — only NextlyError.publicMessage is
        // vetted; fall back to a generic string for anything else.
        return {
          success: false,
          error: NextlyError.is(err)
            ? err.publicMessage
            : "Failed to change password",
        };
      }
    },

    verifyEmail: async token => {
      // PR 4: verifyEmail returns `{ email }` and throws NextlyError.
      const authService = getService("authService");
      try {
        const result = await authService.verifyEmail(token);
        return {
          success: true,
          email: result.email,
        };
      } catch (err) {
        // §13.8 public-surface safety — only NextlyError.publicMessage is
        // vetted; fall back to a generic string for anything else.
        return {
          success: false,
          error: NextlyError.is(err)
            ? err.publicMessage
            : "Failed to verify email",
        };
      }
    },

    resendVerificationEmail: async email => {
      try {
        const authService = getService("authService");
        await authService.generateEmailVerificationToken(email);
        return { success: true };
      } catch {
        // Always return success to prevent enumeration
        return { success: true };
      }
    },
  };
}
