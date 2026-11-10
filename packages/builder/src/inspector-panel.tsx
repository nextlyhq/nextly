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
 * @module inspector-panel
 */

import {
  authoredText,
  BASE_BREAKPOINT,
  breakpointContexts,
  findNode,
  type BlockDocument,
  type BlockInspectorProps,
  type BreakpointId,
  type BreakpointSet,
  type BuilderOp,
  type ComponentLookup,
  type ComponentPath,
  type NodeStyles,
  type SiteTokenSet,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import type { BlockResolver, PageStyleCascade } from "@nextlyhq/blocks-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useIsomorphicLayoutEffect,
} from "@nextlyhq/ui";
import { ChevronRight } from "lucide-react";
import * as React from "react";

import { AdvancedPanel } from "./advanced-panel";
import { BindableField } from "./binding-controls";
import { BlockCard, SelectionCard, type CardVerbs } from "./block-card";
import {
  blockLookGroups,
  sameLook,
  type BlockLookRow,
} from "./block-look-rows";
import { CanvasPassageContext, type CanvasPassage } from "./canvas-passage";
import type { ComponentFieldsHost } from "./component-fields";
import {
  ComponentFieldsContext,
  ComponentFieldsScope,
  ExposedFieldsList,
  PropExposeControl,
  VisibilityExposeControl,
  type ComponentFieldsBinding,
} from "./component-fields-panel";
import type { ComponentVariantsHost } from "./component-variants";
import {
  ComponentVariantsContext,
  ComponentVariantsSection,
} from "./component-variants-panel";
import { ShowWhen } from "./condition-controls";
import {
  ContentServicesContext,
  contentControlFor,
  UnsupportedField,
  type ContentServices,
} from "./content-controls";
import type { EditorState } from "./editor-state";
import { EDITOR_WORDS } from "./editor-words";
import { FocalFrame } from "./focal-frame";
import { HeldByLock } from "./held-by-lock";
import type { SavedComponent } from "./inserter";
import {
  blockIsReadOnly,
  designReadOnlyReason,
  fieldLabel,
  inspectSelection,
  lockOp,
  lockStateOf,
  layersLockChangeable,
  lockStatusOf,
  lockViewOf,
  propIsWritable,
  propLabel,
  propPatch,
  renameOp,
  selectedNode,
  type BlockInspection,
  type EditableProp,
  type LockState,
} from "./inspector";
import { inspectInstance, type InstanceInspection } from "./instance-inspector";
import { InstanceInspectorPanel } from "./instance-inspector-panel";
import { commitLinkChanges } from "./link-control";
import { LookInspector, type LookEditing } from "./look-inspector";
import { useCanvasTokenModeAt } from "./prefers-dark";
import {
  propGroupsOf,
  type BindableOptions,
  type BindableWrapper,
} from "./prop-groups";
import { selectionLock } from "./selection-ops";
import { StyleStateField } from "./state-switcher";
import {
  breakpointLabel,
  StyleInspectorPanel,
  type StyleInspectorPanelProps,
} from "./style-inspector-panel";
import {
  StyleTargetBar,
  useStyleTarget,
  type SharedStylesHost,
  type StyleTargetBarProps,
} from "./style-target";
import type { StylePolicy } from "./style-values";
import { useCanvasReading } from "./use-canvas-reading";
import { placedDefinition } from "./variant-picker";
import { VisibleOn, type BreakpointsStatus } from "./visible-on";
import {
  useVisitorUnreadable,
  VisitorUnreadableNote,
} from "./visitor-unreadable-context";

export interface StyleStateBinding {
  /** The state being edited. `base` when omitted. */
  state?: StyleState | undefined;
  /** Choose a different one. Omitted withholds the control. */
  onChange?: ((state: StyleState) => void) | undefined;
}

/**
 * Resolves a block's own inspector (`editor.component`) to the component the
 * host loaded for it, or `undefined` when it loaded none.
 *
 * Supplied by the host, because this package reaches no component registry:
 * the components a site's plugins contribute are loaded by the app, and only
 * the app knows which arrived.
 *
 * @experimental The custom inspector contract will grow with the controls
 *   registry.
 */
export type BlockInspectorResolver = (
  path: ComponentPath
) => React.ComponentType<BlockInspectorProps> | undefined;

export interface InspectorPanelProps {
  /**
   * The component placement's exposed passage the canvas is editing in place,
   * whose field the inspector holds meanwhile; `null` or omitted while the
   * canvas edits none.
   */
  canvasPassage?: CanvasPassage | null;
  /**
   * The canvas root, forwarded to the style tab.
   *
   * Declared here only to CARRY it: this panel has no opinion about the canvas,
   * and what the style tab does with it lives on
   * {@link StyleInspectorPanelProps.canvasRoot}. Forwarded rather than left out
   * for the reason the class library is: a prop the chain drops is invisible —
   * the surface renders in isolation, its tests pass, and every real selection
   * in the shipped editor silently loses the answer.
   */
  canvasRoot?: HTMLElement | null;
  /**
   * The site's class library, forwarded to the style tab's class selector.
   *
   * Declared here only to CARRY it: this panel has no opinion about classes,
   * and the meaning of each — including why an absent library is a read in
   * flight rather than a host opting out — lives on
   * {@link StyleTargetBarProps.library}.
   *
   * Forwarded rather than left out because a prop the chain drops is invisible:
   * the surface renders in isolation, its tests pass, and every real selection
   * in the shipped editor shows nothing.
   */
  classLibrary?: StyleTargetBarProps["library"];
  /** Why the library is absent, when it is. Carried, not interpreted. */
  classLibraryAbsence?: StyleTargetBarProps["libraryAbsence"];
  /**
   * What the host lends for shared styles: the author's right, the write that
   * stores a style, and the reads of its reach. Without it a block's shared
   * styles are listed but cannot become the target.
   *
   * @experimental Settles with the shared-styles editor.
   */
  sharedStyles?: SharedStylesHost;
  /**
   * A look edited on its own, chosen in the Design panel: while no block is
   * selected the inspector edits it instead of saying to select a block.
   *
   * @experimental Settles with the Design panel's Block looks group.
   */
  lookEditing?: LookEditing;
  /**
   * The site's fonts, carried to the Style tab's Font control. See
   * {@link StyleInspectorPanelProps.fonts}.
   */
  fonts?: StyleInspectorPanelProps["fonts"];
  /**
   * The editor whose selected block this edits.
   *
   * The whole state rather than a document and an `apply` separately: a patch is
   * built from the node in a particular document, and passing them apart lets a
   * caller hand a node from one render to an `apply` bound to another — which
   * writes a merged props object assembled from a stale node.
   */
  editor: EditorState;
  /**
   * What the site allows, forwarded to the Style tab.
   *
   * Carried rather than defaulted: the engine ships no host list of its own, so
   * omitting it does not mean "allow" — it means the question was never asked.
   */
  policy?: StylePolicy;
  /**
   * The interaction state the Style tab edits, and how to change it.
   *
   * ONE prop rather than a value and a setter beside each other, because they
   * are one decision: this state and `Canvas.forcedState` must be the same
   * value, and a host wiring them separately gets a panel reporting a state its
   * canvas is not showing. Bundled, the pair travels together or not at all.
   *
   * `onChange` absent WITHHOLDS the switcher rather than disabling it. A host
   * that cannot carry the choice to its canvas would otherwise show a control
   * whose selection nothing follows — the arrangement that contract exists to
   * prevent.
   */
  styleState?: StyleStateBinding;
  /** The breakpoint the Style tab edits. The unconditional one by default. */
  breakpoint?: BreakpointId;
  /**
   * The definitions the CANVAS renders against, forwarded to the Advanced tab.
   *
   * A host that gives `Canvas` a `render.blocks` resolver must give the same one
   * here, or the id-collision check answers about a different page than the one
   * on screen. Omitted, both sides fall back to the global registry, which is
   * what `PageRenderer` itself defaults to.
   */
  blocks?: BlockResolver;
  /**
   * The declarations the compiler wrote and the tree they describe, so the Style
   * tab can say where a control's value came from.
   *
   * Forwarded rather than compiled here for the reason the panel states: the
   * cascade is walked ONCE per document, by the host that already holds the
   * breakpoints it must be compiled against. The tree is carried with it so the
   * panel resolves the selected node in the same tree the declarations belong
   * to; see {@link StyleInspectorPanelProps.cascade}.
   */
  cascade?: PageStyleCascade;
  /** The site's breakpoints, which decide which of those declarations are live. */
  breakpoints?: BreakpointSet;
  /**
   * Whether `breakpoints` is the site's own set yet: `loading` while the
   * config's defaults stand in for the stored set being read, `unavailable`
   * when that read failed. "Visible on" writes only once it is `ready`: a
   * hide resolved against the wrong set is stored wrong. Defaults to
   * `ready`, for a host whose breakpoints are known up front.
   */
  breakpointsStatus?: BreakpointsStatus;
  /**
   * The container the canvas compiled its breakpoints against, when it is
   * previewing rather than rendering at the browser's own width.
   *
   * Forwarded for the reason the Style tab states: which declarations are LIVE
   * is a question about the queries the sheet was emitted under, and a panel
   * given only the set compares the window against rules a preview compile
   * never wrote.
   */
  previewContainer?: string;
  /**
   * Which breakpoints the canvas is ACTUALLY applying, forwarded to the Style
   * tab. Needed only while previewing, where the queries are about the preview
   * box and only its owner can observe them.
   */
  liveBreakpoints?: readonly BreakpointId[];
  /**
   * Move the canvas to a breakpoint, forwarded to the Style tab.
   *
   * Only the surface owning the canvas width can do this, and it sits above
   * this panel — so the capability is passed down and each control whose value
   * came from another tier offers to use it.
   */
  onJumpToBreakpoint?: (breakpoint: BreakpointId) => void;
  /**
   * The site's design tokens, forwarded to the Style tab's colour controls.
   *
   * Carried rather than defaulted, as `policy` is: omitting it means the
   * question was never asked, not that the site defines none. See
   * {@link StyleInspectorPanelProps.tokens} for why `policy.tokens` cannot
   * serve this.
   */
  tokens?: SiteTokenSet;
  /**
   * The site's component library, as the host read it: the definitions the
   * CANVAS resolves instances against, and the rows that name them.
   *
   * ONE prop rather than a lookup and a list beside each other, because they
   * are one read: a selected instance's rows are read from the very document
   * the page is drawn from, and its title from the row the same read returned.
   * Handed two props from two reads, a host could title an instance from one
   * library and resolve it against another.
   *
   * Supplied rather than fetched, as every input to this package is. Omitted,
   * an instance is inspected as one whose definition could not be loaded —
   * which is what the canvas draws for it under the same omission — and
   * titled by its component id.
   */
  componentLibrary?: ComponentLibrary;
  /**
   * Resolves a block's own inspector. A block naming one gets it in place of
   * its generated content controls; one this answers `undefined` for keeps the
   * generated controls, so an unloaded component never leaves a block with no
   * way to edit it. Omitted, every block gets the generated controls.
   */
  inspectors?: BlockInspectorResolver;
  /**
   * The block verbs the card's menu offers beside Rename and Lock: the same
   * verbs and verdicts the toolbar uses, handed out of the editor's verbs
   * provider. Omitted, the menu offers Rename and Lock alone.
   */
  verbs?: CardVerbs;
  /**
   * What the host lends the Content tab: the media library and the shared
   * rich-text editor. A control whose service is absent says so.
   *
   * @experimental Grows with the controls registry.
   */
  contentServices?: ContentServices;
  /**
   * What the host knows about the component being edited, when the document
   * is one: the ids it may never mint again, and how many pages place it.
   * Exposing fields is offered for any component document; without this, a
   * new field's id is kept clear of the ids this session has seen only.
   *
   * @experimental Settles when the component editor ships.
   */
  componentFields?: ComponentFieldsHost;
  /**
   * What the host can tell the component's variants section: how many
   * placements chose a variant, for the delete dialog. Omitted, the dialog
   * says the placements fall back without a number.
   *
   * @experimental Settles when the component editor ships.
   */
  componentVariants?: ComponentVariantsHost;
}

/** What the inspector needs of the host's component read. */
export interface ComponentLibrary {
  /** The definitions the canvas resolves instances against, keyed by id. */
  readonly definitions: ComponentLookup;
  /** The library's rows, the only holder of a definition's title and usage. */
  readonly components: readonly SavedComponent[];
}

/**
 * Which half of the inspector is showing: what the block says, and how it
 * looks.
 *
 * Two tabs, as Gutenberg's Settings and Styles and Webflow's two panels split
 * it. The CSS id and the custom attributes are Content's last section,
 * "Advanced", rather than a third tab: one place called Advanced, and it is
 * where an author looking for an anchor id goes after the block's own fields.
 */
const INSPECTOR_TABS = [
  { value: "content", label: EDITOR_WORDS.content },
  { value: "style", label: EDITOR_WORDS.style },
] as const;

/** The inspector's tab names, in order, as an author reads them. */
export function inspectorTabLabels(): string[] {
  return INSPECTOR_TABS.map(tab => tab.label);
}

/**
 * The Style tab's own handler for a change of tab.
 *
 * Drops the forced interaction state when the author leaves the Style tab.
 *
 * The one real cost of placing the state control inside the Style tab is that
 * it goes off screen with the tab, so a state left switched on becomes a canvas
 * disagreeing with everything visible — the author edits the text of a button
 * drawn mid-press, with no control on screen saying why. Dropping it here
 * removes that state rather than documenting it.
 *
 * On the CHANGE rather than in an effect keyed on the tab: an effect would also
 * fire on mount and on any re-render that reasserted the same tab, which would
 * fight a host restoring a state deliberately. This runs exactly when a person
 * leaves the tab.
 */
/**
 * The state the panel actually edits, which is `base` unless a setter came with
 * it.
 *
 * The binding permits a state without an `onChange`, and that shape has to mean
 * something rather than being merely allowed. Read literally it is a state
 * nobody can leave: the switcher is withheld because nothing could act on a
 * choice, the tab handler has no callback to return the canvas with, and every
 * control below would go on reading and writing a state with no visible control
 * saying which one — the exact arrangement this panel's contract exists to
 * prevent, reached through the type instead of through a miswiring.
 *
 * Normalised rather than refused, because a host part-way through adopting the
 * control should get a working base editor rather than a broken one.
 */
export function editedStyleState(
  binding: StyleStateBinding | undefined
): StyleState {
  if (binding?.onChange === undefined) return "base";
  return binding.state ?? "base";
}

/**
 * Which tab a mount opens on, given the state the host restored.
 *
 * `content` unless a state is in effect, which is the ordinary case and the
 * behaviour every existing caller already has: a host that names no state, or
 * names `base`, or supplies no setter — in which case {@link editedStyleState}
 * has already resolved the state to `base` and there is nothing to explain.
 */
function openingTabFor(binding: StyleStateBinding | undefined): string {
  return editedStyleState(binding) === "base" ? "content" : "style";
}

function tabChangeHandler(
  setTab: (next: string) => void,
  onStyleStateChange: ((state: StyleState) => void) | undefined
): (next: string) => void {
  return next => {
    setTab(next);
    if (next !== "style") onStyleStateChange?.("base");
  };
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
 * replaces. Nothing selected last: one note, and no tabs.
 */
function surfaceFor(
  editor: EditorState,
  instance: InstanceInspection | null,
  inspection: BlockInspection | null,
  verbs: CardVerbs | undefined,
  fields: ComponentFieldsBinding | undefined,
  definitions: ComponentLookup,
  /** The canvas's root, where the instance panel marks a placement's parts. */
  canvasRoot?: HTMLElement | null
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
   * Nothing selected: one note, and no tabs.
   *
   * The entry's OWN fields are not drawn here. They already ship as a left
   * panel the host renders, and reproducing them in this region would be the
   * second surface-meaning-two-things the layout ruling removed, wearing a
   * different shape. Tabs are withheld too: a Style tab over no selection would
   * offer an author somewhere to click that can never show anything.
   *
   * In a component's own view, nothing selected means the component itself is
   * what is being looked at, so its exposed fields are listed, and the
   * variants that preset them under those.
   */
  if (
    inspection === null &&
    editor.selectedId === null &&
    fields !== undefined
  ) {
    return {
      tabless: (
        <ExposedFieldsList binding={fields} editor={editor}>
          <ComponentVariantsSection
            editor={editor}
            component={fields.context.component}
          />
        </ExposedFieldsList>
      ),
    };
  }
  if (inspection === null) {
    return {
      tabless: (
        <div className="nx-inspector" data-empty="no-selection">
          <p className="nx-inspector__note">Select a block to edit it.</p>
        </div>
      ),
    };
  }
  return { block: inspection };
}

/**
 * The prop whose binding a link group's lead is drawn with: the entry's,
 * where the link follows its bound entry, else the address's.
 *
 * The same precedence the renderer reads a link by (`linkFor` in
 * blocks-react's `blocks/props.ts`): an entry reference, both its halves
 * given, before the address. So a block whose entry is bound and whose
 * collection is set is drawn, and changed, as its entry, whether or not its
 * address is bound too; with no collection the renderer follows the address,
 * and so does the panel. A half counts as given stored or bound, as the
 * render fills a bound one before reading the link.
 */
function drawnBinding(
  lead: string,
  entry: BindableOptions["entryLink"],
  bindings: Readonly<Record<string, unknown>> | undefined,
  props: readonly EditableProp[]
): string {
  if (entry === undefined || bindings?.[entry.id] === undefined) return lead;
  const collection = props.find(prop => prop.name === entry.collection);
  // Read as the renderer reads it (`text`, which is `authoredText`).
  const given =
    bindings[entry.collection] !== undefined ||
    authoredText(collection?.value) !== "";
  return given ? entry.id : lead;
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
          <SelectionInspector {...panel} />
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

  /*
   * Declared before the early returns below, because a hook has to run on every
   * render of this component and "no selection" is one of them.
   *
   * OPENS ON STYLE when a host mounts with a state already chosen. A binding
   * naming a non-base state is a host restoring what an author was editing, and
   * this panel's contract is that such a state and `Canvas.forcedState` are the
   * same value — so opening on Content would leave the canvas drawing a block
   * mid-hover with the only control that explains or clears it behind a tab
   * nobody was told to open. The tab handler cannot catch that: it fires on a
   * CHANGE, and a mount is not one.
   *
   * Honouring the state rather than clearing it, for the reason the multi-
   * selection case does the same: the host asked for it deliberately, and
   * resetting would silently discard what it restored.
   */
  const [tab, setTab] = React.useState<string>(() => openingTabFor(styleState));
  // A list's sort asked for from its canvas note is on the Content tab, so
  // the author is taken there, once per ask, from wherever they were.
  // Each ask moves the tab once: a new style-state setter is no new ask.
  const asked = editor.sortFieldAsked?.seq;
  const onStyleStateChange = styleState?.onChange;
  const answeredAsk = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (asked === undefined || asked === answeredAsk.current) return;
    answeredAsk.current = asked;
    tabChangeHandler(setTab, onStyleStateChange)("content");
  }, [asked, onStyleStateChange]);

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
    canvasRoot
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
        `key` on the node id would reset it on every click.
      */}
      <Tabs
        value={tab}
        onValueChange={tabChangeHandler(setTab, styleState?.onChange)}
        className="nx-inspector__tabs"
      >
        {/* Compact underlined tabs at the start of the panel; the classes
            carry the inspector's own tab rules over the shared tabs'. */}
        <TabsList className="nx-inspector__tablist">
          {INSPECTOR_TABS.map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="nx-inspector__tab"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/*
          FORCE-MOUNTED, because Content holds Advanced, and Advanced holds a
          draft: unmounting it threw away what the author had typed and the
          reason a refused row was not saved. HIDDEN here rather than left to
          Radix, which ties mounting and visibility together — `forceMount`
          alone would draw Content under Style as well — and `hidden` takes it
          out of the accessibility tree exactly as an unmounted panel was.
        */}
        <TabsContent value="content" forceMount hidden={tab !== "content"}>
          <ContentTab
            block={block}
            editor={editor}
            onCommit={commit}
            inspectors={inspectors}
            services={contentServices}
            blocks={blocks}
            onScreen={tab === "content"}
            reasonId={reasonId}
            fields={fields}
            breakpoints={styleOnly.breakpoints}
            breakpoint={breakpoint ?? BASE_BREAKPOINT}
            breakpointsStatus={breakpointsStatus}
          />
        </TabsContent>

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
      </Tabs>
    </div>
  );
}

/**
 * The Content tab: the block's own fields, then its Advanced section with the
 * CSS id and custom attributes.
 */
function ContentTab({
  block,
  editor,
  onCommit: commit,
  inspectors,
  services,
  blocks,
  onScreen,
  reasonId,
  fields,
  breakpoints,
  breakpoint,
  breakpointsStatus,
}: {
  block: BlockInspection;
  editor: EditorState;
  onCommit: (name: string, value: unknown) => BlockDocument | null | void;
  inspectors: BlockInspectorResolver | undefined;
  services: ContentServices | undefined;
  blocks: BlockResolver | undefined;
  /** The id of the lock reason held controls point to, in the card. */
  reasonId: string;
  /** Whether the Content tab is the one showing. */
  onScreen: boolean;
  /** The component's own view, when the document is a component. */
  fields: ComponentFieldsBinding | undefined;
  /** The site's breakpoints, for "Visible on". */
  breakpoints: BreakpointSet | undefined;
  /** The device being edited. */
  breakpoint: BreakpointId;
  /** Whether `breakpoints` is the site's own set yet. */
  breakpointsStatus: BreakpointsStatus;
}): React.JSX.Element {
  // Whether the Advanced section is open, so the panel inside it can be told
  // when it stops being on screen and settle its draft.
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const designLocked = designReadOnlyReason(
    editor.document,
    block.nodeId,
    lockViewOf(editor)
  );

  return (
    <>
      <ContentSurface
        // Keyed by node, so a custom inspector holding local state does not
        // carry one block's draft to the next, as the generated fields do
        // not.
        key={`${block.nodeId}:content`}
        inspection={block}
        editor={editor}
        onCommit={commit}
        inspectors={inspectors}
        services={services}
        reasonId={reasonId}
        fields={fields}
      />
      {/* Which devices the block shows on: after its own fields, before the
          Advanced section, as the design draws the Content tab. */}
      <VisibleOn
        editor={editor}
        nodeId={block.nodeId}
        breakpoints={breakpoints}
        editing={breakpoint}
        status={breakpointsStatus}
        heldBy={designLocked}
        reasonId={reasonId}
      />
      {/* Whether the block shows at all, by the entry or list item it is drawn
          with: beside where it shows, as the design draws the Content tab. */}
      {/* Keyed by the block, so a row added and not yet finished stays with
          the block it was added to rather than moving to the next one. */}
      <ShowWhen
        key={block.nodeId}
        editor={editor}
        nodeId={block.nodeId}
        services={services}
        heldBy={designLocked}
        reasonId={reasonId}
      />
      <details className="nx-inspector__advanced" open={advancedOpen}>
        {/*
        Opened from the summary's own click, which a keyboard's Enter and
        Space also raise, rather than from the element's toggle event:
        that event arrives a task later, and the panel inside must know
        it is on screen in the same render the author opened it.
      */}
        <summary
          onClick={event => {
            event.preventDefault();
            setAdvancedOpen(open => !open);
          }}
        >
          <ChevronRight
            className="nx-inspector__advanced-chevron"
            size={16}
            aria-hidden="true"
          />
          Advanced
        </summary>
        {/*
          Held while the design is locked: every native control inside is
          read-only at once and points at the reason in the card, and the
          panel's own write path refuses what the save would.
        */}
        <HeldByLock
          reasonId={designLocked === undefined ? undefined : reasonId}
        >
          <AdvancedPanel
            // Keyed by node, so a half-typed attribute does not travel to
            // the next block the way an uncommitted name would. The panel
            // holds rows locally; without this an author would select
            // another block and find this one's unsaved row waiting there.
            key={`${block.nodeId}:advanced`}
            nodeId={block.nodeId}
            cssId={block.html.cssId}
            attributes={block.html.attributes}
            editor={editor}
            active={onScreen && advancedOpen}
            blocks={blocks}
          />
        </HeldByLock>
      </details>
    </>
  );
}

/**
 * Where an edit lands, as the bar's second line says it: the devices the
 * value reaches, in words rather than as a breakpoint's id.
 */
function barPlace(
  breakpoints: BreakpointSet | undefined,
  breakpoint: BreakpointId | undefined
): { device: string } {
  return { device: editReach(breakpoints, breakpoint ?? BASE_BREAKPOINT) };
}

/**
 * The State menu the bar carries, bound to the host's choice, or nothing when
 * the host cannot act on one. Its dots read the TARGET's styles (the block's,
 * or the shared style being edited), so a state is marked where the edit goes.
 */
function stateControlFor(
  state: StyleState,
  styleState: StyleStateBinding | undefined,
  holder: { styles?: NodeStyles } | null,
  breakpoints: BreakpointSet | undefined
): React.JSX.Element | undefined {
  if (styleState?.onChange === undefined) return undefined;
  return (
    <StyleStateField
      state={state}
      onSelect={styleState.onChange}
      node={holder}
      breakpoints={breakpoints}
    />
  );
}

/**
 * The Style tab: the bar that says what an edit changes, then the style
 * controls themselves.
 */
function StyleTab({
  editor,
  styleNode,
  renderedTag,
  renderedPicture,
  renderedPicturePosition,
  sideOrientation,
  styleState,
  policy,
  breakpoint,
  cascade,
  breakpoints,
  previewContainer,
  liveBreakpoints,
  onJumpToBreakpoint,
  tokens,
  fonts,
  // The bar's own inputs, kept together: the library, the host and the verbs.
  ...shared
}: Pick<
  InspectorPanelProps,
  | "editor"
  | "styleState"
  | "policy"
  | "breakpoint"
  | "cascade"
  | "breakpoints"
  | "previewContainer"
  | "liveBreakpoints"
  | "onJumpToBreakpoint"
  | "tokens"
  | "classLibrary"
  | "classLibraryAbsence"
  | "sharedStyles"
  | "verbs"
  | "fonts"
> & {
  styleNode: ReturnType<typeof selectedNode>;
  renderedTag: StyleInspectorPanelProps["renderedTag"];
  renderedPicture: string | undefined;
  renderedPicturePosition: string | undefined;
  sideOrientation: StyleInspectorPanelProps["sideOrientation"];
}): React.JSX.Element {
  const state = editedStyleState(styleState);
  // ONE holder of what an edit changes, read by the bar and the controls.
  const { target, choose, held } = useStyleTarget(
    editor,
    shared.classLibrary,
    shared.sharedStyles
  );
  // The mode the selected block is drawn in, read once for the look tiles and
  // the controls below, so the canvas is watched by one subscription.
  const tokenMode = useCanvasTokenModeAt(editor.selectedId);
  return (
    <>
      {/*
      ABOVE the controls, because it decides what every one of them reads
      and writes. Below them it would be a filter applied after the fact,
      and an author would have edited a value before meeting the thing
      that says which state the value belongs to.
    */}
      <StyleTargetBar
        editor={editor}
        tokens={tokens}
        tokenMode={tokenMode}
        target={target}
        onChoose={choose}
        held={held}
        library={shared.classLibrary}
        libraryAbsence={shared.classLibraryAbsence}
        host={shared.sharedStyles}
        verbs={shared.verbs}
        {...barPlace(breakpoints, breakpoint)}
        breakpoints={breakpoints}
        state={state}
        stateControl={stateControlFor(
          state,
          styleState,
          target.kind === "shared" ? target.style : styleNode,
          breakpoints
        )}
      />
      {/* The picture the canvas draws, for the focal point aimed over it. */}
      <FocalFrame.Provider
        value={{ picture: renderedPicture, position: renderedPicturePosition }}
      >
        <StyleInspectorPanel
          editor={editor}
          tokenMode={tokenMode}
          // The block card above says why a held block can't be changed.
          showReadOnlyReason={false}
          renderedTag={renderedTag}
          sideOrientation={sideOrientation}
          policy={policy}
          state={state}
          breakpoint={breakpoint}
          cascade={cascade}
          breakpoints={breakpoints}
          previewContainer={previewContainer}
          liveBreakpoints={liveBreakpoints}
          onJumpToBreakpoint={onJumpToBreakpoint}
          tokens={tokens}
          target={target}
          fonts={fonts}
        />
      </FocalFrame.Provider>
    </>
  );
}

/**
 * Set one prop of one node: the one write path every content control shares.
 *
 * The patch is built from the node in `document`, which the caller passes as
 * the document the edit applies to, and the result is returned so a caller
 * making several edits in a row can build the next one on it. The props are
 * copied whole (`propPatch`), so a patch built from an older copy would put
 * back every value an edit since then changed.
 *
 * @returns the document after the edit, or `null` when it was not applied
 */
function commitProp(
  editor: EditorState,
  document: BlockDocument,
  id: string,
  name: string,
  value: unknown
): BlockDocument | null {
  // Refused here, for every caller: a lock set after a field drew must still
  // stop the write, and inside a `contentOnly` area only content may change.
  if (!propIsWritable(document, id, name, lockViewOf(editor))) return null;
  const node = findNode(document.nodes, id);
  if (node === undefined) return null;
  return editor.apply({
    kind: "update",
    id,
    patch: propPatch(node, name, value),
  });
}

/**
 * The Content tab: the block's own inspector where it names one the host
 * loaded, and the generated fields otherwise.
 *
 * Only the content controls are replaced. The identity fields above the tabs,
 * the Advanced tab's CSS id and attributes and the whole Style tab are drawn
 * for every block, so a plugin's inspector cannot lose them.
 */
function ContentSurface({
  inspection,
  editor,
  onCommit,
  inspectors,
  services,
  reasonId,
  fields,
}: {
  inspection: BlockInspection;
  editor: EditorState;
  onCommit: (name: string, value: unknown) => BlockDocument | null | void;
  inspectors: BlockInspectorResolver | undefined;
  services: ContentServices | undefined;
  reasonId: string;
  /** The component's own view, when the document is a component. */
  fields: ComponentFieldsBinding | undefined;
}): React.JSX.Element {
  // A block's own inspector knows nothing of bindings visitors will not see,
  // so beside one, every such binding on the block is said above it.
  const unreadable = useVisitorUnreadable(inspection.nodeId);
  const generated = (
    <ContentFields
      inspection={inspection}
      onCommit={onCommit}
      services={services}
      reasonId={reasonId}
      fields={fields}
      writable={name =>
        propIsWritable(
          editor.document,
          inspection.nodeId,
          name,
          lockViewOf(editor)
        )
      }
      onCommitMany={changes =>
        commitLinkChanges(editor, inspection.nodeId, changes)
      }
      // A binding's edits, applied as any other edit of the block.
      // Whether the editor took it: a refused edit is said, not assumed.
      onApply={op => editor.apply(op) !== null}
      document={editor.document}
      listView={listViewOf(editor, inspection.nodeId)}
    />
  );
  const Custom =
    inspection.inspector === undefined
      ? undefined
      : inspectors?.(inspection.inspector);
  const visibility =
    fields === undefined ? null : (
      <VisibilityExposeControl
        binding={fields}
        nodeId={inspection.nodeId}
        blockName={inspection.label}
      />
    );
  if (Custom === undefined) {
    return (
      <>
        {visibility}
        {generated}
      </>
    );
  }
  return (
    <>
      {visibility}
      <VisitorUnreadableNote
        bindings={unreadable}
        props={new Set(unreadable.map(binding => binding.prop))}
        // A library fallback named by its file, as the image row names it.
        services={services}
      />
      <CustomInspectorBoundary fallback={generated}>
        <CustomInspector
          Inspector={Custom}
          nodeId={inspection.nodeId}
          editor={editor}
        />
        {/*
          A block's own inspector draws its own controls and knows nothing of
          exposing them, so in a component's view its props are listed again
          beneath it, each with its switch.
        */}
        {fields === undefined ? null : (
          <ExposeRows inspection={inspection} fields={fields} />
        )}
      </CustomInspectorBoundary>
    </>
  );
}

/** Each prop's expose switch, for a block whose own inspector draws its controls. */
function ExposeRows({
  inspection,
  fields,
}: {
  inspection: BlockInspection;
  fields: ComponentFieldsBinding;
}): React.JSX.Element {
  return (
    <div className="nx-inspector__fields" data-expose-rows="">
      {inspection.props.map(prop => (
        <div
          key={`${inspection.nodeId}:${prop.name}:expose`}
          className="nx-inspector__prop"
        >
          <p className="nx-inspector__note">{fieldLabel(prop.name)}</p>
          <PropExposeControl
            binding={fields}
            nodeId={inspection.nodeId}
            prop={prop}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * A block's own inspector, given the contract every one is given.
 *
 * `commit` is the generated controls' own write path, addressed to THIS node
 * rather than to whatever is selected when it is called, with one guard in
 * front, asked of the document at the moment of the call: nothing is written
 * to a locked block, and inside a `"contentOnly"` area only its content props
 * are. `readOnly` tells the component to draw itself disabled, but the
 * component is plugin code, and a lock that held only while the plugin
 * honoured a flag would not be a lock. So the refusal is here, whatever the
 * component does with the flag.
 */
function CustomInspector({
  Inspector,
  nodeId,
  editor,
}: {
  Inspector: React.ComponentType<BlockInspectorProps>;
  nodeId: string;
  editor: EditorState;
}): React.JSX.Element | null {
  /*
   * The editor and the document every commit reads, held where any copy of
   * `commit` sees the latest.
   *
   * A component may commit twice in one handler, before the panel re-renders,
   * or hold `commit` across an await while the document moves on. Either way
   * the render's `editor.document` is out of date when the call runs, and a
   * patch built from it would put back what changed in between (`propPatch`
   * copies the props whole) and miss a lock set meanwhile. So each render
   * publishes its editor here, each commit advances the document to what its
   * own write produced, and the callback itself never changes.
   */
  const live = React.useRef({ editor, document: editor.document });
  useIsomorphicLayoutEffect(() => {
    live.current = { editor, document: editor.document };
  }, [editor]);
  const commit = React.useCallback(
    (name: string, value: unknown): void => {
      const { editor: current, document } = live.current;
      if (!propIsWritable(document, nodeId, name, lockViewOf(current))) {
        return;
      }
      const next = commitProp(current, document, nodeId, name, value);
      if (next !== null) live.current = { editor: current, document: next };
    },
    [nodeId]
  );
  const node = findNode(editor.document.nodes, nodeId);
  if (node === undefined) return null;
  return (
    <div className="nx-inspector__fields" data-inspector="custom">
      <Inspector
        node={node}
        props={node.props}
        commit={commit}
        readOnly={blockIsReadOnly(editor.document, nodeId)}
      />
    </div>
  );
}

/**
 * Keeps a plugin inspector that throws from taking the editor down with it.
 *
 * The generated controls are drawn instead, with a note, so the author can go
 * on editing the block: a broken plugin component is a reason to lose its
 * nicer controls, never the block's content.
 */
class CustomInspectorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <>
        <p className="nx-inspector__note" role="status">
          This block&apos;s own controls could not be shown, so its standard
          controls are shown instead.
        </p>
        {this.props.fallback}
      </>
    );
  }
}

/** Whether the canvas draws a list's empty state, and the way to switch it. */
interface ListView {
  readonly showsEmpty: boolean;
  readonly onShowEmpty: (empty: boolean) => void;
  /** The count of the latest ask to fix this list's sort, when it has one. */
  readonly sortFieldAsked: number | undefined;
  /** Tag the list on the canvas while a new source waits for an input. */
  readonly onStillShowing: ((words: string | undefined) => void) | undefined;
}

/** A block's list view, where the editor keeps one. */
function listViewOf(editor: EditorState, nodeId: string): ListView | undefined {
  const show = editor.showListEmpty;
  if (show === undefined) return undefined;
  return {
    showsEmpty: editor.listsShowingEmpty?.has(nodeId) === true,
    onShowEmpty: empty => show(nodeId, empty),
    sortFieldAsked:
      editor.sortFieldAsked?.id === nodeId
        ? editor.sortFieldAsked.seq
        : undefined,
    onStillShowing:
      editor.tagListStillShowing === undefined
        ? undefined
        : words => editor.tagListStillShowing?.(nodeId, words),
  };
}

/** What a group is told of the list view: none drawn empty when none is kept. */
function listGroupView(listView: ListView | undefined): {
  showsEmpty: boolean;
  onShowEmpty: ListView["onShowEmpty"] | undefined;
  sortFieldAsked: number | undefined;
  onStillShowing: ListView["onStillShowing"];
} {
  return {
    showsEmpty: listView?.showsEmpty === true,
    onShowEmpty: listView?.onShowEmpty,
    sortFieldAsked: listView?.sortFieldAsked,
    onStillShowing: listView?.onStillShowing,
  };
}

/** The Content tab: one field per declared prop, or the note that there are none. */
function ContentFields({
  inspection,
  onCommit,
  services,
  reasonId,
  fields,
  writable,
  onCommitMany,
  document,
  listView,
  onApply,
}: {
  inspection: BlockInspection;
  /** Apply one op as an edit: a binding's, which writes props and bindings at once. */
  onApply: (op: BuilderOp) => boolean;
  /** The document the block is in, for a group that reads around it. */
  document: BlockDocument;
  /** Whether the canvas draws this block's empty state, and the switch. */
  listView?: ListView | undefined;
  onCommit: (name: string, value: unknown) => BlockDocument | null | void;
  /** Several props written as one edit, for a block's prop groups. */
  onCommitMany: (
    changes: Readonly<Record<string, unknown>>
  ) => BlockDocument | null | void;
  services: ContentServices | undefined;
  /** The id of the lock reason a held field points to. */
  reasonId: string;
  /**
   * Whether one prop may be set: not on a locked block, and inside a
   * `contentOnly` area only for content props. The same rule the commit and
   * the save apply, asked so the field is drawn read-only rather than met with
   * a refusal.
   */
  writable: (name: string) => boolean;
  /** The component's own view, when the document is a component. */
  fields?: ComponentFieldsBinding | undefined;
}): React.JSX.Element {
  // The bindings on this block a visitor will not see filled, each said under
  // the field that draws its prop.
  const unreadable = useVisitorUnreadable(inspection.nodeId);
  // The block's bindings as the document holds them, so a bound prop draws
  // its chip in place of its own control.
  const bindings = findNode(document.nodes, inspection.nodeId)?.bindings;
  // A prop the inspector leaves out draws no control, but in a component's
  // view keeps its expose icon: a page may clear what hides it.
  const drawn = inspection.props.filter(
    prop => prop.offered || fields !== undefined
  );
  if (drawn.length === 0) {
    return (
      <p className="nx-inspector__note">
        This block has no editable properties.
      </p>
    );
  }
  // What the block holds, for a control whose choices depend on another of
  // its props: a loop's sort offers its collection's fields.
  const values = Object.fromEntries(
    inspection.props.map(prop => [prop.name, prop.value])
  );
  // Props an author reads as one thing (a link and what qualifies it, an
  // image's source, its alt text) are drawn as one group, where the group's
  // lead prop sits; the others it draws get no row of their own. Built from
  // the props the block offers, so a sibling its own `onlyWithout` hides is
  // neither drawn nor written by a group.
  const groups = propGroupsOf(inspection.props.filter(prop => prop.offered));
  const leads = new Map(groups.map(group => [group.lead, group]));
  const grouped = new Set(groups.flatMap(group => [...group.drawn]));
  // A group's prop wrapped in the same binding controls a prop on its own
  // row gets, for the props the group offers: one chip, one menu and one
  // note for every bindable prop, wherever it is drawn.
  const bindableIn = (offered: ReadonlySet<string>): BindableWrapper =>
    function wrapBindable(lead, field, options) {
      const entry = options?.entryLink;
      const name = drawnBinding(lead, entry, bindings, inspection.props);
      const prop = inspection.props.find(each => each.name === name);
      // Offered by the group's lead: a bound entry id is drawn in its place.
      if (prop === undefined || !prop.offered || !offered.has(lead)) {
        return field;
      }
      const clears = options?.clearsOnBind ?? [];
      return (
        <BindableField
          nodeId={inspection.nodeId}
          prop={prop}
          blockLabel={inspection.label}
          binding={bindings?.[name]}
          entryLink={entry}
          document={document}
          services={services}
          disabled={!writable(name)}
          onApply={onApply}
          clearsOnBind={clears}
          // The props a bind would empty that may not be written here: a
          // bind or a change that would empty one is held, while the
          // fallback and the unbind, which empty nothing, stay offered.
          clearsLocked={clears.filter(each => !writable(each))}
        >
          {field}
        </BindableField>
      );
    };
  return (
    <div className="nx-inspector__fields">
      {drawn.map(prop => {
        const group = leads.get(prop.name);
        if (group === undefined && grouped.has(prop.name)) {
          // Drawn inside its group, but in a component's view still a prop of
          // its own to expose: named, with its icon, as a prop the inspector
          // leaves out is, so a placement may still set it.
          return fields === undefined ? null : (
            <div
              key={`${inspection.nodeId}:${prop.name}`}
              className="nx-inspector__prop"
            >
              <p className="nx-inspector__note">
                {propLabel(prop.name, prop.schema)}
              </p>
              <PropExposeControl
                binding={fields}
                nodeId={inspection.nodeId}
                prop={prop}
              />
            </div>
          );
        }
        const groupField =
          group === undefined ? undefined : (
            <React.Fragment key={`${inspection.nodeId}:${prop.name}`}>
              {group.render({
                props: inspection.props,
                writable,
                reasonId,
                services,
                placedWith: inspection.placedWith,
                onCommitMany,
                document,
                nodeId: inspection.nodeId,
                ...listGroupView(listView),
                bindable: bindableIn(group.bindable),
              })}
            </React.Fragment>
          );
        // Under the field: the props it draws whose bound value a visitor
        // will not see, a group's included.
        const note = (
          <VisitorUnreadableNote
            bindings={unreadable}
            props={group === undefined ? new Set([prop.name]) : group.drawn}
            // A library fallback named by its file, as the image row names it.
            services={services}
          />
        );
        // Named as the block names it, so its icon is not drawn bare.
        const field = !prop.offered ? (
          <p className="nx-inspector__note">
            {propLabel(prop.name, prop.schema)}
          </p>
        ) : (
          (groupField ?? (
            <HeldByLock
              // Keyed by node AND prop: a bare prop name would let React reuse
              // one block's field for the next block's same-named prop, so the
              // input would keep the previous block's uncommitted text.
              key={`${inspection.nodeId}:${prop.name}`}
              // A held field points at the reason in the card.
              reasonId={writable(prop.name) ? undefined : reasonId}
            >
              <BindableField
                nodeId={inspection.nodeId}
                prop={prop}
                blockLabel={inspection.label}
                binding={bindings?.[prop.name]}
                document={document}
                services={services}
                disabled={!writable(prop.name)}
                onApply={onApply}
              >
                <PropField
                  prop={prop}
                  disabled={!writable(prop.name)}
                  onCommit={onCommit}
                  services={services}
                  values={values}
                />
              </BindableField>
            </HeldByLock>
          ))
        );
        if (fields === undefined) {
          // Always a fragment under one key, so a note appearing or going
          // never remounts the field above it and its uncommitted text.
          return (
            <React.Fragment key={`${inspection.nodeId}:${prop.name}`}>
              {field}
              {note}
            </React.Fragment>
          );
        }
        // The switch sits OUTSIDE the lock's fieldset: a prop a lock holds is
        // still one a designer may try to expose, and the refusal that says
        // why is the answer they need, which a disabled switch would withhold.
        return (
          <div
            key={`${inspection.nodeId}:${prop.name}`}
            className="nx-inspector__prop"
          >
            {field}
            {note}
            <PropExposeControl
              binding={fields}
              nodeId={inspection.nodeId}
              prop={prop}
            />
          </div>
        );
      })}
    </div>
  );
}

function PropField({
  prop,
  disabled,
  onCommit,
  services,
  values,
}: {
  prop: EditableProp;
  disabled: boolean;
  onCommit: (name: string, value: unknown) => BlockDocument | null | void;
  services: ContentServices | undefined;
  /** The block's props as stored, for a control that reads another of them. */
  values: Readonly<Record<string, unknown>>;
}): React.JSX.Element {
  // Unique per mount, so two editors on one page never share a field id and a
  // label never points at the other editor's control.
  const id = React.useId();
  const Control = contentControlFor(prop.schema.type);

  if (Control === undefined) {
    return <UnsupportedField prop={prop} />;
  }

  return (
    <Control
      id={id}
      prop={prop}
      disabled={disabled}
      onCommit={onCommit}
      services={services}
      values={values}
    />
  );
}

/**
 * The inspector when several blocks are selected.
 *
 * Says how many, and offers in its menu the one control that is well defined
 * across a set: the lock. From a set that is partly locked, the menu LOCKS
 * everything — the alternative is a first press that appears to do nothing to
 * the blocks that were already unlocked, and every file manager and design
 * tool resolves it the same way.
 *
 * Planned only over the blocks whose own lock may change here. A block inside
 * a `contentOnly` area has its lock pinned by that area, and the edit is
 * applied as one group, so planning it would have the save refuse the whole
 * edit and change none of the others. The card says how many are held and why.
 */
function ManyBlocksPanel({
  editor,
  count,
  lock,
}: {
  editor: EditorState;
  count: number;
  lock: LockState;
}): React.JSX.Element {
  const view = lockViewOf(editor);
  const changeable = editor.selection.ids.filter(id =>
    layersLockChangeable(lockStatusOf(editor.document, id, view))
  );
  // The direction is read from the blocks it would change, so a held block
  // already in the other state cannot leave the menu with nothing to do.
  const unlocking =
    changeable.length > 0 &&
    lockStateOf(editor.document, changeable) === "locked";
  const plan = selectionLock(editor.document, changeable, !unlocking);

  return (
    <div className="nx-inspector" data-selection="many">
      <SelectionCard
        count={count}
        lock={lock}
        unlocking={unlocking}
        held={editor.selection.ids.length - changeable.length}
        onLock={plan === null ? undefined : () => editor.applyAll(plan.ops)}
      />
      <p className="nx-inspector__note">
        Editing properties across several blocks is not available yet. Select
        one block to edit what it holds.
      </p>
    </div>
  );
}

/**
 * The devices an edit at one tier reaches: the unconditional tier reaches
 * "All devices"; a narrower one reaches itself and every narrower one on its
 * axis ("Tablet and smaller"), or only itself when it is the narrowest
 * ("Mobile"). Read from the site's own breakpoints in the engine's order
 * (`breakpointContexts`: each axis widest first), named by each definition's
 * own label, so a site with its own breakpoints is described in its words.
 */
function editReach(
  breakpoints: BreakpointSet | undefined,
  id: BreakpointId
): string {
  if (id === BASE_BREAKPOINT) return "All devices";
  const contexts = breakpointContexts(breakpoints);
  const at = contexts.findIndex(context => context.id === id);
  const label = breakpointLabel(breakpoints, id);
  if (at === -1) return label;
  const axis = contexts[at]?.axis;
  const narrower = contexts
    .slice(at + 1)
    .some(context => context.axis === axis);
  return narrower ? `${label} and smaller` : label;
}
