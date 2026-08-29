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
 * The compiled cascade behind the page, for chrome that names where a value
 * came from.
 *
 * On the CLIENT entry rather than the root one. It reaches
 * `@nextlyhq/blocks-react` to compile, so publishing it from the server-safe
 * barrel would pull a React dependency into an artifact whose whole contract is
 * that a Server Component can call everything in it.
 *
 * Exported at all because the HOST is the only surface holding both halves the
 * compile needs — the document and the site's breakpoints — while the panel that
 * reads the answer sits several layers below. Compiling once at the top is what
 * keeps the cascade from being walked per control; `style-trace.ts` says why it
 * is compiled a second time.
 */
export { pageStyleTrace } from "./style-trace";

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
export type { CanvasPreview, CanvasProps } from "./canvas";

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

/**
 * The Style half of the same inspector.
 *
 * Exported beside it rather than only through it, because a host embedding the
 * editor in a surface of its own may have somewhere else to put styling — and
 * withholding it would invite exactly the second implementation the note above
 * is about. Mounting BOTH is the ordinary case and needs nothing here:
 * `InspectorPanel` already renders this one under its Style tab.
 */
export { StyleInspectorPanel } from "./style-inspector-panel";
export type { StyleInspectorPanelProps } from "./style-inspector-panel";

export { InsertPanel } from "./insert-panel";
export type { InsertPanelProps } from "./insert-panel";

/**
 * The site's breakpoints, as a trigger and the dialog behind it.
 *
 * The MANAGER is published and the dialog is not. A host needs the pair —
 * something to click and something to edit in — and publishing the dialog alone
 * would leave every host inventing the same open state, while publishing both
 * would offer two ways to mount one feature that must agree about when the
 * saved set has actually been read.
 */
export { authoredBreakpoints, sameBreakpoints } from "./breakpoints";
export { BreakpointManager } from "./breakpoint-manager";
export type { BreakpointManagerProps } from "./breakpoint-manager";

/**
 * The control that sizes the canvas, and the derivations behind it.
 *
 * Published together because they are one answer read from two places. The
 * switcher SETS a width; `editedBreakpointAtWidth` and `breakpointsAtWidth`
 * turn the width the box actually got into the tier an edit lands in and the
 * tiers that are live. A host given only the control would have to derive those
 * itself, and a second derivation of "which tier is this box in" is exactly the
 * disagreement between the canvas and the inspector that deriving from one
 * width exists to make unrepresentable.
 *
 * On the CLIENT entry: the switcher is a component, and the derivations travel
 * with it rather than from the root barrel so a host imports the pair from one
 * place.
 */
export { BreakpointSwitcher } from "./breakpoint-switcher";
export type { BreakpointSwitcherProps } from "./breakpoint-switcher";

/**
 * The canvas zoom, and the control that names it.
 *
 * The control is a client component and belongs here; the model beside it is
 * pure and is exported from the root entry as well, so a host can read a stored
 * preference without pulling a component into a server render.
 */
export { CanvasZoomControl } from "./canvas-zoom-control";
export type { CanvasZoomControlProps } from "./canvas-zoom-control";
// The type alone: a host threading a zoom through this entry should not have
// to import the model from a second one.
export type { CanvasZoom } from "./canvas-zoom";
export {
  breakpointsAtWidth,
  editedBreakpointAtWidth,
  offeredTiers,
  selectableTiers,
  widthForBreakpoint,
} from "./canvas-width";

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
/**
 * The command palette, assembled and mounted for the editor.
 *
 * From this entry because it is a client component and because it only works
 * below `BlockKeyboardActions`, whose verbs it runs. A host that wants to build
 * its own list uses `CommandPalette` with `builderCommands` instead.
 */
export { EditorCommandPalette } from "./editor-command-palette";
export type { EditorCommandPaletteProps } from "./editor-command-palette";

/**
 * The right-click menu over the canvas.
 *
 * Beside the palette because the two are the same kind of thing: a surface the
 * editor assembles from the verbs context so a host does not have to know the
 * three separate facts that mounting one correctly requires.
 */
export { BlockContextMenu } from "./block-context-menu";
export type { BlockContextMenuProps } from "./block-context-menu";

export { BlockToolbar } from "./block-toolbar";
export type { BlockToolbarProps } from "./block-toolbar";

/**
 * The selected block's margin and padding, drawn over the page.
 *
 * A canvas overlay like the drop indicator, and composed the same way — it goes
 * in `Canvas`'s `overlay`, because it is positioned in the canvas's own content
 * coordinates and the canvas root is what establishes them.
 *
 * It reads the RENDERED page rather than the stored style tier, so what it
 * reports is what the author is looking at: the browser has already resolved the
 * logical sides to physical ones, `auto` to a used value, percentages against
 * the containing block, and the whole cascade to a winner.
 */
export { SpacingOverlay } from "./spacing-overlay";
export type { SpacingOverlayProps } from "./spacing-overlay";

/**
 * A labelled "+" drawn over every container that has nothing in it.
 *
 * A canvas overlay like the two above, and composed the same way — it goes in
 * `Canvas`'s `overlay`, because it is positioned in the canvas's own content
 * coordinates and the canvas root is what establishes them. It is a client
 * component for the same reason `SpacingOverlay` is: it holds React state for
 * what it has measured, so it belongs behind this entry's banner rather than
 * the root's.
 */
export { EmptyContainerAppenders } from "./empty-container-appender";
export type { EmptyContainerAppendersProps } from "./empty-container-appender";

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
/**
 * Typing a block's text in place on the canvas.
 *
 * The hook owns the caret and the handover; the rules about WHAT may be edited
 * are `inline-text`'s, and a block declares its own through its prop schemas.
 */
export { useInlineText, EDITING_ATTRIBUTE } from "./use-inline-text";
export type { InlineTextEditing, UseInlineTextResult } from "./use-inline-text";
export { inlineTargets, inlineTarget, inlineTextOp } from "./inline-text";
/**
 * Typing a block's PASSAGE directly on the canvas, and the one gesture that
 * reaches either surface.
 *
 * `useInlineEditing` is what a host wires to the canvas: it owns both the plain
 * and the rich edit, decides from the block's own schema which a double-click
 * opened, and keeps at most one of them live. A host that supplies no rich-text
 * loader still edits plain text; passages simply do not open.
 *
 * The rich editor is loaded on first edit, not on mount, because its node
 * classes carry a 630KB chunk that an author who never edits a passage should
 * never fetch.
 */
export { useInlineEditing } from "./use-inline-editing";
export type { UseInlineEditingResult } from "./use-inline-editing";
/**
 * What finishing an inline edit did.
 *
 * A host must branch on this rather than on the presence of a document. A
 * refused commit has kept the surface open because the author's words are in it
 * and nowhere else — closing, navigating or opening another value on top of
 * that is what loses them.
 */
export {
  documentAfter,
  INLINE_EDIT_DISCARDED,
  INLINE_EDIT_UNCHANGED,
} from "./inline-edit-outcome";
export type {
  InlineEditOutcome,
  InlineEditDiscarded,
  InlineEditRefusal,
  InlineEditRefused,
  InlineEditUnchanged,
  InlineEditWritten,
} from "./inline-edit-outcome";
export { useInlineRichText } from "./use-inline-rich-text";
export type {
  InlineRichTextEditing,
  InlineRichTextEditorLoader,
  InlineRichTextFinished,
  UseInlineRichTextResult,
} from "./use-inline-rich-text";
export {
  richInlineTargets,
  richInlineTarget,
  richInlineTextOp,
  richTextChanged,
} from "./inline-rich-text";
export type { InlineRichTextTarget } from "./inline-rich-text";
export { inlinePropKind } from "./inline-prop-kind";
export { namedTarget, firstInlineProp } from "./inline-target";
export type { FirstInlineProp } from "./inline-target";
export type { InlinePropKind } from "./inline-prop-kind";
/**
 * The first-run checklist: what an author has not done on this page yet.
 *
 * Every step is DERIVED from the document rather than tracked, so it describes
 * the page rather than a person's history with it.
 */
export {
  OnboardingChecklist,
  useBuilderChecklist,
  CHECKLIST_STORAGE_KEY,
} from "./onboarding-checklist";
export type {
  OnboardingChecklistProps,
  UseBuilderChecklistOptions,
  UseBuilderChecklistResult,
} from "./onboarding-checklist";
export {
  builderChecklist,
  checklistComplete,
  checklistDoneCount,
} from "./onboarding";
export type { ChecklistStep } from "./onboarding";
export type { InlineTextTarget } from "./inline-text";
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
/*
 * The tokens studio. A host that mounts it owns the site style document and
 * decides when an edit is persisted; this exports the surface, not the save.
 */
export { TokensPanel } from "./tokens-panel";
export type { TokensPanelProps } from "./tokens-panel";
export { SelectionBreadcrumb } from "./breadcrumb";
export type { SelectionBreadcrumbProps } from "./breadcrumb";
/*
 * The two class surfaces, and the rules both answer from.
 *
 * Split because the actions are: applying a class happens while styling one
 * element and belongs beside the style controls, while auditing and deleting is
 * occasional and needs a list. A host that mounts either owns the site style
 * document and decides when an edit is persisted; these export the surfaces,
 * not the save.
 */
export { ClassSelector } from "./class-selector";
export type { ClassSelectorProps } from "./class-selector";
/*
 * The notice surface is deliberately NOT exported.
 *
 * `BuilderShell` owns its queue and renders the region itself, and it offers no
 * way to supply a queue or to suppress the built-in region — so a host calling
 * `useNoticeQueue` would build a SECOND, empty queue and place a region that
 * can never receive anything, while the shell's own went on reporting. An
 * export whose documented use cannot work is worse than its absence, because
 * the failure is silent and looks like a wiring mistake at the call site.
 *
 * Publishing it needs the shell to accept a queue first. That is a contract
 * change rather than an export, so it waits for a host that wants it.
 */
export { ClassManagerPanel } from "./class-manager-panel";
export type {
  ClassManagerPanelProps,
  ClassRenameOutcome,
} from "./class-manager-panel";
export {
  classRows,
  filterClassRows,
  deletionWarning,
  newClassName,
  renamedClassName,
  nodeHasRoom,
  siteClasses,
  usageSummary,
  withClassApplied,
  withClassRemoved,
} from "./class-library";
export type {
  ApplyRefusal,
  ClassApplyOutcome,
  ClassChoice,
  ClassFilter,
  ClassNameOutcome,
  ClassRow,
  ClassUsageCounts,
  DeletionWarning,
  NameRefusal,
} from "./class-library";

/**
 * The fonts panel, and the rules it draws from.
 *
 * A reader over the site's faces and its `fontFamily` tokens rather than an
 * editor: creating and renaming those tokens belongs to the tokens studio, and
 * the question this answers — whether a family a token names will actually
 * render — needs both lists at once, which is why neither the studio nor the
 * inspector can ask it.
 */
export { FontsPanel } from "./fonts-panel";
export type { FontsPanelProps } from "./fonts-panel";
export { fontTokenRows, readStack, rowsNeedingAttention } from "./font-library";
export type {
  FamilyReading,
  FamilySource,
  FontTokenRow,
  StackReading,
} from "./font-library";
