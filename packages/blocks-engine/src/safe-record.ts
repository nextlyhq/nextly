/**
 * Building a record whose KEYS come from stored data.
 *
 * Slot names, node ids and token path segments all reach this package as
 * strings a user's document supplied, and a record keyed by them is not a
 * neutral container: two of its keys are answered by `Object.prototype` rather
 * than by the object, and they fail in opposite directions.
 *
 * ## The asymmetry
 *
 * `constructor` defeats the READ. `built["constructor"]` resolves
 * `Object.prototype.constructor` on a record that never had the key, so a
 * lookup meant to ask "did I rebuild this entry?" answers with a function.
 *
 * `__proto__` defeats the WRITE. `target["__proto__"] = value` invokes the
 * legacy prototype setter instead of creating a property: no own key exists
 * afterwards, `JSON.stringify` emits the record without it, and the object's
 * prototype has silently become whatever was assigned. Measured:
 *
 * ```js
 * const src = JSON.parse('{"__proto__":["a"],"content":["b"]}');
 * Object.keys(src);                       // ['__proto__', 'content']  — an OWN key
 * const out = {};
 * for (const [k, v] of Object.entries(src)) out[k] = v;
 * Object.keys(out);                       // ['content']  — the entry is gone
 * Object.getPrototypeOf(out) === Object.prototype;  // false
 * ```
 *
 * They are different keys reached by different mechanisms, which is why a guard
 * built for one leaves the other standing: reading through a `Map` closes
 * `constructor` and does nothing for `__proto__`, and this closes `__proto__`
 * and does nothing for `constructor`. A rebuild that reads and writes needs
 * both.
 *
 * ## Why it matters here rather than as a general precaution
 *
 * The loss is caused by an edit that named a DIFFERENT node. A document with a
 * `__proto__` slot is malformed, but this package's contract is that malformed
 * stored content is preserved rather than normalised — an unrelated edit must
 * not be the thing that destroys it. Dropping the entry during a rebuild
 * silently converts "we kept what we could not interpret" into "we deleted it",
 * and nothing downstream can tell that happened.
 *
 * @module safe-record
 */

/**
 * Write one entry into a record under a key that came from stored data.
 *
 * `Object.defineProperty` rather than assignment, because assignment is not a
 * plain write for every string: see the module note. Descriptor matches what
 * assignment to a fresh object would have produced, so a record built this way
 * is indistinguishable from a normally-built one for every key except the one
 * that would have been lost.
 */
export function defineEntry<T>(
  target: Record<string, T>,
  key: string,
  value: T
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Read one entry from a record under a key that came from stored data.
 *
 * The read half of the same asymmetry, and it is needed at any site that looks
 * an entry up before writing it. `record["__proto__"]` returns
 * `Object.prototype` on a record that has no such key, and `record["toString"]`
 * returns a function — so `record[key] ?? fallback` does not reach its fallback
 * for either, and the caller proceeds with an inherited value.
 *
 * Measured: `[...(({})["__proto__"] ?? [])]` throws
 * `TypeError: ... is not iterable` rather than yielding an empty array, because
 * the nullish coalescing never fires.
 */
export function ownEntry<T>(
  record: Record<string, T>,
  key: string
): T | undefined {
  // `Object.prototype.hasOwnProperty.call` rather than `record.hasOwnProperty`:
  // the record's own keys are stored data, so it may carry a `hasOwnProperty`
  // of its own and answer the question with it.
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

/**
 * ## What is already safe, so nobody "fixes" it
 *
 * Only ASSIGNMENT is affected. These define rather than assign, and each
 * preserves a stored `__proto__` as an own key — measured, not assumed:
 *
 * - `{ ...stored }`
 * - `Object.fromEntries(...)`
 * - `Object.assign({}, stored)`
 * - `structuredClone(stored)`
 *
 * And plain assignment is safe when the TARGET has no prototype to inherit
 * from. `Object.create(null)` carries no `__proto__` accessor, so
 * `target[key] = value` there creates an own property like any other key —
 * `compilePageCss` builds its gated map that way and needs nothing from this
 * module. A search for the assignment SHAPE alone finds those sites and
 * misreads them; what decides it is how the target was constructed.
 *
 * So a whole-record rebuild needs no helper here; reach for `defineEntry` when
 * writing ONE key whose name came from stored data, and for `ownEntry` when
 * reading one. A `recordFromEntries` wrapper lived here briefly and was removed
 * as a second spelling of `Object.fromEntries`.
 */
