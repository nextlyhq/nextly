"use client";

/**
 * The inspector: editing the selected block's props.
 *
 * Draws what `inspector` decides and decides nothing itself — which props a
 * block exposes, in what order, and the patch that changes one all live there,
 * where they can be asserted without a DOM.
 *
 * **Text commits on blur, not on every keystroke.** Undo is built from op
 * inverses, so an op per character would make one undo remove one letter, and
 * a sentence would take a sentence's worth of presses to take back. Committing
 * on blur keeps an edit to a field one entry in the history, which is what an
 * author means by "undo that change". The cost is that the canvas updates when
 * focus leaves the field rather than as you type; live preview needs the store
 * to coalesce consecutive updates to one node and prop, which it does not do
 * yet.
 *
 * Discrete controls — a checkbox, a select — commit immediately. There is no
 * typing to coalesce, and waiting for blur on a checkbox would leave the canvas
 * disagreeing with a control the author has already changed.
 *
 * This module draws the panel, its three tabs and the surface a selection
 * gets, and is the entry for the rest: what the panel takes is in
 * `inspector-panel-types.ts`, the style state it edits and the tab it shows
 * in `inspector-style-state.ts`, the Content tab in `inspector-content-tab.tsx`
 * and its generated fields in `inspector-content-fields.tsx`, the Style tab
 * in `inspector-style-tab.tsx`, the Advanced tab in
 * `inspector-advanced-tab.tsx`, and the panel for several blocks in
 * `many-blocks-panel.tsx`.
 *
 * @module inspector-panel
 */

import type { BlockDocument, ComponentLookup } from "@nextlyhq/blocks-engine";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";
import * as React from "react";

import { BlockCard, type CardVerbs } from "./block-card";
import {
  blockLookGroups,
  sameLook,
  type BlockLookRow,
} from "./block-look-rows";
import { CanvasPassageContext } from "./canvas/canvas-passage";
import { useCanvasReading } from "./canvas/use-canvas-reading";
import {
  ComponentFieldsContext,
  ComponentFieldsScope,
  ExposedFieldsList,
  type ComponentFieldsBinding,
} from "./component-fields-panel";
import {
  ComponentVariantsContext,
  ComponentVariantsSection,
} from "./component-variants-panel";
import { ContentServicesContext } from "./content-controls";
import type { EditorState } from "./editor-state";
import { EDITOR_WORDS } from "./editor-words";
import {
  inspectorTabsOf,
  inspectSelection,
  lockOp,
  lockStateOf,
  layersLockChangeable,
  lockStatusOf,
  lockViewOf,
  renameOp,
  selectedNode,
  type BlockInspection,
  type InspectorTab,
} from "./inspector";
import { AdvancedTab } from "./inspector-advanced-tab";
import { commitProp, ContentTab } from "./inspector-content-tab";
import type {
  ComponentLibrary,
  DocumentSettingsView,
  InspectorPanelProps,
  StyleStateBinding,
} from "./inspector-panel-types";
import {
  editedStyleState,
  openingTabFor,
  shownTab,
} from "./inspector-style-state";
import { StyleTab } from "./inspector-style-tab";
import { inspectInstance, type InstanceInspection } from "./instance-inspector";
import { InstanceInspectorPanel } from "./instance-inspector-panel";
import { LookInspector } from "./look-inspector";
import { ManyBlocksPanel } from "./many-blocks-panel";
import { PanelFoldsProvider } from "./panel-folds-context";
import { PanelOptions } from "./panel-options";
import { placedDefinition } from "./variant-picker";

// What the panel takes, the style state it edits, the Content and Style tabs,
// the Content tab's fields and the panel for several blocks live in modules
// of their own beside it; every name this module exported still is.
// Part of this module's exported names; no importer in the package reads them.
// fallow-ignore-next-line unused-type
export type { ComponentLibrary } from "./inspector-panel-types";
// fallow-ignore-next-line unused-type
export type { StyleStateBinding } from "./inspector-panel-types";
export type {
  BlockInspectorResolver,
  DocumentSettingsView,
  InspectorPanelProps,
} from "./inspector-panel-types";
export { editedStyleState } from "./inspector-style-state";

/**
 * The inspector's tabs: what the block says, shows or links to; how it looks;
 * and how it is built into the page (where and when it shows, its HTML).
 *
 * Three, as Elementor, Divi and Breakdance split a block's settings, so the
 * settings that change the HTML but not what a visitor reads have a place of
 * their own rather than a fold at the end of Content. A block has only the
 * tabs that hold something for it (`inspectorTabsOf`).
 */
const INSPECTOR_TABS: readonly { value: InspectorTab; label: string }[] = [
  { value: "content", label: EDITOR_WORDS.content },
  { value: "style", label: EDITOR_WORDS.style },
  { value: "advanced", label: EDITOR_WORDS.advanced },
];

/** The inspector's tab names, in order, as an author reads them. */
export function inspectorTabLabels(): string[] {
  return INSPECTOR_TABS.map(tab => tab.label);
}

/**
 * What a host that supplies no library is judged under: nothing resolves, so an
 * instance reads as one whose definition could not be loaded. A shared instance
 * rather than a fresh one per render, because the inspection is recomputed
 * every render and a fresh empty map is a new identity for nothing.
 */
const NO_LIBRARY: ComponentLibrary = { definitions: new Map(), components: [] };

/** The selected instance, under the library the host supplied or the empty one. */
function selectedInstance(
  editor: EditorState,
  library: ComponentLibrary = NO_LIBRARY
): InstanceInspection | null {
  return inspectInstance(
    editor.document,
    editor.selectedId,
    library.definitions,
    library.components,
    lockViewOf(editor)
  );
}

/**
 * Which surface a selection gets: one drawn WITHOUT the tab strip, or the
 * block whose tabs apply.
 *
 * A discriminated answer rather than "an element or null", so the caller that
 * goes on to draw the tabs holds a BLOCK inspection by type rather than a
 * maybe it has to re-check.
 *
 * Three selections get a surface of their own, and the order is the rule.
 * Several blocks first: a selection of several instances is still several
 * blocks, and the lock is still the one thing well defined across them. An
 * instance next, before the empty case: the block inspection IS empty for an
 * instance — its type is not in the registry — and answering "select a block"
 * to an author who just clicked a component was the state that surface
 * replaces. Nothing selected last: the document's own settings, and no
 * tabs.
 */
function surfaceFor(
  editor: EditorState,
  instance: InstanceInspection | null,
  inspection: BlockInspection | null,
  verbs: CardVerbs | undefined,
  fields: ComponentFieldsBinding | undefined,
  definitions: ComponentLookup,
  /** The canvas's root, where the instance panel marks a placement's parts. */
  canvasRoot: HTMLElement | null | undefined,
  /** The host's view of the open document, drawn while nothing is selected. */
  documentSettings: DocumentSettingsView | undefined
):
  | { readonly tabless: React.JSX.Element }
  | { readonly block: BlockInspection } {
  /*
   * Several blocks selected: a different panel, not a thinner one.
   *
   * Showing the primary's name and props while six blocks are selected would
   * describe one block and act on one block, on a screen where the canvas shows
   * six outlined and the toolbar's delete removes all of them. The two surfaces
   * would be answering different questions with the same words.
   *
   * Per-property batch editing — one field showing "Mixed" and writing to every
   * block — is Plan 05's batch edit and is deliberately not here. What IS here
   * is the one property that is well defined across any set today, because it
   * is a flag rather than a value: the lock.
   */
  if (editor.selection.ids.length > 1) {
    return {
      tabless: (
        <ManyBlocksPanel
          editor={editor}
          count={editor.selection.ids.length}
          lock={lockStateOf(editor.document, editor.selection.ids)}
        />
      ),
    };
  }
  if (instance !== null) {
    return {
      tabless: (
        <InstanceInspectorPanel
          inspection={instance}
          editor={editor}
          verbs={verbs}
          definition={placedDefinition(definitions, instance.componentId)}
          canvasRoot={canvasRoot}
        />
      ),
    };
  }
  /*
   * Nothing selected: the open document's own settings, drawn by the host
   * (a page's title, address and header & footer), in the same frame and so
   * at the same width, so the canvas never rescales on a click. Tabs are
   * withheld: a Style tab over no selection would offer an author somewhere
   * to click that can never show anything.
   *
   * In a component's own view, nothing selected means the component itself
   * is what is being looked at, so its exposed fields are listed, and the
   * variants that preset them under those, handed to the host to place
   * among its own rows.
   */
  if (editor.selectedId === null) {
    const own =
      inspection === null && fields !== undefined ? (
        <ExposedFieldsList binding={fields} editor={editor}>
          <ComponentVariantsSection
            editor={editor}
            component={fields.context.component}
          />
        </ExposedFieldsList>
      ) : null;
    return {
      tabless: (
        <div className="nx-inspector" data-empty="no-selection">
          {documentSettings === undefined ? own : documentSettings(own)}
        </div>
      ),
    };
  }
  // A block whose type this site does not register: nothing to edit it with.
  if (inspection === null) {
    return {
      tabless: (
        <div className="nx-inspector" data-empty="unregistered">
          <p className="nx-inspector__note">
            {"This block can't be edited here: its type isn't on this site."}
          </p>
        </div>
      ),
    };
  }
  return { block: inspection };
}

/**
 * The inspector, inside the component's own view when the document is a
 * component: the scope holds the removal dialog and hands every control the
 * binding, so the panel below draws the same whichever document it edits.
 */
export function InspectorPanel({
  componentFields,
  componentVariants,
  canvasPassage = null,
  ...panel
}: InspectorPanelProps): React.JSX.Element {
  const look = editedLook(panel);
  if (look !== undefined && panel.lookEditing !== undefined) {
    return (
      <LookInspector
        editor={panel.editor}
        look={look}
        host={panel.sharedStyles}
        onExit={panel.lookEditing.onExit}
        library={panel.classLibrary ?? []}
        canvasRoot={panel.canvasRoot}
        state={editedStyleState(panel.styleState)}
        policy={panel.policy}
        breakpoint={panel.breakpoint}
        cascade={panel.cascade}
        breakpoints={panel.breakpoints}
        previewContainer={panel.previewContainer}
        liveBreakpoints={panel.liveBreakpoints}
        onJumpToBreakpoint={panel.onJumpToBreakpoint}
        tokens={panel.tokens}
        fonts={panel.fonts}
      />
    );
  }
  return (
    <ComponentFieldsScope editor={panel.editor} host={componentFields}>
      <ComponentVariantsContext.Provider value={componentVariants}>
        <CanvasPassageContext.Provider value={canvasPassage}>
          <PanelFoldsProvider>
            <SelectionInspector {...panel} />
          </PanelFoldsProvider>
        </CanvasPassageContext.Provider>
      </ComponentVariantsContext.Provider>
    </ComponentFieldsScope>
  );
}

/**
 * The look the inspector edits on its own: the one the host names, while no
 * block is selected and the look is still one the site renders or reads.
 * Selecting a block edits the block, whatever look was chosen.
 */
function editedLook(
  panel: Pick<InspectorPanelProps, "editor" | "classLibrary" | "lookEditing">
): BlockLookRow | undefined {
  const key = panel.lookEditing?.look;
  if (key === undefined || panel.editor.selectedId !== null) return undefined;
  return blockLookGroups(panel.classLibrary ?? [], new Set())
    .flatMap(group => group.rows)
    .find(row => sameLook(row, key));
}

/**
 * The tab the panel shows, and the author's choice of one.
 *
 * OPENS ON STYLE when a host mounts with a state already chosen. A binding
 * naming a non-base state is a host restoring what an author was editing, and
 * this panel's contract is that such a state and `Canvas.forcedState` are the
 * same value — so opening on Content would leave the canvas drawing a block
 * mid-hover with the only control that explains or clears it behind a tab
 * nobody was told to open. The rule that drops the state on leaving Style
 * cannot catch that: it acts on a CHANGE of tab, and a mount is not one.
 * Honouring the state rather than clearing it, for the reason the multi-
 * selection case does the same: the host asked for it deliberately, and
 * resetting would silently discard what it restored.
 *
 * The tab on screen is the author's, or the selected block's first where it
 * lacks the author's (`shownTab`).
 *
 * Leaving Style drops the forced interaction state. The state control sits
 * inside the Style tab and goes off screen with it, so a state left on would
 * be a canvas drawing a button mid-press with no control on screen saying
 * why. However Style is left — a click on another tab, or a block that shows
 * its first tab because it lacks the author's — the canvas goes back to
 * Normal. On a CHANGE of the tab shown, compared with the last one, rather
 * than on every render: a mount, or a render that reasserts the same tab, is
 * no leaving, and a host that restored a state deliberately keeps it.
 *
 * @param styleState - the state the host restored, and its setter
 * @param asked - the count of the latest ask to fix a list's sort, which is
 *   on the Content tab
 * @param inspection - the selected block, whose tabs decide the one shown
 */
function useInspectorTab(
  styleState: StyleStateBinding | undefined,
  asked: number | undefined,
  inspection: BlockInspection | null
): { readonly shown: string; readonly choose: (tab: string) => void } {
  // The tab the AUTHOR chose, kept whichever block is selected.
  const [tab, setTab] = React.useState<string>(() => openingTabFor(styleState));
  // A list's sort asked for from its canvas note is on the Content tab, so
  // the author is taken there, once per ask, from wherever they were.
  // Each ask moves the tab once: a new style-state setter is no new ask.
  const answeredAsk = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (asked === undefined || asked === answeredAsk.current) return;
    answeredAsk.current = asked;
    setTab("content");
  }, [asked]);

  const shown =
    inspection === null ? tab : shownTab(tab, inspectorTabsOf(inspection));
  const onStyleStateChange = styleState?.onChange;
  const lastShown = React.useRef(shown);
  React.useEffect(() => {
    const left = lastShown.current === "style" && shown !== "style";
    lastShown.current = shown;
    if (left) onStyleStateChange?.("base");
  }, [shown, onStyleStateChange]);
  return { shown, choose: setTab };
}

/** The tab list: one Tab stop, with arrows, Home and End between the tabs. */
function InspectorTabList({
  tabs,
  shown,
}: {
  tabs: readonly InspectorTab[];
  /** The tab showing, whose sections the options menu folds. */
  shown: string;
}): React.JSX.Element {
  // Compact underlined tabs at the start of the panel; the classes carry the
  // inspector's own tab rules over the shared tabs'. The options menu sits at
  // the row's end, outside the tab list, so arrows still move between tabs.
  return (
    <div className="nx-inspector__tabrow">
      <InspectorTabs tabs={tabs} />
      <PanelOptions tab={shown} />
    </div>
  );
}

/** The tabs themselves: one Tab stop, with arrows, Home and End. */
function InspectorTabs({
  tabs,
}: {
  tabs: readonly InspectorTab[];
}): React.JSX.Element {
  return (
    <TabsList className="nx-inspector__tablist">
      {INSPECTOR_TABS.filter(tab => tabs.includes(tab.value)).map(tab => (
        <TabsTrigger
          key={tab.value}
          value={tab.value}
          className="nx-inspector__tab"
        >
          {tab.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/**
 * The Content tab's panel, where the block has one; a block without a
 * Content tab mounts none.
 */
function ContentTabPanel({
  tabs,
  shown,
  ...content
}: {
  tabs: readonly InspectorTab[];
  shown: string;
} & Omit<
  React.ComponentProps<typeof ContentTab>,
  "onScreen"
>): React.JSX.Element | null {
  if (!tabs.includes("content")) return null;
  return (
    <TabsContent value="content" forceMount hidden={shown !== "content"}>
      <ContentTab {...content} onScreen={shown === "content"} />
    </TabsContent>
  );
}

function SelectionInspector({
  editor,
  canvasRoot,
  styleState,
  breakpoint,
  cascade,
  previewContainer,
  blocks,
  componentLibrary,
  inspectors,
  verbs,
  contentServices,
  breakpointsStatus = "ready",
  documentSettings,
  // What only the Style tab reads, carried to it whole.
  ...styleOnly
}: Omit<
  InspectorPanelProps,
  "componentFields" | "componentVariants"
>): React.JSX.Element {
  // Recomputed each render rather than memoised: an inspection is only valid
  // against the document it was read from, and an edit anywhere changes both
  // the document and the values shown.
  // Owned here rather than in the style tab: reading it needs a subscription to
  // the canvas, and the panel that decides which control shows a value should
  // not also hold one. Passed down as an answer, exactly as `cascade` is.
  const canvas = useCanvasReading(canvasRoot, editor.selectedId, {
    document: editor.document,
    state: styleState?.state,
    breakpoint,
    cascade,
    previewContainer,
  });
  const inspection = inspectSelection(
    editor.document,
    editor.selectedId,
    lockViewOf(editor)
  );
  /*
   * Asked beside the block inspection rather than instead of it, and the two
   * cannot both answer: a node is an instance or a registered block, never
   * both, and `inspectSelection` already answers nothing for a type the
   * registry does not hold. Asked here, before the early returns, because the
   * hooks below have to run on every render whichever surface is drawn.
   */
  const instance = selectedInstance(editor, componentLibrary);
  /*
   * The NODE rather than the inspection, because the marker is about stored
   * styles and an inspection describes editable props. `selectedNode` answers
   * for a block the registry does not know as well, which is right here: an
   * unregistered block still has styles, and refusing to say which states carry
   * them would be a worse answer than saying none.
   */
  const styleNode = selectedNode(editor.document, editor.selectedId);

  // Declared before the early returns below, because a hook has to run on
  // every render of this component and "no selection" is one of them.
  const { shown, choose } = useInspectorTab(
    styleState,
    editor.sortFieldAsked?.seq,
    inspection
  );

  const commit = React.useCallback(
    (name: string, value: unknown): BlockDocument | null => {
      const id = editor.selectedId;
      if (id === null) return null;
      // Read at commit time rather than closed over: a field committing on
      // blur can fire after another edit has already replaced the node. The
      // document written is answered, for a caller storing it straight away.
      return commitProp(editor, editor.document, id, name, value);
    },
    [editor]
  );

  // The lock reason's id, which every held control points to. Made before
  // the early return, as every hook here is.
  const reasonId = React.useId();
  // The component's own view, when the document is a component.
  const fields = React.useContext(ComponentFieldsContext);

  const surface = surfaceFor(
    editor,
    instance,
    inspection,
    verbs,
    fields,
    (componentLibrary ?? NO_LIBRARY).definitions,
    canvasRoot,
    documentSettings
  );
  // A tabless surface still reaches the host's media library: a component
  // placement's exposed image chooses a file as the Content tab does.
  if ("tabless" in surface) {
    return (
      <ContentServicesContext.Provider value={contentServices}>
        {surface.tabless}
      </ContentServicesContext.Provider>
    );
  }
  const block = surface.block;
  const lock = lockStatusOf(editor.document, block.nodeId, lockViewOf(editor));
  const tabs = inspectorTabsOf(block);

  return (
    <div className="nx-inspector">
      <BlockCard
        // Keyed by node, so a rename half-typed for one block does not carry
        // to the next.
        key={`${block.nodeId}:card`}
        icon={block.icon}
        type={block.label}
        name={block.identity.name}
        description={block.description}
        lock={lock}
        // Withheld while a Layers lock holds the block, its own or one around
        // it: renaming is a change like any other, and the op layer refuses it.
        onRename={
          lock.layers || lock.inheritedFrom !== undefined
            ? undefined
            : name => editor.apply(renameOp(block.nodeId, name))
        }
        onLock={locked => editor.apply(lockOp(block.nodeId, locked))}
        // Held inside a `contentOnly` area, which pins the node's own lock
        // with its design: the save would refuse the change. The one predicate
        // the multi-selection card asks too, so a block's Lock is offered alike
        // however it was selected; inside a block locked in Layers it stays
        // offered, since a change to the lock alone is always allowed.
        lockHeld={
          layersLockChangeable(lock)
            ? undefined
            : "The area it sits in fixes this."
        }
        verbs={verbs}
        reasonId={reasonId}
      />

      {/*
        Held HERE, so the chosen tab survives a change of selection — an author
        styling one block after another means to stay on Style. This element's
        position does not change, so the state lives across every selection; a
        `key` on the node id would reset it on every click. A block without
        the chosen tab shows its first, and the next block that has the
        chosen one shows it again.
      */}
      <Tabs value={shown} onValueChange={choose} className="nx-inspector__tabs">
        <InspectorTabList tabs={tabs} shown={shown} />

        {/*
          FORCE-MOUNTED, Content and Advanced both: a field commits on blur
          and the tabs activate on mousedown, before the blur, and Advanced
          holds a draft, so unmounting either threw away what the author
          typed and why a refused row was not saved. HIDDEN here, not by
          Radix, which ties mounting to showing; `hidden` takes it out of the
          accessibility tree as unmounting did. A block without a Content tab
          mounts none.
        */}
        <ContentTabPanel
          tabs={tabs}
          shown={shown}
          block={block}
          editor={editor}
          onCommit={commit}
          inspectors={inspectors}
          services={contentServices}
          reasonId={reasonId}
          fields={fields}
          around={{
            breakpoints: styleOnly.breakpoints,
            cascade,
            renderedTag: canvas.tag,
          }}
        />

        <TabsContent value="style">
          <StyleTab
            {...styleOnly}
            editor={editor}
            styleNode={styleNode}
            renderedTag={canvas.tag}
            renderedPicture={canvas.picture}
            renderedPicturePosition={canvas.picturePosition}
            sideOrientation={canvas.orientation}
            styleState={styleState}
            breakpoint={breakpoint}
            cascade={cascade}
            previewContainer={previewContainer}
            verbs={verbs}
          />
        </TabsContent>

        <TabsContent value="advanced" forceMount hidden={shown !== "advanced"}>
          <AdvancedTab
            block={block}
            editor={editor}
            onCommit={commit}
            services={contentServices}
            blocks={blocks}
            onScreen={shown === "advanced"}
            reasonId={reasonId}
            fields={fields}
            breakpoints={styleOnly.breakpoints}
            breakpoint={breakpoint}
            breakpointsStatus={breakpointsStatus}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
