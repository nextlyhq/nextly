/**
 * The engine's public exports: URL policy, the op vocabulary, layer locks, rich text and preview breakpoints.
 *
 * Part of the package's root entry, `../index.ts`, which re-exports every
 * part in a fixed order. Nothing here imports that entry.
 */
// Two policies about stored URLs, exported for the same reason: every surface
// that draws or describes a document must reach the same verdict about one
// stored string.
//
// The remote-host policy — `isAllowedRemoteUrl`, `isFetchableUrl`,
// `isRemoteUrl` — is about which hosts a compiled page may FETCH from, so the
// React renderer applies the same matcher the style compiler does.
//
// `isLinkableUrl` is a separate, format-level question: whether this format can
// express the destination at all. It governs whether a link is DRAWN, so a
// consumer restating it as its own scheme check makes a renderer that shows
// nothing and a projection that still reports the label describe different
// pages.
export {
  isAllowedRemoteUrl,
  isFetchableUrl,
  isLinkableUrl,
  isRemoteUrl,
  normalizeUrl,
  type RemotePattern,
  type RemotePatternInput,
} from "../url-policy";

// The operation names the format reserves for composition flows. Exported so
// an operation layer can ask rather than restate: a reservation only holds if
// the code deciding whether to accept a name reads the same list the format
// spec publishes.
export {
  RESERVED_OPERATION_NAMES,
  isReservedOperationName,
  type ReservedOperationName,
} from "../operations";

// The op vocabulary itself: the edits an editor applies, addressed by id, with
// the inverse derived before the mutation so undo is a fact rather than a
// reconstruction. Exported from the ENGINE rather than owned by the editor
// because applying an edit is not an editing-surface concern — a plugin route,
// a script or an agent has the same right to it, and each would otherwise grow
// its own vocabulary that agrees with this one only until one of them changed.
export {
  addressesNoNode,
  applyOp,
  applyOps,
  // Published for the planners: an insert whose subtree arrives locked is
  // refused by the op layer, so a planner has to be able to foresee it rather
  // than hand back a plan the apply throws on.
  // And the document-level rule the apply runs before it looks at the op, so a
  // plan is never built against a destination that cannot be edited at all.
  documentRefusal,
  forestRefusal,
  lockedWithin,
  // And the shape rule for what an insert will carry, for the same reason.
  nodeShapeRefusal,
  OpError,
  // The apply's own position rule, asked without applying: a planner that
  // wrote its own copy would agree until one of the two moved.
  positionRefusal,
  subtreeRemovalRefusal,
  positionOf,
  sameStoredValue,
  sameStyleValue,
  type AppliedOp,
  type AppliedOps,
  type ApplyOptions,
  type BuilderOp,
  type EnvelopeField,
  type EnvelopePatch,
  type NodePatch,
  type OpPosition,
  type SlotAddress,
} from "../ops";

// The Layers lock's rule, stated once: for one op, which the apply asks of
// every edit and an editing surface asks before offering one; and for a whole
// write, judged against the document it would replace, which a save asks
// because a write through the API carries no ops to judge.
export {
  layersLockBreak,
  lockedAncestorOf,
  type LayersLockBreak,
} from "../layers-lock";
export {
  layersLockChanges,
  type LayersLockChange,
  type LayersLockChangeKind,
} from "../layers-lock-stored";
export {
  variantLockChanges,
  type VariantDrawing,
  type VariantLockChange,
} from "../layers-lock-variants";
export {
  componentLayersLocks,
  heldBaselines,
  keptForSameComponents,
  placedLockChanges,
  placementsAsComponentsHoldThem,
  type ComponentLayersLock,
  type ComposedHeldBaseline,
  type HeldBaseline,
  type PlacedLockChange,
} from "../component-layers-locks";
// How every copy into a document keeps the Layers locks it carries.
export { insertKeepingLocks, type Placed } from "../locked-insert";

/**
 * The stored shape of rich text.
 *
 * Shared here because the CMS and the renderer both read it and may not import
 * each other — see the module for why a shared DEFINITION is the containable
 * form of that, and two readers is not.
 */
export {
  codeTokenClass,
  hasFormat,
  isOneParagraphProp,
  isRichTextNode,
  isRichTextValue,
  ONE_PARAGRAPH_OPTION,
  oneParagraphWords,
  RICH_TEXT_PROP_TYPE,
  richTextToPlainText,
  TEXT_FORMAT,
  toOneParagraph,
  type OneParagraph,
  type RichTextNode,
  type RichTextValue,
} from "../rich-text";

/**
 * Emitting a page's breakpoints for a surface that is not the published page.
 */
export {
  MAX_PREVIEW_CONTAINER_LENGTH,
  PREVIEW_VIEWPORT_CONTAINER,
  UNPREVIEWABLE_CONTAINER,
  previewContainerFor,
  previewContainerName,
  type BreakpointContextOptions,
} from "../style/compile-page";
