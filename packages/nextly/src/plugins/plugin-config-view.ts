/**
 * What of the application's configuration plugin code is handed.
 *
 * Plugin code meets the configuration twice: a `setup` transformer receives
 * it before services start, and `ctx.config` carries it afterwards. Both are
 * an allowlist of plain settings, derived from the one list below, so a key
 * added to the configuration later stays out of plugins' reach until someone
 * decides it belongs. What is left out is live: the database `adapter`,
 * `storagePlugins` (and the CLI config's `storage`), `imageProcessor`,
 * `logger`, `hookRegistry`, `passwordHasher`, `rateLimit` (whose `store` is a
 * live connection) and `pluginConsent`. Each either reaches past what a
 * plugin's own surfaces grant, the raw-SQL approval above all, or is reached
 * through a surface of its own (`ctx.logger`, `ctx.hooks`).
 *
 * @module plugins/plugin-config-view
 */
import type { NextlyServiceConfig } from "../di/register";

/** The plain settings plugin code may read, in both places it reads them. */
export const PLUGIN_CONFIG_KEYS = [
  "basePath",
  "preview",
  "schemasDir",
  "migrationsDir",
  "runMigrationsOnBoot",
  "plugins",
  "strictPluginTargets",
  "permissions",
  "roles",
  "jobs",
  "collections",
  "singles",
  "fieldGroups",
  "users",
  "email",
  "apiKeys",
  "security",
  "admin",
  "auth",
  "localization",
  "webhookRetention",
  "auditRetention",
  "emailRetention",
  "webhookAuditEnabled",
] as const satisfies readonly (keyof NextlyServiceConfig)[];

/**
 * The keys a `setup` transformer receives and may rewrite: those above, and
 * the settings a transformer configures the schema pipeline with. The app's
 * `db` block is one (its schema hooks are how a transformer extends the
 * schema), handed over as a copy whose `rawSqlPlugins` is frozen; the CLI's
 * config also carries `typescript`.
 */
const SETUP_CONFIG_KEYS: readonly string[] = [
  ...PLUGIN_CONFIG_KEYS,
  "db",
  "typescript",
];

/** `config`'s own values under `keys`, in a new object. */
function pick(
  config: object,
  keys: readonly string[]
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      picked[key] = (config as Record<string, unknown>)[key];
    }
  }
  return picked;
}

/** `config`'s own values under every key except `keys`, in a new object. */
function omit(
  config: object,
  keys: readonly string[]
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...config };
  for (const key of keys) delete rest[key];
  return rest;
}

/**
 * The settings a `setup` transformer receives: the allowlisted keys of
 * `config`, without its live handles. The caller copies them.
 */
export function setupConfigKeysOf(config: object): Record<string, unknown> {
  return pick(config, SETUP_CONFIG_KEYS);
}

/**
 * The config the rest of the boot uses after the transformers: what they
 * returned under the allowlisted keys, and the app's own value for every key
 * they were not handed. A transformer neither received the live handles nor
 * can replace them, and a key it returned outside the allowlist is ignored.
 */
export function withWithheldConfig<C extends object>(
  app: C,
  transformed: object
): C {
  return {
    ...omit(app, SETUP_CONFIG_KEYS),
    ...pick(transformed, SETUP_CONFIG_KEYS),
  } as C;
}
