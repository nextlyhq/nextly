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
  BindingFormat,
  BindingFormatType,
  BindingSource,
  BlockDocument,
  BlockNode,
  ComponentInstanceProps,
  DocumentKind,
  LocaleOverlay,
  LocaleOverlayValue,
  IssueSeverity,
  StyleState,
  ValidationContext,
  ValidationIssue,
  validate,
} from "@nextlyhq/blocks-engine";
import { expectTypeOf } from "vitest";

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
 * envelope's is, and the value types are pinned too because both fields are
 * identifiers rather than open content.
 */
expectTypeOf<keyof ComponentInstanceProps>().toEqualTypeOf<
  "componentId" | "variant"
>();
expectTypeOf<ComponentInstanceProps["componentId"]>().toEqualTypeOf<string>();
expectTypeOf<ComponentInstanceProps["variant"]>().toEqualTypeOf<
  string | undefined
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
