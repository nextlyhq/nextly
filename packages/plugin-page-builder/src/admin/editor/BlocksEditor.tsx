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
  prepareDocumentForRead,
  registeredBlocks,
} from "@nextlyhq/blocks-react";
import {
  BlockContextMenu,
  BlockKeyboardActions,
  BlockToolbar,
  BreakpointSwitcher,
  BuilderShell,
  Canvas,
  DropIndicator,
  EmptyContainerAppenders,
  InspectorPanel,
  RepairNotice,
  OnboardingChecklist,
  SelectionBreadcrumb,
  SpacingOverlay,
  type OpenPassages,
} from "@nextlyhq/builder/shell";
import {
  DocumentPrimaryAction,
  DocumentSaveIndicator,
  loadInlineRichTextEditor,
  MediaPickerDialog,
} from "@nextlyhq/plugin-sdk/admin";
import { Button } from "@nextlyhq/ui";
import { useState, type ComponentProps, type JSX } from "react";
import {
  useFormState,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { siteSheet } from "../../site-style";
import { ComponentActionPrompt } from "../ComponentActionPrompt";
import { ComponentFromSelectionPrompt } from "../ComponentFromSelectionPrompt";
import { contributedInspector } from "../contributed-blocks";
import { DocumentStatusPill } from "../DocumentStatusPill";
import { findEntries } from "../entries-client";
import type { LibraryReadState } from "../pattern-library-client";
import { SavePatternPrompt } from "../SavePatternPrompt";
import { SiteStyleHistoryContext } from "../site-style-client";
import { valueAtPath } from "../snapshot-merge";

import {
  editorPanelRenderer,
  useEditorPanels,
  type EditorPanels,
} from "./editor-panels";
import { EditorSearch, SearchButton } from "./editor-search";
import { HistoryButtons } from "./history-buttons";
import { PreviewButton } from "./preview-button";
import { SettingsDialog } from "./settings-dialog";
import {
  sharePreview,
  type SharePreview,
  type ShareSeoFields,
} from "./share-preview";
import {
  ConnectStyleHistoryContext,
  RemountOnStyleReplay,
  StyleRevisionContext,
  useSiteStyleHistory,
} from "./site-style-history";
import {
  offerableFaces,
  offerableTokens,
  siteStyleStatus,
} from "./site-style-studios";
import { useComponentView, type ComponentView } from "./use-component-view";
import { useEditorMount, type EditorMount } from "./use-editor-mount";
import {
  hasUnsavedWork,
  useDocumentDirty,
  useHostCommit,
  useSavePoint,
} from "./use-host-commit";
import { useOpenAtSection } from "./use-open-at-section";
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
  EditorPanels & {
    documentDirty: boolean;
    /** "Edit component", and the banner over a component's own view. */
    componentView: ComponentView;
  };

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
/**
 * What the editor puts in the shell's top bar, by column: the document's
 * history and state at the start, the devices in the centre, and Preview and
 * the document's actions at the end.
 */
function editorTopBar(view: EditorView): {
  topBar: React.JSX.Element;
  topBarCenter: React.JSX.Element;
  topBarEnd: React.JSX.Element;
} {
  const {
    documentDirty,
    canvasRender,
    siteStylePending,
    siteStyleError,
    editedBreakpoint,
    chooseDevice,
    editor,
    inline,
  } = view;
  return {
    topBar: (
      <>
        <HistoryButtons editor={editor} inline={inline} />
        <DocumentStatusPill isDirty={documentDirty} />
      </>
    ),
    topBarCenter: (
      <>
        {/*
         * Beside the manager, and gated on the same read for the same
         * reason it is: until the stored style has answered, the set in
         * hand is the host's config defaults, so a device chosen against it
         * could name a breakpoint the site never had.
         *
         * The device chosen is the breakpoint being edited. The choice goes
         * to the shell, which stores it with the author's preferences and
         * reports it back, so this shows the device the edits go to.
         */}
        <BreakpointSwitcher
          breakpoints={canvasRender.styleContext.breakpoints}
          selected={editedBreakpoint}
          onSelect={chooseDevice}
          status={siteStyleStatus(siteStylePending, siteStyleError)}
        />
      </>
    ),
    topBarEnd: (
      <>
        {/* Whether the work is stored, beside the verbs that store it: the
          header's own chip, which reads the field's held work too. Its text
          sits against Preview, so the width it reserves for its longest
          state opens towards the panel buttons rather than between it and
          what it describes. Reserved only where the bar has the room: below
          1400px it takes what it shows, as the device labels give way there,
          so the end column never runs into the zoom. */}
        {/* First in the group, as the agreed bar has it: one search for
          blocks, the page, other pages and commands, also on ⌘K. */}
        <SearchButton onOpen={() => view.search.setOpen(true)} />
        <DocumentSaveIndicator className="min-w-[9rem] justify-end @max-[1400px]/topbar:min-w-0" />
        <PreviewButton />
        {/* Last, at the bar's far end where the header kept them: the
          document's leading action with its other ways to publish on its
          arrow, which the builder's taking the window would otherwise leave
          reachable only from the keyboard. */}
        <DocumentPrimaryAction />
      </>
    ),
  };
}

type ContentServices = NonNullable<
  ComponentProps<typeof InspectorPanel>["contentServices"]
>;

let contentServices: ContentServices | undefined;

/**
 * What the inspector's Content tab borrows from the admin: the media library,
 * to choose an image, the shared rich-text editor, and the page builder's
 * entries route, to find an entry a `relation` prop points at with the
 * author's own access. Built on first use and
 * kept for the module's life, so the panel never sees a new object on a
 * render, and loading this module reads nothing from the admin's surface
 * until an editor is drawn.
 */
function borrowedServices(): ContentServices {
  contentServices ??= {
    MediaPicker: MediaPickerDialog,
    loadRichTextEditor: loadInlineRichTextEditor,
    findEntries,
  };
  return contentServices;
}

/**
 * The borrowed services with this editor's open-passage registry and its
 * language, one object per registry and language so the panel sees the same
 * one on every render. A relation search reads titles in the language being
 * edited.
 */
const servicesByPassages = new WeakMap<
  OpenPassages,
  Map<string, ContentServices>
>();

function servicesFor(
  passages: OpenPassages,
  locale: string | undefined
): ContentServices {
  let byLocale = servicesByPassages.get(passages);
  if (byLocale === undefined) {
    byLocale = new Map();
    servicesByPassages.set(passages, byLocale);
  }
  const key = locale ?? "";
  let services = byLocale.get(key);
  if (services === undefined) {
    services = {
      ...borrowedServices(),
      openPassages: passages,
      findEntries: query =>
        findEntries(locale === undefined ? query : { ...query, locale }),
    };
    byLocale.set(key, services);
  }
  return services;
}

/** The block verbs the inspector's card offers, as the verbs provider shares them. */
type CardVerbs = ComponentProps<typeof InspectorPanel>["verbs"];

/**
 * The onboarding checklist, rendered only while it has somewhere to go:
 * passing an element the shell would position and then hide leaves an empty
 * positioner over the canvas.
 */
function editorChecklist({
  checklist,
}: EditorView): React.JSX.Element | undefined {
  return checklist.visible ? (
    <OnboardingChecklist
      steps={checklist.steps}
      onDismiss={checklist.dismiss}
    />
  ) : undefined;
}

/** The inspector, given the same readings the canvas draws with. */
function editorInspector(
  view: EditorView,
  verbs: CardVerbs
): React.JSX.Element {
  const {
    editor,
    canvasElement,
    componentLibrary,
    styleStateBinding,
    classes,
    stylePolicy,
    styleCascade,
    canvasRender,
    chooseDevice,
    editedBreakpoint,
    canvasPreviewContainer,
    liveBreakpoints,
    canvasSiteStyle,
    configSiteStyle,
    siteStylePending,
    siteStyleError,
    requestPanel,
    componentFacts,
    componentVariants,
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
      // A contributed block's own inspector, loaded by the app's generated
      // component map; a block whose inspector did not load keeps its
      // generated controls.
      inspectors={contributedInspector}
      // The verbs provider's own verbs and verdicts for Duplicate and Delete,
      // handed out of it because the inspector is drawn beside the canvas
      // rather than under it.
      verbs={verbs}
      contentServices={servicesFor(view.passages, view.locale)}
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
      onJumpToBreakpoint={chooseDevice}
      breakpoint={editedBreakpoint}
      previewContainer={canvasPreviewContainer}
      liveBreakpoints={liveBreakpoints}
      tokens={offerableTokens(
        canvasSiteStyle,
        siteStylePending,
        siteStyleError
      )}
      // The Font control lists only what the site can draw: the faces the
      // canvas loads, of which those from the site's code cannot be removed,
      // and a way to Design's fonts to add one.
      fonts={{
        faces: offerableFaces(
          canvasSiteStyle,
          siteStylePending,
          siteStyleError
        ),
        fromCode: configSiteStyle.fonts ?? [],
        onManageFonts: () => requestPanel("design", "fonts"),
      }}
      // In a component's own view: the ids its live definition holds, which a
      // new field must never reuse, and how far a removal reaches.
      componentFields={componentFacts}
      // And how many placements chose a variant, for its delete dialog.
      componentVariants={componentVariants}
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
      {/*
        Beside the other notes about the page as a whole: a locked area that
        holds what its lock doesn't allow, and the repair the author can review
        and confirm.
      */}
      <RepairNotice editor={editor} />
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
            // The regions of the page's Layout, drawn locked around it from
            // the published Layout, as a visitor gets them.
            regions={view.canvasRegions}
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
                    // Select the container and open Add to add INSIDE it,
                    // said explicitly: selecting a container never implies
                    // inside, so a click on a selected block adds after it.
                    editor.select(nodeId);
                    openInsertPanel(nodeId);
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

/** What the editor reads of the page's own fields as the author has them now. */
interface PageFacts {
  /** The form's `title` while it is text, for the top bar and the preview. */
  title: string | undefined;
  /** The SEO plugin's fields, where the document has them. */
  seo: ShareSeoFields | undefined;
}

function usePageFacts<TFieldValues extends FieldValues>(
  control: Control<TFieldValues>
): PageFacts {
  const [title, seo]: unknown[] = useWatch({
    control,
    name: ["title", "seo"] as Path<TFieldValues>[],
  });
  return {
    title: typeof title === "string" ? title : undefined,
    seo: seo !== null && typeof seo === "object" ? seo : undefined,
  };
}

/**
 * How a shared link to the page would look, from the page as the published
 * route reads it: prepared with the canvas's own inputs (the same resolver,
 * limits and component definitions), so a component's heading speaks for the
 * page as it does once published.
 */
function pagePreview(view: EditorView, page: PageFacts): SharePreview {
  const { editor, canvasRender } = view;
  const resolver = registeredBlocks();
  const prepared = prepareDocumentForRead(editor.document, {
    resolver,
    styleContext: canvasRender.styleContext,
    definitions: canvasRender.definitions,
    ...(canvasRender.limits === undefined
      ? {}
      : { limits: canvasRender.limits }),
  });
  return sharePreview({
    seo: page.seo,
    document: prepared,
    pageTitle: page.title ?? "",
    definitions: type => resolver.get(type),
  });
}

/**
 * Settings, as the shell's rail opens it: the entry's own fields and a share
 * preview built from the page as it is now, and the site's breakpoints, read
 * from the same answer the canvas and the device buttons are.
 */
function editorSettings(
  view: EditorView,
  page: PageFacts
): NonNullable<React.ComponentProps<typeof BuilderShell>["renderSettings"]> {
  const {
    entryFields,
    pageLayout,
    canvasRender,
    saveBreakpoints,
    siteStylePending,
    siteStyleError,
  } = view;
  // Remounted when a style change is undone or redone, as every surface
  // showing the site's style is, so its breakpoints show the set replayed.
  return dialog => (
    <RemountOnStyleReplay>
      <SettingsDialog
        {...dialog}
        pageFields={entryFields}
        // The page's Layout, in its own section after the page's fields.
        pageLayout={pageLayout}
        // Built only while the dialog is drawn, from the page on screen.
        share={
          // Prepared only while Settings is open: the shell asks for the
          // dialog on every pass, open or not.
          dialog.open ? pagePreview(view, page) : { title: page.title ?? "" }
        }
        breakpoints={{
          value: canvasRender.styleContext.breakpoints,
          onSave: saveBreakpoints,
          status: siteStyleStatus(siteStylePending, siteStyleError),
        }}
      />
    </RemountOnStyleReplay>
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
interface BlocksEditorProps<TFieldValues extends FieldValues> {
  initialValue: unknown;
  /** The kinds the field accepts, so a seeded document is one it will take. */
  kinds: readonly DocumentKind[] | undefined;
  onCommit: (value: BlockDocument) => void;
  onClose: () => void;
  name: Path<TFieldValues>;
  control: Control<TFieldValues>;
  /** The section to open at, as the address names it; none opens at the top. */
  openAt?: string | undefined;
}

export function BlocksEditor<TFieldValues extends FieldValues = FieldValues>(
  props: BlocksEditorProps<TFieldValues>
): JSX.Element {
  /*
   * A change to the site's shared styles is a step of the editor's undo
   * history. Provided from here, above the editor's own hooks, because some
   * of the style writers run in the editor component itself.
   */
  const style = useSiteStyleHistory();
  return (
    <SiteStyleHistoryContext.Provider value={style.history}>
      <StyleRevisionContext.Provider value={style.replay}>
        <ConnectStyleHistoryContext.Provider value={style.connect}>
          <EditorBody {...props} />
        </ConnectStyleHistoryContext.Provider>
      </StyleRevisionContext.Provider>
    </SiteStyleHistoryContext.Provider>
  );
}

/**
 * What the editor's search adds from: the Add panel's own sources, and the
 * container whose "+" opened Add, so a search row adds where the panel would.
 */
function searchInsertSources(
  panels: EditorPanels
): NonNullable<React.ComponentProps<typeof EditorSearch>["insert"]> {
  return {
    components: panels.offered.components,
    componentDefinitions: panels.offered.definitions,
    ...(panels.insertInside === undefined
      ? {}
      : { inside: panels.insertInside }),
  };
}

function EditorBody<TFieldValues extends FieldValues>({
  initialValue,
  kinds,
  onCommit,
  onClose,
  name,
  control,
  openAt,
}: BlocksEditorProps<TFieldValues>): JSX.Element {
  // The field's value as last loaded or saved: the form resets its defaults to
  // what a save stored, so the editor holds an edit to the locks against the
  // same stored copy the next save is judged against.
  const { defaultValues } = useFormState({ control, name });
  const mount = useEditorMount(
    initialValue,
    kinds,
    valueAtPath(defaultValues, name)
  );
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
  const savePoint = useSavePoint(editor);
  const documentDirty = useDocumentDirty(
    control,
    hasUnsavedWork(editor, inline, savePoint.savedAt)
  );

  const style = useSiteStyleInputs(mount.clientConfig);
  const canvas = useCanvasInputs(mount, style);
  const panels = useEditorPanels(mount, name, {
    control,
    canvasRoot: canvas.canvasElement,
  });
  const { done } = useHostCommit({
    name,
    control,
    editor,
    inline,
    onCommit,
    onClose,
    savePoint,
  });

  const page = usePageFacts(control);
  // A component's own view, and the way into one from a placement: its
  // banner, which says how far a change reaches, and "Edit component".
  const componentView = useComponentView({
    initialDocument: mount.initialDocument,
    editor,
    componentLibrary: mount.componentLibrary,
    fieldName: name,
    componentFacts: mount.componentFacts,
  });
  // What the verbs provider shares for the card's menu; `undefined` until it
  // mounts, when the menu offers Rename and Lock alone.
  const [cardVerbs, setCardVerbs] = useState<CardVerbs>(undefined);

  const view: EditorView = {
    ...mount,
    ...style,
    ...canvas,
    ...panels,
    documentDirty,
    componentView,
  };
  useOpenAtSection({
    sectionId: openAt,
    editor,
    canvas: canvas.canvasElement,
    requestPanel: panels.requestPanel,
  });
  const {
    notices,
    componentLibrary,
    savePattern,
    mayCreatePattern,
    makeComponent,
    componentVerbs,
    availablePanels,
    openPanelRequest,
    setShowEmptyElements,
    setZoom,
    appliedScale,
    deviceRequest,
    setChosenDevice,
  } = view;

  return (
    // Fills the view's area, under the admin's lock and recovery notices for
    // this document, rather than covering the window over them. A component's
    // own view carries its banner above the editor.
    <EditorFrame banner={componentView.banner}>
      <BuilderShell
        notices={notices}
        onExit={done}
        // The signed-in author's own preferences, not the browser's.
        store={mount.preferenceStore}
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
        // The device being edited: chosen here, held and stored by the shell,
        // and reported back so the canvas and the inspector follow it.
        editingBreakpointRequest={deviceRequest}
        onEditingBreakpointChange={setChosenDevice}
        appliedScale={appliedScale}
        // Whether the page is live, which the admin's own chrome would have
        // shown had this editor not asked for it to be hidden. `undoDepth` is
        // the editor's OWN dirty signal: the form's is false for as long as the
        // editor is open, because the document is committed on the way out.
        {...editorTopBar(view)}
        // The document's title, read-only, as the author has it in the form
        // right now. Nothing for a document with no title field.
        title={page.title}
        renderSettings={editorSettings(view, page)}
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
        inspector={editorInspector(view, cardVerbs)}
        // Switched on the panel id rather than rendering the inserter for
        // whatever the rail reports open. The shell asks for the panel it
        // opened, and a renderer ignoring that argument would draw the inserter
        // under every heading the moment a second panel is listed above.
        // The trail sits in the bottom bar, which the shell owns. Passed as a
        // slot rather than rendered beside the canvas so it cannot overlap the
        // page an author is editing.
        // The hint names Enter, Escape and the palette's key because this
        // editor binds all three: inline editing and the block keyboard
        // actions below, and the palette it mounts.
        breadcrumb={
          <SelectionBreadcrumb
            editor={editor}
            hints={{ editText: true, goUp: true, commandPalette: true }}
            componentTitle={componentLibrary.titleOf}
          />
        }
        checklist={editorChecklist(view)}
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
          components={componentVerbs}
          // Opening a placed component in its own view: the host's, since it
          // knows the view's address and whether this author may update
          // components. Absent, no surface offers it.
          onEditComponent={componentView.onEditComponent}
          onShareVerbs={setCardVerbs}
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
          <EditorSearch
            editor={editor}
            onExit={done}
            canvas={canvas.canvasElement}
            // The Add panel's own sources, so search offers what it offers.
            insert={searchInsertSources(panels)}
            componentTitle={componentLibrary.titleOf}
            open={panels.search.open}
            onOpenChange={panels.search.setOpen}
          />
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
          <ComponentFromSelectionPrompt
            request={makeComponent.request}
            editor={editor}
            library={componentLibrary}
            onClose={makeComponent.close}
            returnFocusTo={makeComponent.returnFocusTo}
          />
          <ComponentActionPrompt
            request={makeComponent.request}
            editor={editor}
            library={componentLibrary}
            onClose={makeComponent.close}
            returnFocusTo={makeComponent.returnFocusTo}
          />
        </BlockKeyboardActions>
      </BuilderShell>
    </EditorFrame>
  );
}

/**
 * The editor's area: the whole of it for a page, and under the banner for a
 * component's own view, so the banner takes its height and the shell the rest.
 */
function EditorFrame({
  banner,
  children,
}: {
  banner: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  if (banner === null) {
    return <div className="h-full bg-background">{children}</div>;
  }
  return (
    <div className="flex h-full flex-col bg-background">
      {banner}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
