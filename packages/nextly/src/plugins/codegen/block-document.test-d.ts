/**
 * The freeze, as a compile error.
 *
 * A frozen format that exists only as prose is a convention, and conventions
 * drift silently. These assertions are the enforcement: after the freeze, a
 * change to a frozen shape stops `check-types`, so altering the format becomes
 * a deliberate act with a migration attached rather than an edit that merges.
 *
 * Enforced by `tsc --noEmit -p tsconfig.tests.json`, which `check-types` runs
 * alongside the source config.
 *
 * ## What is pinned, and why it is the KEY SET
 *
 * The assertions below pin which fields exist, not what every value type is.
 * That is a deliberate limit rather than an omission:
 *
 * - Adding or removing a field is the change that breaks a stored document and
 *   every external producer of one. The key set catches it exactly.
 * - Value types inside `props`, `styles` and binding `options` are open by
 *   design — the style catalog is additive-open and props are per-block — so
 *   pinning them here would fail on changes the format explicitly permits.
 *
 * A field whose TYPE changes incompatibly while keeping its name is the gap
 * this cannot see. `blockDocumentSchema` covers the structural half of that at
 * runtime, and `validate()` covers the rest against a live registry.
 */
import type {
  Binding,
  BindingFormat,
  BindingFormatType,
  BindingSource,
  BlockDocument,
  BlockNode,
  ComponentInstanceProps,
  DocumentKind,
  LocaleOverlay,
  LocaleOverlayValue,
  BreakpointId,
  NodeStyles,
  NodeVisibility,
  StyleValues,
  TokenRef,
  IssueCode,
  IssueSeverity,
  StyleState,
  TreePosition,
  ValidationContext,
  ValidationIssue,
  AnyBlockDefinition,
  SupportDefinition,
  DEFAULT_MAX_DOCUMENT_BYTES,
  MAX_DEPTH,
  MAX_NODES,
  RESERVED_OPERATION_NAMES,
  allBlocks,
  allSupports,
  duplicateNode,
  getBlock,
  getBlockSource,
  getSupport,
  insertNode,
  moveNode,
  reidSubtree,
  removeNode,
  updateNode,
  validate,
} from "@nextlyhq/blocks-engine";
import { expectTypeOf } from "vitest";

import type {
  BindingEndpoint,
  isBindablePropType,
} from "../../collections/fields/catalog";

import type { BlockDocumentShape } from "./block-document";

// ---------------------------------------------------------------------------
// The frozen envelope
// ---------------------------------------------------------------------------

expectTypeOf<keyof BlockDocument>().toEqualTypeOf<
  "formatVersion" | "kind" | "nodes" | "settings" | "assets"
>();

// ---------------------------------------------------------------------------
// The frozen node
// ---------------------------------------------------------------------------

// The field TYPES, not only the names. A key set catches a field added or
// removed; it says nothing about `id` becoming a number, `props` becoming an
// array, or `slots` losing its per-name grouping — each of which reinterprets
// every stored document while every name stays exactly where it was.
//
// The three addressed here are the ones the rest of the system keys on: `id` is
// the only way anything addresses a node, `type` selects the definition, and
// `version` decides which migration runs. `props` is deliberately open.
expectTypeOf<BlockNode["id"]>().toEqualTypeOf<string>();
expectTypeOf<BlockNode["type"]>().toEqualTypeOf<string>();
expectTypeOf<BlockNode["version"]>().toEqualTypeOf<number>();
expectTypeOf<BlockNode["props"]>().toEqualTypeOf<Record<string, unknown>>();
expectTypeOf<BlockNode["slots"]>().toEqualTypeOf<
  Record<string, BlockNode[]> | undefined
>();
expectTypeOf<BlockNode["bindings"]>().toEqualTypeOf<
  Record<string, Binding> | undefined
>();
expectTypeOf<BlockNode["classes"]>().toEqualTypeOf<string[] | undefined>();
expectTypeOf<BlockNode["attributes"]>().toEqualTypeOf<
  Record<string, string> | undefined
>();

expectTypeOf<keyof BlockNode>().toEqualTypeOf<
  | "id"
  | "type"
  | "version"
  | "props"
  | "bindings"
  | "slots"
  | "styles"
  | "classes"
  | "visibility"
  | "locked"
  | "name"
  | "customCss"
  | "cssId"
  | "attributes"
  | "migrationFailed"
  | "origin"
>();

// ---------------------------------------------------------------------------
// The frozen locale overlay
// ---------------------------------------------------------------------------

// Overlays are stored SEPARATELY from the document, so `blockDocumentSchema`
// never sees one and the golden schema cannot describe it. These assertions are
// the only reach the freeze has into that shape: without them `contentMode`
// could gain a member, or the overlay maps change, while every runtime check
// stayed green and stored localized content was reinterpreted.
expectTypeOf<keyof LocaleOverlay>().toEqualTypeOf<"contentMode" | "props">();

// Closed for the same reason a document kind is: a third mode needs a merge
// rule at read time before it could mean anything, and adding one silently
// would change how every existing overlay resolves.
expectTypeOf<LocaleOverlay["contentMode"]>().toEqualTypeOf<
  "overlay" | "fork"
>();

expectTypeOf<keyof LocaleOverlayValue>().toEqualTypeOf<"value" | "src">();

// The MAP shape, which the key set above does not reach. `props` is keyed by
// node id and then by prop name, and flattening it to one level — or keying it
// by anything other than the stable node id — reinterprets every stored overlay
// while the key set stays exactly as it is.
expectTypeOf<LocaleOverlay["props"]>().toEqualTypeOf<
  Record<string, Record<string, LocaleOverlayValue>>
>();
expectTypeOf<LocaleOverlayValue["value"]>().toEqualTypeOf<unknown>();
expectTypeOf<LocaleOverlayValue["src"]>().toEqualTypeOf<string | undefined>();

// ---------------------------------------------------------------------------
// The closed vocabularies
// ---------------------------------------------------------------------------

// Closed on purpose: an unknown kind is a validation error in strict mode and
// preserved untouched in forgiving mode, the same policy as an unknown block
// type. Widening this is a format change, not an edit.
expectTypeOf<DocumentKind>().toEqualTypeOf<
  "page" | "pattern" | "component" | "region" | "template"
>();

// A fifth state would need an emission rule in the compiler before it could
// mean anything, so the set is frozen with the format rather than beside it.
expectTypeOf<StyleState>().toEqualTypeOf<
  "base" | "hover" | "focus" | "active"
>();

// The binding vocabulary. Both lists exist as runtime values on the engine and
// the types are derived from them, so pinning the TYPE here pins the value: a
// source added to `BINDING_SOURCES` widens `BindingSource` and stops this line.
expectTypeOf<BindingSource>().toEqualTypeOf<
  "entry" | "item" | "single" | "site"
>();
expectTypeOf<BindingFormatType>().toEqualTypeOf<
  "date" | "number" | "currency" | "relativeTime" | "list"
>();

// `BindingFormat` is a union of per-variant SHAPES while `BindingFormatType` is
// the list of discriminators, and nothing structural ties them together. This
// asserts the tie: a variant added to the union without a matching entry in the
// list — or the reverse — makes these two disagree, which is exactly the drift
// that would leave the published schema rejecting a format the engine accepts.
expectTypeOf<BindingFormat["type"]>().toEqualTypeOf<BindingFormatType>();

// ---------------------------------------------------------------------------
// The component-instance node shape
// ---------------------------------------------------------------------------

/**
 * A component instance is a normal node whose `props` carry the reference, so
 * nothing about the node type distinguishes it and the envelope assertions
 * above cannot reach this shape — `props` is `Record<string, unknown>` there,
 * which every possible props object satisfies.
 *
 * That makes this the one frozen shape with no structural enforcement anywhere
 * else: the runtime schema treats `props` as an open record on purpose, so
 * renaming `componentId` would pass every parse test while silently orphaning
 * every stored instance. The key set is pinned here for the same reason the
 * envelope's is, and the identifier fields' value types are pinned too because
 * they are identifiers rather than open content.
 *
 * `overrides` is deliberately NOT pinned to a value type. It holds whatever an
 * exposed property holds, and props are unconstrained, so any pin here would
 * be `unknown` — an assertion that cannot fail and therefore reports nothing.
 * Its KEY is pinned like the others, because that is the part a rename would
 * orphan.
 */
expectTypeOf<keyof ComponentInstanceProps>().toEqualTypeOf<
  "componentId" | "variant" | "overrides"
>();
expectTypeOf<ComponentInstanceProps["componentId"]>().toEqualTypeOf<string>();
expectTypeOf<ComponentInstanceProps["variant"]>().toEqualTypeOf<
  string | undefined
>();

// ---------------------------------------------------------------------------
// The frozen value shapes inside a node
// ---------------------------------------------------------------------------

/**
 * The three shapes a node's optional fields carry. None is reachable from the
 * envelope assertions, and none is described by the golden schema: `styles`
 * publishes unconstrained values by design, and `bindings` publishes a fragment
 * derived from the schema rather than from these types.
 *
 * `Binding` is asserted as its full union rather than by key set. The
 * discrimination IS the contract — `sourceKey` required on exactly one branch
 * and forbidden on the others — and a key-set assertion over a union collapses
 * to the keys they share, which is precisely the property that would be lost.
 */
expectTypeOf<Binding["$bind"]>().toEqualTypeOf<string>();

// The `single` branch REQUIRES its key. That requirement is the contract — a
// single addressed by nothing resolves to nothing at read time — and it is
// asserted through the branch rather than by restating the union, because a
// restated union has to spell `sourceKey?: never` in a position where the
// compiler has already collapsed it to `undefined`, so the assertion would fail
// for a reason that has nothing to do with the property.
expectTypeOf<
  Extract<Binding, { source: "single" }>["sourceKey"]
>().toEqualTypeOf<string>();

// And the forbidden half, which is the half that actually constrains. The
// assertion above stays green if the other branch is widened from
// `sourceKey?: never` to `sourceKey?: string`, and that widening is exactly
// what would make an ambiguous single binding representable — the thing the
// union exists to prevent. `never` in an optional position reads as
// `undefined`, so `undefined` is the only inhabitant this may have.
expectTypeOf<
  Exclude<Binding, { source: "single" }>["sourceKey"]
>().toEqualTypeOf<undefined>();

// The source vocabulary is DERIVED rather than restated, so a source added to
// the engine's list reaches the stored type without an edit here.
expectTypeOf<Exclude<Binding, { source: "single" }>["source"]>().toEqualTypeOf<
  Exclude<BindingSource, "single"> | undefined
>();

expectTypeOf<keyof NodeVisibility>().toEqualTypeOf<"conditions" | "devices">();

// The token-reference convention. `$token` is the marker that keeps a reference
// self-describing in raw JSON, parallel to `$bind`, and renaming it would make
// every stored reference read as an ordinary object — accepted by the schema,
// which publishes style values unconstrained, and silently unresolved.
expectTypeOf<keyof TokenRef>().toEqualTypeOf<"$token">();
expectTypeOf<TokenRef["$token"]>().toEqualTypeOf<string>();

// States on one axis, breakpoints on the other, both sparse. Flattening either
// level is a storage migration rather than a refactor.
expectTypeOf<NodeStyles>().toEqualTypeOf<
  Partial<Record<StyleState, Partial<Record<BreakpointId, StyleValues>>>>
>();

// ---------------------------------------------------------------------------
// The advertised limits
// ---------------------------------------------------------------------------

/**
 * The specification publishes these numbers, and an external producer sizes its
 * output against them. Nothing else pins them: the runtime tests derive their
 * fixtures from these same constants, so raising a cap moves the test with it,
 * and the golden JSON Schema contains none of them.
 *
 * Asserted as literal types, which is what makes the VALUE the contract rather
 * than the name. A change here is a published-limit change and needs saying so.
 */
expectTypeOf<typeof MAX_DEPTH>().toEqualTypeOf<12>();
expectTypeOf<typeof MAX_NODES>().toEqualTypeOf<5000>();
// Pinned to its VALUE, not to `number`. The earlier reasoning — that a caller
// may raise it through `DocumentLimits` — confused the constant with the field:
// what a caller overrides is `limits.maxBytes`, while this constant is the
// published default every consumer sizes against when it overrides nothing.
// Asserted as `number` it accepted every possible cap, which is no assertion.
expectTypeOf<typeof DEFAULT_MAX_DOCUMENT_BYTES>().toEqualTypeOf<2097152>();

// The reserved vocabulary, in order. A name is only reservable before something
// else takes it, so the list is the contract and its ORDER is how the
// specification page and this assertion stay comparable by eye.
expectTypeOf<typeof RESERVED_OPERATION_NAMES>().toEqualTypeOf<
  readonly [
    "saveAsPattern",
    "saveAsComponent",
    "convertToComponent",
    "detachComponent",
  ]
>();

// ---------------------------------------------------------------------------
// The frozen validation API
// ---------------------------------------------------------------------------

/**
 * `validate` and the issue it returns are a published contract: an external
 * tool locates and repairs problems by reading `path` and switching on `code`.
 *
 * Nothing else here reaches them. The document assertions describe stored data,
 * and the golden schema describes the same, so the signature and the issue
 * shape could both change with their implementation and their tests together
 * while every other check stayed green — and an external validator would break
 * with no migration decision ever having been made.
 *
 * Pinned as a whole shape rather than a key set, because an issue is consumed
 * field by field: `severity` losing a member, or `suggestion` becoming
 * required, changes how a consumer branches without changing any name.
 */
expectTypeOf<keyof ValidationIssue>().toEqualTypeOf<
  "path" | "code" | "message" | "severity" | "suggestion"
>();
expectTypeOf<ValidationIssue["path"]>().toEqualTypeOf<string>();

// `code` is the field an external tool SWITCHES on, so it is the one place a
// widening does the most damage: relaxing it to `string` lets a new code ship
// without appearing in `ISSUE_CODES`, and every consumer's exhaustive switch
// silently grows a default branch instead of failing to compile.
expectTypeOf<ValidationIssue["code"]>().toEqualTypeOf<IssueCode>();
expectTypeOf<ValidationIssue["message"]>().toEqualTypeOf<string>();
expectTypeOf<ValidationIssue["suggestion"]>().toEqualTypeOf<
  string | undefined
>();
expectTypeOf<IssueSeverity>().toEqualTypeOf<"error" | "warning">();

// The call shape: a document and a context in, an array of issues out. A third
// required parameter, or a return that stopped being an array, is a breaking
// change to every caller and is what this line refuses.
expectTypeOf<typeof validate>().parameters.toEqualTypeOf<
  [BlockDocument, ValidationContext]
>();
expectTypeOf<typeof validate>().returns.toEqualTypeOf<ValidationIssue[]>();

// ---------------------------------------------------------------------------
// The frozen tree primitives and bindability rule
// ---------------------------------------------------------------------------

/**
 * The primitives are the format's write API: an external tool composes an edit
 * out of them, and a change to one of their signatures breaks that tool with no
 * stored document changing at all.
 *
 * Behaviour tests exercise them at their current call shapes, which is not the
 * same thing as pinning those shapes — a parameter added or a return type
 * changed moves the implementation and its tests together and stays green. The
 * assertions below are what make that a compile error instead.
 *
 * Return types are pinned alongside the parameters because these are pure
 * functions over a forest: a primitive that started mutating in place and
 * returned `void` would satisfy any parameter-only assertion while breaking
 * every caller that reads the result.
 */
expectTypeOf<typeof insertNode>().parameters.toEqualTypeOf<
  [BlockNode[], BlockNode, TreePosition]
>();
expectTypeOf<typeof insertNode>().returns.toEqualTypeOf<BlockNode[]>();

expectTypeOf<typeof removeNode>().parameters.toEqualTypeOf<
  [BlockNode[], string]
>();
expectTypeOf<typeof removeNode>().returns.toEqualTypeOf<BlockNode[]>();

expectTypeOf<typeof moveNode>().parameters.toEqualTypeOf<
  [BlockNode[], string, TreePosition]
>();
expectTypeOf<typeof moveNode>().returns.toEqualTypeOf<BlockNode[]>();

expectTypeOf<typeof reidSubtree>().parameters.toEqualTypeOf<[BlockNode]>();
expectTypeOf<typeof reidSubtree>().returns.toEqualTypeOf<BlockNode>();

// Both halves, like every other primitive here. A return-only assertion stays
// green while the parameters are changed underneath it — the behaviour tests
// move with the call, so nothing else would report it, and the frozen call
// shape is the half an external tool is written against.
expectTypeOf<typeof duplicateNode>().parameters.toEqualTypeOf<
  [BlockNode[], string]
>();
expectTypeOf<typeof duplicateNode>().returns.toEqualTypeOf<BlockNode[]>();

// The patch type is part of the contract, not an implementation detail: it is
// what states that `id`, `type` and `slots` are NOT patchable — an id change
// would orphan every overlay keyed on it, and slots move through the dedicated
// primitives so a patch cannot reparent a subtree silently.
expectTypeOf<typeof updateNode>().parameters.toEqualTypeOf<
  [BlockNode[], string, Partial<Omit<BlockNode, "id" | "type" | "slots">>]
>();
expectTypeOf<typeof updateNode>().returns.toEqualTypeOf<BlockNode[]>();

// A slot position addresses a parent and a named region, never an index into a
// rendered tree. Positional addressing is excluded from every stored contract,
// so widening this is a format change rather than an ergonomic one.
expectTypeOf<keyof TreePosition>().toEqualTypeOf<
  "parentId" | "slot" | "index"
>();

// The field types, because the key set does not reach them. `parentId` and
// `slot` are OPTIONAL — their absence is what addresses a top-level position —
// while `index` is required, because a position without one is not a position.
// Making either of the first two required, or `index` optional, changes what a
// stored operation means without changing a single name.
expectTypeOf<TreePosition["parentId"]>().toEqualTypeOf<string | undefined>();
expectTypeOf<TreePosition["slot"]>().toEqualTypeOf<string | undefined>();
expectTypeOf<TreePosition["index"]>().toEqualTypeOf<number>();

// Bindability is DERIVED from a prop's field type and is never opted into per
// block. A signature taking anything other than the type name would let a block
// declare its own answer, which is the design this rule exists to forbid.
// The INPUT is the half that carries the rule. A signature taking a
// block-supplied flag instead of the endpoint would let a block declare its own
// answer, which is exactly the per-block opt-in the specification forbids, and
// a return-type assertion alone would stay green through that change.
expectTypeOf<typeof isBindablePropType>().parameters.toEqualTypeOf<
  [BindingEndpoint]
>();
expectTypeOf<typeof isBindablePropType>().returns.toEqualTypeOf<boolean>();

// ---------------------------------------------------------------------------
// The frozen registry read API
// ---------------------------------------------------------------------------

/**
 * The read side of the registry is what a plugin and the manifest generator
 * consume. Behaviour tests exercise these at their current call shapes, which
 * leaves a parameter or return-type change free to move with them.
 *
 * `undefined` rather than a throw on a miss is part of the contract for the
 * two lookups: a caller branches on absence, and a version that threw would
 * break every one of them without any name changing.
 */
expectTypeOf<typeof getBlock>().parameters.toEqualTypeOf<[string]>();
expectTypeOf<typeof getBlock>().returns.toEqualTypeOf<
  AnyBlockDefinition | undefined
>();

expectTypeOf<typeof allBlocks>().parameters.toEqualTypeOf<[]>();
expectTypeOf<typeof allBlocks>().returns.toEqualTypeOf<AnyBlockDefinition[]>();

expectTypeOf<typeof getBlockSource>().parameters.toEqualTypeOf<[string]>();
expectTypeOf<typeof getBlockSource>().returns.toEqualTypeOf<
  string | undefined
>();

expectTypeOf<typeof getSupport>().parameters.toEqualTypeOf<[string]>();
expectTypeOf<typeof getSupport>().returns.toEqualTypeOf<
  SupportDefinition | undefined
>();

expectTypeOf<typeof allSupports>().parameters.toEqualTypeOf<[]>();
expectTypeOf<typeof allSupports>().returns.toEqualTypeOf<SupportDefinition[]>();

// ---------------------------------------------------------------------------
// The published schema describes the frozen envelope
// ---------------------------------------------------------------------------

/**
 * The published schema's closed vocabularies must BE the engine's, not merely
 * resemble them.
 *
 * These are asserted field by field rather than as whole-document equality,
 * because the schema is deliberately looser than the TypeScript type wherever
 * the format is open — `props`, style values, binding `options` — and demanding
 * equality there would fail on the openness the format guarantees.
 *
 * The closed parts are where looseness would be a real defect. `z.enum` widens
 * to `string` if it is ever handed a plain `string[]`, which compiles, passes
 * every runtime test written against valid input, and publishes a contract
 * saying any kind is acceptable. That is the failure these two lines exist to
 * catch, and it is one this file caught once already.
 */
type SchemaDocument = BlockDocumentShape;

expectTypeOf<SchemaDocument["kind"]>().toEqualTypeOf<DocumentKind>();
expectTypeOf<SchemaDocument["formatVersion"]>().toEqualTypeOf<1>();
expectTypeOf<SchemaDocument["nodes"]>().toBeArray();
