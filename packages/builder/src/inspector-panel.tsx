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
  findNode,
  type BreakpointId,
  type BreakpointSet,
  type ComponentLookup,
  type SiteTokenSet,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import type { BlockResolver, PageStyleCascade } from "@nextlyhq/blocks-react";
import {
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@nextlyhq/ui";
import * as React from "react";

import { AdvancedPanel } from "./advanced-panel";
import type { EditorState } from "./editor-state";
import { IdentityFields } from "./identity-fields";
import type { SavedComponent } from "./inserter";
import {
  fieldLabel,
  inspectSelection,
  lockStateOf,
  propPatch,
  selectedNode,
  type BlockInspection,
  type EditableProp,
  type LockState,
} from "./inspector";
import { inspectInstance, type InstanceInspection } from "./instance-inspector";
import { InstanceInspectorPanel } from "./instance-inspector-panel";
import { selectionLock } from "./selection-ops";
import { StyleStateField } from "./state-switcher";
import { useStoredDraft } from "./stored-draft";
import {
  StyleInspectorPanel,
  type StyleInspectorPanelProps,
} from "./style-inspector-panel";
import type { StylePolicy } from "./style-values";
import { useCanvasReading } from "./use-canvas-reading";

export interface StyleStateBinding {
  /** The state being edited. `base` when omitted. */
  state?: StyleState | undefined;
  /** Choose a different one. Omitted withholds the control. */
  onChange?: ((state: StyleState) => void) | undefined;
}

export interface InspectorPanelProps {
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
   * {@link StyleInspectorPanelProps.classLibrary}.
   *
   * Forwarded rather than left out because a prop the chain drops is invisible:
   * the surface renders in isolation, its tests pass, and every real selection
   * in the shipped editor shows nothing.
   */
  classLibrary?: StyleInspectorPanelProps["classLibrary"];
  /** Why the library is absent, when it is. Carried, not interpreted. */
  classLibraryAbsence?: StyleInspectorPanelProps["classLibraryAbsence"];
  /** Create a class and apply it to the selected block. Opts the surface in. */
  onCreateClass?: StyleInspectorPanelProps["onCreateClass"];
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
}

/** What the inspector needs of the host's component read. */
export interface ComponentLibrary {
  /** The definitions the canvas resolves instances against, keyed by id. */
  readonly definitions: ComponentLookup;
  /** The library's rows, the only holder of a definition's title and usage. */
  readonly components: readonly SavedComponent[];
}

/**
 * Which half of the inspector is showing.
 *
 * Two tabs rather than a second rail: two rails meaning different things is the
 * ambiguity this editor's layout rulings have consistently removed, and the
 * inspector is already the region that answers "what is selected".
 */
const INSPECTOR_TABS = [
  { value: "content", label: "Content" },
  { value: "style", label: "Style" },
  /*
   * Last, and named for what it is rather than for what it holds. An author
   * reaching for a `data-` attribute or an anchor id is leaving the modelled
   * surface behind, and putting that beside Content would invite it as an
   * ordinary next step. Every editor with this surface separates it the same
   * way, and the one this replaces did too.
   */
  { value: "advanced", label: "Advanced" },
] as const;

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
    library.components
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
  inspection: BlockInspection | null
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
      tabless: <InstanceInspectorPanel inspection={instance} editor={editor} />,
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
   */
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

export function InspectorPanel({
  editor,
  canvasRoot,
  classLibrary,
  classLibraryAbsence,
  onCreateClass,
  policy,
  styleState,
  breakpoint,
  cascade,
  breakpoints,
  previewContainer,
  liveBreakpoints,
  onJumpToBreakpoint,
  tokens,
  blocks,
  componentLibrary,
}: InspectorPanelProps): React.JSX.Element {
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
  const inspection = inspectSelection(editor.document, editor.selectedId);
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

  const commit = React.useCallback(
    (name: string, value: unknown) => {
      const id = editor.selectedId;
      if (id === null) return;
      // Read the node at commit time rather than closing over one. A field
      // committing on blur can fire after another edit has already replaced the
      // node, and patching from the older copy would resurrect its props.
      const node = findNode(editor.document.nodes, id);
      if (node === undefined) return;
      editor.apply({ kind: "update", id, patch: propPatch(node, name, value) });
    },
    [editor]
  );

  const surface = surfaceFor(editor, instance, inspection);
  if ("tabless" in surface) return surface.tabless;
  const block = surface.block;

  return (
    <div className="nx-inspector">
      <h2 className="nx-inspector__title">{block.label}</h2>

      {/*
        What the block IS, above what it holds.

        First because it answers "which block am I looking at" — a page with six
        headings gives an author six identical inspector titles, and the name is
        the only thing that tells them apart. Both fields are also the two the
        layers panel already shows, so this is where that display gets a writer.

        Above the tabs rather than inside Content, because it describes the block
        under both of them: an author on the Style tab still needs to know which
        of six headings they are looking at.
      */}
      <IdentityFields
        // Keyed by node so the name input does not carry an uncommitted edit
        // across a selection change, exactly as the prop fields are.
        key={`${block.nodeId}:identity`}
        nodeId={block.nodeId}
        identity={block.identity}
        editor={editor}
      />

      {/*
        Held HERE, so the chosen tab survives a change of selection — an author
        styling one block after another means to stay on Style. This element's
        position does not change, so the state lives across every selection; a
        `key` on the node id would reset it on every click.

        Controlled rather than left to Radix because the Advanced tab has to be
        told when it stops being the one on screen: it is force-mounted, so its
        own removal no longer tells it.
      */}
      <Tabs
        value={tab}
        onValueChange={tabChangeHandler(setTab, styleState?.onChange)}
        className="nx-inspector__tabs"
      >
        <TabsList>
          {INSPECTOR_TABS.map(tab => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="content">
          <ContentFields inspection={block} onCommit={commit} />
        </TabsContent>

        <TabsContent value="style">
          {/*
            ABOVE the controls, because it decides what every one of them reads
            and writes. Below them it would be a filter applied after the fact,
            and an author would have edited a value before meeting the thing
            that says which state the value belongs to.

            Whether it appears at all is the FIELD's own decision — see
            `StyleStateField`, which withholds itself from a host that cannot
            carry the choice to its canvas.
          */}
          <StyleStateField
            state={editedStyleState(styleState)}
            onSelect={styleState?.onChange}
            node={styleNode}
            breakpoints={breakpoints}
          />
          <StyleInspectorPanel
            editor={editor}
            renderedTag={canvas.tag}
            sideOrientation={canvas.orientation}
            policy={policy}
            state={editedStyleState(styleState)}
            breakpoint={breakpoint}
            cascade={cascade}
            breakpoints={breakpoints}
            previewContainer={previewContainer}
            liveBreakpoints={liveBreakpoints}
            onJumpToBreakpoint={onJumpToBreakpoint}
            tokens={tokens}
            classLibrary={classLibrary}
            classLibraryAbsence={classLibraryAbsence}
            onCreateClass={onCreateClass}
          />
        </TabsContent>

        {/*
          FORCE-MOUNTED, alone among the three. The other two hold controls that
          write on the spot; this one holds a draft, and unmounting it threw
          away both what the author had typed and the reason a refused row was
          not saved.

          HIDDEN here rather than left to Radix, which ties the two together:
          `TabsContent` renders `hidden={!present}` where `present` is
          `forceMount || isSelected`, so asking it to stay mounted also tells it
          it is on screen — and the Advanced fields appeared under Content and
          Style as well. Keeping the mount and stating the visibility separately
          is what was actually wanted, and `hidden` takes it out of the
          accessibility tree exactly as an unmounted panel was.
        */}
        <TabsContent value="advanced" forceMount hidden={tab !== "advanced"}>
          <AdvancedPanel
            // Keyed by node, so a half-typed attribute does not travel to the
            // next block the way an uncommitted name would. The panel holds
            // rows locally; without this an author would select another block
            // and find this one's unsaved row waiting there.
            key={`${block.nodeId}:advanced`}
            nodeId={block.nodeId}
            cssId={block.html.cssId}
            attributes={block.html.attributes}
            editor={editor}
            active={tab === "advanced"}
            blocks={blocks}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** The Content tab: one field per declared prop, or the note that there are none. */
function ContentFields({
  inspection,
  onCommit,
}: {
  inspection: BlockInspection;
  onCommit: (name: string, value: unknown) => void;
}): React.JSX.Element {
  if (inspection.props.length === 0) {
    return (
      <p className="nx-inspector__note">
        This block has no editable properties.
      </p>
    );
  }
  return (
    <div className="nx-inspector__fields">
      {inspection.props.map(prop => (
        <PropField
          // Keyed by node AND prop: a bare prop name would let React reuse one
          // block's field for the next block's same-named prop, so the input
          // would keep the previous block's uncommitted text.
          key={`${inspection.nodeId}:${prop.name}`}
          prop={prop}
          onCommit={onCommit}
        />
      ))}
    </div>
  );
}

function PropField({
  prop,
  onCommit,
}: {
  prop: EditableProp;
  onCommit: (name: string, value: unknown) => void;
}): React.JSX.Element {
  const id = `nx-prop-${prop.name}`;

  if (!prop.supported) {
    return (
      <div className="nx-inspector__field" data-unsupported="">
        <Label htmlFor={id}>{fieldLabel(prop.name)}</Label>
        {/*
          Listed rather than omitted. A block declaring a prop this panel cannot
          draw is still a block with that prop, and hiding it presents an
          incomplete block as a complete one — an author would conclude the
          field does not exist rather than that it is edited elsewhere.
        */}
        <p className="nx-inspector__note">
          Not editable here ({prop.schema.type}).
        </p>
      </div>
    );
  }

  if (prop.schema.type === "checkbox") {
    return (
      <div className="nx-inspector__field nx-inspector__field--inline">
        <Checkbox
          id={id}
          checked={prop.value === true}
          onCheckedChange={checked => onCommit(prop.name, checked === true)}
        />
        <Label htmlFor={id}>{fieldLabel(prop.name)}</Label>
      </div>
    );
  }

  if (prop.schema.type === "select") {
    return (
      <div className="nx-inspector__field">
        <Label htmlFor={id}>{fieldLabel(prop.name)}</Label>
        <Select
          value={typeof prop.value === "string" ? prop.value : undefined}
          onValueChange={next => onCommit(prop.name, next)}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {prop.options.map(option => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return <TextishField id={id} prop={prop} onCommit={onCommit} />;
}

/** A prop's value as editable text, or empty when it is not representable. */
function storedText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * A field the author types into: text, textarea, url, number.
 *
 * Holds its own value while focused so typing is responsive, and reports it on
 * blur. Reading straight from the node would make every keystroke a document
 * edit; reporting only on blur without local state would make the field refuse
 * to show what was typed.
 */
function TextishField({
  id,
  prop,
  onCommit,
}: {
  id: string;
  prop: EditableProp;
  onCommit: (name: string, value: unknown) => void;
}): React.JSX.Element {
  // Only a primitive becomes text. `String({})` is "[object Object]", and a
  // field showing that would COMMIT it on blur — turning a prop the panel
  // cannot represent into a string that permanently replaces it. An
  // unrepresentable value shows empty and, because `send` compares against
  // this, an untouched field writes nothing.
  const stored = storedText(prop.value);
  const [draft, setDraft] = useStoredDraft(stored);

  const send = () => {
    if (draft === stored) return;
    if (prop.schema.type === "number") {
      const parsed = Number(draft);
      // A number field that cannot parse reverts rather than writing NaN, which
      // survives JSON as `null` and reaches the renderer as a missing prop.
      if (draft.trim() === "" || Number.isNaN(parsed)) {
        setDraft(stored);
        return;
      }
      onCommit(prop.name, parsed);
      return;
    }
    onCommit(prop.name, draft);
  };

  const shared = {
    id,
    value: draft,
    onBlur: send,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => setDraft(event.target.value),
  };

  return (
    <div className="nx-inspector__field">
      <Label htmlFor={id}>{fieldLabel(prop.name)}</Label>
      {prop.schema.type === "textarea" ? (
        <Textarea {...shared} rows={3} />
      ) : (
        <Input
          {...shared}
          type={prop.schema.type === "number" ? "number" : "text"}
          inputMode={prop.schema.type === "url" ? "url" : undefined}
          // Enter commits as well as blur. A single-line field is where an
          // author expects Enter to mean "done", and waiting for them to click
          // elsewhere leaves the canvas stale after a deliberate action.
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * The inspector when several blocks are selected.
 *
 * Says how many, and offers the one control that is well defined across a set:
 * the lock. A tri-state checkbox rather than a two-state one, because "some of
 * these are locked" is a real state and showing it as either on or off tells
 * the author something false about half of their selection.
 *
 * From `mixed`, the first press LOCKS everything. The alternative — unlocking —
 * is a first press that appears to do nothing to the blocks that were already
 * unlocked, and every file manager and design tool resolves it the same way.
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
  const plan = selectionLock(
    editor.document,
    editor.selection.ids,
    // Mixed locks; locked unlocks; unlocked locks.
    lock !== "locked"
  );

  return (
    <div className="nx-inspector" data-selection="many">
      <h2 className="nx-inspector__title">{count} blocks selected</h2>

      <div className="nx-inspector__identity">
        <label className="nx-inspector__check">
          <input
            type="checkbox"
            checked={lock === "locked"}
            // `indeterminate` is a DOM property with no HTML attribute, so it
            // is set through a ref rather than declared. `aria-checked` carries
            // the same fact to assistive technology, which reads the attribute
            // and never the property.
            ref={element => {
              if (element !== null) element.indeterminate = lock === "mixed";
            }}
            aria-checked={lock === "mixed" ? "mixed" : lock === "locked"}
            onChange={() => {
              if (plan === null) return;
              editor.applyAll(plan.ops);
            }}
          />
          Lock these blocks
        </label>
      </div>

      <p className="nx-inspector__note">
        Editing properties across several blocks is not available yet. Select
        one block to edit what it holds.
      </p>
    </div>
  );
}
