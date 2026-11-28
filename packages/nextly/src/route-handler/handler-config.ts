/**
 * The route handler's config store: the config the route was created with, and
 * the view of it as boot transformed it.
 *
 * A module of its own, apart from `auth-handler.ts`, so a reader of the stored
 * config (the builder's availability, the list owners, the dashboard's
 * readers) and the boot that publishes its plugin list load this store alone,
 * not the request path's boot and auth router. `auth-handler.ts` re-exports
 * these functions, so its callers see the same store.
 */

import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import { isServicesRegistered } from "../di";
import type { NextlyServiceConfig } from "../di/register";

// Module-level config store, populated by `setHandlerConfig()`.
// This allows `createDynamicHandlers({ config })` to pass the user's
// nextly.config so that plugins and collections are registered on first request.
let _storedConfig: SanitizedNextlyConfig | null = null;

/**
 * The plugin list as boot produced it, or undefined before any boot has run.
 *
 * Held separately from `_storedConfig` rather than folded into it, because the
 * two have independent lifecycles: the route config is re-stored every time the
 * route module is evaluated, while boot transforms the plugin list once per
 * process. Writing the transformed list INTO the stored config would leave
 * whichever write happened to land last as the winner — and both orders occur.
 * A boot through `getNextly()` or instrumentation runs before the route module
 * is imported, and route-module HMR re-stores the raw config without booting
 * again. Either way the raw list would silently replace the booted one.
 *
 * On `globalThis`, and NOT module-local, for the same reason `register.ts`
 * keeps its registration state there: Next.js and Turbopack can evaluate this
 * module in more than one server module graph, so instrumentation's boot may
 * call `setBootedConfig` on one copy while `/admin-meta` reads another. A
 * module-local value is `null` in the reading copy, and the endpoint falls back
 * to disclosing the raw, pre-`setup` list — which is the defect this whole seam
 * exists to remove, reappearing only under a bundler that duplicates modules.
 *
 * `_storedConfig` stays module-local deliberately: it is written by
 * `createDynamicHandlers` in whichever copy the route module imported, and that
 * same copy serves the request, so it has no cross-graph reader.
 */
const globalForBoot = globalThis as unknown as {
  __nextly_bootConfig?: BootedConfigView;
};

/**
 * The blocks of the booted config this store republishes, WHOLE.
 *
 * An earlier version kept entity SLUGS only, reasoning that the permission fold
 * was the sole reader. It is not: `getHandlerConfig()` has several readers, and
 * a reader resolving a table name needs the definition's `dbName` and a
 * relationship's `junctionTable`. Projecting those away made one of them look
 * for a table that never existed.
 *
 * So what is bounded here is WHICH blocks travel, never how much of each. The
 * bound is type compatibility and the compiler checks it: the transformed
 * config is a `NextlyServiceConfig`, whose `auth` is the UNSANITIZED
 * `AuthConfig`, so overlaying that onto a `SanitizedNextlyConfig` would hand
 * readers a shape they are typed against and do not have. Widening this list
 * means checking a field's type across the two, not adding a name to it.
 *
 * These are also the blocks a `setup` transformer meaningfully rewrites: the
 * plugin list, the entities plugins contribute, and the app-level permission
 * declarations that can collide with them.
 */
type BootedConfigView = Pick<
  SanitizedNextlyConfig,
  "plugins" | "collections" | "singles"
> &
  Pick<SanitizedNextlyConfig, "permissions">;

/**
 * `booted`'s explicitly-set keys laid over `base`.
 *
 * Key by key rather than a spread: a present-but-`undefined` key would
 * otherwise delete a field the stored config legitimately holds.
 */
function overlayDefined(
  base: SanitizedNextlyConfig,
  booted: BootedConfigView
): SanitizedNextlyConfig {
  // Every key of `BootedConfigView` is taken, `undefined` included. These four
  // are blocks boot OWNS, so its answer is authoritative in both directions: a
  // transformer that removes the last app-level permission returns
  // `permissions: undefined`, and skipping that would preserve the raw
  // declaration — leaving `/admin-meta` folding against a collision the running
  // config resolved, and degrading to an empty set that hides every seeded
  // plugin permission.
  //
  // Skipping `undefined` was right when this overlaid the WHOLE config, where
  // it protected `typescript`, `db` and `storage` from a transformed value that
  // never carries them. Narrowing the type to what boot owns removed the reason.
  return {
    ...base,
    plugins: booted.plugins,
    collections: booted.collections,
    singles: booted.singles,
    permissions: booted.permissions,
  };
}

/**
 * The merged view, and the exact inputs it was built from.
 *
 * Module-local rather than global, because one of its inputs is: a merge of
 * THIS copy's `_storedConfig` with the shared list. Keyed on the IDENTITY of
 * both inputs rather than cleared by the writers — a write may land in a
 * different module copy than the reader, so an invalidation call cannot be
 * relied on to arrive, while an identity check cannot miss.
 */
let _bootView: SanitizedNextlyConfig | null = null;
let _bootViewInputs: {
  config: SanitizedNextlyConfig;
  booted: BootedConfigView;
} | null = null;

/**
 * The stored config as it BOOTED — the raw route config with boot's plugin list
 * in place of the declared one.
 *
 * Derived at read time, never written back into `_storedConfig`, because the
 * two answer different questions and only one of them is a registration input.
 * `_storedConfig` is what `requestPathServiceConfig` hands to
 * `registerServices`, and boot runs every plugin's `setup` transformer over it.
 * Folding the transformed list back in would make the next registration
 * transform boot's OWN OUTPUT: the dev recovery path re-registers when no
 * localization baseline exists, and an append-style transformer would then
 * duplicate its plugins and fail slug or route validation.
 *
 * Only the plugins are taken from boot: the transformed config carries no
 * `typescript`, `db` or `storage`, so adopting it wholesale would silently drop
 * three fields this store holds.
 */
function bootView(): SanitizedNextlyConfig | null {
  const config = _storedConfig;
  // Gated on the canonical registration state rather than on the list having
  // been cleared by whoever tore services down. The list describes a RUNNING
  // runtime, so it is meaningful exactly while one is registered — and two
  // functions clear that state (`shutdownServices`, `clearServices`), so a
  // remembered-to-clear approach would be one edit away from the stale-read it
  // is meant to prevent. Derived here, a teardown, a failed re-boot, and a
  // process that never booted all fall back to the declared list on their own.
  const booted = isServicesRegistered()
    ? globalForBoot.__nextly_bootConfig
    : undefined;
  if (!config || !booted) return config;

  if (
    !_bootView ||
    _bootViewInputs?.config !== config ||
    _bootViewInputs?.booted !== booted
  ) {
    _bootView = overlayDefined(config, booted);
    _bootViewInputs = { config, booted };
  }
  return _bootView;
}

/**
 * The plugins the running runtime booted with, read without the route's own
 * config.
 *
 * {@link getHandlerConfig} answers only for a route created with a config. An
 * app whose route was created without one, and whose instrumentation hook
 * booted the runtime, still has a booted plugin list, and a reader that needs
 * only the plugins reads it here. Falls back to the route's declared list when
 * nothing has booted, and to none when there is neither.
 */
export function bootedPlugins(): NonNullable<SanitizedNextlyConfig["plugins"]> {
  const booted = isServicesRegistered()
    ? globalForBoot.__nextly_bootConfig
    : undefined;
  return booted?.plugins ?? _storedConfig?.plugins ?? [];
}

/**
 * Store the nextly config for use during service initialization.
 * Called by `createDynamicHandlers({ config })` in routeHandler.ts.
 */
export function setHandlerConfig(config: SanitizedNextlyConfig): void {
  _storedConfig = config;
}

/**
 * Record the plugin list boot produced, and re-point the store at it.
 *
 * The store is populated when the route module is imported, which is the
 * earliest the config exists and is before any `setup` transformer has run.
 * Boot then transforms the list — a transformer may add, remove, or flip the
 * `enabled` flag on a plugin — and the public admin-meta endpoint reads this
 * store WITHOUT initializing services, so without this it describes plugins as
 * their author declared them rather than as they actually booted.
 *
 * Takes the config's own `plugins` shape, optional included, and reads an
 * absent list as an empty one. A boot that registered no plugins and a boot
 * whose transformers removed them all are the same fact — the store must stop
 * advertising the plugins the author declared — and normalizing here rather
 * than at the call site leaves the caller no branch in which to disagree.
 */
export function setBootedConfig(config: NextlyServiceConfig): void {
  // Takes the WHOLE transformed config, and narrows here rather than at the
  // call site. A caller that named the blocks to publish would be one omission
  // from the endpoint folding against raw values for whatever it forgot.
  //
  // `plugins` is normalized because an absent list and an emptied one are the
  // same fact: a boot whose transformers removed every plugin must stop this
  // store advertising the ones the author declared.
  globalForBoot.__nextly_bootConfig = {
    // Normalized, because the sanitized shape these overlay onto requires them
    // and an absent list means the same as an empty one: a boot whose
    // transformers removed every plugin, collection or single must stop the
    // store advertising the ones the author declared.
    plugins: config.plugins ?? [],
    collections: config.collections ?? [],
    singles: config.singles ?? [],
    // NOT normalized: `permissions` is genuinely optional on the sanitized
    // config, so `undefined` is a value here — "boot registered no app-level
    // permissions" — and the overlay must carry it rather than fall back to the
    // author's raw declaration.
    permissions: config.permissions,
  };
}

/**
 * Retrieve the stored nextly config, as it BOOTED.
 *
 * Used by the admin-meta endpoint to read branding config without going
 * through the service dispatcher. Readers of this see boot's plugin list;
 * service registration reads `_storedConfig` directly and sees the raw one.
 */
export function getHandlerConfig(): SanitizedNextlyConfig | null {
  return bootView();
}

/**
 * The route's config as it was stored, without boot's plugin list: what a
 * request-path registration is handed (`requestPathServiceConfig`), and what
 * its localization is compared against.
 */
export function storedRouteConfig(): SanitizedNextlyConfig | null {
  return _storedConfig;
}
