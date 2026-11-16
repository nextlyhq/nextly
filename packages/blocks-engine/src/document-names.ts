/**
 * The names a document stores and the caps on them: block types and part
 * names, and how many named classes a site and a node may hold.
 *
 * @module document-names
 */

/**
 * The grammar a block type follows: two lowercase slug segments around one `/`.
 *
 * Held here, in the document model, because a block type is a document-model
 * fact rather than a property of any one consumer. Registration, validation and
 * compilation all decide whether a value is a type, and each asking its own
 * question is how they come to disagree about the same string.
 */
const BLOCK_TYPE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The longest block type this engine accepts.
 *
 * The grammar constrains the alphabet and not the length, so a type of megabytes
 * of otherwise-valid characters satisfies it, is scanned in full wherever it is
 * checked, and is copied into a selector for every rule its defaults produce.
 * The same reason `MAX_BREAKPOINT_ID_LENGTH` and `MAX_NAMED_CLASS_NAME_LENGTH`
 * exist, and the same value: far above a namespaced slug anyone types, so it is
 * only ever met by data that is already wrong.
 */
export const MAX_BLOCK_TYPE_LENGTH = 128;

/**
 * Whether a value is a usable block type.
 *
 * Length before the pattern, so the cheap test is what rejects an oversized
 * value: the other way round, the regex scans the whole string first and the cap
 * bounds nothing it exists to bound.
 *
 * This is the ONE answer. A consumer that bounds the type where another does not
 * accepts a value its neighbour rejects — a block registers and validates while
 * the compiler silently omits its defaults, so it renders without the look it
 * declared and nothing reports why.
 */
export function isBlockType(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_BLOCK_TYPE_LENGTH &&
    BLOCK_TYPE_RE.test(value)
  );
}

/**
 * The grammar a part NAME is held to.
 *
 * A part name is compiled into a class, so it reaches a selector — and a block
 * definition is code a plugin supplies. The same shape a block type's own
 * segments use, for the same reason: no dot, no bracket, no space can appear,
 * so nothing here can close a rule and open another.
 *
 * Consecutive dashes are excluded deliberately. The class joins the block type
 * and the part with a DOUBLED dash, so a name containing one would make the
 * boundary ambiguous and let two different blocks compile to a single class.
 */
const BLOCK_PART_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Longest part name accepted. A name longer than this is not a name, and the
 * bound keeps a pathological value out of an issue message.
 */
const MAX_BLOCK_PART_LENGTH = 32;

/**
 * True if a value names a part a block may state styles for.
 *
 * The ONE answer, for the same reason {@link isBlockType} is: a caller that
 * bounds this where another does not emits a class its neighbour refuses.
 */
export function isPartName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_BLOCK_PART_LENGTH &&
    BLOCK_PART_NAME_RE.test(value) &&
    // A name `Object.prototype` already owns cannot be stored in a record and
    // read back: the lookup answers with the inherited member instead of
    // `undefined`, and assigning it sets the prototype rather than creating an
    // own property. `constructor` passes the grammar above, which is exactly
    // why this is asked of the prototype rather than matched against a written
    // list — the list everyone writes is `__proto__` and `constructor` while
    // `valueof` behaves identically.
    !Object.prototype.hasOwnProperty.call(Object.prototype, value)
  );
}

/**
 * Maximum named classes read from the site library on one compile.
 *
 * The library is site settings, not part of a document, so the document's own byte cap does not
 * bound it — and it is read on every page render. Set far above any hand-authored library so the
 * cap is only ever reached by data that is already wrong.
 *
 * Applied to the STORED order, before `orderIndex` is read. Deciding by `orderIndex` instead
 * means reading every entry to know which to keep, which is exactly the read this bounds.
 */
export const MAX_NAMED_CLASSES = 2000;

/**
 * Maximum class references read from one node.
 *
 * The per-node counterpart to the library cap. A document reaches the compiler whether or not
 * anything validated it, and a node's `classes` array is walked on every render of the page that
 * holds it, so without a bound one corrupt array is copied and scanned in full each time.
 *
 * Set far above any real design. A named class is a preset, not a utility: a block carrying
 * dozens of them is describing a class that should have been one.
 */
export const MAX_CLASSES_PER_NODE = 64;
