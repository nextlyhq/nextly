/**
 * Validating a plugin's `contributes.admin.clientConfig` and reducing it to the
 * value the browser receives.
 *
 * Its own module because two callers need it at different times: boot rejects a
 * bad config before anything depends on it, and the admin-meta serializer needs
 * the reduced value. One implementation, so the request path cannot accept what
 * boot refused.
 *
 * @module plugins/validate-client-config
 */

import { clientConfigError } from "./client-config-error";
import type { PluginDefinition } from "./plugin-context";

/**
 * The top-level keys whose values do not survive JSON.
 *
 * Only for the error message: a plugin author faced with "your config is not
 * JSON" has to bisect an object to find the offender, and the keys are what
 * turn that into a one-line fix. The accept/reject decision stays with
 * {@link jsonOnly}, which compares the whole value — a nested offender makes
 * its top-level key the one worth naming.
 */
function unserializableKeys(value: Record<string, unknown>): string[] {
  // Enumeration itself can throw: reading an entry evaluates a getter, and a
  // getter that throws would escape from the DIAGNOSTIC path — turning a
  // reportable configuration error into a raw exception from the one function
  // whose job is to describe it.
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    return [];
  }
  return keys.filter(key => {
    try {
      const encoded = JSON.stringify(value[key]);
      if (encoded === undefined) return true;
      return !sameShape(value[key], JSON.parse(encoded));
    } catch {
      return true;
    }
  });
}

function jsonOnly(
  value: Record<string, unknown>
): Record<string, unknown> | undefined {
  // The declared type promises a record and the runtime may not deliver one: a
  // JavaScript host can pass `null`, an array or a primitive, all of which
  // round-trip perfectly and would publish a `clientConfig` that every reader
  // — the type, the hook, the destructuring in a component — assumes is an
  // object.
  let decoded: Record<string, unknown>;
  try {
    // Inside the guard with everything else that touches the value. Each of
    // these is an observable operation on a Proxy — `Array.isArray` and
    // `getPrototypeOf` both run traps — so a trap that throws would escape as
    // a raw exception rather than as the configuration error this reports.
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return undefined;
    }
    const encoded = JSON.stringify(value);
    // `undefined` when the top-level value itself is not encodable.
    if (encoded === undefined) return undefined;
    decoded = JSON.parse(encoded) as Record<string, unknown>;
    // Inside the guard, because it READS the properties again: a getter that
    // returned once for `JSON.stringify` may throw on the second call, and
    // that would escape as a raw exception from the validator rather than as
    // the configuration error this is here to produce.
    return sameShape(value, decoded) ? decoded : undefined;
  } catch {
    // A cycle, a BigInt, or a getter that throws on either read.
    return undefined;
  }
}

/**
 * Whether a value came back from JSON as the same thing it went in as.
 *
 * Compared against the DECODED value rather than against a second encoding of
 * it. Re-encoding proves only that JSON is stable, which it always is: a `Date`
 * encodes to a string and that string re-encodes identically, so the check
 * passes while the client reads a `string` where the plugin wrote a `Date`.
 * Comparing the two sides catches that, and catches the other silent
 * conversions with it — a `Map` that arrives as `{}`, a key whose value was
 * `undefined` or a function and is simply gone, an `undefined` in an array that
 * arrives as `null`.
 */
function sameShape(before: unknown, after: unknown): boolean {
  // `Object.is` rather than `===`, so `-0` is not accepted as unchanged after
  // JSON turns it into `0`. The browser can tell them apart (`1 / value`), so
  // that is a mangled copy like any other.
  if (Object.is(before, after)) return true;
  if (typeof before !== typeof after) return false;
  if (before === null || after === null) return false;
  if (typeof before !== "object") return false;
  if (Array.isArray(before) !== Array.isArray(after)) return false;
  // A `Map` and a `Set` both encode to `{}`, so the shapes match while the
  // prototypes do not. This is what separates a plain object from a class
  // instance that merely looks like one.
  if (Object.getPrototypeOf(before) !== Object.getPrototypeOf(after))
    return false;
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = Object.keys(a);
  // Own keys JSON cannot carry: a symbol key, or a non-enumerable one. Both are
  // invisible to `Object.keys` on BOTH sides, so comparing only enumerable
  // string keys would certify a decoded object that quietly lost them.
  //
  // An array's own keys include a non-enumerable `length`, which JSON does
  // carry — as the array's shape. That one is discounted rather than the whole
  // array being exempted, so `[1, 2, 3]` passes while an array someone hung a
  // symbol property on is still refused.
  const carried = keys.length + (Array.isArray(a) ? 1 : 0);
  if (Reflect.ownKeys(a).length !== carried) return false;
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => sameShape(a[key], b[key]));
}

/**
 * The config a plugin will publish, or `undefined` when it declares none.
 *
 * Throws {@link clientConfigError} when the value cannot be delivered
 * unchanged.
 */
export function validatedClientConfig(
  plugin: PluginDefinition
): Record<string, unknown> | undefined {
  const declared = plugin.contributes?.admin?.clientConfig;
  if (declared === undefined) return undefined;
  const serializable = jsonOnly(declared);
  if (serializable === undefined) {
    throw clientConfigError(plugin.name, unserializableKeys(declared));
  }
  return serializable;
}

/**
 * Boot-time check over every plugin, disabled ones included.
 *
 * Validating only when `/api/admin-meta` is first requested would make a bad
 * config look like a healthy start followed by an endpoint that takes the whole
 * branding payload down with it — and the contract promises a boot error.
 * Disabled plugins are checked too, because their config is serialized too.
 */
export function assertClientConfigs(plugins: PluginDefinition[]): void {
  for (const plugin of plugins) validatedClientConfig(plugin);
}
