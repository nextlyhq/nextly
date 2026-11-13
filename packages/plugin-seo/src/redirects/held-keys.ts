/**
 * Which addresses any redirect holds, kept in this process so the Proxy can
 * pass a page request no redirect is for without reading the database.
 *
 * The record keeps one row per address a redirect holds, exact or a range,
 * under a claim key. The keys of every such row are read once and kept as a
 * set: a request whose address and ranges above it match none of them meets
 * no redirect, which a set lookup per key answers. Only a request that does
 * match one is asked of the database, as before, so which redirect answers,
 * and whether a page serves the address instead, is still decided by one
 * rule (`redirectMeeting`).
 *
 * The set is read again in the background every
 * {@link REDIRECT_KEYS_REFRESH_MS}, so a redirect saved on another server
 * applies here within that time, and at once on the server that saved it,
 * which forgets the set when the save commits. A key kept after its redirect
 * is gone costs only that database read.
 *
 * @module redirects/held-keys
 */
import type { KeptAddress, PluginContext } from "@nextlyhq/plugin-sdk";

import { keysHolding } from "../address-record/rows";
import { keysHeldBy } from "../address-record/store";
import { keptValue } from "../kept-value";

import { redirectsSlug } from "./collection";

/** How old the kept keys may grow before they are read again. */
const REDIRECT_KEYS_REFRESH_MS = 15_000;

/** The claim key of every record row a redirect holds. */
function readHeldKeys(ctx: PluginContext): Promise<ReadonlySet<string>> {
  return keysHeldBy(ctx, redirectsSlug(ctx));
}

/** The kept keys, and the two questions asked of them. */
export interface HeldRedirectKeys {
  /**
   * Whether a redirect may answer `address`: false only where no redirect
   * holds the address or a range above it, so no read is needed.
   */
  mayMeet(ctx: PluginContext, address: KeptAddress): Promise<boolean>;
  /** Drop the kept keys, after a redirect was saved or removed here. */
  forget(): void;
}

/** Keys kept as described above, read again every `refreshMs`. */
export function heldRedirectKeys(
  refreshMs: number = REDIRECT_KEYS_REFRESH_MS,
  now?: () => number
): HeldRedirectKeys {
  // The context the latest request was handed: a restart hands a new one.
  let latest: PluginContext | undefined;
  const kept = keptValue(
    () =>
      latest === undefined
        ? Promise.resolve(new Set<string>())
        : readHeldKeys(latest),
    refreshMs,
    now
  );
  return {
    async mayMeet(ctx, address) {
      latest = ctx;
      const keys = await kept.get();
      if (keys.size === 0) return false;
      return keysHolding(address.locale, address.path).some(key =>
        keys.has(key)
      );
    },
    forget: () => kept.forget(),
  };
}
