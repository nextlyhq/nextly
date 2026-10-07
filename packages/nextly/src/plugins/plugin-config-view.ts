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
import type { EmailConfig, EmailSettings } from "../domains/email/types";
import { copyPlainValues } from "../shared/lib/plain-copy";

import type { PluginCapabilities, PluginDefinition } from "./plugin-context";

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

/**
 * @experimental One plugin, as `ctx.config.plugins` lists it: what another
 * plugin may know about it, not its definition. Its code (`init`, hooks,
 * routes, services) is not reachable from here, so no plugin can replace
 * another's. `contributes.declarations` is the channel one plugin addresses
 * to another (`collectDeclarations`), so it is carried. Frozen all the way
 * down.
 */
export interface PluginSummary {
  readonly name: string;
  readonly version: string;
  /** False when the app configured the plugin with `enabled: false`. */
  readonly enabled: boolean;
  /** A copy of what the plugin's manifest declares it may do. */
  readonly capabilities?: Readonly<PluginCapabilities>;
  readonly contributes?: {
    /** A copy of what the plugin declared for other plugins to read. */
    readonly declarations?: Readonly<Record<string, unknown>>;
  };
}

/**
 * @experimental The application's email settings, as `ctx.config.email`
 * carries them: everything except `providerConfig`, which holds the code-first
 * provider's credentials. A plugin sends through `ctx.services.email`.
 */
export type PluginEmailSettings = EmailSettings &
  Pick<Partial<Extract<EmailConfig, { from: string }>>, "from">;

/**
 * @experimental What a plugin reads at `ctx.config`: the application's plain
 * configuration values, as a copy frozen all the way down. Live handles are
 * not part of it; a plugin reaches the database through `ctx.db` and logs
 * through `ctx.logger`. `plugins` lists summaries (`PluginSummary`) rather
 * than definitions, and `email` leaves out the provider's credentials.
 */
export type PluginConfig = Readonly<
  Omit<
    Pick<NextlyServiceConfig, (typeof PLUGIN_CONFIG_KEYS)[number]>,
    "plugins" | "email"
  > & {
    plugins?: readonly PluginSummary[];
    email?: Readonly<PluginEmailSettings>;
  }
>;

/** What `ctx.config.plugins` lists for one plugin. */
function pluginSummary(plugin: PluginDefinition): PluginSummary {
  const declarations = plugin.contributes?.declarations;
  return {
    name: plugin.name,
    version: plugin.version,
    enabled: plugin.enabled !== false,
    ...(plugin.capabilities !== undefined
      ? { capabilities: plugin.capabilities }
      : {}),
    ...(declarations !== undefined ? { contributes: { declarations } } : {}),
  };
}

/**
 * Build `ctx.config` from the service configuration: the allowlisted keys
 * only, copied and frozen all the way down (`copyPlainValues`), so no write
 * through it reaches the configuration core reads, whether to the upload
 * policy under `security`, a collection's `access`, or the plugin list.
 * Functions are kept by reference, and are behaviour the plugin could
 * already call. `plugins` becomes summaries and `email` loses
 * `providerConfig`.
 */
export function pluginConfigView(config: NextlyServiceConfig): PluginConfig {
  const view = pick(config, PLUGIN_CONFIG_KEYS);
  if (config.plugins !== undefined) {
    view.plugins = config.plugins.map(pluginSummary);
  }
  if (config.email !== undefined) {
    const { providerConfig: _credentials, ...settings } = config.email;
    view.email = settings;
  }
  return copyPlainValues(view, { freeze: true });
}
