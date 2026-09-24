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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { getDialectTables } from "../../database/index";
import type { NextlyServiceConfig } from "../../di/register";
import {
  buildAuditLogWriter,
  isStrategyName,
} from "../../domains/audit/audit-log-writer";
import { NextlyError } from "../../errors";
import { getHookRegistry } from "../../hooks/hook-registry";
import { env } from "../../lib/env";
import type { RateLimitStore } from "../../middleware/rate-limit";
import {
  createPluginContext,
  type PluginContext,
} from "../../plugins/plugin-context";
import type { AuthUser } from "../../types/auth";
import { readProxyTrustSettings } from "../../utils/proxy-trust";
import { verifyCredentials } from "../credentials/verify-credentials";
import { ChallengeRegistry } from "../pipeline/challenge";
import { AuthHookRegistry } from "../pipeline/hooks";
import { createPasswordStrategy } from "../pipeline/password-strategy";
import type { AuthHooks, ChallengeDefinition } from "../pipeline/types";

import { aggregateAuthUi } from "./auth-ui";
import type { AuthRouterDeps } from "./router";

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
  const base: Omit<
    AuthRouterDeps,
    | "authStrategies"
    | "authHooks"
    | "challengeRegistry"
    | "pluginCtx"
    | "challengeTokenTTL"
    | "maxChallengeAttempts"
    | "authUi"
  > = {
    secret: env.NEXTLY_SECRET || "",
    isProduction: env.NODE_ENV === "production",
    accessTokenTTL: 900, // 15 minutes
    refreshTokenTTL: 7 * 24 * 60 * 60, // 7 days
    maxLoginAttempts: 5,
    lockoutDurationSeconds: 15 * 60, // 15 minutes
    loginStallTimeMs: 500,
    requireEmailVerification: true,
    // Spec §13.2: read the host-app's auth.revealRegistrationConflict flag
    // from the registered NextlyConfig. Defaults to false (silent-success on
    // email conflict) when config is not yet initialised or the flag is
    // unset. The schema is already populated by sanitizeConfig.
    revealRegistrationConflict: readRevealRegistrationConflict(getService),
    devAutoLogin: readDevAutoLogin(getService),
    allowedOrigins: env.NEXTLY_ALLOWED_ORIGINS_PARSED || [],
    ...readProxyTrustSettings(() => getService("config")),
    authRateLimit: readAuthRateLimit(getService),
    auditLog: buildAuditLogWriter(getService),

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
      // Errors propagate intentionally. The refresh handler relies on this
      // lookup to decide whether to rotate or `clearAndDeny`; a swallowed
      // DB error returning `null` was indistinguishable from "user
      // genuinely missing" and tore down the session on every transient
      // hiccup. The refresh handler now wraps the lookup and surfaces
      // failures as a 503 envelope without clearing cookies.
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
    },

    fetchAccountState: async (userId: string) => {
      // Errors propagate, like findUserById above: a swallowed DB error
      // returning null would be read as "account unusable" and tear down a
      // healthy session on a transient hiccup.
      const adapter = getService("adapter");
      const db = adapter.getDrizzle();
      const schema = getDialectTables();
      const { eq } = await import("drizzle-orm");
      const result = await db
        .select({
          userId: schema.users.id,
          isActive: schema.users.isActive,
          lockedUntil: schema.users.lockedUntil,
          emailVerified: schema.users.emailVerified,
          mustChangePassword: schema.users.mustChangePassword,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      return result[0] || null;
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
        const { container } = await import("../../di/container");
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
      // Errors propagate intentionally. The user count gates two
      // security-relevant decisions (setup-status reporting and the
      // first-admin pre-check); collapsing an unknown count to 0 would
      // both lie about setup state and risk a duplicate super-admin.
      // Callers convert failures to a 503 envelope.
      const adapter = getService("adapter");
      const db = adapter.getDrizzle();
      const schema = getDialectTables();
      const { count } = await import("drizzle-orm");
      const result = await db.select({ count: count() }).from(schema.users);
      return Number(result[0]?.count || 0);
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
      const authService = getService("authService");
      const user = await authService.registerUser(data);
      return { id: user.id, email: user.email, name: user.name };
    },

    generatePasswordResetToken: async (email, redirectPath) => {
      const authService = getService("authService");
      const result = await authService.generatePasswordResetToken(email, {
        redirectPath,
      });
      return { token: result.token };
    },

    resetPasswordWithToken: async (token, newPassword) => {
      const authService = getService("authService");
      const result = await authService.resetPasswordWithToken(
        token,
        newPassword
      );
      return { email: result.email };
    },

    acceptInvite: async (token, newPassword) => {
      const authService = getService("authService");
      return await authService.acceptInvite(token, newPassword);
    },

    setInitialPassword: async (userId, newPassword) => {
      const authService = getService("authService");
      return await authService.setInitialPassword(userId, newPassword);
    },

    changePassword: async (userId, currentPassword, newPassword) => {
      const authService = getService("authService");
      try {
        await authService.changePassword(userId, currentPassword, newPassword);
        return { success: true };
      } catch (err) {
        // Spec section 13.8 public-surface safety: only NextlyError.publicMessage
        // is vetted; fall back to a generic string for anything else.
        return {
          success: false,
          error: NextlyError.is(err)
            ? err.publicMessage
            : "Failed to change password",
        };
      }
    },

    verifyEmail: async token => {
      const authService = getService("authService");
      try {
        const result = await authService.verifyEmail(token);
        return {
          success: true,
          email: result.email,
        };
      } catch (err) {
        // Spec section 13.8 public-surface safety: only NextlyError.publicMessage
        // is vetted; fall back to a generic string for anything else.
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

  // ── Auth extensibility pipeline (D71) ──────────────────────────────────
  // Built-in `password` strategy: wraps verifyCredentials with base's lockout
  // deps so the legacy login behavior is preserved exactly (zero-regression).
  const passwordStrategy = createPasswordStrategy({
    verify: async ({ email, password }) => {
      const u = await verifyCredentials(
        { email, password },
        {
          findUserByEmail: base.findUserByEmail,
          incrementFailedAttempts: base.incrementFailedAttempts,
          lockAccount: base.lockAccount,
          resetFailedAttempts: base.resetFailedAttempts,
          maxLoginAttempts: base.maxLoginAttempts,
          lockoutDurationSeconds: base.lockoutDurationSeconds,
          requireEmailVerification: base.requireEmailVerification,
        }
      );
      return {
        id: u.id as AuthUser["id"],
        email: u.email,
        name: u.name,
        image: u.image,
        mustChangePassword: u.mustChangePassword,
      };
    },
  });

  // Base plugin-context resolver for the auth pipeline.
  //
  // createPluginContext resolves "db" as the drizzle instance (not a raw DI
  // service), so translate "db" → adapter.getDrizzle() the same way di/register
  // does; everything else delegates to the container. The ADAPTER entry is
  // what lets a plugin's own settings store transact on SQLite.
  const ctxGetService = ((name: string) => {
    if (name === "db") {
      const adapter = getService("adapter") as { getDrizzle: () => unknown };
      return adapter.getDrizzle();
    }
    // Also not a DI service. The container registers the adapter, and the
    // dialect is something it is asked for; a plugin's settings store picks
    // its table metadata and its upsert spelling from this answer, and the
    // restricted database handle it receives carries no dialect to infer one
    // from.
    if (name === "dialect") {
      const adapter = getService("adapter") as {
        getCapabilities: () => { dialect: SupportedDialect };
      };
      return adapter.getCapabilities().dialect;
    }
    if (name === "adapter") {
      // The transaction-capable adapter, reached LAZILY like the handle:
      // the context can be built before the database is connected.
      return getService(name);
    }
    return getService(name);
  }) as Parameters<typeof createPluginContext>[0];
  const pluginCtx = createPluginContext(ctxGetService, getHookRegistry());
  // Collect plugin contributes.auth (hooks + challenges) + app-config
  // strategies.
  //
  // ENABLED plugins only, so the runtime registries and the served auth UI
  // are derived from one set. Registering a disabled plugin's hooks let its
  // `afterAuthenticate` challenge fire on a successful login while the login
  // page — which filters disabled plugins — had no view for it, leaving that
  // login unfinishable until the plugin was removed or enabled.
  const config = readServiceConfig(getService);
  const authHooks = new AuthHookRegistry();
  const challengeRegistry = new ChallengeRegistry();
  for (const plugin of (config?.plugins ?? []).filter(
    p => p.enabled !== false
  )) {
    const authContrib = plugin.contributes?.auth;
    if (!authContrib) continue;
    // Each contribution receives the OWNING plugin's context, not the
    // system one: a hook that reads its plugin's settings, fetches through
    // its declared hosts, or audits under its prefix needs exactly the
    // surfaces every other lifecycle method of that plugin gets — a TOTP
    // hook reading its encrypted secret from ctx.settings threw on a
    // context whose `self` was empty and whose settings were absent.
    const ownCtx = createPluginContext(
      ctxGetService,
      getHookRegistry(),
      plugin
    );
    if (authContrib.hooks) {
      authHooks.add(bindHooksToContext(authContrib.hooks, ownCtx));
    }
    for (const def of authContrib.challenges ?? []) {
      challengeRegistry.add(bindChallengeToContext(def, ownCtx));
    }
  }
  const configStrategies = config?.auth?.strategies ?? [];
  assertConfiguredStrategyNames(configStrategies);

  return {
    ...base,
    authStrategies: [...configStrategies, passwordStrategy],
    authHooks,
    challengeRegistry,
    pluginCtx,
    challengeTokenTTL: 300,
    maxChallengeAttempts: 5,
    authUi: aggregateAuthUi(config?.plugins ?? []),
  };
}

/**
 * Refuse an app-configured strategy whose name the audit trail cannot carry.
 *
 * The same rule `completeLogin` enforces on a plugin's own strategy, applied
 * at boot to the config's. The rule is not stylistic: the audit writer admits
 * a strategy to a row only when the name matches it, so a name with an
 * uppercase letter or a dot authenticated normally while being silently
 * omitted from every success row — the attribution this field exists to
 * carry, missing on exactly the installs that configured a custom strategy.
 * Failing the boot names the strategy and the rule where the operator is
 * still reading configuration, rather than leaving a working login with no
 * trail.
 */
export function assertConfiguredStrategyNames(
  strategies: readonly { name: string }[]
): void {
  for (const strategy of strategies) {
    if (!isStrategyName(strategy.name)) {
      throw NextlyError.internal({
        logContext: {
          reason: "auth-strategy-name-invalid",
          strategy: strategy.name,
          rule: "lowercase letters, digits, :, _ or -; starts with a letter or digit; at most 64 characters",
        },
      });
    }
  }
}

/** Read the sanitized NextlyServiceConfig from the DI container, if present. */
function readServiceConfig(
  getService: (name: string) => unknown
): NextlyServiceConfig | undefined {
  try {
    return (getService("config") as NextlyServiceConfig) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read `auth.revealRegistrationConflict` from the NextlyConfig registered in
 * the DI container. Returns the spec default (false) when the container is
 * not yet initialised or the flag is unset.
 */
function readRevealRegistrationConflict(
  getService: (name: string) => unknown
): boolean {
  try {
    const config = getService("config");
    if (config && typeof config === "object" && "auth" in config) {
      const auth = (config as { auth?: unknown }).auth;
      if (
        auth &&
        typeof auth === "object" &&
        "revealRegistrationConflict" in auth
      ) {
        return (
          (auth as { revealRegistrationConflict?: unknown })
            .revealRegistrationConflict === true
        );
      }
    }
    return false;
  } catch {
    // DI container not initialised yet — fall back to the safe default.
    return false;
  }
}

/**
 * Read `admin.devAutoLogin` from the NextlyConfig registered in the DI
 * container. Returns `false` when the container isn't initialised, the
 * field is unset, or the field's shape is invalid. The runtime check in
 * the session handler still gates this on NODE_ENV !== "production" - this
 * function only resolves what the host configured.
 */
function readDevAutoLogin(
  getService: (name: string) => unknown
): false | { email: string; password?: string } {
  try {
    const config = getService("config");
    if (config && typeof config === "object" && "admin" in config) {
      const admin = (config as { admin?: unknown }).admin;
      if (admin && typeof admin === "object" && "devAutoLogin" in admin) {
        const dal = (admin as { devAutoLogin?: unknown }).devAutoLogin;
        if (
          dal &&
          typeof dal === "object" &&
          "email" in dal &&
          typeof (dal as { email?: unknown }).email === "string"
        ) {
          const typed = dal as { email: string; password?: string };
          return {
            email: typed.email,
            password: typed.password,
          };
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Read `security.authRateLimit` from the NextlyConfig registered in the
 * DI container. Falls back to the default 30 req/IP/hour, 1-hour window
 * when unset or the container is not yet initialised.
 */
/**
 * A nested object off the DI config, or `undefined` when it is not there.
 *
 * The config service is `unknown` at this boundary — the bridge deliberately
 * does not import its type — so every read is a shape check. Doing that once
 * here rather than inline at each level is what keeps the reader below flat:
 * the same three checks repeated per level is where this function's complexity
 * came from, not the number of values it reads.
 */
function configBlock(
  source: unknown,
  key: string
): Record<string, unknown> | undefined {
  if (source === null || typeof source !== "object" || !(key in source)) {
    return undefined;
  }
  const value = (source as Record<string, unknown>)[key];
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A configured number, or the fallback when it is absent or the wrong type. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

/**
 * The configured per-IP auth limit.
 *
 * Exported so a plugin route opting into `rateLimit: "auth"` uses the same
 * limit and window as core's, rather than a second set of numbers that can
 * drift from it.
 */
export function readAuthRateLimit(getService: (name: string) => unknown): {
  requestsPerHour: number;
  windowMs: number;
  store?: RateLimitStore;
} {
  const fallback = { requestsPerHour: 30, windowMs: 3_600_000 };
  try {
    const config = getService("config");

    // The limits and the store come from DIFFERENT blocks: the numbers are
    // security config, the window's home is rate-limit config, and one app has
    // one store. Read independently so a deployment that configures a store but
    // leaves the auth limits at their defaults still gets a shared window — the
    // case that would otherwise look configured and behave per-process.
    const store = configBlock(config, "rateLimit")?.["store"] as
      | RateLimitStore
      | undefined;
    const limits = configBlock(
      configBlock(config, "security"),
      "authRateLimit"
    );

    return {
      requestsPerHour: numberOr(
        limits?.["requestsPerHour"],
        fallback.requestsPerHour
      ),
      windowMs: numberOr(limits?.["windowMs"], fallback.windowMs),
      ...(store === undefined ? {} : { store }),
    };
  } catch {
    return fallback;
  }
}

/**
 * Bind every phase of a plugin's auth hooks to that plugin's context.
 *
 * The registries pass ONE context to whatever they invoke; the owning
 * plugin's is the only correct one — `ctx.settings`, `ctx.fetch`,
 * `ctx.audit` and `ctx.self` are per-plugin surfaces, and a hook reading
 * its own encrypted settings through a system context threw on a `self`
 * that was empty. Wrapping at registration keeps the registries and the
 * AuthHooks contract untouched.
 */
export function bindHooksToContext(
  hooks: AuthHooks,
  ctx: PluginContext
): AuthHooks {
  const bound: Record<string, unknown> = {};
  for (const [phase, fn] of Object.entries(hooks)) {
    if (typeof fn !== "function") continue;
    void phase;
    // Every phase takes its arguments and receives the context LAST; the
    // wrapper swaps whatever context the registry passes for the owning
    // plugin's, so phases and contract stay untouched.
    bound[phase] = (...args: unknown[]) =>
      (fn as (...a: unknown[]) => unknown)(...args.slice(0, -1), ctx);
  }
  return bound;
}

/** Bind a plugin's challenge definition to that plugin's context. */
export function bindChallengeToContext(
  def: ChallengeDefinition,
  ctx: PluginContext
): ChallengeDefinition {
  return {
    id: def.id,
    resolve: (args, _ctx) => def.resolve(args, ctx),
  };
}
