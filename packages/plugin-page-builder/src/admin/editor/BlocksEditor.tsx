"use client";

/**
 * The page builder editor, mounted over the entry form while it is open.
 *
 * Composed from parts, each in a module of its own: mounting the editor
 * (`use-editor-mount`), the canvas's render inputs (`use-render-inputs`), the
 * panels (`editor-panels`) and the commit to the form (`use-host-commit`); and
 * what fills the shell's slots from them: the top bar (`editor-top-bar`), the
 * inspector (`editor-inspector`, with its services in `editor-services`), the
 * canvas region (`editor-canvas-region`), Settings (`editor-settings`) and the
 * strip above the canvas and "Preview as visitor" (`editor-conditions`),
 * all reading one view (`editor-view`). This module puts them into the
 * shell.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/BlocksEditor
 */
import {
  isPlainRecord,
  type BlockDocument,
  type DocumentKind,
} from "@nextlyhq/blocks-engine";
import {
  BlockKeyboardActions,
  BuilderShell,
  useConditionsUnchecked,
  CanvasFrameProvider,
  OnboardingChecklist,
  RecentColoursStore,
  SelectionBreadcrumb,
  VisitorUnreadableProvider,
} from "@nextlyhq/builder/shell";
import { useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useMemo, useState, type JSX } from "react";
import {
  useFormState,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { ComponentActionPrompt } from "../ComponentActionPrompt";
import { ComponentFromSelectionPrompt } from "../ComponentFromSelectionPrompt";
import { SavePatternPrompt } from "../SavePatternPrompt";
import {
  SiteStyleHistoryContext,
  SiteStylePreviewContext,
} from "../site-style-client";
import { valueAtPath } from "../snapshot-merge";

import type { OpenAt } from "./builder-address";
import { useCanvasEntryIdentity } from "./canvas-entry";
import { listEntryCollectionOf } from "./canvas-page-context";
import { useDropKeptReadsOnSave } from "./canvas-source-check";
import { useConditionedPage } from "./conditioned-page";
import { editorCanvasRegion } from "./editor-canvas-region";
import {
  editorStrip,
  pageConditionsSourceOf,
  useAppliedConditionsSwitch,
  useConditionServices,
} from "./editor-conditions";
import { editorInspector } from "./editor-inspector";
import {
  editorPanelRenderer,
  useEditorPanels,
  type EditorPanels,
} from "./editor-panels";
import { EditorSearch } from "./editor-search";
import { editorSettings, usePageFacts } from "./editor-settings";
import { editorTopBar } from "./editor-top-bar";
import type { CardVerbs, EditorView } from "./editor-view";
import {
  useMediaSearchReader,
  useMediaSummaryReader,
} from "./media-summary-reader";
import { PageReads, readPageDataLimit } from "./page-read-meter";
import { recentColoursStore } from "./recent-colours-store";
import { useReveal } from "./reveal-hidden";
import { useSettingsPlace } from "./settings-place";
import {
  ConnectStyleHistoryContext,
  StyleRevisionContext,
  useSiteStyleHistory,
} from "./site-style-history";
import { documentFrom } from "./stored-document";
import {
  TemplatePreviewScope,
  useDrawnTemplate,
  useTemplatePreviewState,
} from "./template-preview-strip";
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
  useBoundCanvasRender,
  useCanvasInputs,
  useSiteStyleInputs,
} from "./use-render-inputs";
import {
  drawnNodesOf,
  useFollowApplied,
  useItemsJudgedRender,
  useListsAsVisitor,
} from "./visitor-lists";

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
  /**
   * The section or block to open at, as the address names it; none opens at
   * the top.
   */
  openAt?: OpenAt | undefined;
  /**
   * The field's address from the document's root, where it differs from
   * `name`: inside a repeater's row, which the address names by its saved id
   * and the form by its position. What the editor records the page under, so
   * opening it again finds the same row. `name` where absent.
   */
  address?: string | undefined;
  /**
   * Where the field sits, in words, for a field below the top level
   * (`Sections · Hero banner · Body`): said in the top bar and at the root of
   * the bottom bar, so the author knows which row's layout this is.
   */
  location?: string | undefined;
  /**
   * For a field in a repeater's row: where it sits in another copy of the
   * document's values, found by the row's id. The editor reads the field's
   * stored copy through it, since the row may stand elsewhere in the values
   * last stored than in the form.
   */
  pathIn?:
    | ((values: Record<string, unknown>) => string | undefined)
    | undefined;
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
  // Read once, from the document the editor opens with, as the editor reads
  // it: its kind does not change while the editor is open.
  const [isTemplate] = useState(
    () => documentFrom(props.initialValue, props.kinds).kind === "template"
  );
  return (
    <SiteStyleHistoryContext.Provider value={style.history}>
      {/* Held style edits, drawn before they are stored. */}
      <SiteStylePreviewContext.Provider value={style.preview}>
        <StyleRevisionContext.Provider value={style.replay}>
          <ConnectStyleHistoryContext.Provider value={style.connect}>
            {/*
            The canvas's frame, provided above the whole editor: the canvas
            registers it here, and the inspector, the toolbar, inline editing
            and the keys outside the canvas all ask it which document and
            window the page is drawn in.
          */}
            <CanvasFrameProvider>
              {/*
                A template is drawn with an entry of the collection it names,
                chosen in the strip above its canvas: read around the editor,
                so the canvas, the inspector and the strip all read the one
                answer. Any other document is drawn as itself.
              */}
              {isTemplate ? (
                <TemplatePreviewScope control={props.control}>
                  <EditorBody {...props} place={fieldPlace(props)} />
                </TemplatePreviewScope>
              ) : (
                <EditorBody {...props} place={fieldPlace(props)} />
              )}
            </CanvasFrameProvider>
          </ConnectStyleHistoryContext.Provider>
        </StyleRevisionContext.Provider>
      </SiteStylePreviewContext.Provider>
    </SiteStyleHistoryContext.Provider>
  );
}

/**
 * The canvas's render inputs with the sources its bindings read, asked of
 * `document` as the canvas draws it: a template's with the previewed entry's
 * own blocks composed in, so a binding inside them reads its source here as
 * the published page, which composes first, reads it. Composed from the
 * entry's own read, not the seam's, which waits on this read's answer. Only
 * `document`'s own blocks are marked: the entry's are edited on the entry.
 */
function useDrawnCanvasRender(
  render: Parameters<typeof useBoundCanvasRender>[0],
  document: BlockDocument,
  regions: Parameters<typeof useBoundCanvasRender>[1]["regions"],
  locale: string | undefined,
  component: boolean
): ReturnType<typeof useBoundCanvasRender> {
  // Under the canvas's limits, the entry left the room its components need.
  const drawn = useDrawnTemplate(document, {
    ...render.limits,
    definitions: render.definitions,
  });
  return useBoundCanvasRender(
    render,
    { document: drawn, stored: document, regions },
    locale,
    component
  );
}

/**
 * What the editor's search adds from: the Add panel's own sources, and the
 * place a "+" that opened Add chose, so a search row adds where the panel
 * would.
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
    ...(panels.insertAfter === undefined ? {} : { after: panels.insertAfter }),
  };
}

/**
 * The field's value as last loaded or saved: the form resets its defaults to
 * what a save stored, so the editor holds an edit to the locks against the
 * same stored copy the next save is judged against. Inside a repeater's row
 * the row is found in that copy by its id (`pathIn`), since the form may hold
 * the rows in another order; a row not stored yet has no stored copy. A hook
 * of its own so the editor's body reads one answer rather than the steps.
 */
function useStoredFieldValue<TFieldValues extends FieldValues>(
  control: Control<TFieldValues>,
  name: Path<TFieldValues>,
  pathIn: FieldPlace["pathIn"]
): unknown {
  const { defaultValues } = useFormState({ control, name });
  const storedPath = pathIn === undefined ? name : pathIn(defaultValues ?? {});
  return storedPath === undefined
    ? undefined
    : valueAtPath(defaultValues, storedPath);
}

/**
 * The bottom bar's trail, for the shell to draw. For a field below the top
 * level it starts at where the field sits, so the author reads which row's
 * layout this is; for a top-level field it starts at the page, as it always
 * has. Built here so the editor's body passes one finished element.
 */
function editorBreadcrumb(
  editor: React.ComponentProps<typeof SelectionBreadcrumb>["editor"],
  componentTitle: React.ComponentProps<
    typeof SelectionBreadcrumb
  >["componentTitle"],
  location: string | undefined
): React.JSX.Element {
  return (
    <SelectionBreadcrumb
      editor={editor}
      {...(location === undefined ? {} : { rootLabel: location })}
      hints={{ editText: true, goUp: true, commandPalette: true }}
      {...(componentTitle === undefined ? {} : { componentTitle })}
    />
  );
}

/**
 * Where the field the editor is open on sits, in one value: its address, which
 * the editor records the page under; where it sits in words, for the top bar
 * and the bottom bar; and, inside a repeater's row, how to find the row in
 * another copy of the values. Gathered so the editor's body takes one fact
 * about the field's place rather than three.
 */
interface FieldPlace {
  address: string;
  location: string | undefined;
  pathIn: ((values: Record<string, unknown>) => string | undefined) | undefined;
}

/**
 * The field's place from the editor's props: a field outside repeaters is
 * addressed by its form path, so `name` stands in for an address not given.
 */
function fieldPlace<TFieldValues extends FieldValues>(
  props: BlocksEditorProps<TFieldValues>
): FieldPlace {
  return {
    address: props.address ?? props.name,
    location: props.location,
    pathIn: props.pathIn,
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
  place,
}: BlocksEditorProps<TFieldValues> & { place: FieldPlace }): JSX.Element {
  const mount = useEditorMount(
    initialValue,
    kinds,
    useStoredFieldValue(control, name, place.pathIn)
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
  // A store made here drops what the canvas kept at once: the page's own
  // entry is among what it reads.
  useDropKeptReadsOnSave();
  const documentDirty = useDocumentDirty(
    control,
    hasUnsavedWork(editor, inline, savePoint.savedAt)
  );

  const style = useSiteStyleInputs(mount.clientConfig);
  // Whether the canvas's lists read as a visitor: held above the canvas's
  // inputs, which read them, and set by "Preview as visitor" below.
  const listsAsVisitor = useListsAsVisitor();
  const canvas = useCanvasInputs(mount, style, listsAsVisitor.lists);
  const panels = useEditorPanels(mount, name, {
    control,
    canvasRoot: canvas.canvasElement,
  });
  // The Settings dialog's place for other plugins' tabs, for a page or a
  // design: what is being edited, and its own metadata as one undoable edit.
  const settingsPlace = useSettingsPlace(
    editor,
    control,
    mount.initialDocument.kind,
    name
  );
  const { done, publishOffer, removalHold } = useHostCommit({
    name,
    address: place.address,
    control,
    editor,
    inline,
    onCommit,
    onClose,
    savePoint,
    // The count the removal dialog says now; the hold keeps it as it stood
    // when each field was removed.
    removalReach: () => mount.componentFacts?.reach,
    // A tab's text still being typed, made before the document is stored.
    ...(settingsPlace === null ? {} : { flushHeld: settingsPlace.flushHeld }),
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
    // Said by the banner's Back in the view a placement here opens.
    here: page.title,
    inline,
  });
  // The canvas's render inputs with the sources its bindings read, asked of
  // the tree the canvas draws (in a component's view, the open variant's)
  // and of the Layout regions drawn around it, together.
  const { canvasRender, visitorUnreadable } = useDrawnCanvasRender(
    canvas.canvasRender,
    componentView.preview.document,
    panels.canvasRegions,
    mount.locale,
    mount.initialDocument.kind === "component"
  );
  // The "Part of" toast offers the same Edit component the panel does.
  useOfferedEditComponent(
    mount.offerEditComponent,
    componentView.onEditComponent
  );
  // What the verbs provider shares for the card's menu; `undefined` until it
  // mounts, when the menu offers Rename and Lock alone.
  const [cardVerbs, setCardVerbs] = useState<CardVerbs>(undefined);

  // Shared styles on a block: the Style tab's target and "Save as shared
  // style…", from the same class surface the canvas compiles from.
  const { sharedStyle } = canvas;
  // The page's title, for the canvas frame's accessible name.
  const pageTitle = page.title;
  // Over the document the canvas draws: in a component's view, the open
  // variant's.
  const reveal = useReveal(
    componentView.preview.document,
    mount.editor.selection.ids,
    canvas.canvasRender.styleContext.breakpoints,
    canvas.editedBreakpoint
  );
  // A stored image's name and picture in the inspector, read as the canvas
  // reads it.
  const readMedia = useMediaSummaryReader();
  // The library's images by name, for an image binding's Fallback picker.
  const searchMedia = useMediaSearchReader();
  // The entry the canvas is drawn as: the document's own, or the entry a
  // template is previewed with, whose collection the inspector judges by.
  const identity = useCanvasEntryIdentity();
  // The document itself, which the inspector's unbind is planned against.
  const editedDocument = useDocumentIdentity();
  const isComponentDocument =
    isPlainRecord(mount.initialDocument) &&
    mount.initialDocument.kind === "component";
  const entryCollection = listEntryCollectionOf(
    identity,
    mount.initialDocument
  );
  // The Previewing strip, for a template only.
  const templatePreview = useTemplatePreviewState();
  // The conditioned blocks the page can't check, badged in red on the canvas,
  // judged with the collections the inspector lists, in this language.
  const conditionServices = useConditionServices(
    mount.locale,
    mount.userId,
    entryCollection
  );
  // The page as the canvas draws it, the previewed entry's blocks composed
  // in once: what its conditions are badged on, judged on and applied to.
  const conditioned = useConditionedPage(
    reveal.document,
    templatePreview,
    canvas.canvasRender.limits,
    // The placed components, whose expansion the entry leaves room for.
    canvas.canvasRender.definitions
  );
  const conditionsUnchecked = useConditionsUnchecked(
    conditioned.composed,
    conditionServices,
    // The limits the canvas draws and the save surveys under.
    canvas.canvasRender.limits,
    // The placed components' definitions, whose own conditions are judged
    // in the tree the canvas composes.
    canvas.canvasRender.definitions
  );
  // "Preview as visitor", which applies the conditions for the entry a
  // template is previewed with, or for the page: the author's own, for this
  // session, never saved.
  const conditions = useAppliedConditionsSwitch(
    conditioned,
    templatePreview,
    mount.initialDocument.kind,
    pageConditionsSourceOf(
      templatePreview,
      mount.initialDocument.kind,
      identity,
      mount.locale
    ),
    {
      services: conditionServices,
      componentTitle: mount.componentLibrary.titleOf,
      // Every block the canvas draws, under the limits it draws with.
      limits: canvas.canvasRender.limits,
      // The placed components, whose own conditioned blocks go unchecked.
      definitions: canvas.canvasRender.definitions,
      // The regions of the page's Layout, whose conditioned blocks go
      // unchecked too.
      regions: panels.canvasRegions,
      // The site's zone, as the canvas's bindings read it, for a date a
      // condition compares by day.
      timeZone: canvasRender.bindings.timeZone,
      // Once the lists read as a visitor, a list item's block is judged for
      // each item the canvas draws.
      itemsJudged: listsAsVisitor.visitor !== undefined,
    }
  );
  // The blocks the canvas draws while the conditions are applied: the page
  // as they leave it, and the regions of its Layout, whose lists read as a
  // visitor too, each as the renderer prepares it, so a list inside a placed
  // component is found by the id it is drawn with.
  // The page with its components judged for the entry, as the canvas draws
  // it; the regions of the Layout as they are drawn, unjudged.
  const appliedNow = conditions.applied;
  const regions = panels.canvasRegions;
  const visitorDrawn = useMemo(
    () =>
      appliedNow === undefined
        ? undefined
        : [
            ...drawnNodesOf(
              appliedNow.document,
              canvasRender,
              canvasRender.definitions,
              appliedNow.entryJudgement
            ),
            ...(regions ?? []).flatMap(region =>
              drawnNodesOf(region.document, canvasRender, region.definitions)
            ),
          ],
    [appliedNow, regions, canvasRender]
  );
  useFollowApplied(listsAsVisitor, visitorDrawn);
  const shownRender = useItemsJudgedRender(
    canvasRender,
    listsAsVisitor.visitor !== undefined && conditions.applied !== undefined,
    {
      services: conditionServices,
      componentTitle: mount.componentLibrary.titleOf,
      timeZone: canvasRender.bindings.timeZone,
    }
  );
  const view: EditorView = {
    ...mount,
    ...style,
    ...canvas,
    ...panels,
    canvasRender: shownRender,
    visitorUnreadable,
    documentDirty,
    pageTitle,
    componentView,
    layerVerbs: cardVerbs,
    reveal,
    readMedia,
    searchMedia,
    preview: componentView.preview,
    // The stored document's kind too: a component's lists relate to the
    // entries of the pages placing it, as its save judges them.
    entryCollection,
    // A component has no entry of its own: its bindings read each placing
    // page's, so the picker lists no entry for it and it plans no unbind of
    // one, as its lists and its save already judge it.
    bindingEntry: isComponentDocument ? null : identity,
    editedDocument: isComponentDocument ? null : editedDocument,
    canvasEntry: identity,
    conditionsUnchecked,
    conditionsApplied: conditions.applied,
    composedDocument: conditions.composed,
    conditionsShownLabel: `Shown for this ${conditions.noun}`,
  };
  useOpenAtSection({
    sectionId: openAt?.sectionId,
    blockId: openAt?.blockId,
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
    setZoom,
    appliedScale,
    deviceRequest,
    setChosenDevice,
  } = view;

  return (
    // Fills the view's area, under the admin's lock and recovery notices for
    // this document, rather than covering the window over them. A component's
    // own view carries its banner above the editor.
    <EditorFrame banner={componentView.banner} userId={mount.userId}>
      {/* The bound props a visitor will not see, for the inspector's note
          under each; the canvas's badges are handed the same answer. */}
      <VisitorUnreadableProvider value={view.visitorUnreadable}>
        {/* The page's data, counted once for the top bar's meter and Page
            settings' line. */}
        <PageReads
          counts={view.initialDocument.kind === "page"}
          editor={editor}
          drawnWith={view.canvasRender}
          regions={view.canvasRegions}
          componentTitle={componentLibrary.titleOf}
          cap={readPageDataLimit(mount.clientConfig)}
        >
          <BuilderShell
            notices={notices}
            onExit={shellExit(componentView, done)}
            // The signed-in author's own preferences, not the browser's.
            store={mount.preferenceStore}
            availablePanels={availablePanels}
            // Forces the insert panel open from the empty-container appender,
            // which lives on the canvas below rather than beside the rail that
            // normally opens a panel.
            openPanelRequest={openPanelRequest}
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
            // The title is the top bar's switcher, so the shell draws none.
            {...editorTopBar(view, {
              title: page.title,
              // Recorded by its address, so the recent page opens the same row
              // after the rows are reordered.
              field: place.address,
              location: place.location,
              canvas: canvas.canvasElement,
              // "Preview as visitor", in Preview's menu.
              visitor: conditions.visitor,
            })}
            // Pinned above the canvas: a template's entry it is drawn with, and
            // the visitor's view while it is on.
            canvasStrip={editorStrip(templatePreview, conditions)}
            openSettingsRequest={view.pages.settingsRequest}
            renderSettings={editorSettings(view, page, settingsPlace)}
            // The shell owns the region; this fills it. Rendered unconditionally
            // rather than only when something is selected, because with nothing
            // selected the panel shows the document's own settings: a region
            // that appears and disappears with the selection makes the canvas
            // resize on every click.
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
            inspector={editorInspector(view, cardVerbs, sharedStyle.host, {
              control,
              page,
            })}
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
            breadcrumb={editorBreadcrumb(
              editor,
              componentLibrary.titleOf,
              place.location
            )}
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
              // Esc with no block selected leaves a look edited on its own.
              onEscapeWithoutSelection={panels.lookEditing.exit}
              onEditText={componentView.preview.onEditText}
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
              // "Save as shared style…", offered by every block menu.
              sharedStyles={sharedStyle.verb}
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
              {publishOffer}
              {removalHold}
              {sharedStyle.dialog}
            </BlockKeyboardActions>
          </BuilderShell>
        </PageReads>
      </VisitorUnreadableProvider>
    </EditorFrame>
  );
}

/**
 * The shell's exit arrow: withheld while the component banner offers its
 * Back, so the view has one way back rather than two arrows going to two
 * places. Leaving through search still commits, as the exit always did.
 */
function shellExit(
  view: Pick<ComponentView, "offersBack">,
  done: () => void
): (() => void) | undefined {
  return view.offersBack ? undefined : done;
}

/**
 * The editor's area: the whole of it for a page, and under the banner for a
 * component's own view, so the banner takes its height and the shell the rest.
 * The author's Recent colours are provided here, around the whole editor, so
 * the Design panel's colour pickers and the inspector's read one list.
 */
function EditorFrame({
  banner,
  userId,
  children,
}: {
  banner: React.ReactNode;
  /** The signed-in author, whose Recent colours these are. */
  userId: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const recentColours = useMemo(() => recentColoursStore(userId), [userId]);
  const body = (
    <RecentColoursStore.Provider value={recentColours}>
      {children}
    </RecentColoursStore.Provider>
  );
  if (banner === null) {
    return <div className="h-full bg-background">{body}</div>;
  }
  return (
    <div className="flex h-full flex-col bg-background">
      {banner}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

/**
 * Hand the "Part of" toast the component opener the view built, so its Edit
 * component action opens what the panel's button does.
 */
function useOfferedEditComponent(
  offer: EditorMount["offerEditComponent"],
  open: ComponentView["onEditComponent"]
): void {
  useEffect(() => {
    offer(open);
  }, [offer, open]);
}
