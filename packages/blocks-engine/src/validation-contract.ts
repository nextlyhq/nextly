/**
 * What validation takes and reports: the issue shape and its severities, the
 * lookups and context a caller supplies, the stable issue codes, and the
 * block-type and version predicates.
 *
 * @module validation-contract
 */
import { BINDING_ISSUE_CODES, type BindingIssueCode } from "./binding-issues";
import type { BindingSchemaRef, BindingSchemaSource } from "./binding-rules";
import {
  type BlockDocument,
  type BreakpointSet,
  COMPONENT_INSTANCE_TYPE,
  isBlockType,
} from "./document";
import {
  ENTRY_CONTENT_ISSUE_CODES,
  type EntryContentIssueCode,
} from "./entry-content";
import type { DocumentLimits } from "./limits";
import { LIST_ISSUE_CODES, type ListFieldSource } from "./list-query";
import type { DocumentSurvey } from "./measure-bytes";
import type { NamedQuerySource } from "./named-query";
import type { NestingSource } from "./nesting";
import type { TokenKind } from "./style/catalog-types";
import {
  type ReadyStyleIssueBudget,
  registerLookupCache,
} from "./style/validate-style-value";
import type { SlotDefaultSource } from "./tree";
import { CONDITION_ISSUE_CODES } from "./visibility-conditions";

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

/** Whether an issue refuses a strict save, as opposed to warning about it. */
export function isErrorIssue(issue: ValidationIssue): boolean {
  return issue.severity === "error";
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
export function memoizeClassLookup(
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
  /**
   * How to resolve a block's declared slots, for checking that a locked slot
   * holds exactly the children it starts with.
   *
   * The source `expandSlotDefaults` reads, so the children a save requires are
   * the children an insert of the block creates. Separate from
   * {@link nesting} because a slot's starting children and its lock are
   * declarations that one-method source does not carry.
   *
   * Absent means locks are not checked, on the same terms as nesting: a caller
   * that omits this gets no lock issues rather than an error saying it could
   * not look.
   */
  definitions?: SlotDefaultSource;
  /**
   * The document's stored forms, a draft's and the live one's, where the
   * caller has them: what a `"contentOnly"` slot already holds is kept rather
   * than refused (`stored-counterparts`).
   *
   * Absent for a document never stored, and for a value judged on its own:
   * every locked slot is then measured against its starting children alone.
   */
  stored?: readonly BlockDocument[];
  /**
   * The field shapes of the sources a binding may read, for checking each
   * binding's path, field and format against them: one relation at most, no
   * list on the way, a field the source has, a type and a format that fit the
   * prop.
   *
   * Absent means bindings are checked for their shape only, on the same terms
   * as nesting: a caller that cannot answer for the schema gets no schema
   * issues. Whether a binding fits its PROP is judged only when
   * {@link definitions} is given too, since that is where a block's props are.
   */
  bindingSchema?: BindingSchemaSource;
  /** Which source an `entry` binding reads, for {@link bindingSchema}. */
  bindingEntry?: BindingSchemaRef;
  /**
   * The fields each collection declares and the public may read, for judging
   * what a collection list filters and sorts by (`list-query`).
   *
   * Absent means a list is judged by its shape and nesting only, on the same
   * terms as {@link bindingSchema}. A list related to the page's entry looks
   * its relation up in the collection {@link bindingEntry} names.
   */
  listFields?: ListFieldSource;
  /**
   * The named queries the site registers, for judging a list whose source
   * is a custom one (`list-query`). Absent, such a list is judged by its
   * shape alone.
   */
  namedQueries?: NamedQuerySource;
}

/** The validator's own codes, before the binding codes are added. */
const DOCUMENT_ISSUE_CODES = {
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
  "variant-empty":
    "A variant presets no value, so choosing it shows the component's defaults.",
  "variant-label-clash":
    "Two of a component's variants share one name, ignoring case and spaces.",
  "invalid-document": "The document is not an object.",
  "nodes-not-array": "The document nodes field is not an array.",
  "invalid-node": "A node is not an object.",
  "invalid-origin":
    "A node's provenance record is missing a field it needs to be trusted.",
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
  "invalid-css-classes":
    "A node's own CSS class names are not text, or hold a name a block may not carry.",
  "invalid-nosnippet": "A node nosnippet mark is not true or false.",
  "unknown-node-type": "A node type is not registered.",
  "invalid-style-state": "A style state key is not a known interactive state.",
  "invalid-style-values": "A style values entry is not an object.",
  "unknown-breakpoint":
    "A style or visibility breakpoint id is not defined for the site.",
  "breakpoint-id-not-unique":
    "A breakpoint id is defined on more than one axis.",
  "invalid-visibility": "A node visibility structure is malformed.",
  "invalid-binding": "A binding is malformed.",
  "invalid-seo": "A document's own metadata is malformed.",
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
  "look-for-another-block":
    "A node lists a look that belongs to another block type.",
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
  "duplicate-own-look":
    "More than one class in the site library is the same block type's own look; only the first is read.",
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
  // The placement rule's own refusals, spelled as its `PlacementRefusal`
  // members for the reason the three above are.
  "undeclared-slot":
    "A node sits in a slot its container does not declare, so the container never renders it.",
  "holds-no-blocks":
    "A node sits inside a block that holds no blocks, so that block never renders it.",
  "phrasing-only":
    "A node sits in a container that takes only text-level blocks, and it is not one.",
  "content-model":
    "A node is a kind of HTML content an ancestor refuses beneath it, such as something clickable inside a link.",
  "locked-slot-altered":
    "A container's slot is locked, and it does not hold exactly the blocks it starts with.",
  "locked-slot-content-only":
    "A container's slot is locked contentOnly, and a block in it changed something besides its content.",
} as const;

/** A stable validation issue code. */
export type IssueCode =
  | keyof typeof DOCUMENT_ISSUE_CODES
  | BindingIssueCode
  | keyof typeof LIST_ISSUE_CODES
  | keyof typeof CONDITION_ISSUE_CODES
  | EntryContentIssueCode;

/**
 * The stable issue-code vocabulary, each with a one-line description. Tests
 * assert that every code emitted appears here and vice versa, so the emitted
 * vocabulary cannot drift silently.
 *
 * The binding codes are the ones the renderer reports for the same breaks,
 * spread in from their own table, so an author sees one name for one problem
 * wherever it was found.
 */
export const ISSUE_CODES: { readonly [Code in IssueCode]: string } = {
  ...DOCUMENT_ISSUE_CODES,
  ...BINDING_ISSUE_CODES,
  // A collection list's query codes, from the module that reads the query, so
  // the editor, the API and the renderer name a list's problem alike.
  ...LIST_ISSUE_CODES,
  // A block's visibility condition codes, the ones the renderer reports for
  // the same conditions, so an author sees one name for one problem.
  ...CONDITION_ISSUE_CODES,
  // The Entry content block's own rules, from the module that reads the
  // block, so the save, the editor and the API refuse one alike.
  ...ENTRY_CONTENT_ISSUE_CODES,
};

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
 * `validateNode`, in `validation-node`, calls it too, so there is one rule
 * rather than two that agree today.
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
export const ENGINE_NODE_TYPES: Set<string> = new Set<string>([
  COMPONENT_INSTANCE_TYPE,
]);

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
