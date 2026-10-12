/**
 * The grant that lets one read skip the read hooks of a collection a plugin
 * declared.
 *
 * Issued only where a plugin's context is built, and recognised by IDENTITY:
 * the query service asks whether this exact object was issued for this exact
 * collection. App code can reach the raw collection facade through `getService`
 * and pass it any context it likes, so a flag, a string or an object of the
 * right shape would all be a bypass any caller could name. An object the caller
 * built was never issued, whatever it copies, so none of those can be forged
 * into a grant.
 *
 * @module shared/lib/hook-exempt-read
 */

/** An opaque grant. Its only meaning is having been issued. */
export interface HookExemptRead {
  readonly grant: "hook-exempt-read";
}

/**
 * The collections each issued grant covers. Weak, so a grant belongs to the
 * context that holds it and is collected with it.
 */
const issued = new WeakMap<HookExemptRead, ReadonlySet<string>>();

/** Issue a grant covering exactly these collections. */
export function issueHookExemptRead(
  collections: readonly string[]
): HookExemptRead {
  const grant: HookExemptRead = Object.freeze({ grant: "hook-exempt-read" });
  issued.set(grant, new Set(collections));
  return grant;
}

/**
 * Whether a read of `collection` carries a grant issued for it.
 *
 * The one question both ends ask: the plugin surface refuses a collection this
 * answers `false` for before reading, and the query service skips hooks only
 * where it answers `true`. A grant that reached the query service for a
 * collection it does not cover therefore still runs every hook.
 */
export function readHooksWaived(
  grant: HookExemptRead | undefined,
  collection: string
): boolean {
  return grant !== undefined && issued.get(grant)?.has(collection) === true;
}
