/**
 * Whether a value the host is about to serialize survives the trip unchanged.
 *
 * One implementation, because two contributions ask the same question about the
 * same payload: `contributes.admin.clientConfig` and `contributes.admin.widgets`
 * are both copied into `/api/admin-meta` and both handed to one
 * `JSON.stringify`. A second, differently-written round trip would let one of
 * them accept what the other refused -- and the value that gets through is the
 * one that takes the whole response down.
 *
 * Round-tripped rather than type-walked, because the question is exactly "will
 * the client see what the plugin wrote". A structural check would have to keep
 * its own list of things JSON drops, and that list is the thing that goes out
 * of date -- `Date`, `Map`, `Set`, `BigInt`, `undefined` in an array, a getter
 * that throws, a `toJSON` that rewrites the value. Comparing the result to the
 * input catches all of them, including the ones nobody enumerated.
 *
 * @module plugins/json-round-trip
 */

/**
 * The top-level keys whose values do not survive JSON.
 *
 * Only for the error message: an author faced with "your contribution is not
 * JSON" has to bisect an object to find the offender, and the keys are what
 * turn that into a one-line fix. The accept/reject decision stays with
 * {@link jsonOnly}, which compares the whole value -- a nested offender makes
 * its top-level key the one worth naming.
 */
export function unserializableKeys(value: object): string[] {
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
      // `Reflect.get` rather than an index assertion: the declared type is
      // `object`, and reading a property is exactly what this needs to do.
      const property: unknown = Reflect.get(value, key);
      const encoded = JSON.stringify(property);
      if (encoded === undefined) return true;
      return !sameShape(property, JSON.parse(encoded));
    } catch {
      return true;
    }
  });
}

/**
 * The value as the browser will receive it, or `undefined` when the trip would
 * change it.
 */
export function jsonOnly(value: object): Record<string, unknown> | undefined {
  // The declared type promises a record and the runtime may not deliver one: a
  // JavaScript host can pass `null`, an array or a primitive, all of which
  // round-trip perfectly and would publish a value that every reader — the
  // type, the hook, the destructuring in a component — assumes is an object.
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
 * The verdict for a pair JSON can settle WITHOUT descending, or `null` when
 * both sides are comparable objects and the key walk has to run.
 *
 * Split from the walk because it answers a different question: this decides
 * whether the two values are the same KIND of thing, the walk decides whether
 * they carry the same contents. Three-valued on purpose — a boolean could not
 * distinguish "these differ" from "keep going", and collapsing them is how a
 * shallow check comes to stand in for a deep one.
 */
function shallowVerdict(before: unknown, after: unknown): boolean | null {
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
  return null;
}

/**
 * Whether both sides carry the same addressable keys, and the source carries
 * none that JSON silently drops.
 */
function sameKeys(a: Record<string, unknown>, b: Record<string, unknown>) {
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
  // The key SETS, not their sizes. A sparse array with an extra enumerable
  // property has the same COUNT on both sides — JSON drops the property and
  // materialises the hole as `null` — so counting alone reads a rearranged
  // array as unchanged.
  const decodedKeys = Object.keys(b);
  if (keys.length !== decodedKeys.length) return false;
  const inDecoded = new Set(decodedKeys);
  return keys.every(key => inDecoded.has(key));
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
function sameShape(
  before: unknown,
  after: unknown,
  // Source objects already visited. JSON has no way to say "the same object
  // twice": `{ a: x, b: x }` decodes as two distinct objects, so a component
  // reading `config.a === config.b` sees `true` before delivery and `false`
  // after. A repeat is therefore a shape change, and a cycle is caught here as
  // well rather than by `JSON.stringify` throwing.
  seen: Set<object> = new Set()
): boolean {
  const shallow = shallowVerdict(before, after);
  if (shallow !== null) return shallow;

  // `shallowVerdict` returned `null`, which it does only after establishing
  // both sides are non-null objects of the same prototype. The assertion
  // records what it decided; TypeScript cannot narrow across a call boundary.
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  if (seen.has(a)) return false;
  seen.add(a);
  if (!sameKeys(a, b)) return false;
  return Object.keys(a).every(key => sameShape(a[key], b[key], seen));
}
