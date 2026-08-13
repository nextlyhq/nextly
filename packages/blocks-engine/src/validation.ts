/**
 * Document validation. Produces machine-readable issues so both humans and
 * agents can locate and fix problems: every issue carries a JSON-Pointer into
 * the document, a stable code from {@link ISSUE_CODES}, a message, and an
 * optional suggestion. The issue shape is the stable contract external tools
 * consume to locate and repair problems.
 *
 * Runtime-free like the rest of the engine: it reads the document and a caller-
 * supplied context (breakpoints, mode, and an optional block-type lookup); it
 * never touches storage or a framework.
 */
import type { BlockDocument, BlockNode, BreakpointSet } from "./document";
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  MAX_CLASSES_PER_NODE,
  STYLE_STATES,
} from "./document";
import { describeValue, pointer } from "./issue-text";
import { DEFAULT_LIMITS, LIMIT_WARNING_RATIO } from "./limits";
import type { DocumentLimits } from "./limits";
import { isPlainRecord } from "./plain-record";
import type { TokenKind } from "./style/catalog-types";
import { MAX_NAMED_CLASS_NAME_LENGTH } from "./style/named-class";
import {
  canResolveName,
  chargeIssueBudget,
  memoizeTokenLookup,
  registerLookupCache,
  newStyleIssueBudget,
  siteAllowanceSpent,
  siteTruncationNotice,
  structuralAllowanceSpent,
  validateStyleValues,
} from "./style/validate-style-value";
import type { ReadyStyleIssueBudget } from "./style/validate-style-value";

/** Severity of a validation issue. `error` blocks a strict publish. */
export type IssueSeverity = "error" | "warning";

/** How strictly to validate. */
export type ValidationMode = "strict" | "forgiving";

/**
 * One validation finding. `path` is an RFC 6901 JSON-Pointer that resolves into
 * the validated document (e.g. `/nodes/0/slots/children/1/id`); `code` is a
 * stable machine key from {@link ISSUE_CODES}.
 */
export interface ValidationIssue {
  path: string;
  code: IssueCode;
  message: string;
  severity: IssueSeverity;
  suggestion?: string;
}

/**
 * A minimal block-type lookup so validation is not coupled to a concrete
 * registry. When a caller supplies one, unregistered node types are reported;
 * when omitted, node-type existence is not checked but structure still is.
 */
export interface BlockTypeLookup {
  has(type: string): boolean;
}

/**
 * The site's design tokens, for checking the NAMES a document references.
 *
 * Supplying this states that the caller can answer for EVERY token the site
 * defines. A lookup that knows only some of them reports the rest as unknown,
 * which is survivable only because an unknown name is a warning and never an
 * error — see `unknown-token` in the issue table.
 *
 * `kindOf` answers with the kind rather than a boolean so one call settles both
 * questions a reference raises: whether the token exists, and whether it is the
 * kind this leaf accepts. Two methods would let a caller check existence and
 * forget the kind.
 */
export interface TokenLookup {
  /** The kind of the named token, or undefined when the site defines none. */
  kindOf(name: string): TokenKind | undefined;
}

/** The site's named classes, for checking the ids a node lists. */
export interface ClassLookup {
  has(id: string): boolean;
}

/** Wrappers made here, so one is never wrapped twice. */
const memoizedClassLookups = new WeakSet<ClassLookup>();

/**
 * A class lookup that asks the caller's at most once per id.
 *
 * The same reasoning as the token lookup: `has` is caller-supplied and may be
 * expensive, an id repeats freely across a document, and a KNOWN id produces no
 * issue and so is never charged the allowance that bounds everything else. A
 * document applying twenty site classes across five thousand nodes would
 * otherwise ask a hundred thousand times to report nothing at all.
 */
function memoizeClassLookup(
  classes: ClassLookup | undefined,
  budget?: ReadyStyleIssueBudget
): ClassLookup | undefined {
  if (classes === undefined) return undefined;
  if (memoizedClassLookups.has(classes)) return classes;
  const seen = new Map<string, boolean>();
  const lookup: ClassLookup = {
    has(id: string): boolean {
      const cached = seen.get(id);
      if (cached !== undefined) return cached;
      // Charged for what the caller was really asked, as the token lookup is: a
      // repeated id is answered from this cache, and only a new one costs them
      // anything. Distinct ids are what memoizing cannot collapse, and a known
      // one is not a finding, so nothing else counts them.
      if (budget !== undefined) budget.siteLookups -= 1;
      const known = classes.has(id);
      seen.set(id, known);
      return known;
    },
  };
  memoizedClassLookups.add(lookup);
  registerLookupCache(lookup, seen);
  return lookup;
}

/**
 * Everything validation needs beyond the document itself. The engine never
 * reads storage: the caller supplies the site breakpoints and mode, and
 * optionally a block-type lookup and non-default limits.
 */
export interface ValidationContext {
  breakpoints: BreakpointSet;
  mode: ValidationMode;
  registry?: BlockTypeLookup;
  limits?: DocumentLimits;
  /**
   * The site's tokens and classes. Both are optional, and absent means the
   * corresponding names are not checked at all — a document is validated
   * against what it was given, never against what it might have been.
   */
  tokens?: TokenLookup;
  classes?: ClassLookup;
}

/**
 * The stable issue-code vocabulary, each with a one-line description. Tests
 * assert that every code emitted appears here and vice versa, so the emitted
 * vocabulary cannot drift silently.
 */
export const ISSUE_CODES = {
  "invalid-format-version":
    "The document formatVersion is not the supported version.",
  "invalid-kind": "The document kind is not one of the known kinds.",
  "invalid-document": "The document is not an object.",
  "nodes-not-array": "The document nodes field is not an array.",
  "invalid-node": "A node is not an object.",
  "depth-exceeded": "The node tree is nested deeper than the allowed maximum.",
  "node-count-exceeded":
    "The document has more nodes than the allowed maximum.",
  "document-too-large": "The serialized document exceeds the byte limit.",
  "document-size-warning":
    "The serialized document is approaching the byte limit.",
  "missing-node-id": "A node is missing its id or the id is empty.",
  "duplicate-node-id": "Two or more nodes share the same id.",
  "duplicate-dom-id": "Two or more nodes render the same HTML id.",
  "invalid-node-type": "A node type is missing or not a namespaced string.",
  "invalid-node-version":
    "A node version is missing or not a positive integer.",
  "invalid-props": "A node props field is not an object.",
  "invalid-slots": "A node slots field or one of its slot arrays is malformed.",
  "invalid-classes": "A node classes field is not an array of strings.",
  "too-many-classes":
    "A node lists more classes than the compiler will apply to it.",
  "invalid-attributes": "A node attributes field is not a string map.",
  "invalid-css-id": "A node cssId is not a string.",
  "unknown-node-type": "A node type is not registered.",
  "invalid-style-state": "A style state key is not a known interactive state.",
  "invalid-style-values": "A style values entry is not an object.",
  "unknown-breakpoint":
    "A style or visibility breakpoint id is not defined for the site.",
  "breakpoint-id-not-unique":
    "A breakpoint id is defined on more than one axis.",
  "invalid-visibility": "A node visibility structure is malformed.",
  "invalid-binding": "A binding is malformed.",
  "missing-source-key":
    "A single-sourced binding does not name which single it reads.",
  "invalid-component-instance":
    "A component-instance node does not reference a component.",
  "unknown-style-property":
    "A style values key is not a property in the style catalog.",
  "unknown-token":
    "A design token reference names a token the site does not define.",
  "token-kind-mismatch":
    "A design token is not the kind of value its property accepts.",
  "unknown-class": "A node lists a class id the site does not define.",
  "invalid-class-name":
    "A named class in the site library has a name that cannot be written to CSS.",
  "invalid-class":
    "A named class in the site library is missing the id or the styles record it needs to be written.",
  "invalid-class-library":
    "The site's named class library is not a list of classes.",
  "duplicate-class-name":
    "More than one named class in the site library carries the same name.",
  "duplicate-class-id":
    "More than one named class in the site library carries the same id, which is what documents reference.",
  "invalid-style-value":
    "A style value does not match the shape its property declares.",
  "token-not-allowed":
    "A design-token reference is used where only literal values are accepted.",
  "style-issues-truncated":
    "More style problems were found than the validation reports.",
  "site-issues-truncated":
    "Some token and class names were not checked against the site, so any that do not resolve are not reported.",
  "invalid-scope":
    "The compile scope is not a single class, so the document's rules were not scoped.",
} as const;

/** A stable validation issue code. */
export type IssueCode = keyof typeof ISSUE_CODES;

/** A node type is a namespaced slug, e.g. "core/heading". */
const NODE_TYPE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Whether a value is a well-formed node type, independent of any registry.
 *
 * Exported because the editor's op layer has to refuse a malformed node BEFORE
 * it reaches the tree, and it has no registry in hand — a tree operation is not
 * the place to require one. Asking this function is what stops that layer
 * growing its own idea of what a type looks like: a `typeof value === "string"`
 * check there accepts `"box"`, which this rejects, and the document would then
 * hold a node that strict validation refuses on the next read.
 *
 * `validateNode` below calls it too, so there is one rule rather than two that
 * agree today.
 */
export function isNodeType(value: unknown): value is string {
  return typeof value === "string" && NODE_TYPE_RE.test(value);
}

/**
 * Whether a value is a usable node version: a positive integer.
 *
 * Exported for the same reason as {@link isNodeType}, and it excludes the cases
 * a plain `typeof value === "number"` admits — `0`, `-2.5`, `NaN` — each of
 * which reaches storage as a version no migration can act on.
 */
export function isNodeVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Node types the engine defines itself rather than blocks a registry holds.
 * They are structurally valid and resolved by their own machinery, so a
 * registry miss on one of them is not an unknown type.
 */
const ENGINE_NODE_TYPES = new Set<string>([COMPONENT_INSTANCE_TYPE]);

/**
 * Validate a document. Returns every issue found (empty array = valid). In
 * `strict` mode, preservable-but-unknown problems (unknown node type, dangling
 * breakpoint reference) are errors; in `forgiving` mode they are warnings, so a
 * renderer can still show what it can. Structural corruption (missing ids,
 * malformed shapes, exceeded limits) is always an error.
 */
export function validate(
  doc: BlockDocument,
  ctx: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const limits = ctx.limits ?? DEFAULT_LIMITS;
  const unknownSeverity: IssueSeverity =
    ctx.mode === "strict" ? "error" : "warning";

  // A wholly-malformed document (null, an array, a primitive) is reported as a
  // structural issue rather than crashing on the field reads below. `rawDoc`
  // aliases the same value as `unknown`: reads through it are legitimately
  // untrusted, while `doc` keeps its declared type for the typed helper calls.
  const rawDoc: unknown = doc;
  if (!isPlainRecord(rawDoc)) {
    issues.push({
      path: "",
      code: "invalid-document",
      severity: "error",
      message: "The document must be an object.",
    });
    return issues;
  }

  const knownBreakpoints = collectBreakpointIds(ctx.breakpoints, issues);

  const formatVersion = rawDoc.formatVersion;
  if (formatVersion !== DOCUMENT_FORMAT_VERSION) {
    issues.push({
      path: "/formatVersion",
      code: "invalid-format-version",
      severity: "error",
      message: `Unsupported document formatVersion ${describeValue(formatVersion)}.`,
      suggestion: `Use formatVersion ${DOCUMENT_FORMAT_VERSION}.`,
    });
  }

  // An unrecognized kind STRING is preserved in forgiving mode (a warning) and
  // rejected in strict mode, matching the unknown-block-type policy. A missing
  // or non-string kind is structural corruption, not a future value to
  // preserve, so it is always an error.
  const kind = rawDoc.kind;
  if (!DOCUMENT_KINDS.includes(kind as (typeof DOCUMENT_KINDS)[number])) {
    issues.push({
      path: "/kind",
      code: "invalid-kind",
      severity: typeof kind === "string" ? unknownSeverity : "error",
      message: `Unknown document kind "${describeValue(kind)}".`,
      suggestion: `Use one of: ${DOCUMENT_KINDS.join(", ")}.`,
    });
  }

  if (!Array.isArray(rawDoc.nodes)) {
    issues.push({
      path: "/nodes",
      code: "nodes-not-array",
      severity: "error",
      message: "The document nodes field must be an array.",
    });
    // Nothing further to check without a node forest.
    return issues;
  }

  const beforeLimits = issues.length;
  checkLimits(doc, limits, issues);
  // Any limit rejection, not the byte one alone. A forest over the node or
  // depth cap is refused BEFORE its bytes are measured, so asking only about
  // size would leave the expensive per-value work running on a document already
  // known to be invalid.
  const overLimits = issues
    .slice(beforeLimits)
    .some(
      issue =>
        issue.code === "document-too-large" ||
        issue.code === "node-count-exceeded" ||
        issue.code === "depth-exceeded"
    );

  const styleBudget = newStyleIssueBudget();
  const nodeState: NodeCheckState = {
    // Both site lookups are wrapped once here rather than per node or per style
    // envelope, so a name repeated across the document costs the caller one
    // answer for the whole walk. Nothing else bounds that repetition: a name
    // that RESOLVES produces no issue, so it is never charged the allowance
    // that stops the rest of the per-value work.
    ctx: {
      ...ctx,
      tokens: memoizeTokenLookup(ctx.tokens, styleBudget),
      classes: memoizeClassLookup(ctx.classes, styleBudget),
    },
    issues,
    knownBreakpoints,
    unknownSeverity,
    seenIds: new Map<string, string>(),
    seenDomIds: new Map<string, string>(),
    skipValueParsing: overLimits,
    styleBudget,
  };

  // Document-level styles use the same envelope as node styles but have no
  // owning node, so validate them here or they would go unchecked.
  if (isPlainRecord(rawDoc.settings) && rawDoc.settings.styles !== undefined) {
    validateStyleEnvelope(
      rawDoc.settings.styles,
      "/settings/styles",
      nodeState
    );
  }

  // Iterative breadth-first walk. It never recurses, so a document nested
  // arbitrarily deep cannot overflow the call stack — validation returns the
  // depth issue instead of throwing. It also stops after visiting maxNodes
  // nodes (the node-count issue is already recorded by checkLimits), so an
  // oversized document cannot make the walk do unbounded work.
  // Index-based reads (not .map/.forEach) so a sparse array's holes become
  // explicit undefined entries reported as invalid nodes, and the queue is
  // capped at maxNodes so an oversized forest cannot grow it without bound.
  const queue: Array<{ node: BlockNode; path: string }> = [];
  for (
    let i = 0;
    i < doc.nodes.length && queue.length <= limits.maxNodes;
    i++
  ) {
    queue.push({ node: doc.nodes[i], path: pointer("/nodes", i) });
  }
  for (let i = 0; i < queue.length && i < limits.maxNodes; i++) {
    const { node, path } = queue[i];
    validateNode(node, path, nodeState);
    if (isPlainRecord(node) && isPlainRecord(node.slots)) {
      for (const [slot, children] of Object.entries(node.slots)) {
        if (Array.isArray(children)) {
          const slotPath = pointer(pointer(path, "slots"), slot);
          for (
            let c = 0;
            c < children.length && queue.length <= limits.maxNodes;
            c++
          ) {
            queue.push({ node: children[c], path: pointer(slotPath, c) });
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Collect every breakpoint id, reporting any id that repeats — whether within a
 * single axis or across the two. This is the one check about the CONTEXT rather
 * than the document: its issue path (`/breakpoints/<axis>/<i>`) points into the
 * supplied breakpoint set, not the validated document, because a duplicate id
 * is a site-settings problem that makes every flat style breakpoint key
 * ambiguous.
 */
function collectBreakpointIds(
  breakpoints: BreakpointSet,
  issues: ValidationIssue[]
): Set<string> {
  const ids = new Set<string>();
  // The breakpoint set comes from stored settings, so treat it as untrusted: a
  // null/malformed set or axis is skipped rather than dereferenced.
  const set: unknown = breakpoints;
  const scanAxis = (axis: "viewport" | "container"): void => {
    const defs = isPlainRecord(set) ? set[axis] : undefined;
    if (!Array.isArray(defs)) return;
    defs.forEach((def, index) => {
      // A malformed definition (null, missing id) contributes no usable
      // breakpoint id, so it is skipped rather than dereferenced.
      const rawDef: unknown = def;
      if (!isPlainRecord(rawDef) || typeof rawDef.id !== "string") return;
      const id = rawDef.id;
      if (ids.has(id)) {
        issues.push({
          path: pointer(pointer("/breakpoints", axis), index),
          code: "breakpoint-id-not-unique",
          severity: "error",
          message: `Breakpoint id "${describeValue(id)}" is defined more than once.`,
          suggestion: "Give every breakpoint a unique id across both axes.",
        });
      }
      ids.add(id);
    });
  };
  scanAxis("viewport");
  scanAxis("container");
  return ids;
}

/**
 * Count nodes and detect depth-exceedance in one bounded pass. An oversized
 * document costs O(maxNodes), not O(document): once the node cap is passed the
 * traversal stops (the document is already rejected) and the frontier is never
 * allowed to grow past the cap, so a rejected forest cannot exhaust memory.
 */
function measureForest(
  nodes: BlockNode[],
  maxNodes: number,
  maxDepth: number
): { count: number; exceededDepth: boolean } {
  let count = 0;
  let exceededDepth = false;
  const queue: Array<{ node: BlockNode; depth: number }> = [];
  for (let i = 0; i < nodes.length && queue.length <= maxNodes; i++) {
    queue.push({ node: nodes[i], depth: 1 });
  }
  for (let i = 0; i < queue.length; i++) {
    count++;
    const { node, depth } = queue[i];
    if (depth > maxDepth) exceededDepth = true;
    if (count > maxNodes) break; // already over the cap; no need to count more
    if (typeof node === "object" && node !== null && node.slots) {
      for (const children of Object.values(node.slots)) {
        if (!Array.isArray(children)) continue;
        for (let c = 0; c < children.length && queue.length <= maxNodes; c++) {
          queue.push({ node: children[c], depth: depth + 1 });
        }
      }
    }
  }
  return { count, exceededDepth };
}

/**
 * UTF-8 byte length of a string, counted code unit by code unit so a huge
 * string is never materialized into a buffer, stopping once `budget` is passed.
 */
function utf8ByteLength(s: string, budget: number): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      // Serialized size counts JSON escaping. Backspace, tab, newline, form
      // feed, and carriage return have two-byte short escapes; other control
      // characters expand to a six-byte \uXXXX; quote and backslash are two.
      if (
        code === 0x08 ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0c ||
        code === 0x0d
      ) {
        bytes += 2;
      } else if (code < 0x20) bytes += 6;
      else if (code === 0x22 || code === 0x5c) bytes += 2;
      else bytes += 1;
    } else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A high surrogate is a 4-byte code point only when a low surrogate
      // follows. A lone one is not valid UTF-8 and serializes as a six-byte
      // \uXXXX escape, and must not consume the next unit.
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6; // lone low surrogate → \uXXXX
    } else bytes += 3;
    if (bytes > budget) return bytes;
  }
  return bytes;
}

/**
 * Estimate a document's serialized byte size, aborting as soon as `limit` is
 * passed and WITHOUT materializing the full JSON string — so a document that
 * stays under the node/depth caps but hides a huge string cannot force a giant
 * allocation before being rejected. Iterative, so deep nesting cannot overflow.
 * When the walk completes under the limit, `bytes` is an exact-enough estimate;
 * when `exceeded` is true it stopped early.
 */
/**
 * Serialized size, counted rather than produced, stopping once past `limit`.
 *
 * `documentBytes` answers the same question by building the JSON string and
 * then a UTF-8 buffer of it, which is fine for a document already known to be
 * of reasonable size and is the wrong tool for DECIDING that. An oversized
 * value has to be rejected without first allocating two copies of itself.
 *
 * Pass `Number.POSITIVE_INFINITY` for an exact count with no early exit; any
 * finite limit makes `bytes` a lower bound once `exceeded` is true.
 */
/** Whether `JSON.stringify` writes this value rather than dropping it. */
function serializesAs(value: unknown): boolean {
  return (
    typeof value !== "undefined" &&
    typeof value !== "function" &&
    typeof value !== "symbol"
  );
}

/**
 * A value as `JSON.stringify` will SEE it: through `toJSON` when one exists.
 *
 * The hook runs before the writer decides anything else about the value —
 * including whether the value is writable at all. So a member whose `toJSON`
 * returns `undefined`, a function or a symbol is DROPPED, exactly as if it had
 * held that directly, and a decision made on the original object gets both the
 * size and the drop wrong.
 */
function asSerialized(value: unknown, key: string): unknown {
  return typeof (value as { toJSON?: unknown } | null | undefined)?.toJSON ===
    "function"
    ? (value as { toJSON: (key: string) => unknown }).toJSON(key)
    : value;
}

export function measureBytes(
  root: unknown,
  limit: number
): { bytes: number; exceeded: boolean } {
  let bytes = 0;
  // Each entry carries the KEY it sits under, because `toJSON` receives it.
  // `JSON.stringify` passes the containing property name — the index as a
  // string inside an array, and `""` for the root — and a hook that reads it
  // either throws on `undefined` or quietly returns something else. Both make
  // this counter disagree with the writer it exists to agree with.
  const stack: { value: unknown; key: string }[] = [{ value: root, key: "" }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    const popped = entry.value;
    // `toJSON` FIRST, because that is what `JSON.stringify` writes. A value
    // defining it is serialized as whatever it returns, not as the fields it
    // happens to carry — and this counter exists to agree with the serializer.
    // A `Date` is the everyday case: walking its enumerable fields finds none
    // and counts the empty object at 2 bytes, while the writer emits a 26-byte
    // quoted timestamp. A caller enforcing a storage cap through this function
    // would admit data the store then refuses.
    //
    // Load-bearing now that this is exported: inside this package every value
    // reaching it has already been established as plain JSON, so the gap could
    // not open. A public caller has made no such promise.
    const value = asSerialized(popped, entry.key);
    if (typeof value === "string") {
      bytes += 2 + utf8ByteLength(value, limit - bytes);
    } else if (typeof value === "number") {
      // `JSON.stringify` writes `null` for a number it cannot represent, so
      // `NaN` and the infinities cost four bytes rather than the three or eight
      // their `String()` form suggests. Counting the source spelling reads low
      // for NaN, which admits a value whose serialized form is over the cap.
      bytes += Number.isFinite(value) ? String(value).length : 4;
    } else if (typeof value === "boolean") {
      bytes += String(value).length;
    } else if (value === null || value === undefined) {
      bytes += 4;
    } else if (Array.isArray(value)) {
      // Count the array's own structural bytes (brackets + commas) and bail
      // BEFORE enqueuing elements: a huge array's comma count alone can exceed
      // the cap, so millions of entries must never be pushed first.
      bytes += 2 + Math.max(0, value.length - 1);
      if (bytes > limit) return { bytes, exceeded: true };
      // An element JSON cannot represent becomes `null` IN AN ARRAY, because an
      // array's length is part of its meaning. The same value inside an object
      // is dropped instead — see below. Normalised here so the walk never has
      // to remember which container a value came from.
      for (let index = 0; index < value.length; index += 1) {
        // Decided on what the WRITER will see. An element whose `toJSON`
        // returns a function or `undefined` becomes `null` in an array just as
        // a bare one does, and judging the original object keeps a member the
        // serializer drops.
        const written = asSerialized(value[index], String(index));
        stack.push({
          value: serializesAs(written) ? written : null,
          key: String(index),
        });
      }
    } else if (typeof value === "object") {
      // Only the members that will actually be written. `JSON.stringify` DROPS
      // an object member whose value is `undefined`, a function or a symbol —
      // key, colon, value and separator all — so charging for one measures a
      // document larger than the one that gets saved.
      //
      // This is not a rounding error in practice. An update that clears a field
      // leaves an own property holding `undefined`, so an edit that SHRINKS a
      // document was measured as growing it, and the cap refused the very edit
      // that would have brought an over-cap document back under.
      // Filtered on what `toJSON` RETURNS, not on the member as it stands. The
      // hook runs before the writer decides whether the member is writable at
      // all, so `{ x: { toJSON: () => undefined } }` is dropped entirely and
      // serializes to `{}` — charging its key, quotes and colon reports ten
      // bytes for two, and a caller enforcing a cap rejects data that fits.
      const entries = Object.entries(value as Record<string, unknown>)
        .map(([key, member]) => [key, asSerialized(member, key)] as const)
        .filter(([, member]) => serializesAs(member));
      // Braces AND the separators between entries, for the same reason the
      // array branch counts its commas: `{"a":1,"b":2}` carries one comma that
      // belongs to the object rather than to either entry, so charging it per
      // entry would over-count the last one and omitting it under-counts every
      // object with more than one property. Under-counting is the direction
      // that matters — it lets a document past a cap it actually exceeds, and
      // the validator, which decides the same question with this counter, then
      // does not catch it either.
      bytes += 2 + Math.max(0, entries.length - 1);
      if (bytes > limit) return { bytes, exceeded: true };
      for (const [key, val] of entries) {
        bytes += utf8ByteLength(key, limit) + 3; // quotes + colon
        if (bytes > limit) return { bytes, exceeded: true };
        stack.push({ value: val, key });
      }
    }
    if (bytes > limit) return { bytes, exceeded: true };
  }
  return { bytes, exceeded: false };
}

function checkLimits(
  doc: BlockDocument,
  limits: DocumentLimits,
  issues: ValidationIssue[]
): void {
  const { count, exceededDepth } = measureForest(
    doc.nodes,
    limits.maxNodes,
    limits.maxDepth
  );
  if (exceededDepth) {
    issues.push({
      path: "/nodes",
      code: "depth-exceeded",
      severity: "error",
      message: `Node tree is nested deeper than the maximum of ${limits.maxDepth}.`,
    });
  }
  if (count > limits.maxNodes) {
    issues.push({
      path: "/nodes",
      code: "node-count-exceeded",
      severity: "error",
      message: `Document exceeds the maximum of ${limits.maxNodes} nodes.`,
    });
  }
  // A structurally over-cap document is already rejected; skip the byte pass so
  // an oversized forest is never measured in full.
  if (exceededDepth || count > limits.maxNodes) return;

  // Measure serialized size with a bounded, non-materializing counter: a
  // document that stays under the node/depth caps but hides a huge string must
  // still be rejected without allocating a full JSON copy of it.
  const { bytes, exceeded } = measureBytes(doc, limits.maxBytes);
  if (exceeded) {
    issues.push({
      path: "",
      code: "document-too-large",
      severity: "error",
      message: `Document exceeds the maximum of ${limits.maxBytes} bytes.`,
    });
  } else if (bytes > limits.maxBytes * LIMIT_WARNING_RATIO) {
    issues.push({
      path: "",
      code: "document-size-warning",
      severity: "warning",
      message: `Document is ${bytes} bytes, over ${Math.round(
        LIMIT_WARNING_RATIO * 100
      )}% of the ${limits.maxBytes}-byte limit.`,
    });
  }
}

interface NodeCheckState {
  ctx: ValidationContext;
  issues: ValidationIssue[];
  knownBreakpoints: Set<string>;
  unknownSeverity: IssueSeverity;
  seenIds: Map<string, string>;
  /** Non-empty DOM ids seen so far (from `cssId` or `attributes.id`) → pointer. */
  seenDomIds: Map<string, string>;
  /** Shared across the whole document, so the limit is not per node. */
  styleBudget: ReadyStyleIssueBudget;
  /**
   * Set when the document already failed the byte cap. Its style values are
   * still walked for shape, which is cheap, but not PARSED: parsing every
   * value builds an AST apiece, and a document this size is rejected whatever
   * those values turn out to be, so the byte cap would otherwise bound the
   * document without bounding the work spent reading it.
   */
  skipValueParsing: boolean;
}

function validateNode(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  const { issues } = state;
  if (!isPlainRecord(node)) {
    issues.push({
      path,
      code: "invalid-node",
      severity: "error",
      message: "A node must be an object.",
    });
    return;
  }

  // id: present, non-empty, unique across the whole document.
  if (typeof node.id !== "string" || node.id.length === 0) {
    issues.push({
      path: pointer(path, "id"),
      code: "missing-node-id",
      severity: "error",
      message: "Every node needs a non-empty string id.",
    });
  } else {
    const firstSeenAt = state.seenIds.get(node.id);
    if (firstSeenAt !== undefined) {
      issues.push({
        path: pointer(path, "id"),
        code: "duplicate-node-id",
        severity: "error",
        message: `Node id "${describeValue(node.id)}" is already used at ${firstSeenAt}.`,
        suggestion: "Give every node a unique id.",
      });
    } else {
      state.seenIds.set(node.id, pointer(path, "id"));
    }
  }

  // type: namespaced slug, and — if a registry is supplied — registered.
  if (!isNodeType(node.type)) {
    issues.push({
      path: pointer(path, "type"),
      code: "invalid-node-type",
      severity: "error",
      message: `Node type "${describeValue(node.type)}" must be a namespaced slug like "core/heading".`,
    });
  } else if (
    state.ctx.registry &&
    // Engine-owned synthetic types are not registrable blocks and so are never
    // present in a block registry; exempt them from the registration check.
    !ENGINE_NODE_TYPES.has(node.type) &&
    !state.ctx.registry.has(node.type)
  ) {
    issues.push({
      path: pointer(path, "type"),
      code: "unknown-node-type",
      severity: state.unknownSeverity,
      message: `Node type "${describeValue(node.type)}" is not registered.`,
      suggestion: "Register the block or remove the node.",
    });
  }

  // version: positive integer.
  if (!isNodeVersion(node.version)) {
    issues.push({
      path: pointer(path, "version"),
      code: "invalid-node-version",
      severity: "error",
      message: "A node version must be a positive integer.",
    });
  }

  if (!isPlainRecord(node.props)) {
    issues.push({
      path: pointer(path, "props"),
      code: "invalid-props",
      severity: "error",
      message: "A node props field must be an object.",
    });
  }

  validateSlots(node, path, state);
  validateClasses(
    node,
    path,
    issues,
    state.ctx,
    state.styleBudget,
    state.skipValueParsing
  );
  validateAttributes(node, path, issues);
  validateStyles(node, path, state);
  validateVisibility(node, path, state);
  validateBindings(node, path, issues);
  validateComponentInstance(node, path, issues);
  validateDomIds(node, path, state);
}

/**
 * A rendered node's DOM id — from `cssId` or the `attributes.id` escape hatch —
 * must be unique across the document, or the page emits duplicate HTML `id`
 * attributes (breaking anchors, labels, and CSS selectors). Preservable, so the
 * severity follows the mode.
 */
function validateDomIds(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  const report = (domId: string, at: string): void => {
    const firstAt = state.seenDomIds.get(domId);
    if (firstAt !== undefined) {
      state.issues.push({
        path: at,
        code: "duplicate-dom-id",
        severity: state.unknownSeverity,
        message: `HTML id "${describeValue(domId)}" is already used at ${firstAt}.`,
        suggestion: "Give each element a unique id.",
      });
    } else {
      state.seenDomIds.set(domId, at);
    }
  };
  if (node.cssId !== undefined && typeof node.cssId !== "string") {
    state.issues.push({
      path: pointer(path, "cssId"),
      code: "invalid-css-id",
      severity: "error",
      message: "A node cssId must be a string.",
    });
  } else if (typeof node.cssId === "string" && node.cssId.length > 0) {
    report(node.cssId, pointer(path, "cssId"));
  }
  if (isPlainRecord(node.attributes)) {
    for (const [key, value] of Object.entries(node.attributes)) {
      if (key.toLowerCase() === "id" && typeof value === "string" && value) {
        // One node setting the same id through both `cssId` and `attributes.id`
        // renders a single id, so it must not be reported as colliding with
        // itself; only a second NODE claiming the id is a duplicate.
        if (value === node.cssId) continue;
        report(value, pointer(pointer(path, "attributes"), key));
      }
    }
  }
}

function validateSlots(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  if (node.slots === undefined) return;
  if (!isPlainRecord(node.slots)) {
    state.issues.push({
      path: pointer(path, "slots"),
      code: "invalid-slots",
      severity: "error",
      message: "A node slots field must be an object of node arrays.",
    });
    return;
  }
  for (const [slot, children] of Object.entries(node.slots)) {
    if (!Array.isArray(children)) {
      state.issues.push({
        path: pointer(pointer(path, "slots"), slot),
        code: "invalid-slots",
        severity: "error",
        message: `Slot "${describeValue(slot)}" must be an array of nodes.`,
      });
    }
    // Child nodes themselves are validated by the recursive walk in validate().
  }
}

function validateClasses(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[],
  ctx: ValidationContext,
  budget?: ReadyStyleIssueBudget,
  overLimits = false
): void {
  if (node.classes === undefined) return;
  // Index-based, not `.every` (which skips array holes), so a sparse classes
  // array — which serializes to `[null, …]` — is rejected, not accepted.
  let valid = Array.isArray(node.classes);
  if (valid) {
    for (let i = 0; i < node.classes.length; i++) {
      if (typeof node.classes[i] !== "string") {
        valid = false;
        break;
      }
    }
  }
  if (!valid) {
    issues.push({
      path: pointer(path, "classes"),
      code: "invalid-classes",
      severity: "error",
      message: "A node classes field must be an array of class-id strings.",
    });
    return;
  }
  // The compiler applies a bounded prefix of this list, so a longer one is a document that
  // validates and then renders differently from what it says. Reported here, where a save or a
  // publish can still refuse it, rather than being discovered as styling that silently did
  // nothing — the account this engine exists to give.
  //
  // An error only where a gate is being applied. A stored document already holding a longer list
  // has to stay readable, and downgrading it to a warning there says the same thing without
  // making the document unopenable.
  if (node.classes.length > MAX_CLASSES_PER_NODE) {
    issues.push({
      path: pointer(path, "classes"),
      code: "too-many-classes",
      severity: ctx.mode === "strict" ? "error" : "warning",
      message: `This node lists ${node.classes.length} classes; only the first ${MAX_CLASSES_PER_NODE} are applied.`,
    });
  }
  // A reference longer than a class id may be names nothing the library can hold, whatever a
  // caller's lookup answers: `isUsableNamedClass` refuses an entry carrying one, so the compiler
  // drops the reference. Reported here for the same reason the count above is — a document that
  // passes a strict publish and then renders without its class styling is the one outcome these
  // two halves must not produce between them.
  for (let index = 0; index < node.classes.length; index += 1) {
    const id = node.classes[index];
    if (id.length <= MAX_NAMED_CLASS_NAME_LENGTH) continue;
    issues.push({
      path: pointer(pointer(path, "classes"), index),
      code: "invalid-classes",
      severity: ctx.mode === "strict" ? "error" : "warning",
      message: `This class id is ${id.length} characters; a class id may be at most ${MAX_NAMED_CLASS_NAME_LENGTH}, so it was not applied.`,
    });
  }
  const lookup = ctx.classes;
  if (lookup === undefined) return;
  // A document a limit already refused is not read further, and the shape above
  // is all that is worth reading of it. Resolving names means handing every
  // class string to a lookup that hashes it, and a known id spends no allowance
  // to stop that, so a rejected document made of very many known ids would be
  // read in full right after a limit said not to read it.
  if (overLimits) return;
  // A WARNING in both modes, never an error. A class the site no longer defines
  // costs the element that class's styling and nothing else, and a document is
  // data while a class library is site configuration: deleting a class must not
  // make every document that used it unpublishable.
  for (let index = 0; index < node.classes.length; index += 1) {
    // A node may list as many class ids as a document has room for, and each
    // unknown one costs a lookup and an allocated issue. Bounded by the run's
    // SITE allowance, and by both of its dimensions: the count keeps one node
    // from turning a small document into a long report, and the path bytes keep
    // a node nested under a very long slot key from repeating that key in every
    // warning, which bounds how many are returned without bounding how large.
    //
    // The site allowance, not the structural one, because these are warnings
    // that never block a publish. Spending the structural allowance on them
    // would stop the checks that do decide validity, and the marker for
    // stopping those is an error.
    const id = node.classes[index];
    if (typeof id !== "string") continue;
    // Whether this id can be answered at all: from the cache for nothing, or by
    // asking the caller while there are lookups left to spend and an answer
    // could still be reported.
    if (!canResolveName(lookup, id, budget)) {
      issues.push(...siteTruncationNotice(budget, pointer(path, "classes")));
      continue;
    }
    // A KNOWN id is not a finding, so it truncates nothing. Resolving it first
    // and asking about the allowance second is what keeps the marker honest:
    // announced before the answer is known, it would claim names went unchecked
    // on a document whose every name checked out.
    if (lookup.has(id)) continue;
    const issuePath = pointer(pointer(path, "classes"), index);
    if (siteAllowanceSpent(budget)) {
      issues.push(...siteTruncationNotice(budget, issuePath));
      continue;
    }
    const issue: ValidationIssue = {
      path: issuePath,
      code: "unknown-class",
      severity: "warning",
      message: `The class "${describeValue(id)}" is not defined by this site.`,
      suggestion: "Create the class, or remove it from this node.",
    };
    chargeIssueBudget(budget, [issue]);
    issues.push(issue);
  }
}

function validateAttributes(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.attributes === undefined) return;
  if (
    !isPlainRecord(node.attributes) ||
    !Object.values(node.attributes).every(v => typeof v === "string")
  ) {
    issues.push({
      path: pointer(path, "attributes"),
      code: "invalid-attributes",
      severity: "error",
      message: "A node attributes field must be a string-to-string map.",
    });
    return;
  }
  // Event-handler attributes are inline JS, which blocks never allow; reject
  // them at the gate. The broader render-safe attribute allowlist is owned by
  // the renderer; validation does not duplicate it here to avoid two lists
  // drifting apart.
  for (const key of Object.keys(node.attributes)) {
    if (/^on/i.test(key)) {
      issues.push({
        path: pointer(pointer(path, "attributes"), key),
        code: "invalid-attributes",
        severity: "error",
        message: `Attribute "${describeValue(key)}" is an event handler; inline JavaScript is not allowed.`,
      });
    }
  }
}

function validateStyles(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  if (node.styles === undefined) return;
  validateStyleEnvelope(node.styles, pointer(path, "styles"), state);
}

/**
 * Validate a `NodeStyles` envelope (states × breakpoints × values) at any path.
 * Shared by node styles and document-level `settings.styles`, which use the
 * same shape.
 */
/**
 * The truncation marker for the envelope walk, emitted once per run. It shares
 * the budget's flag with the property walk, so a document that stops early says
 * so exactly once, wherever it stopped.
 */
/**
 * Whether an object carries any key of its own.
 *
 * `Object.keys` would build an array of every key merely to ask, which is the
 * unbounded work the issue budget exists to prevent — and this is asked at the
 * moment the budget has just run out.
 */
function hasOwnKey(value: Record<string, unknown>): boolean {
  for (const key in value) {
    if (Object.hasOwn(value, key)) return true;
  }
  return false;
}

function styleBudgetExhausted(
  state: NodeCheckState,
  path: string
): ValidationIssue[] {
  if (state.styleBudget.truncated) return [];
  state.styleBudget.truncated = true;
  return [
    {
      path,
      code: "style-issues-truncated",
      severity: "error",
      message:
        "There are more style problems than are reported here, so the rest of this document was not checked.",
    },
  ];
}

/**
 * Record one style-envelope issue and charge the run for it.
 *
 * Both dimensions of the allowance, never the count alone: these paths carry
 * the node's own pointer, so a node nested under a very long slot key repeats
 * that key in every issue reported beneath it, and a count-only charge bounds
 * how many are returned without bounding how large they are.
 */
function pushStyleIssue(state: NodeCheckState, issue: ValidationIssue): void {
  state.issues.push(issue);
  chargeIssueBudget(state.styleBudget, [issue]);
}

function validateStyleEnvelope(
  styles: unknown,
  stylesPath: string,
  state: NodeCheckState
): void {
  if (!isPlainRecord(styles)) {
    // Charged like every other style issue, and checked first: one per node
    // sounds bounded until a document carries thousands of nodes, and the cap
    // is document-wide rather than per node.
    if (structuralAllowanceSpent(state.styleBudget)) {
      state.issues.push(...styleBudgetExhausted(state, stylesPath));
      return;
    }
    pushStyleIssue(state, {
      path: stylesPath,
      code: "invalid-style-values",
      severity: "error",
      message: "A styles field must be an object.",
    });
    return;
  }
  // Enumerated lazily: `Object.entries` would build a pair for every state name
  // before the budget below sees the first one, which is the allocation the
  // budget exists to bound.
  for (const stateKey in styles) {
    if (!Object.hasOwn(styles, stateKey)) continue;
    const byBreakpoint = styles[stateKey];
    // The envelope's own keys are as unbounded as the values inside it: a
    // document can carry a hundred thousand unknown state names. The budget
    // therefore governs the whole style walk, not only the property level.
    //
    // Bailing here is right only for a state that produces an issue of its
    // own. A known state holding a map may hold nothing at all, and the marker
    // is an error, so deciding its fate before looking inside would reject a
    // document that was read in full. The breakpoint loop judges each entry.
    const stateIsKnown = STYLE_STATES.includes(
      stateKey as (typeof STYLE_STATES)[number]
    );
    const stateHasOwnIssue = !stateIsKnown || !isPlainRecord(byBreakpoint);
    if (structuralAllowanceSpent(state.styleBudget) && stateHasOwnIssue) {
      state.issues.push(...styleBudgetExhausted(state, stylesPath));
      return;
    }
    const statePath = pointer(stylesPath, stateKey);
    if (!stateIsKnown) {
      pushStyleIssue(state, {
        path: statePath,
        code: "invalid-style-state",
        severity: "error",
        message: `"${describeValue(stateKey)}" is not a known style state.`,
        suggestion: `Use one of: ${STYLE_STATES.join(", ")}.`,
      });
      continue;
    }
    if (!isPlainRecord(byBreakpoint)) {
      pushStyleIssue(state, {
        path: statePath,
        code: "invalid-style-values",
        severity: "error",
        message: `Style state "${describeValue(stateKey)}" must map breakpoint ids to values.`,
      });
      continue;
    }
    for (const breakpointId in byBreakpoint) {
      if (!Object.hasOwn(byBreakpoint, breakpointId)) continue;
      const values = byBreakpoint[breakpointId];
      // Two different questions, so two different tests. Stopping the WHOLE
      // walk here is only free if this entry would say nothing at all, and an
      // unknown breakpoint still reports that it is unknown — exempting it
      // would let the walk run past the cap while emitting. Skipping just this
      // entry's VALUES, at the recheck below, is free whenever there are none,
      // whatever the breakpoint id turned out to be.
      const noValuesHere = isPlainRecord(values) && !hasOwnKey(values);
      const nothingLeftHere =
        noValuesHere && state.knownBreakpoints.has(breakpointId);
      if (structuralAllowanceSpent(state.styleBudget) && !nothingLeftHere) {
        state.issues.push(...styleBudgetExhausted(state, statePath));
        return;
      }
      const bpPath = pointer(statePath, breakpointId);
      if (!state.knownBreakpoints.has(breakpointId)) {
        pushStyleIssue(state, {
          path: bpPath,
          code: "unknown-breakpoint",
          severity: state.unknownSeverity,
          message: `Breakpoint "${describeValue(breakpointId)}" is not defined for this site.`,
        });
      }
      // Rechecked between the two: an unknown breakpoint and a malformed value
      // are independently chargeable, so the first can spend the last slot and
      // the second would otherwise push past the cap without saying it stopped.
      // Nothing is skipped when this breakpoint holds no values, though, and
      // the marker is an error — claiming a document went unchecked when it did
      // not would reject it for having been fully read.
      if (structuralAllowanceSpent(state.styleBudget) && !noValuesHere) {
        state.issues.push(...styleBudgetExhausted(state, bpPath));
        return;
      }
      if (!isPlainRecord(values)) {
        pushStyleIssue(state, {
          path: bpPath,
          code: "invalid-style-values",
          severity: "error",
          message: `Style values at "${describeValue(breakpointId)}" must be an object.`,
        });
        continue;
      }
      // The envelope's shape is only half of what makes a style block valid:
      // the properties inside it have to be ones the catalog defines, holding
      // values of the shape it declares. Checking them here is what puts unsafe
      // values in front of the same gate every other document defect passes.
      // The property walk charges the budget for every issue it returns, so
      // there is nothing to subtract here; doing so would bill each one twice.
      state.issues.push(
        ...validateStyleValues(
          values,
          bpPath,
          state.ctx.mode,
          state.styleBudget,
          state.skipValueParsing,
          state.ctx.tokens
        )
      );
    }
  }
}

function validateVisibility(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  if (node.visibility === undefined) return;
  const vis = node.visibility;
  const visPath = pointer(path, "visibility");
  if (!isPlainRecord(vis)) {
    state.issues.push({
      path: visPath,
      code: "invalid-visibility",
      severity: "error",
      message: "A node visibility field must be an object.",
    });
    return;
  }
  if (vis.conditions !== undefined) {
    // Each condition needs a string `field` AND a string `op`; the optional
    // `value` may be anything. Index-based loops (not `.every`, which skips
    // holes) so a sparse array's undefined entries are rejected, not passed.
    const ok = isConditionsShapeValid(vis.conditions);
    if (!ok) {
      state.issues.push({
        path: pointer(visPath, "conditions"),
        code: "invalid-visibility",
        severity: "error",
        message:
          "visibility.conditions must be an OR-array of AND-arrays of {field, op, value?}.",
      });
    }
  }
  if (vis.devices !== undefined) {
    if (!isPlainRecord(vis.devices)) {
      state.issues.push({
        path: pointer(visPath, "devices"),
        code: "invalid-visibility",
        severity: "error",
        message: "visibility.devices must map breakpoint ids to booleans.",
      });
    } else {
      for (const [breakpointId, value] of Object.entries(vis.devices)) {
        const devicePath = pointer(pointer(visPath, "devices"), breakpointId);
        if (!state.knownBreakpoints.has(breakpointId)) {
          state.issues.push({
            path: devicePath,
            code: "unknown-breakpoint",
            severity: state.unknownSeverity,
            message: `Breakpoint "${describeValue(breakpointId)}" is not defined for this site.`,
          });
        }
        // The stored shape is Record<breakpointId, boolean>; a truthy string or
        // number would render differently from the author's intent.
        if (typeof value !== "boolean") {
          state.issues.push({
            path: devicePath,
            code: "invalid-visibility",
            severity: "error",
            message: `visibility.devices["${describeValue(breakpointId)}"] must be a boolean.`,
          });
        }
      }
    }
  }
}

/**
 * True if `conditions` is a well-formed OR-of-AND array of `{field, op}`.
 * Iterates by index rather than with `.every`, which skips array holes, so a
 * sparse array's `undefined` entries are treated as invalid, not passed over.
 */
function isConditionsShapeValid(conditions: unknown): boolean {
  if (!Array.isArray(conditions)) return false;
  for (let g = 0; g < conditions.length; g++) {
    const group: unknown = conditions[g];
    if (!Array.isArray(group)) return false;
    for (let c = 0; c < group.length; c++) {
      const cond: unknown = group[c];
      if (
        !isPlainRecord(cond) ||
        typeof cond.field !== "string" ||
        typeof cond.op !== "string"
      ) {
        return false;
      }
    }
  }
  return true;
}

const BINDING_SOURCES = ["entry", "item", "single", "site"];

/**
 * A binding path is a dot-joined chain of field identifiers, e.g. "title" or
 * "author.name". This rejects expression-like or otherwise malformed strings so
 * nothing evaluable is ever stored. The one-hop RELATION limit is semantic and
 * needs the schema, so it is enforced where bindings are resolved, not here.
 */
const BIND_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function validateBindings(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.bindings === undefined) return;
  if (!isPlainRecord(node.bindings)) {
    issues.push({
      path: pointer(path, "bindings"),
      code: "invalid-binding",
      severity: "error",
      message: "A node bindings field must be an object keyed by prop name.",
    });
    return;
  }
  const bindingsPath = pointer(path, "bindings");
  for (const [prop, binding] of Object.entries(node.bindings)) {
    const bPath = pointer(bindingsPath, prop);
    // Check the shape BEFORE reading any field: a null/primitive binding value
    // must produce an issue, not a thrown property access.
    if (!isPlainRecord(binding)) {
      issues.push({
        path: bPath,
        code: "invalid-binding",
        severity: "error",
        message: "A binding must be an object with a string $bind path.",
      });
      continue;
    }
    const bindPath = binding.$bind;
    if (typeof bindPath !== "string") {
      issues.push({
        path: bPath,
        code: "invalid-binding",
        severity: "error",
        message: "A binding must be an object with a string $bind path.",
      });
      continue;
    }
    if (!BIND_PATH_RE.test(bindPath)) {
      issues.push({
        path: pointer(bPath, "$bind"),
        code: "invalid-binding",
        severity: "error",
        message: `Binding path "${describeValue(bindPath)}" must be a dot-joined field path (never an expression).`,
      });
    }
    const source: unknown = binding.source;
    if (
      source !== undefined &&
      (typeof source !== "string" || !BINDING_SOURCES.includes(source))
    ) {
      issues.push({
        path: pointer(bPath, "source"),
        code: "invalid-binding",
        severity: "error",
        message: `Binding source "${describeValue(source)}" is not one of: ${BINDING_SOURCES.join(", ")}.`,
      });
    }
    const sourceKey = binding.sourceKey;
    if (source === "single") {
      if (typeof sourceKey !== "string" || sourceKey.length === 0) {
        issues.push({
          path: pointer(bPath, "sourceKey"),
          code: "missing-source-key",
          severity: "error",
          message:
            'A binding with source "single" must name the single via sourceKey.',
          suggestion: "Set sourceKey to the single's slug.",
        });
      }
    } else if (sourceKey !== undefined) {
      // sourceKey is reserved for single-sourced bindings; on any other source
      // it is an ambiguous, unresolvable field.
      issues.push({
        path: pointer(bPath, "sourceKey"),
        code: "invalid-binding",
        severity: "error",
        message: 'sourceKey is only allowed when source is "single".',
      });
    }
  }
}

function validateComponentInstance(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.type !== COMPONENT_INSTANCE_TYPE) return;
  // Only check componentId once props is an object: if props is missing or
  // malformed, `invalid-props` already covers it and a `/props/componentId`
  // pointer would target a location a fixer cannot edit.
  if (!isPlainRecord(node.props)) return;
  const componentId = node.props.componentId;
  if (typeof componentId !== "string" || componentId.length === 0) {
    issues.push({
      path: pointer(pointer(path, "props"), "componentId"),
      code: "invalid-component-instance",
      severity: "error",
      message:
        "A component-instance node must set props.componentId to the component's id.",
    });
  }
}
