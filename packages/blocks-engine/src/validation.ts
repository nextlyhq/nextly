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
  BINDING_SOURCES,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  EXPOSED_PROPERTY_TYPES,
  MAX_CLASSES_PER_NODE,
  STYLE_STATES,
  isBindingSource,
  isBlockType,
} from "./document";
import { describeValue, pointer } from "./issue-text";
import {
  DEFAULT_LIMITS,
  LIMIT_WARNING_RATIO,
  MAX_ENVELOPE_ENTRIES,
} from "./limits";
import type { DocumentLimits } from "./limits";
import { surveyDocument } from "./measure-bytes";
import type { DocumentSurvey } from "./measure-bytes";
import { canBeRoot, canNest, canNestInSlot } from "./nesting";
import type { NestingSource } from "./nesting";
import { isPlainRecord } from "./plain-record";
import type { TokenKind } from "./style/catalog-types";
import { breakpointContexts } from "./style/compile-page";
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
import { walkNodes } from "./tree";

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
  /**
   * How to resolve a block's declared parents, for checking that each node sits
   * somewhere its own definition permits.
   *
   * Separate from {@link registry} because that lookup answers whether a type is
   * registered and nothing else, and widening it would make every existing
   * caller owe an answer about nesting to keep reporting unknown types.
   *
   * Absent means nesting is not checked, the same terms as tokens and classes: a
   * document is validated against what the caller can answer for. That is
   * fail-open and worth naming as such — a caller that omits this gets no
   * placement issues rather than an error saying it could not look.
   */
  nesting?: NestingSource;
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
  "component-envelope-invalid":
    "A component document's exposed list or slot map is not the right shape.",
  "exposed-property-invalid":
    "An exposed property is missing a required field or declares an unknown type.",
  "exposed-duplicate-id":
    "Two exposed properties or slots share one id, so an override cannot address either.",
  "exposed-node-missing":
    "An exposed property or slot points at a node this document does not contain.",
  "exposed-path-invalid":
    "An exposed property's prop path is not a dot-joined chain of field identifiers.",
  "exposed-options-invalid":
    "An exposed property declares options without being a select, or a select declares none.",
  "exposed-slot-missing":
    "An exposed slot names a slot the node it points at does not declare.",
  "variant-unknown-target":
    "A variant names an exposed property or slot the definition does not expose.",
  "invalid-document": "The document is not an object.",
  "nodes-not-array": "The document nodes field is not an array.",
  "invalid-node": "A node is not an object.",
  "depth-exceeded": "The node tree is nested deeper than the allowed maximum.",
  "node-count-exceeded":
    "The document has more nodes than the allowed maximum.",
  "document-too-large": "The serialized document exceeds the byte limit.",
  "document-unwritable":
    "The document holds a value JSON cannot write, so it has no stored form.",
  "document-lossy":
    "The document holds a value JSON rewrites, so the stored form differs from it.",
  "document-unreadable":
    "The document holds a member the validator will not read, so it cannot be measured.",
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
  "invalid-block-part":
    "A block names an element it renders, and the name is not a lowercase slug, so that part's default styles were not written.",
  // Spelled the same as the `NestingRefusal` members they report, so the code a
  // caller matches on and the reason the rule gave are one string rather than a
  // mapping that has to be kept in step.
  "wrong-parent":
    "A node declares the block types it may sit under, and its container is not one of them.",
  "not-allowed-in-slot":
    "A container's slot declares the block types it holds, and this node is not one of them.",
  "restricted-at-root":
    "A node declares the block types it may sit under, and it sits at the top level, which is inside none of them.",
} as const;

/** A stable validation issue code. */
export type IssueCode = keyof typeof ISSUE_CODES;

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
  return isBlockType(value);
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
/**
 * What one validation produced: the issues, and the survey they were derived
 * from.
 *
 * The survey is published because a caller that goes on to walk the same
 * document needs to know whether the engine measured it in FULL, and issue
 * codes are the wrong channel for that question. A code says what is wrong with
 * the document; `complete` says whether these numbers can be trusted, and the
 * two do not line up — a document JSON merely rewrites is fully measured and
 * safe to walk, while one holding an accessor is neither, and both are errors.
 *
 * Reconstructing the second answer from the first means keeping a list of codes
 * in the consumer, which is a copy of a fact the engine already established and
 * goes stale in silence when a verdict is added.
 */
export interface ValidationResult {
  issues: ValidationIssue[];
  survey: DocumentSurvey;
}

/**
 * Issues only — the narrow view, DERIVED from {@link validateDocument} rather
 * than computed beside it.
 *
 * Most callers want exactly this and should keep using it. Reach for the richer
 * function when the answer decides whether to do more work on the same
 * document.
 */
export function validate(
  doc: BlockDocument,
  ctx: ValidationContext
): ValidationIssue[] {
  return validateDocument(doc, ctx).issues;
}

export function validateDocument(
  doc: BlockDocument,
  ctx: ValidationContext
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const limits = ctx.limits ?? DEFAULT_LIMITS;
  // Taken before ANY return, so every path can hand back the measurement it
  // judged the document with. The walk accepts arbitrary input by design, so a
  // malformed document surveys as readily as a well-formed one — and a caller
  // that gets issues without a survey would have to guess whether the absence
  // means "not measured" or "nothing to measure".
  const survey = surveyDocument(doc, {
    maxBytes: limits.maxBytes,
    maxDepth: limits.maxDepth,
    maxNodes: limits.maxNodes,
  });
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
    return { issues, survey };
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
    return { issues, survey };
  }

  checkLimits(survey, issues);
  //
  // `document-unwritable` belongs here for a sharper reason than tidiness: the
  // byte pass could not measure what it refused. A `styles` accessor is
  // reported absent rather than invoked, so its megabytes were never counted —
  // and the per-value work below reaches the same field by ordinary property
  // access, runs the getter, and parses everything it returns. Leaving it out
  // meant the one document whose size is UNKNOWN was the one whose values were
  // parsed in full.
  // Asked of the SURVEY rather than reconstructed from the issues it produced.
  // Matching issue codes re-derives, from four strings, a fact the walk already
  // established — and a code list is a second statement of when the numbers are
  // untrustworthy, which goes stale the first time a fifth way to stop short is
  // added. `complete` is that fact, derived where it is known.
  //
  // `traversed`, NOT `complete`, and the difference is a fail-open. `complete`
  // additionally requires the counts to be the writer's, so a node hook
  // returning a replacement makes it false on a document the walk read from end
  // to end — and every per-value check below was then skipped on a document
  // with nothing wrong with it. Coverage silently dropped, no issue raised.
  //
  // The narrow question is the one this needs. A document JSON merely REWRITES
  // was measured in full, so the per-value work below is bounded and skipping it
  // would drop real issues on a document whose only fault is that a value comes
  // back changed. It is a measurement that STOPPED SHORT which leaves nothing
  // bounded, and that is exactly what `traversed` reports.
  const overLimits = !survey.traversed;

  // Per-kind rules. Only `component` has any today, and it is the kind whose
  // extra fields nothing else in the document can check: `exposed` and `slots`
  // are pointers INTO the node forest, so this is the first point at which
  // they can be resolved at all.
  //
  // After the limits verdict, and skipped once it is negative, for the same
  // reason the per-value work below is: a document the survey could not
  // traverse is refused already, and an envelope with a million entries would
  // otherwise be walked in full — and produce an issue per entry — to add
  // nothing to a refusal that has already been made.
  if (kind === "component" && !overLimits) {
    // The SURVEY's snapshot, not `limits`. `DocumentLimits` is an ordinary
    // object a caller may back with a getter, and `surveyDocument` snapshots
    // it precisely so two readings cannot disagree. Re-reading here would let
    // a shrinking limit report a node the survey counted as missing from the
    // index, which surfaces as `exposed-node-missing` on a sound definition.
    validateComponentEnvelope(
      rawDoc,
      rawDoc.nodes as BlockNode[],
      survey.limits.maxNodes,
      issues
    );
  }

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
  // Where this node was reached from, carried on the queue entry: a
  // breadth-first walk has already left the parent behind by the time a node is
  // dequeued, and re-deriving it would mean a second traversal answering a
  // question this one already knew.
  //
  // THREE states, not a nullable type. "At the top level" and "inside a
  // container whose type is malformed" are different facts, and one absent value
  // standing for both makes a child in a slot answer the ROOT question — which
  // reports it as sitting nowhere while its own path says which slot holds it.
  const queue: Array<{
    node: BlockNode;
    path: string;
    placement: Placement;
  }> = [];
  for (
    let i = 0;
    i < doc.nodes.length && queue.length <= survey.limits.maxNodes;
    i++
  ) {
    queue.push({
      node: doc.nodes[i],
      path: pointer("/nodes", i),
      placement: { at: "root" },
    });
  }
  for (let i = 0; i < queue.length && i < survey.limits.maxNodes; i++) {
    const { node, path, placement } = queue[i];
    validateNode(node, path, nodeState);
    checkNesting(node, path, placement, nodeState);
    if (isPlainRecord(node) && isPlainRecord(node.slots)) {
      // The container's placement for every child beneath it, read once.
      //
      // `isNodeType`, NOT a `typeof` check, and they are not the same boundary:
      // `"columns"` and `"core/columns/"` are strings that no block can be
      // named, so a weaker guard admits them as container NAMES and a restricted
      // child is then refused against a name nothing could ever match. The
      // predicate used here is the one that decides `invalid-node-type`, so a
      // container reported as malformed is exactly a container this cannot name.
      //
      // Children are still walked and still checked for everything else. Only
      // the one question that needs the container's name is recorded as
      // unanswerable rather than answered from a name that does not exist.
      // The container's name, resolved once; the SLOT differs per iteration, so
      // the placement is built inside the loop. Hoisting it would carry one
      // slot's name to every sibling slot's children and check each against the
      // wrong allow-list — a refusal naming a slot the node is not in.
      const containerType = isNodeType(node.type) ? node.type : undefined;
      for (const [slot, children] of Object.entries(node.slots)) {
        const childPlacement: Placement =
          containerType === undefined
            ? { at: "unnameable-container" }
            : { at: "container", type: containerType, slot };
        if (Array.isArray(children)) {
          const slotPath = pointer(pointer(path, "slots"), slot);
          for (
            let c = 0;
            c < children.length && queue.length <= survey.limits.maxNodes;
            c++
          ) {
            queue.push({
              node: children[c],
              path: pointer(slotPath, c),
              placement: childPlacement,
            });
          }
        }
      }
    }
  }

  return { issues, survey };
}

/**
 * Where the walk reached a node from.
 *
 * `unnameable-container` is its own member rather than an absent type, because
 * the alternative — one nullable field for both "no container" and "a container
 * I cannot name" — makes the two indistinguishable at the point of use, and the
 * rule then answers the root question for a node that is plainly in a slot.
 */
type Placement =
  | { at: "root" }
  | { at: "container"; type: string; slot: string }
  | { at: "unnameable-container" };

/**
 * Report a node sitting somewhere its own definition does not permit.
 *
 * The rule is asked of `canNest`/`canBeRoot` rather than restated here, so the
 * canvas refusing a drag and this refusing a save cannot drift: one of them
 * would otherwise start permitting a placement the other writes, and a drag that
 * is refused leaves nothing behind to compare against.
 *
 * An ERROR in both modes. `parent` is the child stating where it is meaningful,
 * so a violation is a document that renders somewhere its author never said it
 * could — not a forward-compatible value to preserve, which is what the lenient
 * mode exists for.
 */
function checkNesting(
  node: BlockNode,
  path: string,
  placement: Placement,
  state: NodeCheckState
): void {
  const source = state.ctx.nesting;
  if (source === undefined) return;
  // A container this walk cannot name cannot be judged against. The container's
  // own malformed type is already reported, and answering anyway would mean
  // either inventing a name or treating a node in a slot as a root — the second
  // being the trap, because it produces a confident refusal saying the node
  // sits nowhere while its own path names the slot holding it.
  if (placement.at === "unnameable-container") return;
  // The same predicate the container is judged by, for the same reason. A
  // malformed type is reported by `validateNode`; asking the rule about it would
  // get "no restriction" back for a name no definition carries, which is a
  // confident answer to a question the document cannot pose.
  const raw: unknown = node;
  if (!isPlainRecord(raw) || !isNodeType(raw.type)) return;
  // Both halves, and the CHILD's first. Either refusal is enough, so the order
  // decides only which reason an author is shown, and "this block belongs
  // elsewhere" is the more actionable of the two — a slot refusal for a block
  // that never belonged under this parent describes the symptom rather than the
  // mistake.
  const verdict =
    placement.at === "root"
      ? canBeRoot(raw.type, source)
      : (() => {
          const child = canNest(raw.type, placement.type, source);
          if (!child.allowed) return child;
          return canNestInSlot(
            raw.type,
            placement.type,
            placement.slot,
            source
          );
        })();
  if (verdict.allowed) return;
  // The refusal's own reason IS the issue code, so a rule added to
  // `NestingRefusal` reaches the document already named rather than through a
  // mapping that answers for the members it was written with.
  state.issues.push({
    path,
    code: verdict.reason,
    severity: "error",
    message: messageForRefusal(raw.type, placement, verdict.permitted),
  });
}

/**
 * Names the containers the block WILL go in, because that is the author's next
 * action. A sentence saying only that the placement is wrong leaves them to find
 * the permitted set by trying positions.
 *
 * Takes the restriction the REFUSAL carried, never the source. Asking the source
 * again would be a second answer to the question the verdict already settled,
 * and nothing requires a caller-supplied lookup to be idempotent — so a stateful
 * or lazily-resolved one could name a set other than the one that refused this
 * placement. Both inputs now come from the verdict, so the sentence cannot
 * describe a position or a permitted set other than the ones that were judged.
 */
function messageForRefusal(
  childType: string,
  placement: Placement,
  permitted: readonly string[]
): string {
  const where = permitted.map(name => describeValue(name)).join(" or ");
  return placement.at === "container"
    ? `A "${describeValue(childType)}" may only sit inside ${where}, not inside "${describeValue(placement.type)}".`
    : `A "${describeValue(childType)}" may only sit inside ${where}, and a top-level node sits inside nothing.`;
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
  // REPORTED above, DERIVED here. The scan exists to tell an author about a
  // duplicate id; which ids this site actually defines is a different question,
  // and the compiler is the only thing that answers it. Returning the scanned
  // set made validation and compilation disagree about the same document: a
  // definition the compiler drops — an unusable bound, a viewport entry with no
  // bound at all, a duplicate past the first, one past the per-axis cap, or an
  // id longer than it will read — was counted as known here, so styles keyed to
  // it validated with no issue and then compiled to nothing, reported only as an
  // unknown breakpoint by a pass the author never ran.
  //
  // It also answers the opposite case: `breakpointContexts` always carries the
  // base context, so styles keyed to `base` are known even when the stored set
  // names no base definition — which the scan alone got wrong in the direction
  // of reporting a value that compiles perfectly well.
  return new Set(breakpointContexts(breakpoints).map(context => context.id));
}

/**
 * Whole-document verdicts, which a per-value walk can restate more precisely.
 *
 * Each of these describes the document as a WHOLE — its size, or what the
 * writer would do to it — rather than naming a place in it. A consumer that
 * walks the document itself can report the same fact against the actual key,
 * so it needs to know which issues are summaries it is entitled to replace.
 *
 * Exported because that consumer would otherwise keep its own list, and a list
 * in another package is a second statement of this one: `plugin-page-builder`
 * held exactly such a set, naming two of these, and adding a third verdict here
 * silently reclassified it there — the precise per-key report was dropped in
 * favour of the summary it was meant to replace.
 *
 * `invalid-document` is deliberately NOT here. It says the walk cannot run at
 * all, so nothing can restate it.
 *
 * Kept beside the code that emits them: a new document-level verdict is added
 * in this file, and belongs in this set in the same edit.
 */
/**
 * Verdicts meaning the engine did NOT measure the document in full.
 *
 * The bounded walk stopped early — at the byte cap, at a structural cap, or at
 * a member it refused to read — so `bytes`, `nodes` and `depth` are lower
 * bounds. A consumer that responds by making a second, UNBOUNDED pass over the
 * same document undoes the bound the engine exists to impose.
 *
 * Serializing is the pass that matters, and for an unreadable document it is
 * worse than expensive. The survey declines to invoke an accessor precisely so
 * that document-supplied code does not run inside a precondition;
 * `JSON.stringify` invokes it happily. A caller that reaches for the whole
 * document after this verdict executes exactly the code the refusal existed to
 * avoid, and materializes whatever it returns.
 *
 * Exported for the same reason as {@link DOCUMENT_VERDICT_CODES}: the consumer
 * would otherwise name these itself, and a name kept in step by hand is how a
 * new verdict silently joins the safe list.
 */
export const INCOMPLETE_SURVEY_CODES: ReadonlySet<IssueCode> = new Set([
  "document-too-large",
  "document-unreadable",
  "node-count-exceeded",
  "depth-exceeded",
]);

export const DOCUMENT_VERDICT_CODES: ReadonlySet<IssueCode> = new Set([
  "document-too-large",
  "document-unwritable",
  "document-unreadable",
  "document-lossy",
  "document-size-warning",
]);

function checkLimits(survey: DocumentSurvey, issues: ValidationIssue[]): void {
  // ONE traversal answers all three bounds, taken by the caller and handed
  // here.
  //
  // Depth, node count and serialized size were measured by two separate walks,
  // and the second of them had to decide what counts as a node and how deep it
  // sits in order to measure anything at all. So "what is a node" had two
  // implementations that agreed on the day they were written and nothing to
  // keep them agreeing — and a document sits between them only when they
  // disagree, which is exactly when nobody is looking. Every accepted document
  // also paid for the tree twice.
  if (survey.tooDeep) {
    issues.push({
      path: "/nodes",
      code: "depth-exceeded",
      severity: "error",
      message: `Node tree is nested deeper than the maximum of ${survey.limits.maxDepth}.`,
    });
  }
  if (survey.tooManyNodes) {
    issues.push({
      path: "/nodes",
      code: "node-count-exceeded",
      severity: "error",
      message: `Document exceeds the maximum of ${survey.limits.maxNodes} nodes.`,
    });
  }
  // A structurally over-cap document is already rejected, and the walk stopped
  // at that breach — so its byte count is a lower bound rather than a
  // measurement, and reporting a size from it would report a number that was
  // never finished.
  if (survey.tooDeep || survey.tooManyNodes) return;

  // The CAUSE, not just the refusal. A document over the limit is fixed by
  // removing content; one holding a value JSON cannot write is not made smaller
  // by deleting blocks, and reporting it as "too large" sends its author to
  // work that cannot help.
  //
  // Read off the SAME survey that answered depth and node count, rather than
  // from a second measurement. Over-limit is reported ahead of unwritable when
  // a document is both: the byte issue is what gates the precise walk
  // downstream, so losing it to the other cause is what lets an unbounded
  // traversal run.
  const { bytes } = survey;
  if (survey.tooLarge) {
    issues.push({
      path: "",
      code: "document-too-large",
      severity: "error",
      message: `Document exceeds the maximum of ${survey.limits.maxBytes} bytes.`,
    });
  } else if (survey.unwritable) {
    issues.push({
      path: "",
      code: "document-unwritable",
      severity: "error",
      message:
        "Document holds a value JSON cannot write, so it has no stored form.",
    });
  } else if (survey.unreadable) {
    // `unreadable`, not `!complete`. A survey is ALSO incomplete when its byte
    // count is approximate — a node hook returning a replacement — and such a
    // document was read perfectly well; JSON merely rewrites it. Reporting that
    // here told an author the validator refused to read a member it had read,
    // and sent them looking for a member that is not the problem.
    //
    // After `unwritable`, because a cycle is both and "no stored form" is the
    // more actionable of the two. Before `lossy`, because a walk that stopped
    // short cannot describe what it never reached.
    issues.push({
      path: "",
      code: "document-unreadable",
      severity: "error",
      message:
        "Document holds a member the validator will not read, so it cannot be measured.",
    });
  } else if (survey.lossy) {
    // A DIFFERENT statement, because the document has a stored form and it is
    // not this one. Reporting it as unwritable said the content could not be
    // saved at all, which sent an author looking for a value that JSON refuses
    // when the real answer is that a value they hold will come back changed.
    issues.push({
      path: "",
      code: "document-lossy",
      severity: "error",
      message:
        "Document holds a value JSON rewrites, so the stored form differs from it.",
    });
  } else if (bytes > survey.limits.maxBytes * LIMIT_WARNING_RATIO) {
    issues.push({
      path: "",
      code: "document-size-warning",
      severity: "warning",
      message: `Document is ${bytes} bytes, over ${Math.round(
        LIMIT_WARNING_RATIO * 100
      )}% of the ${survey.limits.maxBytes}-byte limit.`,
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
  // Before the field is READ, not after. Every check below walks a list whose
  // length the document controls, and each re-reads `node.classes`, so the
  // field is reached about twice per member — the unbounded work the caps exist
  // to prevent, on a document whose measurement never bounded anything.
  //
  // Safe to skip only because this flag is now the NARROW question. A document
  // JSON merely rewrites was measured in full, so it does not reach here and
  // still has its classes validated; a sparse array is exactly that case, and
  // gating on the wider "not serializable" dropped its `invalid-classes` report
  // entirely.
  if (overLimits) return;
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

// ---------------------------------------------------------------------------
// The component definition envelope (`kind: "component"`)
// ---------------------------------------------------------------------------

/**
 * Every node in the forest, by id.
 *
 * Its own bounded walk rather than a share of the main one. The envelope needs
 * the WHOLE index before it can judge its first pointer, while the main walk
 * reports as it goes — so reusing it would mean either checking pointers
 * against a half-built index, or holding the envelope's issues back to the end
 * and reordering the report. A second walk of a component document, bounded by
 * the same snapshotted node cap, costs less than either.
 */
function nodesById(nodes: BlockNode[], maxNodes: number) {
  const index = new Map<string, BlockNode>();
  // The snapshotted node bound, so this walk and the survey that measured the
  // document agree on how many nodes there are. A caller may back
  // `DocumentLimits` with a getter, and two readings that disagree would build
  // an index missing a node the survey counted — reported as a sound exposure
  // pointing at nothing.
  walkNodes(
    nodes,
    node => {
      // First writer wins. A forest with a duplicated id is already reported by
      // the main walk, and overwriting here would make the envelope's answer
      // depend on traversal order for a document that is being refused anyway.
      if (!index.has(node.id)) index.set(node.id, node);
    },
    { maxNodes }
  );
  return index;
}

/**
 * Walk an untrusted array, bounded, without calling a method on it.
 *
 * Two hazards in one helper, because the envelope reads arrays a caller
 * supplied and both apply to every one of them.
 *
 * BOUNDED, on the collection's own terms. The survey measures what
 * `JSON.stringify` would emit, so a field carrying a `toJSON` returning `[]`
 * is measured as two bytes while this reads the real array by ordinary
 * property access — a document that passes a 200-byte survey can still hold a
 * hundred thousand entries. Nothing upstream bounds what is read here.
 *
 * BY INDEX, never `forEach`. The array is a caller's object, so its `forEach`
 * may be shadowed with a non-function, and validation would throw where its
 * whole contract is to RETURN issues about malformed input.
 *
 * @returns false when the collection was refused for its size, so a caller
 * skips the work rather than reporting a fault per entry on top of it.
 */
function eachBounded(
  items: readonly unknown[],
  path: string,
  what: string,
  issues: ValidationIssue[],
  visit: (entry: unknown, index: number) => void
): boolean {
  if (!withinBudget(items.length, path, what, issues)) return false;
  for (let i = 0; i < items.length; i += 1) visit(items[i], i);
  return true;
}

/** Report once when a collection is too large to be worth walking. */
function withinBudget(
  size: number,
  path: string,
  what: string,
  issues: ValidationIssue[]
): boolean {
  if (size <= MAX_ENVELOPE_ENTRIES) return true;
  issues.push({
    path,
    code: "component-envelope-invalid",
    severity: "error",
    message: `A component declares ${size} ${what}, more than the ${MAX_ENVELOPE_ENTRIES} an envelope may hold.`,
  });
  return false;
}

/**
 * The own keys of an untrusted record, or `null` when there are too many.
 *
 * Counted with `for...in` and stopped at the budget rather than materializing
 * `Object.keys` first: a map with a hundred thousand keys would otherwise be
 * enumerated into an array in full before anything could refuse it, which is
 * the allocation the budget exists to prevent.
 */
function ownKeysBounded(
  record: object,
  path: string,
  what: string,
  issues: ValidationIssue[]
): string[] | null {
  const keys: string[] = [];
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    if (keys.length >= MAX_ENVELOPE_ENTRIES) {
      withinBudget(keys.length + 1, path, what, issues);
      return null;
    }
    keys.push(key);
  }
  return keys;
}

/** One `exposed` entry, before anything about it has been checked. */
type RawExposed = Record<string, unknown>;

/** True when a record declares `key` itself rather than inheriting it. */
function declares(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Check a component definition's exposed properties, slots and variants.
 *
 * Every rule here is about a POINTER resolving or a field being present,
 * because those are the faults the envelope introduces and the ones nothing
 * downstream can report. A definition whose pointer names a deleted node still
 * loads, still renders, and still offers the property in the inspector — where
 * editing it writes an override keyed to an id that resolves to nothing, on
 * every instance in the site. The failure surfaces as "my change did nothing",
 * far from the definition that caused it.
 *
 * Errors, not warnings, and in both modes. Forgiving mode exists to keep a
 * document READABLE when a future build wrote something this one does not
 * understand; a dangling pointer is not a future value, it is a broken
 * reference to this document's own tree.
 */
function validateComponentEnvelope(
  doc: Record<string, unknown>,
  nodes: BlockNode[],
  maxNodes: number,
  issues: ValidationIssue[]
): void {
  const index = nodesById(nodes, maxNodes);
  const exposedIds = checkExposedList(doc.exposed, index, issues);
  checkExposedSlots(doc.slots, index, issues);
  checkVariants(doc.variants, exposedIds, issues);
}

/**
 * The `exposed` list, returning the ids it declared.
 *
 * The ids are the return value because the variants below address them: a
 * variant preset naming something nothing exposes is applied by no one, and
 * only this pass knows what was named.
 */
function checkExposedList(
  exposed: unknown,
  index: Map<string, BlockNode>,
  issues: ValidationIssue[]
): ReadonlySet<string> {
  const exposedIds = new Set<string>();
  if (exposed === undefined) return exposedIds;

  if (!Array.isArray(exposed)) {
    issues.push({
      path: "/exposed",
      code: "component-envelope-invalid",
      severity: "error",
      message: "A component's exposed field must be an array.",
    });
    return exposedIds;
  }

  eachBounded(exposed, "/exposed", "exposed properties", issues, (entry, i) => {
    checkExposedProperty(entry, `/exposed/${i}`, index, exposedIds, issues);
  });
  return exposedIds;
}

/** The `slots` map, keyed by the id an instance addresses its content with. */
function checkExposedSlots(
  slots: unknown,
  index: Map<string, BlockNode>,
  issues: ValidationIssue[]
): void {
  if (slots === undefined) return;

  if (!isPlainRecord(slots)) {
    issues.push({
      path: "/slots",
      code: "component-envelope-invalid",
      severity: "error",
      message: "A component's slots field must be an object keyed by slot id.",
    });
    return;
  }

  const ids = ownKeysBounded(slots, "/slots", "exposed slots", issues);
  if (ids === null) return;

  for (const id of ids) {
    checkExposedSlot(slots[id], id, pointer("/slots", id), index, issues);
  }
}

/**
 * One exposed property.
 *
 * Split three ways — identity, pointer, options — rather than checked in one
 * pass, because the id has to be established before anything else can be
 * REPORTED. Every message below names the exposure, and an entry with no
 * usable id is one the author cannot pick out of a list whose entries
 * otherwise look alike.
 */
function checkExposedProperty(
  entry: unknown,
  path: string,
  index: Map<string, BlockNode>,
  seen: Set<string>,
  issues: ValidationIssue[]
): void {
  if (!isPlainRecord(entry)) {
    issues.push({
      path,
      code: "exposed-property-invalid",
      severity: "error",
      message: "An exposed property must be an object.",
    });
    return;
  }

  const raw: RawExposed = entry;
  const id = checkExposedIdentity(raw, path, seen, issues);
  if (id === undefined) return;

  checkExposedPointer(raw, id, path, index, issues);
  checkExposedOptions(raw.options, raw.type, id, path, issues);
}

/**
 * The id, its uniqueness and the label; returns the id when it is usable.
 *
 * `undefined` stops the caller rather than letting it report the remaining
 * faults against an entry it has no way to name.
 */
function checkExposedIdentity(
  raw: RawExposed,
  path: string,
  seen: Set<string>,
  issues: ValidationIssue[]
): string | undefined {
  const id = raw.id;
  if (typeof id !== "string" || id === "") {
    issues.push({
      path: pointer(path, "id"),
      code: "exposed-property-invalid",
      severity: "error",
      message: "An exposed property needs a non-empty id.",
    });
    return undefined;
  }

  // Reported against the SECOND entry, so one message names one thing to fix
  // rather than two that each read as unrelated.
  if (seen.has(id)) {
    issues.push({
      path: pointer(path, "id"),
      code: "exposed-duplicate-id",
      severity: "error",
      message: `Two exposed properties share the id "${id}".`,
      suggestion: "Give each exposed property its own id.",
    });
  }
  seen.add(id);

  if (typeof raw.label !== "string" || raw.label === "") {
    issues.push({
      path: pointer(path, "label"),
      code: "exposed-property-invalid",
      severity: "error",
      message: `Exposed property "${id}" needs a non-empty label.`,
    });
  }

  return id;
}

/** Where the exposure points: its type, its node, and the prop path on it. */
function checkExposedPointer(
  raw: RawExposed,
  id: string,
  path: string,
  index: Map<string, BlockNode>,
  issues: ValidationIssue[]
): void {
  const type = raw.type;
  if (
    !EXPOSED_PROPERTY_TYPES.includes(
      type as (typeof EXPOSED_PROPERTY_TYPES)[number]
    )
  ) {
    issues.push({
      path: pointer(path, "type"),
      code: "exposed-property-invalid",
      severity: "error",
      message: `Exposed property "${id}" declares an unknown type ${describeValue(type)}.`,
      suggestion: `Use one of: ${EXPOSED_PROPERTY_TYPES.join(", ")}.`,
    });
  }

  const nodeId = raw.nodeId;
  if (typeof nodeId !== "string" || !index.has(nodeId)) {
    issues.push({
      path: pointer(path, "nodeId"),
      code: "exposed-node-missing",
      severity: "error",
      message: `Exposed property "${id}" points at node ${describeValue(nodeId)}, which this document does not contain.`,
      suggestion:
        "Point it at a node in this component's tree, or remove the exposure.",
    });
  }

  // The GRAMMAR only. Whether the path names a prop the node's block actually
  // declares is a question about the block's schema, and the schema is not
  // reachable from here — `BlockTypeLookup` answers `has(type)` and nothing
  // else. Checking the path against `node.props` instead would refuse a sound
  // exposure of any prop whose value comes from the block's default, since a
  // defaulted prop is absent from the stored node.
  const propPath = raw.propPath;
  if (typeof propPath !== "string" || !BIND_PATH_RE.test(propPath)) {
    issues.push({
      path: pointer(path, "propPath"),
      code: "exposed-path-invalid",
      severity: "error",
      message: `Exposed property "${id}" has prop path ${describeValue(propPath)}.`,
      suggestion: 'Use a dot-joined chain of field identifiers, e.g. "text".',
    });
  }
}

/**
 * The options list, which only a `select` may carry.
 *
 * Checked in both directions. Options on a non-select are dead configuration
 * the inspector will not read, and a select WITHOUT them offers a control with
 * nothing to choose — which reads to an author as a broken editor rather than
 * as an incomplete definition.
 */
function checkExposedOptions(
  options: unknown,
  type: unknown,
  id: string,
  path: string,
  issues: ValidationIssue[]
): void {
  const isSelect = type === "select";

  if (!isSelect) {
    if (options !== undefined) {
      issues.push({
        path: pointer(path, "options"),
        code: "exposed-options-invalid",
        severity: "error",
        message: `Exposed property "${id}" declares options but is not a select.`,
      });
    }
    return;
  }

  if (!Array.isArray(options) || options.length === 0) {
    issues.push({
      path: pointer(path, "options"),
      code: "exposed-options-invalid",
      severity: "error",
      message: `Exposed property "${id}" is a select and needs at least one option.`,
    });
    return;
  }

  const at = pointer(path, "options");
  const seen = new Set<string>();
  eachBounded(options, at, "select options", issues, (option, i) => {
    if (
      !isPlainRecord(option) ||
      typeof option.value !== "string" ||
      typeof option.label !== "string"
    ) {
      issues.push({
        // One segment per call. `pointer` escapes its token whole, so a single
        // call with "options/0" emits `options~10` — a pointer that resolves
        // to nothing, in the field whose purpose is to let a machine locate
        // the value.
        path: pointer(at, i),
        code: "exposed-options-invalid",
        severity: "error",
        message: `An option of exposed property "${id}" needs a string value and label.`,
      });
      return;
    }

    // An override stores only the VALUE, so two options sharing one cannot be
    // told apart after the author chooses: the menu shows two labels and both
    // resolve identically, with nothing recording which was picked.
    if (seen.has(option.value)) {
      issues.push({
        path: pointer(at, i),
        code: "exposed-options-invalid",
        severity: "error",
        message: `Exposed property "${id}" offers the value "${option.value}" twice.`,
        suggestion: "Give each option its own value.",
      });
      return;
    }
    seen.add(option.value);
  });
}

/** One exposed slot: its metadata, its node, and the region on that node. */
function checkExposedSlot(
  entry: unknown,
  id: string,
  path: string,
  index: Map<string, BlockNode>,
  issues: ValidationIssue[]
): void {
  // The map KEY is the slot's id, and an empty one is unusable rather than
  // merely odd: instance content is stored under it in the instance node's own
  // `slots`, and the builder's operation boundary refuses an empty slot name —
  // so an exposure accepted here is one no author can ever fill.
  if (id === "") {
    issues.push({
      path,
      code: "component-envelope-invalid",
      severity: "error",
      message: "An exposed slot needs a non-empty id.",
    });
    return;
  }

  if (!isPlainRecord(entry)) {
    issues.push({
      path,
      code: "component-envelope-invalid",
      severity: "error",
      message: `Exposed slot "${id}" must be an object.`,
    });
    return;
  }

  checkExposedSlotMetadata(entry, id, path, issues);

  const nodeId = entry.nodeId;
  const node = typeof nodeId === "string" ? index.get(nodeId) : undefined;
  if (node === undefined) {
    issues.push({
      path: pointer(path, "nodeId"),
      code: "exposed-node-missing",
      severity: "error",
      message: `Exposed slot "${id}" points at node ${describeValue(nodeId)}, which this document does not contain.`,
    });
    return;
  }

  checkSlotOnNode(entry.slot, node, id, path, issues);
}

/**
 * The label the layers panel shows, and the block types the slot accepts.
 *
 * Both are read straight out of the stored envelope by consumers that treat
 * the declared types as guarantees: a missing label renders as `undefined` in
 * the panel, and an `allow` that is a bare string is iterated character by
 * character, silently permitting nothing.
 */
function checkExposedSlotMetadata(
  entry: Record<string, unknown>,
  id: string,
  path: string,
  issues: ValidationIssue[]
): void {
  if (typeof entry.label !== "string" || entry.label === "") {
    issues.push({
      path: pointer(path, "label"),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Exposed slot "${id}" needs a non-empty label.`,
    });
  }

  const allow = entry.allow;
  if (allow === undefined) return;
  if (!Array.isArray(allow)) {
    issues.push({
      path: pointer(path, "allow"),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Exposed slot "${id}" allow must be an array of block types.`,
    });
    return;
  }

  const at = pointer(path, "allow");
  eachBounded(allow, at, "allowed block types", issues, (type, i) => {
    // The same predicate the rest of this file holds a node's `type` to. A
    // second, weaker definition here would accept `"not-a-block"` as a block
    // type in the one place the field's whole purpose is naming block types.
    if (isBlockType(type)) return;
    issues.push({
      path: pointer(at, i),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Exposed slot "${id}" allows ${describeValue(type)}, which is not a block type.`,
    });
  });
}

/**
 * That the node holds the named region.
 *
 * Answered from the node's STORED slots, which is what this package can see: a
 * block's declared slots live in its definition, and validation is given a
 * `BlockTypeLookup` that answers `has(type)` and nothing else. So this catches
 * the case it can — a slot key the node's own content does not use, which is
 * what a renamed container leaves behind — and cannot catch a slot that the
 * block definition no longer declares but whose content is still stored.
 *
 * A node with NO slots map is passed, deliberately. `makeNode` sets `slots`
 * only when a caller supplies content and `expandSlotDefaults` returns nothing
 * for a container with no seeded children, so a declared, still-empty region
 * is stored as an absent map — indistinguishable from a region that never
 * existed. Refusing that would reject a sound definition for exposing a slot
 * the author has not filled yet, which is the ordinary state of a container
 * the moment it is created.
 *
 * An OWN property when there is a map. `slots` is an ordinary object, so
 * `"toString" in slots` is true of every node, and a slot by that name would
 * otherwise pass and then resolve to nothing.
 */
function checkSlotOnNode(
  slot: unknown,
  node: BlockNode,
  id: string,
  path: string,
  issues: ValidationIssue[]
): void {
  // The NAME first, before any question about the node. A slot field that is
  // missing, numeric or empty is wrong whatever the node holds, and answering
  // the node question first let an empty container accept `undefined` as a
  // region name — handing a consumer the one value the contract promises it
  // will never see.
  if (typeof slot !== "string" || slot === "") {
    issues.push({
      path: pointer(path, "slot"),
      code: "exposed-slot-missing",
      severity: "error",
      message: `Exposed slot "${id}" names ${describeValue(slot)}, which is not a slot name.`,
    });
    return;
  }

  // A stored `slots` that is not a record is the main node walk's to report as
  // `invalid-slots`. Reading it here first would reach `hasOwnProperty.call`
  // with `null` and throw — turning a malformed import, which this function
  // exists to describe, into a crash that describes nothing.
  const declared = node.slots;
  if (!isPlainRecord(declared)) return;
  if (declares(declared, slot)) return;

  issues.push({
    path: pointer(path, "slot"),
    code: "exposed-slot-missing",
    severity: "error",
    message: `Exposed slot "${id}" names slot "${slot}", which node "${node.id}" does not hold.`,
    suggestion: `Name one of: ${Object.keys(declared).join(", ") || "(none)"}.`,
  });
}

/**
 * Variants, checked against what the definition actually exposes.
 *
 * A variant is a preset of overrides, so every key it sets has to name
 * something an instance could set itself. A key naming nothing is applied by
 * no one and reported by nothing: the variant appears in the picker, selecting
 * it changes nothing, and the definition looks broken rather than
 * misconfigured.
 */
function checkVariants(
  variants: unknown,
  exposedIds: ReadonlySet<string>,
  issues: ValidationIssue[]
): void {
  if (variants === undefined) return;
  if (!isPlainRecord(variants)) {
    issues.push({
      path: "/variants",
      code: "component-envelope-invalid",
      severity: "error",
      message: "A component's variants field must be an object keyed by name.",
    });
    return;
  }

  const names = ownKeysBounded(variants, "/variants", "variants", issues);
  if (names === null) return;

  for (const name of names) {
    checkVariant(name, variants[name], exposedIds, issues);
  }
}

/** One variant: its label, and the exposures its overrides address. */
function checkVariant(
  name: string,
  variant: unknown,
  exposedIds: ReadonlySet<string>,
  issues: ValidationIssue[]
): void {
  const at = pointer("/variants", name);
  if (!isPlainRecord(variant)) {
    issues.push({
      path: at,
      code: "component-envelope-invalid",
      severity: "error",
      message: `Variant "${name}" must be an object.`,
    });
    return;
  }

  if (typeof variant.label !== "string" || variant.label === "") {
    issues.push({
      path: pointer(at, "label"),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Variant "${name}" needs a non-empty label.`,
    });
  }

  // Required AND non-empty. A variant is a preset, and the picker offering one
  // that presets nothing is a control that does nothing when chosen. An empty
  // map is that control exactly, so checking only the type would state the
  // invariant in the comment and enforce a weaker one in the code.
  if (!isPlainRecord(variant.overrides)) {
    issues.push({
      path: pointer(at, "overrides"),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Variant "${name}" needs an overrides object keyed by exposed id.`,
    });
  } else {
    // Bounded HERE, not only at the variant map. `variants` being within the
    // budget says nothing about one variant's overrides, so a single variant
    // holding a hundred thousand keys reached both the emptiness check and the
    // per-key walk below — twice — through a cap that had already passed.
    const overrideKeys = ownKeysBounded(
      variant.overrides,
      pointer(at, "overrides"),
      "variant overrides",
      issues
    );
    if (overrideKeys === null) return;

    if (overrideKeys.length === 0) {
      issues.push({
        path: pointer(at, "overrides"),
        code: "component-envelope-invalid",
        severity: "error",
        message: `Variant "${name}" presets nothing, so selecting it would change nothing.`,
        suggestion: "Give it at least one override, or remove the variant.",
      });
      return;
    }

    checkVariantTargets(
      overrideKeys,
      exposedIds,
      pointer(at, "overrides"),
      key =>
        `Variant "${name}" overrides "${key}", which this component does not expose.`,
      issues
    );
  }

  // `slots` carries no content in this format yet, so a variant naming one can
  // only be addressing a slot id — see `Variant` in `document.ts`.
  if (variant.slots !== undefined) {
    issues.push({
      path: pointer(at, "slots"),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Variant "${name}" declares slot content, which this format version does not carry.`,
      suggestion: "Put the content in the instance's own slots.",
    });
  }
}

/**
 * A variant's override map, against the ids the definition exposes.
 *
 * The keys are the whole check: a value may be anything an exposed property
 * holds, and props are unconstrained, so there is nothing narrower to say
 * about one than that its key names something.
 */
function checkVariantTargets(
  keys: readonly string[],
  known: ReadonlySet<string>,
  at: string,
  message: (key: string) => string,
  issues: ValidationIssue[]
): void {
  // Takes the KEYS a bounded read already produced, rather than the map. Given
  // the map it would enumerate a second time, so one collection would be
  // counted once and walked twice — and the second walk had no bound at all.
  for (const key of keys) {
    if (known.has(key)) continue;
    issues.push({
      // One segment per call: `pointer` escapes its token whole, so passing
      // "overrides/missing" emits `overrides~1missing`, which resolves to
      // nothing.
      path: pointer(at, key),
      code: "variant-unknown-target",
      severity: "error",
      message: message(key),
    });
  }
}
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
      (typeof source !== "string" || !isBindingSource(source))
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

  // `overrides` is a MAP keyed by exposed id, and only the shape is checkable
  // here: which ids exist is a property of a definition this document does not
  // carry. The shape still has to be refused, because a resolver enumerating
  // it either throws on a string and an array, or reads their indices as
  // exposure ids and applies values to properties nobody named.
  //
  // Only when present. Absent means the instance overrides nothing, which is
  // the ordinary state of a freshly placed component.
  const overrides = node.props.overrides;
  if (overrides !== undefined && !isPlainRecord(overrides)) {
    issues.push({
      path: pointer(pointer(path, "props"), "overrides"),
      code: "invalid-component-instance",
      severity: "error",
      message: `A component instance's props.overrides must be an object keyed by exposed id, not ${describeValue(overrides)}.`,
    });
  }
}
