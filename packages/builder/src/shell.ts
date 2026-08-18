/**
 * The editor shell, published as its own entry because it is a CLIENT one.
 *
 * The shell is a client component, and Rollup drops per-module `"use client"`
 * directives while bundling, so the directive has to be re-applied to the built
 * file as a banner. A banner applies to the WHOLE artifact and to everything it
 * re-exports — which is why this is a separate entry rather than part of the
 * root barrel.
 *
 * Put in the root barrel, the shell's banner would have marked the frame
 * geometry as client-only too. Those helpers are plain arithmetic that a Server
 * Component is meant to be able to call, and they were part of this package's
 * public surface before the shell existed, so the banner would have been a
 * silent regression for anyone already importing them: the export map would go
 * on advertising a callable function while the artifact delivered a client
 * reference. Splitting the entry keeps the boundary where the React actually is.
 *
 * The props type is still described from the root entry — a type is erased, so
 * it carries no boundary with it.
 *
 * @module @nextlyhq/builder/shell
 */

export { BuilderShell } from "./builder-shell";
export type { BuilderShellProps } from "./builder-shell";

/**
 * Whether the surrounding shell is interactive.
 *
 * Exported for slot content that PORTALS out of the shell, which the shell cannot reach with
 * `hidden` and `inert` and so has to inform instead.
 */
export { useShellIsActive } from "./builder-shell";

/**
 * The command palette, published here beside the shell because it is a client
 * component for the same reason: it holds React state and registers a keyboard
 * binding through the shell's provider, so it belongs behind the same banner.
 *
 * Its types are described from the root entry, which stays server-callable.
 */
export { COMMAND_PALETTE_KEYS, CommandPalette } from "./command-palette";
export type { BuilderCommand, CommandPaletteProps } from "./command-palette";

/**
 * The canvas, behind the same client banner and for a stricter reason than the
 * shell's: it holds a pointer handler and renders `PageRenderer`, so it is
 * interactive in its own right rather than merely stateful.
 *
 * `CANVAS_ROOT_CLASS` and `nodeIdFromEvent` ship beside it rather than from the
 * root entry even though neither touches React. They describe how a DOM element
 * is matched to a node id, which is only answerable where that DOM exists, and
 * splitting them across two entries would let a host read the attribute name
 * from a server module while the writer lives behind the boundary — two halves
 * of one contract that could then be versioned apart.
 */
export { CANVAS_ROOT_CLASS, Canvas, nodeIdFromEvent } from "./canvas";
export type { CanvasProps } from "./canvas";

/**
 * The inserter, behind the same client banner as the shell it fills: it holds
 * search state and composes the command primitives, so it is interactive in its
 * own right.
 *
 * Published here rather than from the root for the reason the canvas is — the
 * root entry stays server-callable, and a value re-export of a client component
 * would make importing the frame geometry pull React into a server bundle.
 *
 * The derivations it draws from are deliberately NOT re-exported beside it.
 * They are the editor's internal answer to what may be inserted where, and
 * publishing them would invite a host to compute a palette of its own — which
 * is the second implementation of the nesting rule that the engine exists to
 * prevent.
 */
/**
 * The inspector, behind the same client banner: it holds draft field state and
 * writes through the store.
 *
 * The derivations it draws from are not re-exported beside it, for the reason
 * the inserter's are not — which props a block exposes is the editor's answer,
 * and publishing it invites a host to build a second inspector that disagrees
 * with this one about the merge rule for a patch.
 */
export { InspectorPanel } from "./inspector-panel";
export type { InspectorPanelProps } from "./inspector-panel";

export { InsertPanel } from "./insert-panel";
export type { InsertPanelProps } from "./insert-panel";

/**
 * The editor's keyboard actions — moving, deleting, undoing — behind the same
 * client banner.
 *
 * ONE component rather than a set, because they share a live region: two
 * regions announcing the same author's actions read them twice, and a listener
 * has no way to tell which to believe.
 *
 * Published as a component as well as a hook because the shell provides the
 * shortcut context: whatever renders the shell is outside it, so only a child
 * of the shell can register bindings.
 */
export {
  BlockKeyboardActions,
  useBlockActionsContext,
  useBlockKeyboardActions,
} from "./keyboard-actions";
export type {
  BlockActions,
  BlockKeyboardActionsOptions,
  BlockKeyboardActionsResult,
} from "./keyboard-actions";

/**
 * The floating toolbar, from this entry because it is a client component and
 * because it only works below `BlockKeyboardActions`.
 *
 * It presses the verbs that component publishes rather than applying ops of its
 * own, which is what keeps one gesture having one answer — and what lets both
 * the button and the keystroke announce into the single live region.
 */
export { BlockToolbar } from "./block-toolbar";
export type { BlockToolbarProps } from "./block-toolbar";

/**
 * The editor's document state, published beside the canvas because it is a hook
 * and therefore client-only for the same reason the shell is.
 *
 * It is the ONLY place a document changes: the canvas, the panels, a keyboard
 * handler and an agent all reach the same `apply`, so undo covers every one of
 * them rather than only the path that happened to implement it.
 */
export { MAX_HISTORY, useEditorState } from "./editor-state";
export type { EditorState, UseEditorStateArgs } from "./editor-state";

/**
 * Dragging blocks on the canvas, behind the same client banner: the hook holds
 * a gesture and the indicator draws its answer.
 *
 * Published together because neither is useful alone — the hook's whole output
 * is something to draw, and the indicator has nothing to draw without it.
 *
 * The RULES the drag obeys are not here. Which positions exist, which the
 * nesting rule permits and which one a pointer means are decided in
 * `drop-targets`, and when the answer may change is decided in `target-switch`;
 * both are plain functions over numbers and ship from the root entry, where a
 * caller can reach them without loading React.
 */
export { DropIndicator, useCanvasDrag } from "./canvas-drag";
export type {
  CanvasDrag,
  CanvasDragHandlers,
  CanvasDragState,
  DropIndicatorProps,
  UseCanvasDragOptions,
} from "./canvas-drag";

/**
 * The layers panel and the ancestor breadcrumb, behind the same client banner.
 *
 * Together because they answer one question from two directions — where does
 * this block sit — and they read the SAME tree to answer it, so shipping one
 * without the other would leave a host able to show a trail the panel could
 * contradict.
 *
 * The tree they draw is derived in `layers`, which is plain functions over a
 * document and ships from the root entry.
 */
export { LayersPanel } from "./layers-panel";
export type { LayersPanelProps } from "./layers-panel";
export { SelectionBreadcrumb } from "./breadcrumb";
export type { SelectionBreadcrumbProps } from "./breadcrumb";
