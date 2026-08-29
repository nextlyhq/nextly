/**
 * `@nextlyhq/builder` — the visual page-builder editor.
 *
 * The editor half of the page builder: the shell, the canvas, and the op store
 * that everything in it either produces or reads. It is deliberately NOT a
 * renderer.
 *
 * **The invariant this package is built around**: the canvas renders documents
 * through `@nextlyhq/blocks-react` — the same renderer that serves published
 * pages — and re-implements nothing downstream of the document model. Read-path
 * preparation, condition gating and slot pruning are consumed from the engine's
 * own entry points, never reproduced here.
 *
 * No test enforces it. Reimplementing rendering on React and the engine
 * imports exactly the same packages as delegating to the renderer, so the
 * layering guard cannot tell the two apart; it narrows what may be imported,
 * which makes the shortcut inconvenient rather than impossible.
 *
 * That rule is not stylistic. `plugin-page-builder` carries a second renderer of
 * its own, and the two disagree about condition gating in OPPOSITE directions —
 * one failing closed, the other not evaluating conditions at all. Sharing a
 * predicate would not have prevented that, because sharing a predicate does not
 * share the decision to call it; only sharing the entry point does.
 *
 * **Public surface**, all of it `@experimental` while the editor is being built
 * out:
 *
 * - {@link BUILDER_PACKAGE_NAME}, for diagnostics that report what a host loaded.
 * - The frame geometry — {@link pointToCanvas}, {@link pointToHost},
 *   {@link rectToHost}, {@link frameContentOrigin}, {@link frameInsetOf} — also
 *   published at `@nextlyhq/builder/geometry`, which carries no `"use client"`
 *   banner and so is reachable from a server component.
 * - The shell's declared bounds and preference port, also published at
 *   `@nextlyhq/builder/shell-state`.
 * - `BuilderShell` itself at `@nextlyhq/builder/shell`, which is the ONLY entry
 *   carrying `"use client"`. This one does not, so everything above is callable
 *   from a Server Component.
 * - `@nextlyhq/builder/styles.css`, the chrome's stylesheet. It SUPPLEMENTS the
 *   design system's rather than restating it, so a host loads
 *   `@nextlyhq/ui/styles.css` — or the admin's, which contains it — alongside.
 *   The shell says so in the console, in development, when it is missing.
 *
 * - The op store — {@link applyOp}, {@link OpError} and the op vocabulary —
 *   which every edit is expressed in and which derives each edit's inverse.
 *
 * The package was created ahead of any of this so its name could be claimed on
 * npm, because trusted publishing cannot perform a package's first publish and
 * the bootstrap script will not claim a name that is not already a workspace
 * package.
 *
 * @module @nextlyhq/builder
 */

/**
 * This package's npm name, for diagnostics that report which packages a host
 * has loaded.
 *
 * The name and not the version. A version literal in source would be stale one
 * release after it was written, because every release bumps this package in
 * lockstep with its siblings; reporting a version means injecting the manifest's
 * value at build time, which belongs with the surface that displays it rather
 * than with a constant nothing reads yet.
 */
export const BUILDER_PACKAGE_NAME = "@nextlyhq/builder" as const;

/**
 * The one mapping between the canvas frame and the host page.
 *
 * Exported because the acceptance harness measures against the SAME arithmetic
 * the editor positions with. A browser test carrying its own copy certifies its
 * own stale copy, and would keep passing through exactly the correction it
 * exists to catch.
 */
export {
  FrameGeometryError,
  frameContentOrigin,
  pointToCanvas,
  pointToHost,
  rectToHost,
  type FrameGeometry,
  type FrameInset,
  type Point,
  type Rect,
} from "./geometry";

/**
 * The DOM read the mapping cannot do for itself.
 *
 * Exported beside the geometry because the inset is the one input every caller
 * has to measure, and the one they get wrong: documenting the recipe as
 * `clientLeft`/`clientTop` left three call sites short by the padding.
 */
export { frameInsetOf } from "./geometry-dom";

/**
 * @experimental The op store: the vocabulary every edit is expressed in, and
 * how one applies.
 *
 * Exported from the package entry because the entry is what `tsup` builds. A
 * module the entry does not reference is absent from `dist` however thoroughly
 * it is tested — the tests import it by relative path and pass, while a consumer
 * installing the package finds nothing.
 *
 * `OpPosition` travels with the vocabulary because `BuilderOp` is written in
 * terms of it: a consumer that can name an op but not the position inside one
 * cannot construct an insert or a move.
 */
export {
  applyOp,
  OpError,
  type AppliedOp,
  type BuilderOp,
  type NodePatch,
  type OpPosition,
} from "./ops";

/**
 * @experimental The editor shell's props.
 *
 * The TYPE only. `BuilderShell` itself lives at `@nextlyhq/builder/shell`, and
 * this entry deliberately does not re-export it: a value re-export would pull
 * the component into this bundle, which would then need the `"use client"`
 * banner, which would make every export above it a client reference — including
 * the geometry, which a Server Component is supposed to be able to call.
 *
 * A type costs nothing at runtime, so it can be described from here.
 */
export type { BuilderShellProps } from "./builder-shell";

/**
 * @experimental The shell's own decisions: which panels the rail offers, the
 * bounds handed to the panel library, and the preference port.
 *
 * `DEFAULT_PREFERENCES` travels with them for a host that mirrors ONE
 * preference outside the shell — `BuilderShellProps.onShowEmptyElementsChange`
 * reports `showEmptyElements` after the shell has read it, which is later than
 * such a host's own first render. Reading the default from here rather than
 * restating `true` is what keeps that first render honest, and keeps it that
 * way if the default here ever changes.
 */
export {
  DEFAULT_PREFERENCES,
  EMPTY_ELEMENTS_ATTRIBUTE,
  LEFT_PANELS,
  MIN_CANVAS_WIDTH,
  MIN_SHELL_WIDTH,
  PANEL_BOUNDS,
  RAIL_WIDTH,
} from "./shell-state";
export type {
  LeftPanel,
  PreferenceStore,
  ShellPreferences,
} from "./shell-state";

/**
 * @experimental The command palette's TYPES only.
 *
 * The component itself carries `"use client"` and is reached through
 * `@nextlyhq/builder/shell` beside `BuilderShell`, for the same reason that
 * entry exists: this root is server-callable, and re-exporting a client
 * component from it would make importing the geometry pull React into a server
 * bundle.
 *
 * A type costs nothing at runtime, so a host can describe its command list
 * without reaching for the client entry.
 */
export type { BuilderCommand, CommandPaletteProps } from "./command-palette";

/**
 * @experimental The drop rules: where a dragged block can land, and which of
 * those places a pointer means.
 *
 * From this entry rather than from `/shell`, because none of it touches React —
 * it is arithmetic over measured rectangles, and the split is what lets the
 * acceptance harness and a host reason about a drop without loading an editor.
 *
 * The same argument as the geometry above, and the same hazard: a harness
 * carrying its own copy of this ranking would certify its own copy, and would
 * keep passing through exactly the correction it exists to catch.
 *
 * `InsertTarget` and `SlotSource` travel with them because the region types are
 * written in terms of both: a consumer that can name a region but not what it
 * accepts cannot ask the nesting rule about one.
 */
export {
  axisOfRects,
  collectRegions,
  movingSubtree,
  regionAt,
  resolveDrop,
  ROOT_REGION,
  targetsInRegion,
  type DropAxis,
  type DropQuery,
  type DropRefusal,
  type DropRegion,
  type DropResolution,
  type DropTarget,
  type RectSource,
} from "./drop-targets";
export {
  blockAllowedAt,
  registryBlockSource,
  registrySlotSource,
  type InsertTarget,
  type SlotSource,
} from "./inserter";

/**
 * @experimental When a drag is allowed to change the target it has committed
 * to.
 *
 * Separate from the drop rules above because it decides something different:
 * those say what the pointer is over NOW, this says when that answer may
 * replace the one being drawn. Keeping them apart is what lets a region
 * boundary be an ordinary candidate change rather than a case of its own.
 */
export {
  nextTargetSwitchState,
  NO_TARGET,
  type PendingTarget,
  type TargetId,
  type TargetSwitchState,
} from "./target-switch";

/**
 * @experimental The document as a structure: the layers tree, the path to a
 * block, and what a search leaves standing.
 *
 * From this entry rather than from `/shell`, because none of it touches React.
 * A host that wants an outline of a stored document — a summary, an export, an
 * agent describing a page — needs the tree without needing an editor.
 */
export {
  ancestorIds,
  filterLayers,
  layerLabel,
  layersOf,
  pathTo,
  type LayerNode,
  type LayerSearch,
} from "./layers";
export { blockLabel } from "./inserter";

/**
 * @experimental Whether the editor may move or delete a block the author has
 * locked.
 *
 * From this entry because it is plain functions over a document. A host or an
 * agent deciding whether an action is permitted has to ask the SAME question
 * the editor asks — a second reading of `node.locked` would miss that deleting
 * a container is refused by a lock anywhere inside it, while moving one is not.
 */
export { isLocked, lockBlockingDelete, lockBlockingMove } from "./locking";

/**
 * @experimental How a lock reads across a whole selection.
 *
 * From this entry because it is a plain function over a document, and because
 * anything showing a lock for several blocks needs the same THREE answers the
 * inspector uses. A surface that collapsed "some of these" into on or off would
 * tell an author something false about half of what they selected.
 */
export { lockStateOf, type LockState } from "./inspector";

/**
 * @experimental Duplicating a block: the copy, and where it goes.
 *
 * From this entry because it is a plain function over a document. An agent
 * asked to "make three of these" needs the same copy the editor makes — one
 * that re-ids the whole subtree and drops the DOM id — and a second
 * implementation would produce a document with two nodes sharing an id.
 */
export {
  blockDuplication,
  COPY_SUFFIX,
  type BlockDuplication,
} from "./duplicate-block";

/**
 * @experimental Delete, duplicate and lock across a whole selection.
 *
 * From this entry because each is a plain function returning ops. An agent
 * asked to "remove these six" needs the same plan the editor makes — including
 * that one lock refuses the whole group, and that copies must be planned in
 * reverse so each lands beside its own original.
 */
export {
  isRefusal,
  selectionDeletion,
  selectionDuplication,
  selectionLock,
  selectionMove,
  type SelectionDuplication,
  type SelectionEdit,
  type SelectionMove,
  type SelectionMovePlan,
  type SelectionPlan,
  type SelectionRefusal,
} from "./selection-ops";

/**
 * @experimental What "the selection" is once it can hold more than one block.
 *
 * From this entry because every part of it is a plain function over a document.
 * A host, an agent, or a surface answering "what is selected" needs the same
 * normalisation the editor uses — a second reading would let one of them act on
 * a container AND something inside it, which deletes the child twice.
 */
export {
  EMPTY_SELECTION,
  applySelection,
  documentOrder,
  normalizeSelection,
  pruneSelection,
  rangeBetween,
  type BlockSelection,
  type SelectionMode,
} from "./selection";

/**
 * @experimental The palette's command list, as a plain function over state.
 *
 * From this entry because a host assembling its own palette — or an agent
 * enumerating what the editor can do right now — needs the same list the editor
 * offers, and availability derived from a second reading of the lock and move
 * rules is how the two come to disagree.
 */
/**
 * @experimental How large the canvas draws the page.
 *
 * Pure, so it stays on this entry: a host reads a stored preference and hands
 * the result to the canvas, and neither half needs a component to do it.
 */
export {
  FIT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  readZoom,
  steppedZoom,
  writeZoom,
  type CanvasZoom,
} from "./canvas-zoom";

export {
  BLOCK_GROUP,
  EDITOR_GROUP,
  HISTORY_GROUP,
  blockActionRunners,
  builderCommands,
  type BuilderCommandsInput,
  type CommandVerbs,
} from "./builder-commands";

/**
 * @experimental Who owns Escape while the editor is on screen.
 *
 * From this entry because the rule is a plain function over the DOM and a
 * selection. A host embedding the editor beside its own Escape handling needs
 * the same answer the editor uses, and a second reading of it is how the two
 * end up both claiming the key or both releasing it.
 */
export {
  CANVAS_ESCAPE_PRIORITY,
  escapeOutcome,
  isTextEntry,
  modalIsOpen,
  type EscapeOutcome,
} from "./canvas-escape";

/**
 * @experimental What the floating toolbar offers, and where it sits.
 *
 * From this entry because both halves are plain functions. The action list is
 * the same set of questions an agent asks before proposing a structural edit —
 * whether this block can move, whether a lock forbids removing it — answered by
 * the rules the editor itself uses rather than by a second reading of them.
 */
export {
  TOOLBAR_GAP_PX,
  toolbarActions,
  toolbarPlacement,
  unionRect,
  type ToolbarAction,
  type ToolbarActionId,
  type ToolbarPlacement,
  type ToolbarSize,
} from "./toolbar-actions";

/**
 * @experimental The style controls SDK: what a property offers, and how a
 * control reads, previews and writes it.
 *
 * From this entry because every piece is a plain function over a catalog entry
 * or a style envelope. The controls a property offers are DERIVED from
 * `catalog.ts` rather than listed, so a property added to the engine gains an
 * editor with no code here — and an agent asked to "set the bottom margin"
 * addresses the value through the same functions the panel does, rather than
 * reaching into `node.styles` with its own idea of where a side lives.
 *
 * No control renders yet. This is the contract they will be built on.
 */
export {
  styleControlsFor,
  SUPPORTED_LEAF_KINDS,
  type StyleControl,
  type StyleControlKind,
  type StyleControlOptions,
  type StyleControlSet,
  type StyleControlVariants,
} from "./style-controls";

/**
 * @experimental Addressing one control's value inside a node's style envelope.
 *
 * From this entry because the envelope is `state × breakpoint × property` and
 * a caller that spelled that path itself would be a second answer to where a
 * value lives. Validation is the catalog's, so a refused value comes back with
 * the catalog's own reasons rather than a control's guess at them.
 */
export {
  readStyleValue,
  styleClearOp,
  styleValueAtPath,
  styleWriteOp,
  type StyleAddress,
  type StylePolicy,
  type StyleWrite,
} from "./style-values";

/**
 * @experimental Whether a control's value was authored here, inherited, or
 * never set.
 *
 * From this entry because it is a pure classification over the compiler's own
 * provenance record. Anything showing where a value came from — a dot beside a
 * control, an agent explaining why a page looks as it does — needs the answer
 * the compiler already wrote, not a second walk of the cascade.
 */
export {
  styleProvenance,
  type StyleProvenance,
  type StyleProvenanceQuery,
} from "./style-provenance";

/**
 * @experimental Previewing a value mid-drag, and committing it once.
 *
 * From this entry because the preview is compiled through the same function
 * that emits the published stylesheet, so what a drag shows is what a release
 * would store. The rule sits at the compiler's own specificity and wins on
 * document order, so the element carrying it belongs AFTER the compiled sheet.
 */
export {
  scrubCommitOp,
  scrubPreviewCss,
  scrubStateFragments,
  type ScrubPreview,
  type ScrubTarget,
} from "./style-scrub";

/**
 * @experimental Where a control's custom behaviour lives, referenced by name.
 *
 * From this entry because it is the seam a host configures. The catalog stays
 * data — it is read by validation, the compiler, the inspector and the
 * generated reference docs, and a function stored in it could not be
 * serialized, reasoned about, or documented — so behaviour is registered under
 * a key derived from the catalog's own identity instead. Ships empty.
 */
export {
  NO_STYLE_CONTROL_BEHAVIOUR,
  styleControlBehaviour,
  styleControlBehaviourKey,
  type StyleControlBehaviour,
  type StyleControlBehaviours,
} from "./style-control-behaviour";

/**
 * @experimental What the selected block offers on the Style tab.
 *
 * From this entry because it is a plain function over a document and the
 * registry. A host drawing its own style surface — or an agent asked "what can
 * I set on this block" — needs the same answer the panel draws from, which is
 * `supports` read through the engine rather than a second reading of it. The
 * panel itself is behind the client banner in `./shell`.
 */
export {
  inspectStyle,
  type InspectedStyleProperty,
  type StyleInspection,
  type StyleInspectionOptions,
  type StyleSection,
} from "./style-inspector";

/**
 * What a SELECTION of blocks shares at one style address, and what changes it.
 *
 * The model half of batch editing, exported for the same reason the style
 * inspection above is: a host drawing its own multi-selection surface — or an
 * agent asked "do these six blocks agree on this padding" — needs the answer
 * this package already computes rather than a second implementation of it. The
 * shipped panel is behind the client banner in `./shell`.
 *
 * Headless by construction: it answers what a shared value MEANS and what ops
 * would change it, and knows nothing about how either is drawn.
 *
 * @experimental
 */
export {
  sharedValueAt,
  batchStyleWriteOps,
  batchStyleClearOps,
  type SharedValue,
  type BatchStyleWrite,
} from "./batch-style";
