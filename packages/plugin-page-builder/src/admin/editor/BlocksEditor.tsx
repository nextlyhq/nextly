"use client";

/**
 * The page builder editor, mounted over the entry form while it is open.
 *
 * Composed from four parts, each in a module of its own: mounting the editor
 * (`use-editor-mount`), the canvas's render inputs (`use-render-inputs`), the
 * panels (`editor-panels`) and the commit to the form (`use-host-commit`).
 * This module puts them into the shell.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/BlocksEditor
 */
import type { BlockDocument, DocumentKind } from "@nextlyhq/blocks-engine";
import {
  BlockContextMenu,
  BlockKeyboardActions,
  BlockToolbar,
  BreakpointManager,
  BreakpointSwitcher,
  BuilderShell,
  Canvas,
  DropIndicator,
  EditorCommandPalette,
  EmptyContainerAppenders,
  InspectorPanel,
  OnboardingChecklist,
  selectableTiers,
  SelectionBreadcrumb,
  SpacingOverlay,
} from "@nextlyhq/builder/shell";
import { Button } from "@nextlyhq/ui";
import type { Control, FieldValues, Path } from "react-hook-form";

import { siteSheet } from "../../site-style";
import { DocumentStatusPill } from "../DocumentStatusPill";
import type { LibraryReadState } from "../pattern-library-client";
import { SavePatternPrompt } from "../SavePatternPrompt";
import { UnsavedChangesPill } from "../UnsavedChangesPill";

import {
  editorPanelRenderer,
  useEditorPanels,
  type EditorPanels,
} from "./editor-panels";
import { offerableTokens, siteStyleStatus } from "./site-style-studios";
import { useEditorMount, type EditorMount } from "./use-editor-mount";
import {
  hasUnsavedWork,
  useDocumentDirty,
  useHostCommit,
} from "./use-host-commit";
import {
  useCanvasInputs,
  useSiteStyleInputs,
  type CanvasInputs,
  type SiteStyleInputs,
} from "./use-render-inputs";

/** Everything the shell's slots are filled from. */
type EditorView = EditorMount &
  SiteStyleInputs &
  CanvasInputs &
  EditorPanels & { documentDirty: boolean };

/**
 * Whether the empty-container appender should be suppressed right now.
 *
 * Two independent reasons collapse into one boolean here, named, rather than
 * inlined at the JSX call site: a drag in progress, where the document is
 * mid-change, and the author having turned empty-container chrome off, where
 * the container this control would sit over has collapsed to zero height. A
 * bare `||` at the call site reads as one condition; naming it is what says
 * these are two unrelated causes that happen to share an operator.
 */
function emptyContainerAppenderHidden(
  dragging: boolean,
  showEmptyElements: boolean
): boolean {
  return dragging || !showEmptyElements;
}

/**
 * What stands where the canvas will be, while a read it cannot draw without is
 * still coming or has failed.
 *
 * The site's style gates the canvas in both states: without the sheet the page
 * draws a plausible design the site does not have, and a failed read is fixed
 * by reloading. The component read gates it only while PENDING — long enough
 * to keep every instance from flashing as could-not-be-loaded and re-laying
 * out when the read lands. A FAILED component read must not gate it: the
 * route refuses a role that may edit pages but not read components, and a
 * least-privilege page editor would otherwise lose the canvas for every page,
 * block-only pages included. That state, and a read that failed to refresh
 * what it had, are said beside the canvas instead — see
 * {@link ComponentsUnavailableNote}.
 *
 * Only the canvas waits: the shell, the rail and the inspector are about the
 * DOCUMENT, which is already in hand.
 */
function CanvasGate({
  styleError,
}: {
  styleError: Error | null;
}): React.JSX.Element {
  if (styleError !== null) {
    return (
      <p className="nx-inspector__note" data-canvas-state="failed">
        This site’s styles could not be loaded, so the canvas would not match
        the published page. Reload to try again.
      </p>
    );
  }
  return (
    <p className="nx-inspector__note" data-canvas-state="loading">
      Loading this site’s styles and components…
    </p>
  );
}

/**
 * That the component definitions could not be read, said ABOVE a canvas that
 * still draws.
 *
 * The canvas is drawn without them — every instance on the page as the
 * could-not-be-loaded marker — because refusing to draw at all would take the
 * editor away from an author whose role simply cannot read components. What
 * this adds is the sentence that tells the marker apart from a deleted
 * component, and the one remedy reachable from here.
 */
function ComponentsUnavailableNote({
  state,
  retry,
}: {
  state: LibraryReadState;
  retry: () => void;
}): React.JSX.Element | null {
  const sentence = COMPONENT_READ_NOTES[state];
  if (sentence === undefined) return null;
  return (
    <p
      className="nx-inspector__note"
      role="status"
      data-canvas-state={`components-${state}`}
    >
      {sentence}{" "}
      <Button type="button" variant="ghost" size="sm" onClick={retry}>
        Try again
      </Button>
    </p>
  );
}

/**
 * What is said beside the canvas of a component read that failed, by how it
 * failed. Nothing for a read in flight or one that answered: the canvas
 * waits on the first and draws from the second.
 *
 * The two sentences differ in what is true of the instances on the page. A
 * read that never answered leaves them drawn as missing. One that answered
 * once and could not answer again leaves them drawn from that answer, which
 * an edit elsewhere may since have overtaken — so not missing, but possibly
 * out of date.
 */
const COMPONENT_READ_NOTES: Readonly<
  Partial<Record<LibraryReadState, string>>
> = {
  unavailable:
    "This site’s components could not be loaded, so any placed on this page draw as missing.",
  stale:
    "This site’s components could not be reloaded, so any placed on this page may draw out of date.",
};

/**
 * The top bar's items: the document's state, and the breakpoints.
 *
 * Called as a function rather than rendered as a component, here and for the
 * inspector and the canvas region below, so the tree the shell receives is
 * the one it always received.
 */
function editorTopBar(view: EditorView): React.JSX.Element {
  const {
    documentDirty,
    canvasRender,
    saveBreakpoints,
    siteStylePending,
    siteStyleError,
    requestedWidth,
    measuredWidth,
    setRequestedTier,
  } = view;
  return (
    <>
      <DocumentStatusPill isDirty={documentDirty} />
      {/* Beside the publish state, not folded into it. The two answer
                different questions and one of them has no answer where a
                collection declares no lifecycle. */}
      <UnsavedChangesPill isDirty={documentDirty} />
      {/*
       * Gated on the SAME read the canvas and the cascade are gated on.
       * Until the stored style has answered, `canvasSiteStyle` is the
       * host's config defaults — so the dialog would open on a set the
       * site never chose, and saving from that draft would overwrite the
       * site's real breakpoints with defaults the author never saw.
       *
       * `!== null`, not `!== undefined`: `useSiteStyle` types `error` as
       * `Error | null` and normalises success to `null`, so the
       * `undefined` comparison is true on success too — the same mistake
       * that once withheld the provenance trace unconditionally.
       */}
      <BreakpointManager
        value={canvasRender.styleContext.breakpoints}
        onSave={saveBreakpoints}
        status={siteStyleStatus(siteStylePending, siteStyleError)}
      />
      {/*
       * Beside the manager, and gated on the same read for the same
       * reason it is: until the stored style has answered, the set in
       * hand is the host's config defaults, so this would size the canvas
       * to a bound the site never chose and every edit made there would
       * land in whichever tier that bound implies.
       *
       * It is handed BOTH widths. The requested one is what the author
       * chose and is what the control reports as selected; the measured
       * one is what the box got and is what it names a tier from. Fed
       * only the measured width it would unselect the option just
       * clicked whenever the region could not honour it.
       */}
      <BreakpointSwitcher
        breakpoints={canvasRender.styleContext.breakpoints}
        width={requestedWidth}
        appliedWidth={measuredWidth}
        /*
         * Stored as the TIER, not as the width it emitted.
         *
         * A width identifies an option only until the site's bounds move.
         * Editing the widest breakpoint changes the width the
         * unconditional tier applies from, and the number the author's
         * choice produced is then nobody's — so the canvas was released
         * and the editor returned to the bounded tier while the option
         * they had chosen still existed.
         *
         * The lookup is unambiguous because `selectableTiers` collapses
         * tiers sharing a bound to the one the browser paints, which is
         * the same reason the switcher offers one radio for them.
         */
        onSelect={width => {
          setRequestedTier(
            width === undefined
              ? undefined
              : selectableTiers(canvasRender.styleContext.breakpoints).find(
                  tier => tier.maxWidth === width
                )?.id
          );
        }}
        status={siteStyleStatus(siteStylePending, siteStyleError)}
      />
    </>
  );
}

/** The inspector, given the same readings the canvas draws with. */
function editorInspector(view: EditorView): React.JSX.Element {
  const {
    editor,
    canvasElement,
    componentLibrary,
    styleStateBinding,
    classes,
    stylePolicy,
    styleCascade,
    canvasRender,
    setRequestedTier,
    editedBreakpoint,
    canvasPreviewContainer,
    liveBreakpoints,
    canvasSiteStyle,
    siteStylePending,
    siteStyleError,
  } = view;
  return (
    <InspectorPanel
      editor={editor}
      // The SAME ref the canvas publishes its root through, so the style
      // tab reads the element a node is actually drawn as rather than
      // inferring one from the document. Two refs would let the panel
      // read a canvas that is not the one on screen.
      canvasRoot={canvasElement}
      // The SAME read the canvas resolves against, for the reason the
      // ref is the same ref: a selected instance's rows are read from the
      // very document the page is drawn from, and titled from the row
      // the same read returned.
      componentLibrary={componentLibrary}
      styleState={styleStateBinding}
      classLibrary={classes.library}
      classLibraryAbsence={classes.absence}
      onCreateClass={classes.create}
      policy={stylePolicy}
      cascade={styleCascade}
      breakpoints={canvasRender.styleContext.breakpoints}
      // Which tier the Style tab writes to, and which tiers it may call
      // live. Both are the canvas's answer rather than the panel's: the
      // queries are about the preview box, and `matchMedia` cannot
      // evaluate a container query, so only the surface that owns the box
      // can observe them. The container name travels with them because
      // that is what tells the panel the window is not the authority.
      /*
       * Going to a tier is SIZING THE CANVAS to it, never setting a
       * second piece of state saying which tier is being edited. The
       * edited tier is derived from the width the box gets, so a jump
       * that wrote its own answer would put the two back in the
       * disagreement deriving them from one width exists to remove.
       *
       * A tier the compiler emits no bound for resolves to `undefined`
       * and releases the canvas to the region rather than pinning it to a
       * number nothing responds to — which is also what the unconditional
       * tier means.
       */
      // Already a TIER, so it is stored directly rather than converted
      // to a width and back.
      onJumpToBreakpoint={setRequestedTier}
      breakpoint={editedBreakpoint}
      previewContainer={canvasPreviewContainer}
      liveBreakpoints={liveBreakpoints}
      tokens={offerableTokens(
        canvasSiteStyle,
        siteStylePending,
        siteStyleError
      )}
    />
  );
}

/** The canvas, or what stands in its place while a read it needs is out. */
function editorCanvasRegion(view: EditorView): React.JSX.Element {
  const {
    componentLibrary,
    siteStylePending,
    siteStyleError,
    editor,
    inline,
    zoom,
    setAppliedScale,
    canvasRoot,
    setCanvasElement,
    shownStyleState,
    canvasSiteStyle,
    canvasRender,
    canvasPreview,
    drag,
    dragging,
    spacingScrub,
    slots,
    blocks,
    showEmptyElements,
    openInsertPanel,
  } = view;
  return (
    <>
      {/*
            Held back until the stored style has arrived.

            `useSiteStyle` answers with the host's defaults while the read is in
            flight, and those defaults are a legitimate design rather than a
            placeholder — so a canvas mounted on them looks finished and is
            wrong at exactly the properties an admin overrode. The author would
            see the page re-lay-out under them, and could start dragging against
            a design the site does not have.

            A FAILED read is held back for the same reason, and it is not the
            same state. When the request exhausts its retry — a network fault,
            or a 403 for an editor without `read-site-style` — `pending` goes
            false while the merged value falls back to the config defaults. So
            "not pending" alone would mount a finished-looking canvas over a
            stored tier nobody has read, which is the exact problem the wait was
            added to prevent, arrived at down the failure path instead. Absent
            is not the same as unknown, and the author is told which.

            Only the canvas waits. The shell, the rail and the inspector are all
            about the DOCUMENT, which is already in hand, and blanking them
            would make the editor feel slower than it is. After the first open
            the read is cached, so this is one brief state per session rather
            than one per opening.
          */}
      <ComponentsUnavailableNote
        state={componentLibrary.state}
        retry={componentLibrary.retry}
      />
      {siteStylePending ||
      siteStyleError !== null ||
      componentLibrary.state === "pending" ? (
        <CanvasGate styleError={siteStyleError} />
      ) : (
        /*
              Wrapped rather than passed in, because the menu opens over the
              WHOLE canvas and reads which block from the selection the canvas
              has already moved. The wrapper generates no box, so the canvas
              lays out exactly as it did.
            */
        <BlockContextMenu editor={editor}>
          <Canvas
            zoom={zoom}
            /*
                  On the CANVAS, not inside `preview`. The scale is reported
                  whether or not a viewport is being previewed, and an extra key
                  on that inferred object is accepted and ignored rather than
                  refused — so the reporter simply never ran.
                */
            onScale={setAppliedScale}
            document={editor.document}
            rootRef={canvasRoot}
            onRoot={setCanvasElement}
            forcedState={shownStyleState}
            siteStyles={siteSheet(canvasSiteStyle)}
            selectedId={editor.selectedId}
            selectedIds={editor.selection.ids}
            onSelect={editor.select}
            // The style context and the host policy, derived above so both are
            // one object with one identity rather than rebuilt per render.
            render={canvasRender}
            // The box the tiers are compiled against, the width it is asked
            // to take, and the reporter that closes the loop: the request is
            // a ceiling, and everything downstream is derived from what the
            // box actually got rather than from what it was offered.
            preview={canvasPreview}
            dragHandlers={drag.handlers}
            // The same object those handlers came from, forwarded whole.
            // The canvas draws what the pointer currently means — which
            // block is in flight, which container is receiving it, and why
            // a region will not take it — and decides none of it.
            //
            // Whole rather than picked apart for the reason the handlers
            // are: a set spread across several props can be partially
            // wired, and a canvas told about a refusal but not about the
            // block in flight explains a refusal while dimming nothing.
            drag={drag}
            // The pointer route into typing a block's text. Its keyboard
            // counterpart is the Enter binding above, registered in the same
            // place so a surface cannot gain one without the other.
            onDoubleClick={inline.onDoubleClick}
            // Both pieces of chrome go through the canvas rather than beside it,
            // because both are positioned in the canvas's own content
            // coordinates and the canvas root is what establishes them.
            overlay={
              <>
                <DropIndicator target={drag.target} />
                {/*
                  Suppressed for the duration of a drag. The bar would otherwise
                  sit over the canvas the author is aiming at, naming a block
                  that is in the middle of moving.
                */}
                <BlockToolbar editor={editor} hidden={dragging} />
                {/*
                  Suppressed for the same reason and by the same signal. The
                  bands report a layout that is mid-change during a drag, so
                  every value on them is about to be wrong.
                */}
                <SpacingOverlay
                  editor={editor}
                  hidden={dragging}
                  /*
                   * The tier a spacing handle writes to, and what the canvas
                   * compiled this page under. Not optional in practice: the
                   * overlay falls back to the base breakpoint of the resting
                   * state, so without this a handle on a narrow canvas would
                   * preview nothing and commit at the wrong tier — the same
                   * inputs the inspector beside it is already given, read
                   * from the ONE context that compiled the sheet rather than
                   * derived a second time.
                   */
                  scrub={spacingScrub}
                />
                {/*
                  Suppressed during a drag for the same reason the toolbar and
                  the bands are: the document is mid-change, so a control
                  offering to fill a container names a shape that is about to
                  be different.
                  ALSO suppressed while the author has turned empty-container
                  chrome off: the dashed placeholder box collapses to zero
                  height under the same preference (`builder-chrome.css`'s
                  `[data-nx-slots]:empty` rule already matches it), and a "+"
                  left floating over nothing after that would make the
                  preference lie about what a visitor sees.
                */}
                <EmptyContainerAppenders
                  document={editor.document}
                  slots={slots}
                  blocks={blocks}
                  hidden={emptyContainerAppenderHidden(
                    dragging,
                    showEmptyElements
                  )}
                  onAppend={nodeId => {
                    // Select first, then open. The inserter derives its
                    // target from the selection, so selecting the container
                    // is what makes the next insert land inside it — there
                    // is no second targeting path to keep in step.
                    editor.select(nodeId);
                    openInsertPanel();
                  }}
                />
              </>
            }
          />
        </BlockContextMenu>
      )}
    </>
  );
}

/**
 * The editor itself, mounted only while open.
 *
 * Separate component so the hooks below — editor state, and the chrome request
 * — run only when there is an editor. Calling them from the control above would
 * ask the admin to hide its navigation for every entry form holding a blocks
 * field, open or not.
 */
export function BlocksEditor<TFieldValues extends FieldValues = FieldValues>({
  initialValue,
  kinds,
  onCommit,
  onClose,
  name,
  control,
}: {
  initialValue: unknown;
  /** The kinds the field accepts, so a seeded document is one it will take. */
  kinds: readonly DocumentKind[] | undefined;
  onCommit: (value: BlockDocument) => void;
  onClose: () => void;
  name: Path<TFieldValues>;
  control: Control<TFieldValues>;
}) {
  const mount = useEditorMount(initialValue, kinds);
  const { editor, inline } = mount;

  /*
   * `hasUnsavedWork` rather than `undoDepth` alone, so an inline edit that is
   * OPEN counts. Until it commits, the typed value lives in the DOM and neither
   * the editor's history nor the form's dirty fields have moved — so a reading
   * built on those two says "nothing outstanding" while an author is midway
   * through a paragraph.
   *
   * The same answer the navigation guard reports, asked once here. The guard
   * keeps reporting only the EDITOR's half, because it tells the form about
   * work the form's own values do not contain; this composes that half with the
   * form's own dirtiness, which is what a reading of the whole document needs.
   */
  const documentDirty = useDocumentDirty(
    control,
    hasUnsavedWork(editor, inline)
  );

  const style = useSiteStyleInputs(mount.clientConfig);
  const canvas = useCanvasInputs(mount, style);
  const panels = useEditorPanels(mount, name);
  const { done } = useHostCommit({
    name,
    control,
    editor,
    inline,
    onCommit,
    onClose,
  });

  const view: EditorView = {
    ...mount,
    ...style,
    ...canvas,
    ...panels,
    documentDirty,
  };
  const {
    notices,
    componentLibrary,
    savePattern,
    mayCreatePattern,
    checklist,
    availablePanels,
    openPanelRequest,
    setShowEmptyElements,
    setZoom,
    appliedScale,
  } = view;

  return (
    // Fills the view's area, under the admin's lock and recovery notices for
    // this document, rather than covering the window over them.
    <div className="h-full bg-background">
      <BuilderShell
        notices={notices}
        onExit={done}
        availablePanels={availablePanels}
        // Forces the insert panel open from the empty-container appender,
        // which lives on the canvas below rather than beside the rail that
        // normally opens a panel.
        openPanelRequest={openPanelRequest}
        // The read half of the same gap: mirrors the shell's own preference
        // so the appender below can be suppressed by the SAME switch that
        // already suppresses the placeholder box it sits over.
        onShowEmptyElementsChange={setShowEmptyElements}
        onZoomChange={setZoom}
        appliedScale={appliedScale}
        // Whether the page is live, which the admin's own chrome would have
        // shown had this editor not asked for it to be hidden. `undoDepth` is
        // the editor's OWN dirty signal: the form's is false for as long as the
        // editor is open, because the document is committed on the way out.
        topBar={editorTopBar(view)}
        // The shell owns the region; this fills it. Rendered unconditionally
        // rather than only when something is selected, because the panel states
        // "select a block to edit it" — a region that appears and disappears
        // with the selection makes the canvas resize on every click.
        // The policy travels with the panel because the Style tab judges a
        // written value at the keystroke and has to reach the same verdict the
        // published compiler will.
        //
        // The tokens travel with it for the same reason one step further: a
        // colour control offers the site's tokens and resolves a stored
        // reference to the name an author currently reads, and `policy.tokens`
        // cannot serve either — a `TokenLookup` answers ABOUT a name the caller
        // already holds and cannot enumerate one. This is the MERGED set the
        // canvas compiles with, so the picker offers exactly the tokens the
        // page will resolve.
        inspector={editorInspector(view)}
        // Switched on the panel id rather than rendering the inserter for
        // whatever the rail reports open. The shell asks for the panel it
        // opened, and a renderer ignoring that argument would draw the inserter
        // under every heading the moment a second panel is listed above.
        // The trail sits in the bottom bar, which the shell owns. Passed as a
        // slot rather than rendered beside the canvas so it cannot overlap the
        // page an author is editing.
        breadcrumb={<SelectionBreadcrumb editor={editor} />}
        // Rendered only while it has somewhere to go: passing an element the
        // shell would position and then hide leaves an empty positioner over
        // the canvas.
        checklist={
          checklist.visible ? (
            <OnboardingChecklist
              steps={checklist.steps}
              onDismiss={checklist.dismiss}
            />
          ) : undefined
        }
        renderPanel={editorPanelRenderer(view)}
      >
        {/*
          Inside the shell, which is what provides the shortcut context — a
          caller rendering the shell is outside it and cannot register bindings.
          It draws the live region and publishes the structural verbs to what it
          wraps, which is how the toolbar presses exactly what the keys press.
        */}
        <BlockKeyboardActions
          editor={editor}
          onEditText={inline.begin}
          onSaveAsPattern={savePattern.open}
          /*
            The same map the canvas draws with, so a keyboard move of an
            instance is judged by the roots it draws — as its drop is — rather
            than by the instance node's own type, which the nesting rule
            restricts nowhere.
          */
          definitions={componentLibrary.definitions}
          /*
            Whether the author holds the grant the save is judged by, asked of
            the server because only it knows the RESOLVED collection: a site may
            rename it, and the browser knows the declared name alone. Passed
            here rather than read inside the builder for the same reason
            `onSaveAsPattern` is passed — the collection a pattern goes in is
            this plugin's business, not the canvas's.
          */
          mayCreatePattern={mayCreatePattern}
        >
          {/*
            Inside the verbs provider, which is what lets the palette run
            exactly what the keystrokes and the toolbar run.

            `onExit` is the SAME handler the shell's exit button gets, so
            leaving through the palette commits the document exactly as leaving
            through the button does. Passing a different one — or omitting it
            while the button exists — would give the editor two ways out that
            behave differently.
          */}
          <EditorCommandPalette editor={editor} onExit={done} />
          {editorCanvasRegion(view)}
          {/*
            Rendered inside the verbs provider so the form and the button that
            opens it are one feature rather than two that have to be kept in
            step. The dialog is CONTROLLED from here because the verb that opens
            it belongs to the same chain as every other block verb — a form that
            owned its own trigger would be reachable from one surface and not
            from the palette, the context menu or a keystroke.
          */}
          <SavePatternPrompt
            document={savePattern.document}
            selectedIds={editor.selection.ids}
            onClose={savePattern.close}
            returnFocusTo={savePattern.returnFocusTo}
          />
        </BlockKeyboardActions>
      </BuilderShell>
    </div>
  );
}
