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
 * The shell's preferences kept per signed-in user, for a host that knows who
 * is signed in: pass it as `store`. @experimental
 */
export { userPreferenceStore } from "./shell-state";

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
/*
 * The inspector's own answer to whether it can show anything for a selection,
 * exported because a HOST needs it.
 *
 * A host drawing both the panel and the canvas has to keep them agreeing about
 * the interaction state, and the panel withholds its whole tab strip — the
 * state control with it — for a selection it cannot inspect. An unregistered
 * block type is that case and reads as one ordinary selection to anything
 * counting ids, so a host deriving the answer itself gets it wrong on exactly
 * the input the predicate exists for.
 *
 * A pure function over a document, so it crosses this entry carrying no state
 * and no React.
 */
export { lockViewOf, selectionIsInspectable } from "./inspector";
export { pageStyleTrace } from "./style-trace";

/**
 * Whether the surrounding shell is interactive.
 *
 * Exported for slot content that PORTALS out of the shell, which the shell cannot reach with
 * `hidden` and `inert` and so has to inform instead.
 */
export { useShellIsActive } from "./shell-active";

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
export {
  CANVAS_ROOT_CLASS,
  Canvas,
  DropRefusal,
  nodeIdFromEvent,
} from "./canvas";

/**
 * @experimental Which blocks' visibility conditions the page can't check, for
 * a host to hand the canvas so it badges them in red: judged as the save
 * judges them, with the collections the editor's services list.
 */
export { useConditionsUnchecked } from "./condition-checks";

/**
 * @experimental The frame the canvas is drawn in, and how the code around the
 * canvas learns about it.
 *
 * `CanvasFrame` is both the component and the type `useCanvasFrame` answers
 * with: what the frame is, its document and window, its painted scale and
 * viewport, and the point mapping between it and the editor. The provider
 * goes ABOVE the editor's shell, so the panels, the toolbar and the keys
 * outside the canvas see the frame the canvas registers into it.
 *
 * `CanvasMarks` draws the selection and the drop container over the page.
 *
 * A `CanvasFrameSource` says where the frame's page comes from: the editor's
 * blank page, or a page the site serves so the canvas is drawn inside the
 * site's own layout, with `onSourceFallback` told when that page cannot be
 * shown.
 */
export {
  CanvasFrame,
  CANVAS_FRAME_TITLE_PREFIX,
  canvasFrameTitle,
} from "./canvas-frame";
export type {
  BlankFrameSource,
  CanvasFrameFallback,
  CanvasFrameProps,
  CanvasFrameSource,
  SiteFrameSource,
} from "./canvas-frame";
export { CanvasFrameProvider, useCanvasFrame } from "./canvas-frame-context";
/**
 * @experimental Where the docs explain the canvas route, for a note saying the
 * canvas is drawn without the site's layout.
 */
export {
  CANVAS_ROUTE_DOCS_HREF,
  SITE_CODE_POLICY_DOCS_HREF,
} from "./docs-links";
export { CanvasMarks } from "./canvas-marks";

/**
 * @experimental Hold the editor's shortcuts while something modal is over it.
 *
 * From THIS entry rather than the root, which carries no `"use client"` banner
 * and is documented as callable from a Server Component. The hook reaches
 * `useShortcuts`, so exporting it there would pull the design system's client
 * barrel into a module a server build is entitled to load — the contract the
 * root entry states about itself, broken by one re-export.
 *
 * Published at all because a modal the editor RAISES is not always the editor's
 * own: a host draws the form its verbs open, and a focus trap does nothing about
 * shortcuts — the canvas's bindings sit on the document, so Delete and
 * Alt+Arrow reach the page behind the dialog.
 */
export { useModalKeyboardHold } from "./modal-keyboard-hold";
export type { CanvasProps } from "./canvas";
// The regions of a page's Layout, drawn locked around the page on the canvas.
export type { CanvasRegion } from "./canvas-regions";
export { REGION_ATTRIBUTE } from "./canvas-regions";

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
export type {
  BlockInspectorResolver,
  InspectorPanelProps,
} from "./inspector-panel";
// What a host tells the inspector about the component it edits, beside it.
export type { ComponentFieldsHost } from "./component-fields";
// The banner over a component's own view: its name, its reach, and Back.
export { ComponentBanner } from "./component-banner";
export type { ComponentBannerProps } from "./component-banner";
// And about its variants: how many placements chose one, for the delete dialog.
export type {
  ComponentVariantsHost,
  VariantPreviewBinding,
  VariantUse,
} from "./component-variants";
// The variant open in a component's view, previewed on the host's canvas.
export { useVariantPreview, VariantPreviewTag } from "./variant-preview";
export type { VariantPreviewState } from "./variant-preview";

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
export type { InsertPanelProps, LibraryTierState } from "./insert-panel";
export { ComponentsPanel } from "./components-panel";
export type { ComponentsPanelProps } from "./components-panel";
// The shape a host hands the panel for the pattern tier. Published beside the
// panel because supplying `patterns` is impossible without it: a caller loads
// rows from a plugin's collection and has to know which fields the palette
// reads before it can map them.
export type { SavedPattern } from "./inserter";

/**
 * The site's breakpoints, as a trigger and the dialog behind it.
 *
 * The MANAGER is published and the dialog is not. A host needs the pair —
 * something to click and something to edit in — and publishing the dialog alone
 * would leave every host inventing the same open state, while publishing both
 * would offer two ways to mount one feature that must agree about when the
 * saved set has actually been read.
 */
export {
  authoredBreakpoints,
  BASE_DEVICE_LABEL,
  sameBreakpoints,
} from "./breakpoints";
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
  DESKTOP_PREVIEW_WIDTH,
  editedBreakpointAtWidth,
  editingBreakpointOf,
  offeredTiers,
  previewHeight,
  previewWidth,
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
  ComponentVerbsHost,
  SharedStyleVerbHost,
} from "./keyboard-actions";
// Which way "Turn into component…" may go, as the host is told when it opens.
export type { TurnIntoChoice } from "./toolbar-actions";

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
/*
 * The notice a host renders above the canvas while a locked area holds what
 * its lock doesn't allow: it shows the repair's steps and applies them, once
 * confirmed, as one edit. `@experimental` until the editor's lock surfaces
 * ship together.
 */
export { RepairNotice } from "./repair-notice";
/*
 * The scrub context a host has to supply for a handle to write anywhere but the
 * base breakpoint of the resting state. The overlay defaults to that tier and
 * says so; a host drawing tiers or compiling under a scope passes this instead.
 */
export type { SpacingScrubContext, SpacingSubject } from "./spacing-handles";

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
 * The badge on a block whose bound value a visitor will not see, drawn in the
 * canvas's overlay from the host's `visitorUnreadableBindings` answer.
 */
export { VisitorUnreadableBadges } from "./visitor-unreadable-badges";
export type { VisitorUnreadableBadgesProps } from "./visitor-unreadable-badges";
export { VisitorUnreadableProvider } from "./visitor-unreadable-context";
/**
 * @experimental The entry a template is previewed with: the host provides it
 * around a template's editor, and anything inside reads it. `undefined`
 * outside a template.
 */
export {
  PREVIEWED_ENTRY_KEYS,
  PreviewedEntryProvider,
  usePreviewedEntry,
} from "./previewed-entry";
export type { PreviewedEntry } from "./previewed-entry";
export { PageInserters } from "./page-inserters";
export type { PageInsertersProps } from "./page-inserters";

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
 * Why `EditorState.lockRefusalFor` refuses an edit: a slot lock a block
 * declares, or a block an author locked in Layers. The answer is a union, and
 * `isLayersLockFacts` tells the two apart: a Layers lock names the locked
 * block (`label`, `relation`, `verb`), a slot lock names its holder
 * (`holderType`, `lock`). `lockRefusalWording` words either.
 */
export {
  isLayersLockFacts,
  lockRefusalWording,
  type LayersLockRefusalFacts,
  type LockedRelation,
  type LockedVerb,
  type LockRefusalFacts,
  type SlotLockRefusalFacts,
} from "./lock-refusal";

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
/**
 * The registry an inspector rich-text field holds its open passage in, so the
 * host's `useInlineEditing` finishes it before the document is stored.
 * Made once per editor and lent to both the inspector and the inline editing.
 *
 * @experimental
 */
export { createOpenPassages } from "./open-passages";
export type { OpenPassages } from "./open-passages";
export type { UseInlineEditingResult } from "./use-inline-editing";
/**
 * What a host says when a double-click lands on text a component does not
 * expose: the hook selects the placement and hands the host its id, and the
 * host reads the placement with `inspectInstance` against its own library.
 */
export { inspectInstance, partOfComponentSentence } from "./instance-inspector";
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
export type { LayersPanelProps, LayersRegionRow } from "./layers-panel";
/*
 * The tokens studio. A host that mounts it owns the site style document and
 * decides when an edit is persisted; this exports the surface, not the save.
 */
export { TokensPanel, useVariablesHeader } from "./tokens-panel";
export type {
  SpacingModeControl,
  TokensPanelProps,
  VariablesHeader,
} from "./tokens-panel";
/*
 * How widely variables are used, as a host reads it for the Variables view.
 * Experimental, as the view's `usage` is.
 */
export type {
  VariableReach,
  VariablesAccess,
  VariablesUsage,
  VariableUse,
  VariableUseKind,
  VariableUsesPage,
} from "./variable-usage";
export { SelectionBreadcrumb } from "./breadcrumb";
export type { SelectionBreadcrumbProps } from "./breadcrumb";
/*
 * The page reads meter: the reads a page makes against its allowance, from
 * 80% of it a warning, and over it the blocks that went unread.
 */
export { ReadBudgetMeter } from "./read-budget-meter";
export type { ReadBudgetMeterProps } from "./read-budget-meter";
export { readBudgetStanding, READ_WARNING_SHARE } from "./read-budget";
export type {
  PageReadReport,
  ReadBudgetStanding,
  ReadKind,
  UnreadBlock,
} from "./read-budget";
/*
 * The editor's words, spelled once, for every surface a host draws beside the
 * shell's own: a panel it mounts names its places with these.
 */
export { EDITOR_WORDS } from "./editor-words";
export type { EditorWord } from "./editor-words";
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
 * Saving a block's look as a shared style: the dialog the host raises from
 * the block verb, and what the Style tab borrows from the host to edit a
 * shared style as its target.
 */
export { SaveSharedStyleDialog } from "./shared-style-save-dialog";
export type { SaveSharedStyleDialogProps } from "./shared-style-save-dialog";
export type { SharedStylesHost } from "./style-target";
export type {
  SharedStyleChange,
  SharedStyleOffer,
} from "./shared-style-target";
export { sharedStyleNameTaken } from "./shared-style-target";
/*
 * The notice QUEUE is published; the region is not.
 *
 * `BuilderShell` renders the region for whichever queue it holds, and it takes
 * the host's through its `notices` prop — so a host that raises notices from
 * above the shell (an editor it builds there refusing an edit for room) builds
 * the queue with `useNoticeQueue`, hands it to the shell, and raises into it.
 * Building one and NOT handing it over would place nothing and report nothing,
 * which is why the region stays unpublished: the shell is the one place a
 * queue is drawn.
 */
export { useNoticeQueue } from "./builder-notices";
export type { NoticeQueue, RaiseNotice } from "./builder-notices";
export { SharedStylesPanel } from "./shared-styles-panel";
export type {
  ClassRenameOutcome,
  PageClassBlocks,
  SharedStylesAccess,
  SharedStylesPanelProps,
} from "./shared-styles-panel";
export type {
  SharedStyleKind,
  SharedStyleReach,
  SharedStyleRefusal,
  SharedStylesCount,
  SharedStylesUsage,
  SharedStyleUse,
  SharedStyleUsesPage,
} from "./shared-style-library";
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
 * The Design panel's Fonts tab, and the rules it draws from.
 *
 * It lists the site's fonts and font variables, adds a font by uploading a
 * file or through the host's Google Fonts catalogue, and removes one. Font
 * variables are listed here and changed in Variables.
 *
 * @experimental The catalogue's shapes may change while the feature settles.
 */
export { FontsPanel } from "./fonts-panel";
export type {
  CatalogueAddRequest,
  CatalogueFamilyView,
  FontCatalogue,
  FontsPanelProps,
  FontFaceUpload,
} from "./fonts-panel";
export {
  fontTokenRows,
  readStack,
  rowsNeedingAttention,
  withoutFamily,
} from "./font-library";
export type {
  FamilyReading,
  FamilySource,
  FontTokenRow,
  SiteFamily,
  StackReading,
} from "./font-library";

/**
 * Which values each placement of a new component may change: the picker the
 * host's "Turn into component" form draws.
 */
export { ExposurePicker, selectionAsComponent } from "./exposure-picker";
export type { ExposurePickerProps } from "./exposure-picker";
