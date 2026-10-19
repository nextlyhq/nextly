/**
 * The `localization` block the registered services were built from.
 *
 * The data services capture `localization` when they are constructed, so in
 * development the request path compares the route config's block with this
 * one and registers the services again when the block has moved (see
 * `route-handler/auth-handler.ts`).
 *
 * Recorded by whichever boot registers the services, from the config that
 * boot was handed: `getNextly`, which an app's own server code and the
 * admin's component check call, and the request path's own boot. Without a
 * record from `getNextly`, a request that followed one could not tell what
 * the services held, and so registered them again, disconnecting the
 * adapter under any other request still using it.
 *
 * Held on `globalThis`, as the registration state it describes is, because
 * Next can load this package more than once in one process. Forgotten when
 * the services are released, so it never describes services that are gone.
 *
 * @module di/registered-localization
 */

const globalForLocalization = globalThis as unknown as {
  __nextly_registeredLocalization?: string;
};

/** The comparable form of a config's `localization` block. */
export function localizationKey(
  config: { readonly localization?: unknown } | null
): string {
  return JSON.stringify(config?.localization ?? null);
}

/** Records the block the services were just registered from. */
export function recordRegisteredLocalization(
  config: { readonly localization?: unknown } | null
): void {
  globalForLocalization.__nextly_registeredLocalization =
    localizationKey(config);
}

/**
 * The block the registered services were built from, or `undefined` when the
 * boot that registered them recorded none.
 */
export function registeredLocalization(): string | undefined {
  return globalForLocalization.__nextly_registeredLocalization;
}

/** Forgets the record, as the services it describes are released. */
export function forgetRegisteredLocalization(): void {
  delete globalForLocalization.__nextly_registeredLocalization;
}
