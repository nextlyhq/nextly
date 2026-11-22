/**
 * The engine's public exports: validating a document and the registry-free facts about a node, visibility and authored text.
 *
 * Part of the package's root entry, `../index.ts`, which re-exports every
 * part in a fixed order. Nothing here imports that entry.
 */
export {
  componentEnvelopeIssues,
  isErrorIssue,
  validate,
  validateDocument,
  ISSUE_CODES,
  DOCUMENT_VERDICT_CODES,
  INCOMPLETE_SURVEY_CODES,
} from "../validation";
/**
 * The registry-independent facts about a node, exported so a caller holding no
 * block registry can still refuse a malformed one. The editor's op layer is the
 * caller that needs them: it must reject a bad node before the tree primitives
 * place it, and `validate()` requires a context a tree operation has no business
 * demanding.
 */
export { isNodeType, isNodeVersion } from "../validation";
/**
 * Exported because anything holding a document read from storage has to ask the
 * same question, and the answer is subtler than it looks: the check is on the
 * PROTOTYPE, so a `Date`, a `Map` or a class instance is refused rather than
 * walked and reported clean. A caller writing its own `typeof x === "object"`
 * gets a different answer for exactly the values that survive JSON badly.
 */
export { isPlainRecord } from "../plain-record";
// One style envelope laid over another, property by property: what Detach
// leaves on a block, and a block type's base with the site's edits over it.
// `@experimental` with the own-look helpers above.
export { overlaidStyles } from "../style/overlaid-styles";
/**
 * Exported because the renderer and every plain-text projection of a document
 * must agree on what counts as authored text. They did not: a stored number was
 * drawn as text on the page and skipped in the description derived from it.
 * A caller writing its own `typeof x === "string"` reintroduces exactly that
 * split, so the decision is published rather than restated.
 */
export { authoredText, isAuthoredText } from "../authored-text";
export {
  declaresNoMarkup,
  isConditionGated,
  placementGatesOf,
  storedVisibilityOf,
} from "../visibility";
// Per-device visibility as an author works with it: each device's resolved
// state, a hide that stays on one device, and the stored values carried across
// a change of the site's breakpoints. Public because the editor writes the eye
// and the breakpoint flows rewrite documents, and both must resolve devices as
// the compiler does.
export {
  carryDeviceVisibility,
  carryDocumentDeviceVisibility,
  deviceVisibility,
  hiddenOnDevice,
  revealConditioned,
  revealDeviceHidden,
  setDeviceVisibility,
} from "../device-visibility";
export type { CarriedVisibility, DeviceVisibility } from "../device-visibility";
export type { NoMarkupDefinitionSource } from "../visibility";
export type {
  BlockTypeLookup,
  ClassLookup,
  IssueCode,
  ValidationResult,
  IssueSeverity,
  TokenLookup,
  ValidationContext,
  ValidationIssue,
  ValidationMode,
} from "../validation";
