import type { PluginPrincipalsApi } from "@nextlyhq/plugin-sdk";

import { accountsError } from "../errors";

import type {
  AccountsCore,
  OneTimeSecrets,
  OpaqueSecrets,
  PasswordHelper,
  PluginLimiter,
} from "./ports";

/**
 * The methods each helper must carry for the plugin to start. Checked by
 * name, so a core that lends an older or renamed helper refuses the start
 * rather than failing a visitor's sign-in halfway through.
 */
const REQUIRED = {
  passwords: ["hash", "verify", "needsRehash", "check"],
  secrets: [
    "mintToken",
    "mintCode",
    "peekToken",
    "consumeToken",
    "consumeCode",
    "voidFor",
  ],
  opaque: ["create", "hash", "equal"],
  limits: ["reserve", "release", "reset", "check", "clientKey"],
} as const satisfies {
  passwords: readonly (keyof PasswordHelper)[];
  secrets: readonly (keyof OneTimeSecrets)[];
  opaque: readonly (keyof OpaqueSecrets)[];
  limits: readonly (keyof PluginLimiter)[];
};

/**
 * Finds core's helpers on the plugin context: today `ctx.security.passwords`,
 * `ctx.security.secrets`, `ctx.security.opaque` and `ctx.limits`. This is the
 * only place that knows where they hang, so a move changes this function
 * alone.
 *
 * @throws `ACCOUNTS_CORE_MISSING` naming each helper or member the running
 *   core does not lend (in `logContext.missing`)
 */
export function readAccountsCore(context: object): AccountsCore {
  const security = member(context, "security");
  const passwords = member(security, "passwords");
  const secrets = member(security, "secrets");
  const opaque = member(security, "opaque");
  const limits = member(context, "limits");

  // Every helper is checked before any refusal, so the error names all that
  // is missing rather than the first.
  const missing: string[] = [];
  const hasPasswords = lends<PasswordHelper>(
    passwords,
    "security.passwords",
    REQUIRED.passwords,
    missing
  );
  const hasSecrets = lends<OneTimeSecrets>(
    secrets,
    "security.secrets",
    REQUIRED.secrets,
    missing
  );
  const hasOpaque = lends<OpaqueSecrets>(
    opaque,
    "security.opaque",
    REQUIRED.opaque,
    missing
  );
  const hasLimits = lends<PluginLimiter>(
    limits,
    "limits",
    REQUIRED.limits,
    missing
  );
  if (hasPasswords && typeof passwords.ceiling !== "number") {
    missing.push("security.passwords.ceiling");
  }
  if (
    hasLimits &&
    (typeof member(limits.store, "shared") !== "boolean" ||
      typeof member(limits.store, "singleInstance") !== "boolean")
  ) {
    missing.push("limits.store");
  }

  if (
    !hasPasswords ||
    !hasSecrets ||
    !hasOpaque ||
    !hasLimits ||
    missing.length > 0
  ) {
    throw accountsError("ACCOUNTS_CORE_MISSING", { missing });
  }

  return { passwords, secrets, opaque, limits };
}

/**
 * The helpers as core lends them on the plugin context, the inverse of
 * `readAccountsCore`: kept beside it so the two move together. A test hands
 * a context built by this to anything that reads core's helpers.
 */
export function coreOnContext(core: AccountsCore): object {
  return {
    security: {
      passwords: core.passwords,
      secrets: core.secrets,
      opaque: core.opaque,
    },
    limits: core.limits,
  };
}

/**
 * Refuses a production start whose limiter keeps its counts in one
 * instance's memory, unless the site declared it runs one instance. On
 * several instances each would count apart, and every limit the plugin
 * keeps (sign-in waits, code tries, email requests) would multiply by their
 * number.
 *
 * @throws `ACCOUNTS_LIMITS_NOT_SHARED`
 */
export function assertLimitsShared(
  limits: Pick<PluginLimiter, "store">,
  production: boolean
): void {
  if (!production || limits.store.shared || limits.store.singleInstance) return;

  throw accountsError("ACCOUNTS_LIMITS_NOT_SHARED", {
    fix: "Set rateLimit.store to a shared store, or rateLimit.singleInstance to true.",
  });
}

/**
 * Core's record of the plugin's people, where it reports an account
 * deleted: `ctx.principals`, lent to a plugin that contributes a kind.
 *
 * @throws `ACCOUNTS_CORE_MISSING` when the running core does not lend it
 */
export function readAccountPrincipals(
  context: object
): Pick<PluginPrincipalsApi, "reportDeleted"> {
  const principals = member(context, "principals");
  const missing: string[] = [];
  if (
    !lends<Pick<PluginPrincipalsApi, "reportDeleted">>(
      principals,
      "principals",
      ["reportDeleted"],
      missing
    )
  )
    throw accountsError("ACCOUNTS_CORE_MISSING", { missing });

  return principals;
}

/** A member of an object, or undefined for anything that is not one. */
function member(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;

  return (value as Record<string, unknown>)[key];
}

/**
 * Whether a helper carries every method named, adding the path of each one
 * absent (or of the helper itself) to `missing`.
 */
function lends<T>(
  value: unknown,
  path: string,
  methods: readonly (keyof T & string)[],
  missing: string[]
): value is T {
  if (typeof value !== "object" || value === null) {
    missing.push(path);
    return false;
  }
  const absent = methods.filter(
    method => typeof member(value, method) !== "function"
  );
  missing.push(...absent.map(method => `${path}.${method}`));

  return absent.length === 0;
}
