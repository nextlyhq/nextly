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
  BlockDocument,
  BlockNode,
  DocumentKind,
  LocaleOverlay,
  LocaleOverlayValue,
  StyleState,
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
// never sees one and the golden schema cannot describe it. Without these, the
// freeze would claim a shape that no check on this PR can reach: `contentMode`
// could gain a member, or the overlay maps change, and every other assertion
// here would stay green while stored localized content was reinterpreted.
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
