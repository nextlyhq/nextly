"use client";

/**
 * The Style tab: editing the selected block's style values.
 *
 * Draws what `style-inspector` decides and decides nothing itself — which
 * sections a block offers, which properties sit in each, and which control each
 * property draws all live there, where they can be asserted without a DOM.
 *
 * **One section open at a time.** The choice is remembered across selections
 * rather than reset, because an author working on spacing selects one block
 * after another and means to stay on spacing; it falls back to the first
 * section only when the newly selected block does not offer the open one.
 *
 * **Text commits on blur, discrete controls immediately**, the same rule the
 * content tab follows and for the same reason: undo is built from op inverses,
 * so an op per keystroke would make one undo remove one character.
 *
 * **Clearing is not writing an empty value.** An emptied field removes the
 * entry, so the property falls back through the cascade to whatever a class, a
 * block default or a wider breakpoint set — which is what an author asking to
 * reset a control means. Writing `""` would instead pin the property to nothing
 * here and beat the tier they wanted back.
 *
 * **A refused value is shown, not swallowed.** The catalog's own message sits
 * under the control that produced it, because a field that silently keeps its
 * old value after an edit reads as an editor that dropped the keystroke.
 *
 * @module style-inspector-panel
 */

import {
  findNode,
  isTokenRef,
  trimCssWhitespace,
  walkNodes,
  type BreakpointId,
  type BreakpointSet,
  type ContrastResult,
  type NamedClass,
  type NodeStyles,
  type SiteTokenSet,
  type TokenMode,
  type StyleLeaf,
  type StyleShape,
  type StyleOrigin,
  type StyleState,
  type StyleSubject,
  type StyleTraceEntry,
  type StyleValue,
  previewContainerName,
} from "@nextlyhq/blocks-engine";
import type { PageStyleCascade } from "@nextlyhq/blocks-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ColorPicker,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import * as React from "react";

import { batchStyleClearOps, batchStyleWriteOps } from "./batch-style";
import { breakpointQueries, matchedBreakpoints } from "./breakpoints";
import { ClassSelector, type ClassSelectorProps } from "./class-selector";
import { commitOnEnter } from "./commit-on-enter";
import type { EditorState } from "./editor-state";
import { fieldLabel } from "./inspector";
import type { BuilderOp } from "./ops";
import {
  activeTokenMode,
  colourHexOf,
  colourShowable,
  colourTokenFor,
  colourTokenLabel,
  colourTokensFor,
  contrastAtLeaf,
  contrastObscuredAbove,
  contrastObscuredIn,
  contrastPartnerOf,
  contrastRatioText,
  type ColourToken,
} from "./style-colour";
import type {
  StyleControl,
  StyleControlKind,
  StyleControlVariants,
} from "./style-controls";
import {
  inspectStyle,
  type InspectedStyleProperty,
  type StyleSection,
  type StyleInspection,
} from "./style-inspector";
import {
  CSS_NUMBER,
  measurementOfText,
  steppedValue,
  toggleOptionsFor,
  toggleShows,
  unitChoicesFor,
  withUnit,
} from "./style-numeric";
import {
  breakpointBadge,
  breakpointSource,
  propertiesWriting,
  styleProvenance,
  type BreakpointBadge,
  type BreakpointSource,
  type StyleProvenance,
} from "./style-provenance";
import { styleSubjectFor } from "./style-subject";
import {
  readStyleValue,
  type StyleAddress,
  type StylePolicy,
} from "./style-values";

/**
 * Where one control's value came from, asked per control against a subject and a
 * trace the panel resolved ONCE.
 *
 * A function rather than a precomputed map because the key would have to be the
 * control's CSS property AND its descendant selector — the catalog writes
 * `color` from three different controls — and a map keyed on that pair is a
 * second spelling of the filter `styleProvenance` already applies.
 *
 * `undefined` means nothing can answer, which is not the same as "unset".
 */
/** What one control knows about where its value came from, and what to do. */
interface ProvenanceAnswer {
  provenance: StyleProvenance;
  badge: BreakpointBadge;
  /**
   * Move the canvas to the tier this control's value came from.
   *
   * Carried per LEAF rather than threaded as its own prop, because the
   * target is this control's own source: a different control on the same
   * panel jumps somewhere else. Bundling it here also keeps three
   * intermediate components from gaining a prop they only pass on.
   *
   * Absent when the host supplies no handler, which is a host that cannot
   * move its canvas — and a button that does nothing reads as broken rather
   * than as missing.
   */
  jump?: () => void;
}

type ProvenanceOf = (leaf: StyleLeaf) => ProvenanceAnswer | undefined;

export interface StyleInspectorPanelProps {
  /**
   * The editor whose selected block this styles.
   *
   * The whole state rather than a document and an `apply` separately, for the
   * reason the content tab takes it: a write is built from the node in a
   * particular document, and passing them apart lets a caller hand a node from
   * one render to an `apply` bound to another.
   */
  editor: EditorState;
  /**
   * What the site allows, forwarded to both the arm choice and the write.
   *
   * Carried rather than defaulted: the engine ships no host list of its own, so
   * omitting it does not mean "allow" — it means the question was never asked.
   */
  policy?: StylePolicy;
  /** The interaction state being edited. `base` when the host says nothing. */
  state?: StyleState;
  /** The breakpoint being edited. The unconditional one when the host says nothing. */
  breakpoint?: BreakpointId;
  /**
   * The site's design tokens, so a colour control can offer them and resolve
   * one it is shown.
   *
   * Separate from `policy.tokens`, which cannot serve this: a `TokenLookup` is
   * `{ kindOf(name) }` and answers ABOUT a name the caller already has. It can
   * confirm a reference and cannot enumerate one, so a picker sourced from it
   * would have nothing to list.
   *
   * Carried rather than defaulted, exactly as `policy` is: omitting it does not
   * mean the site has no tokens, it means the question was never asked. A
   * control with no table offers no token picker and shows a stored reference
   * by the identity the document holds, because that is the only name it has.
   */
  tokens?: SiteTokenSet;
  /**
   * The declarations the compiler wrote for this document, WITH the tree they
   * describe.
   *
   * What lets a control say where its value came from. Supplied by the host
   * rather than compiled here, and that is the point: the panel renders once per
   * control, so compiling in this component would walk the cascade per control
   * — the thing this file's own comments say must not happen.
   *
   * The tree travels with the entries rather than being taken from
   * {@link editor}, because the two are one answer. Read-time repair can change
   * WHICH node owns an id: a duplicated id whose first node is condition-gated
   * leaves a later node rendering under it, and a lookup in the raw document
   * then returns a node with different classes, a different type and a different
   * chain of ancestors than the declarations belong to. A visibly applied class
   * is reported as unset, or attributed to the wrong tier.
   *
   * Absent means the question was never asked, not that nothing is inherited: a
   * host that supplies no cascade gets no indicators, which is the honest answer
   * for a surface that cannot compile.
   */
  cascade?: PageStyleCascade;
  /**
   * The site's breakpoints, for deciding which declarations are live.
   *
   * Carried rather than derived from {@link breakpoint}: which rules are in PLAY
   * is a fact about the width being viewed, and the edited breakpoint only says
   * which of them counts as authored here.
   */
  breakpoints?: BreakpointSet;
  /**
   * The container the page's breakpoints were compiled against, when the canvas
   * is previewing rather than rendering at the browser's own width.
   *
   * Carried because this panel decides which declarations are LIVE, and that is
   * a question about the queries the sheet was EMITTED under. Given only the
   * breakpoint set, it compares the window against `@media` rules a preview
   * compile never wrote — a confident wrong answer rather than a stale one,
   * since a narrow admin window then reports the small breakpoints live while a
   * wide canvas box is showing the large ones.
   */
  previewContainer?: string;
  /**
   * Which breakpoints the canvas is ACTUALLY applying, when the host can say.
   *
   * Needed in preview and unnecessary otherwise. Rendering at the browser's own
   * width, this panel asks `matchMedia` and answers for itself; previewing
   * inside a box, the queries are about that box and only whoever owns it can
   * observe them.
   *
   * Absent while previewing, no indicator is drawn at all. Reporting the
   * window's answer there would name the wrong tier as the visible winner,
   * which is worse than naming none.
   */
  liveBreakpoints?: readonly BreakpointId[];
  /**
   * Move the canvas to a breakpoint, for a control offering to go where its
   * value was set.
   *
   * The panel cannot do this itself: which tier the canvas shows is a fact
   * about the surface that OWNS the canvas width, and this panel sits several
   * layers below it. Supplied, each control whose value came from another tier
   * offers the jump; omitted, none does — a host with no canvas to move would
   * otherwise draw a button that does nothing, which reads as broken rather
   * than absent.
   */
  onJumpToBreakpoint?: (breakpoint: BreakpointId) => void;
  /**
   * The site's class library, when the host has one to give.
   *
   * Two signals, not one. {@link StyleInspectorPanelProps.onCreateClass} says
   * whether the host has a class surface at all; this says what it holds. So
   * `undefined` here means the library is absent rather than unasked-for, and
   * it covers BOTH a read in flight and a read that failed —
   * {@link StyleInspectorPanelProps.classLibraryAbsence} says which. They need
   * different words: one will finish and the other will not, and only the
   * first has a field about to fill.
   */
  classLibrary?: readonly NamedClass[];
  /** Why the library is absent, when it is. Forwarded to the selector. */
  classLibraryAbsence?: ClassSelectorProps["libraryAbsence"];
  /**
   * Create a class under this slug and put it on the selected block.
   *
   * Supplying it is what OPTS IN to the class surface: a host that cannot
   * write the site style has no way to create one, and a selector that offered
   * to would report an intent nobody acts on.
   *
   * One callback rather than two, because this surface cannot mint an id — the
   * class has no identity until the host has stored it, so "create it and
   * apply it" is a single intent and splitting it would leave the caller
   * correlating them.
   *
   * Applying and removing an EXISTING class needs no callback: those are edits
   * to the selected node, which this panel already writes through the editor.
   */
  onCreateClass?: ClassSelectorProps["onCreateClass"];
}

/**
 * The op that stores a node's class ids.
 *
 * An empty list REMOVES the field rather than storing `[]`. The two mean the
 * same thing to every reader, and the field is optional, so writing the empty
 * array would leave a document carrying a key that says nothing — and an
 * inverse built from it would restore that key on undo.
 */
function nodeClassesOp(nodeId: string, classIds: readonly string[]): BuilderOp {
  if (classIds.length === 0) {
    return { kind: "update", id: nodeId, patch: {}, unset: ["classes"] };
  }
  return { kind: "update", id: nodeId, patch: { classes: [...classIds] } };
}

/**
 * Why this panel has nothing to style, drawn, or `null` when it does.
 *
 * All four ask ONE question — can an edit here mean what it appears to mean —
 * and each is refused for a different reason. Gathered so the panel body holds
 * one branch instead of four: the reasons are stable and the panel is not, and
 * a large function that grows a branch per release is how one arrives over the
 * complexity gate without anyone deciding to.
 */
type StyleAvailability =
  | { readonly available: false; readonly reason: React.JSX.Element }
  | { readonly available: true; readonly inspection: StyleInspection };

function styleUnavailable(
  editor: EditorState,
  inspection: StyleInspection | null
): StyleAvailability {
  if (editor.selection.ids.length > 1) {
    return {
      available: false,
      reason: (
        <div className="nx-style-inspector" data-empty="many-selected">
          <p className="nx-inspector__note">
            {editor.selection.ids.length} blocks selected. Select one to style
            it.
          </p>
        </div>
      ),
    };
  }

  /*
   * A block whose id is not unique cannot be styled, and saying so is the only
   * honest answer this panel has.
   *
   * The compiler already reaches this conclusion for the same reason, and its
   * words are worth keeping: a class is derived from the id, so two nodes
   * sharing one share a class, and "writing corrupts a node the author did not
   * touch". It refuses to emit their rules.
   *
   * The editor has to refuse for a second reason the compiler does not face. The
   * cascade is read from the PREPARED tree, where read-time repair has already
   * dropped the later duplicate — but gating runs first, so a gated first node
   * leaves a LATER one owning that id there, while every lookup in the stored
   * document returns the first. The controls would then show and write one
   * block while the provenance dots describe another, and typing into a field
   * would silently change a block that is not on screen.
   *
   * Refused rather than reconciled: pointing the controls at the rendered node
   * would not help, because a write is addressed by id and would still land on
   * the first. There is no edit here that means what it appears to mean.
   */
  if (editor.selectedId !== null && sharesItsId(editor, editor.selectedId)) {
    return {
      available: false,
      reason: (
        <div className="nx-style-inspector" data-empty="duplicate-id">
          <p className="nx-inspector__note">
            Another block on this page has the same id, so styles written here
            could not be told apart. Give one of them a new id to style either.
          </p>
        </div>
      ),
    };
  }

  if (inspection === null) {
    return {
      available: false,
      reason: (
        <div className="nx-style-inspector" data-empty="no-selection">
          <p className="nx-inspector__note">Select a block to style it.</p>
        </div>
      ),
    };
  }

  /*
   * A block offering no style properties is NOT unavailable, and that is the
   * distinction this function turns on. The three refusals above are about
   * there being no single node an edit could address — a multi-selection, an
   * ambiguous id, nothing selected. This one is only about the block's own
   * controls, and named classes compile independently of them: such a block
   * can still carry a class, so the class surface has to survive it.
   */
  return { available: true, inspection };
}

/**
 * The class surface for the selected block, or nothing.
 *
 * Its own component rather than a conditional in the panel body: the panel is
 * already near the complexity the gate allows, and a branch plus two inline
 * callbacks is exactly the kind of growth that pushes a large function over
 * without anyone deciding to.
 *
 * `onCreateClass` is what OPTS IN. `library` being undefined then means the
 * read is in flight, which the selector draws as such — two signals, so a host
 * mid-load and a host with no class surface are never the same picture.
 */
function SelectedNodeClasses({
  editor,
  nodeId,
  library,
  libraryAbsence,
  onCreateClass,
}: {
  editor: EditorState;
  nodeId: string;
  library: readonly NamedClass[] | undefined;
  libraryAbsence: ClassSelectorProps["libraryAbsence"];
  onCreateClass: ClassSelectorProps["onCreateClass"] | undefined;
}): React.JSX.Element | null {
  if (onCreateClass === undefined) return null;
  return (
    <ClassSelector
      nodeId={nodeId}
      /*
       * Keyed by NODE, for the reason the style sections are. The typed query
       * and the highlighted row are state about the node in hand; unkeyed,
       * React reuses this component when the selection changes and Enter can
       * apply the previous block's pending choice to the new one.
       */
      key={nodeId}
      library={library}
      libraryAbsence={libraryAbsence}
      nodeClassIds={findNode(editor.document.nodes, nodeId)?.classes ?? []}
      onNodeClassesChange={classIds =>
        // `applyAll` answers null when the store refuses — a document at its
        // byte limit rejects an edit the class rules found perfectly valid.
        // Reported back so the selector keeps the draft rather than clearing
        // it as though the write had landed.
        editor.applyAll([nodeClassesOp(nodeId, classIds)]) === null
          ? "refused"
          : "applied"
      }
      onCreateClass={onCreateClass}
    />
  );
}

export function StyleInspectorPanel({
  editor,
  policy,
  tokens,
  state,
  breakpoint,
  cascade,
  breakpoints,
  previewContainer,
  liveBreakpoints,
  onJumpToBreakpoint,
  classLibrary,
  classLibraryAbsence,
  onCreateClass,
}: StyleInspectorPanelProps): React.JSX.Element {
  // `null` is "the author has not chosen yet", which is NOT the same as the
  // empty string the accordion sends when they collapse the open section. The
  // two collapsed onto one value made the first section impossible to close,
  // and closing any later one silently opened the first.
  const [openGroup, setOpenGroup] = React.useState<string | null>(null);
  // The form an author chose at a union position, keyed by property and path.
  // Panel state rather than document state: it is only consulted where nothing
  // is stored, so there is nothing to persist — the moment a value exists, the
  // value decides its own form.
  const [chosenForms, setChosenForms] = React.useState<Record<string, number>>(
    {}
  );
  const prefersDark = usePrefersDark();
  /*
   * What the browser is applying, or `undefined` when nobody can say.
   *
   * ONE call, because the component must not hold the two inputs separately.
   * It did, and they disagreed: the decision to draw an indicator asked whether
   * a preview name was STATED while the set being judged asked whether the host
   * had supplied one, so a refused name arriving beside a live set had the
   * box-derived tiers used against a published compile. Fixing either half
   * alone left the other standing, which is the tell that the two questions
   * were one question with two answers.
   */
  const live = useLiveBreakpoints(
    breakpoints,
    previewContainer,
    liveBreakpoints
  );

  // Recomputed each render rather than memoised, as the content tab is: an
  // inspection is only valid against the document it was read from, and an edit
  // anywhere changes both the document and the values shown.
  const inspection = inspectStyle(editor.document, editor.selectedId, {
    ...policy,
    state,
    breakpoint,
    variantAt: (property, path) => chosenForms[formKey(property, path)],
  });

  const chooseForm = (property: string, path: readonly string[], arm: number) =>
    setChosenForms(current => ({ ...current, [formKey(property, path)]: arm }));

  /*
   * Several blocks selected: a different panel, not a thinner one.
   *
   * `selectedId` is the PRIMARY of the selection, so inspecting it would draw
   * writable controls that change one block while the canvas outlines six —
   * two surfaces answering different questions with the same words. The
   * inspector wrapper makes the same refusal for the content half; this one
   * makes it for itself because it is exported standalone, and a host mounting
   * it directly gets no wrapper.
   *
   * Editing one property across a whole selection — one field showing "Mixed"
   * and writing to every block — is a different surface with its own rules
   * about what a shared value means, and it does not exist yet.
   */
  /*
   * One branch here, four inside. Narrowed through the RESULT rather than
   * re-tested afterwards: a second `inspection === null` check in this body
   * would put the branch back that the extraction removed, and a non-null
   * assertion would state as fact what the guard already proved.
   */
  const availability = styleUnavailable(editor, inspection);
  if (!availability.available) return availability.reason;
  const inspected = availability.inspection;

  /*
   * ONE subject for the whole panel, and one live-breakpoint set.
   *
   * Every control on this panel asks about the SAME node, so building either per
   * control would walk the document per control — which is the cost this file's
   * own comments say the indicator must not pay.
   *
   * Recomputed each render rather than memoised, exactly as the inspection above
   * is: both are only valid against the document they were read from, and an
   * edit anywhere changes the document and the values shown together.
   */
  const subject = selectedSubject(editor, cascade);
  /*
   * What the panel is editing, so an inherited label can say what DIFFERS from
   * it. Built once beside the subject for the same reason: every control is
   * asking about one node at one address.
   */
  const editing: EditedAddress = {
    nodeId: inspected.nodeId,
    blockType: subject?.blockType,
    state: inspected.state,
    breakpoint: inspected.breakpoint,
    labelOf: id => breakpointLabel(breakpoints, id),
  };
  const provenanceOf = provenanceReader({
    cascade,
    subject,
    live,
    state: inspected.state,
    breakpoint: inspected.breakpoint,
    breakpoints,
    onJumpToBreakpoint,
  });

  const groups = inspected.sections.map(section => section.group);
  // Held rather than left to the accordion, so the open section survives a
  // change of selection. Falling back to the first is what keeps it valid when
  // the newly selected block does not offer the section that was open — an
  // accordion asked to open a section it does not have shows nothing open at
  // all, which reads as the panel having failed to load.
  //
  // Compared as strings because that is what the accordion hands back, and
  // narrowing its argument to a catalog group would be this file claiming to
  // know the vocabulary rather than reading it off the sections in hand.
  const available = new Set<string>(groups);
  const open = openSection(openGroup, available, groups[0] ?? "");

  return (
    <div className="nx-style-inspector">
      {/*
       * Above the sections, because applying a class is the frequent action and
       * it decides what the controls below are even editing. Webflow puts its
       * selector field at the top of the Style panel for the same reason.
       */}
      <SelectedNodeClasses
        editor={editor}
        nodeId={inspected.nodeId}
        library={classLibrary}
        libraryAbsence={classLibraryAbsence}
        onCreateClass={onCreateClass}
      />
      {inspected.sections.length === 0 ? (
        <p className="nx-inspector__note" data-empty="no-style-support">
          This block does not offer style properties.
        </p>
      ) : null}
      <Accordion
        type="single"
        collapsible
        value={open}
        onValueChange={setOpenGroup}
      >
        {inspected.sections.map(section => (
          <StyleSectionItem
            // Keyed by node AND group: a bare group would let React reuse one
            // block's inputs for the next block's same-named section, so a field
            // would keep the previous block's uncommitted text.
            key={`${inspected.nodeId}:${section.group}`}
            section={section}
            nodeId={inspected.nodeId}
            state={inspected.state}
            breakpoint={inspected.breakpoint}
            editor={editor}
            policy={policy}
            tokens={tokens}
            prefersDark={prefersDark}
            provenanceOf={provenanceOf}
            editing={editing}
            onChooseForm={chooseForm}
          />
        ))}
      </Accordion>
    </div>
  );
}

/**
 * Whether the viewer's system asks for a dark colour scheme.
 *
 * Read because a site on the `media` dark-mode strategy has its dark token
 * block wrapped in `@media (prefers-color-scheme:dark)`, so the canvas switches
 * with the system and nothing tells the panel. Resolving every token to its
 * light value regardless would paint swatches and report ratios for colours the
 * canvas is not showing.
 *
 * Starts `false` and subscribes after mount, so a server render and the first
 * client render agree — React discards a subtree whose two renders disagree,
 * which would take the whole Style tab with it. A viewer already in dark mode
 * sees one frame of light-mode swatches; the alternative is a hydration
 * mismatch, which is worse and harder to see.
 */
function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = React.useState(false);
  React.useEffect(() => {
    // Detected by CALLABILITY, not by presence. `"matchMedia" in window` is
    // true under jsdom while the value is not a function, so the property test
    // passes and the call throws — measured, and it took 85 tests down. A
    // capability check has to ask the question the caller will ask.
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(query.matches);
    const listen = (event: MediaQueryListEvent): void =>
      setPrefersDark(event.matches);
    query.addEventListener("change", listen);
    return () => query.removeEventListener("change", listen);
  }, []);
  return prefersDark;
}

/**
 * The breakpoints whose rules the browser is applying right now.
 *
 * Modelled on {@link usePrefersDark} directly below it, and for the same reason:
 * a media query's state is a fact about the viewer that nothing in React tells
 * this panel, so it is read and then subscribed to.
 *
 * Starts from the unconditional contexts and widens after mount, so a server
 * render and the first client render agree — React discards a subtree whose two
 * renders disagree, which would take the whole Style tab with it. The cost is
 * one frame reporting fewer origins than apply; the alternative is a hydration
 * mismatch.
 */
function useLiveBreakpoints(
  breakpoints: BreakpointSet | undefined,
  previewContainer: string | undefined,
  stated: readonly BreakpointId[] | undefined
): readonly BreakpointId[] | undefined {
  /*
   * NORMALISED here, so no caller decides for itself whether a name counts.
   *
   * A stated name is not an active preview: `previewContainerName` refuses an
   * empty, reserved, malformed or oversized string, and a refused name makes
   * the compile published — viewport tiers emit ordinary `@media`, which the
   * window can answer for. Read raw, every indicator was withheld from surfaces
   * that were not previewing at all.
   */
  const preview = previewContainerName(previewContainer);
  /*
   * The emission the sheet was compiled under, carried so this asks the SAME
   * queries. Without it the window is compared against `@media` rules a preview
   * compile never wrote, which is not a stale answer but a confident wrong one:
   * a narrow admin window reports the small breakpoints live while a wide canvas
   * box is showing the large ones.
   */
  const options = React.useMemo(
    () => (preview === undefined ? undefined : { previewContainer: preview }),
    [preview]
  );
  const never = React.useCallback(() => false, []);
  const [matches, setMatches] = React.useState<readonly BreakpointId[]>(() =>
    matchedBreakpoints(breakpoints, never, options)
  );
  React.useEffect(() => {
    // Detected by CALLABILITY rather than presence, the lesson `usePrefersDark`
    // records: `"matchMedia" in window` is true under jsdom while the value is
    // not a function, so the property test passes and the call throws.
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const ask = (query: string): boolean => window.matchMedia(query).matches;
    const read = (): void =>
      setMatches(matchedBreakpoints(breakpoints, ask, options));
    read();
    /*
     * Subscribed to every emitted query, not to a resize. A resize fires
     * continuously and would re-measure on each frame of a drag, while a media
     * query change event fires exactly when an answer here would differ.
     */
    const lists = breakpointQueries(breakpoints, options).map(query =>
      window.matchMedia(query)
    );
    for (const list of lists) list.addEventListener("change", read);
    return () => {
      for (const list of lists) list.removeEventListener("change", read);
    };
  }, [breakpoints, options]);
  /*
   * Previewing, the window is not the authority and the host is.
   *
   * A `matchMedia` caller cannot evaluate a container query, so under a preview
   * compile `matches` reduces to the base context alone — which is not silence
   * but the claim that base is what the browser applies. Whoever owns the box
   * is the only one that can observe it, so `undefined` there means nobody has
   * looked yet and the caller must say nothing rather than guess.
   *
   * Published, the window IS the authority, and a set the host offers describes
   * a box that is not deciding anything — so it is ignored rather than
   * preferred.
   */
  return preview === undefined ? matches : stated;
}

/** One catalog group, as a section that opens onto its properties. */
function StyleSectionItem({
  section,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
  tokens,
  prefersDark,
  provenanceOf,
  editing,
  onChooseForm,
}: {
  section: StyleSection;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
  tokens: SiteTokenSet | undefined;
  prefersDark: boolean;
  provenanceOf: ProvenanceOf;
  editing: EditedAddress;
  onChooseForm: ChooseForm;
}): React.JSX.Element {
  // How many of this section's properties this node sets HERE, so an author can
  // see which sections they have touched without opening each one.
  const setCount = section.properties.filter(property => property.set).length;
  return (
    <AccordionItem value={section.group}>
      <AccordionTrigger>
        <span className="nx-style-inspector__section-label">
          {section.label}
        </span>
        {setCount > 0 ? (
          <span
            className="nx-style-inspector__section-count"
            aria-label={`${setCount} set`}
          >
            {setCount}
          </span>
        ) : null}
      </AccordionTrigger>
      <AccordionContent>
        <div className="nx-inspector__fields">
          {section.properties.map(property => (
            <StylePropertyFields
              key={`${nodeId}:${property.property}`}
              property={property}
              nodeId={nodeId}
              state={state}
              breakpoint={breakpoint}
              editor={editor}
              policy={policy}
              tokens={tokens}
              prefersDark={prefersDark}
              provenanceOf={provenanceOf}
              editing={editing}
              onChooseForm={onChooseForm}
            />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

/**
 * One catalog property, which is one control or several.
 *
 * `margin` is four logical sides and `position` is a scheme, four offsets and a
 * stacking order, so a property is a GROUP of controls rather than a field. The
 * heading is drawn only when there is more than one, because a lone control
 * already carries the property's name.
 */
function StylePropertyFields({
  property,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
  tokens,
  prefersDark,
  provenanceOf,
  editing,
  onChooseForm,
}: {
  property: InspectedStyleProperty;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
  tokens: SiteTokenSet | undefined;
  prefersDark: boolean;
  provenanceOf: ProvenanceOf;
  editing: EditedAddress;
  onChooseForm: ChooseForm;
}): React.JSX.Element {
  const many = property.controls.length > 1;
  return (
    <div
      className="nx-style-inspector__property"
      data-property={property.property}
    >
      {many ? (
        <p
          className="nx-style-inspector__property-label"
          title={property.summary}
        >
          {property.label}
        </p>
      ) : null}
      {/*
        The forms the catalog offers at each union position, so every one is
        reachable. Without this an unset `borderRadius` could only ever be
        authored as a single radius and `position.zIndex` only as a number: the
        engine answers with the catalog's first arm when nothing is stored, and
        that answer is right precisely because the author has not spoken yet.

        Withheld for a property the block no longer offers. `FormChoice`
        REMOVES what is stored at the union's position — `styleClearOp`, so the
        new form starts empty — which is right while a property is still
        editable and wrong once it is not: a selector left enabled beside the
        notice below reads as "switch this to corners" and instead deletes the
        value, through a capability the block has withdrawn. The Clear action on
        the value itself is the honest way to remove it, and it is already
        there.
      */}
      {(property.offered ? property.variants : [])
        .filter(variant => variant.count > 1)
        .map(variant => (
          <FormChoice
            key={variant.path.join(".")}
            property={property}
            variant={variant}
            nodeId={nodeId}
            state={state}
            breakpoint={breakpoint}
            editor={editor}
            policy={policy}
            onChooseForm={onChooseForm}
          />
        ))}
      {property.offered ? null : (
        <p className="nx-inspector__note" data-not-offered={property.property}>
          This block no longer offers {property.label}. The value is still on
          the page and can be cleared.
        </p>
      )}
      {property.controls.map(control => (
        <StyleControlField
          // The ADDRESS, not just the position: a host switching state or
          // breakpoint leaves this field mounted, and where the old and new
          // addresses hold the same value — both unset, most often — the
          // synchronisation effect does not run either. An unfinished draft
          // from the base breakpoint would then commit into the hover state.
          key={[state, breakpoint, property.property, ...control.path].join(
            "."
          )}
          control={control}
          label={
            many
              ? fieldLabel(control.path[control.path.length - 1] ?? "")
              : property.label
          }
          summary={many ? undefined : property.summary}
          propertyLabel={property.label}
          clearOnly={!property.offered}
          nodeId={nodeId}
          state={state}
          breakpoint={breakpoint}
          editor={editor}
          policy={policy}
          tokens={tokens}
          prefersDark={prefersDark}
          provenanceOf={provenanceOf}
          editing={editing}
        />
      ))}
    </div>
  );
}

/** How an author says which form they mean to write a value in. */
type ChooseForm = (
  property: string,
  path: readonly string[],
  arm: number
) => void;

/** The panel-state key for one union position. */
function formKey(property: string, path: readonly string[]): string {
  return [property, ...path].join(".");
}

/**
 * What each form is called, from the arm's own shape kind.
 *
 * The catalog gives arms no names, so their shape kind is the most specific
 * thing it says about them — and "Form 1 / Form 2" tells an author nothing
 * about which is which. Partial for the same reason the placeholders are: this
 * is a label, so a kind this build has not learned about gets the kind itself
 * rather than a compile error.
 */
const FORM_LABEL: Partial<Record<StyleShape["kind"], string>> = {
  dimension: "Length",
  number: "Number",
  keyword: "Keyword",
  color: "Colour",
  cssValue: "Custom",
  url: "URL",
  logicalSides: "Per side",
  logicalCorners: "Per corner",
  object: "Fields",
  union: "Mixed",
};

/**
 * The choice of form at one union position.
 *
 * Choosing a form while a value is stored CLEARS it. The two forms hold
 * different things — one radius is not four corners — so there is nothing to
 * carry across, and leaving the value in place would be worse than clearing:
 * the stored value decides its own arm, so the panel would snap straight back
 * to the form the author just moved away from.
 */
function FormChoice({
  property,
  variant,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
  onChooseForm,
}: {
  property: InspectedStyleProperty;
  variant: StyleControlVariants;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
  onChooseForm: ChooseForm;
}): React.JSX.Element {
  const id = React.useId();
  const choose = (raw: string) => {
    const arm = Number(raw);
    if (!Number.isInteger(arm)) return;
    onChooseForm(property.property, variant.path, arm);
    const current = findNode(editor.document.nodes, nodeId);
    if (current === undefined) return;
    // The union's OWN position, not the property's root. A union can sit below
    // it — `position` holds a type, an inset and a zIndex, and only the last is
    // a union — so clearing the root to change the zIndex form would delete the
    // author's positioning scheme and offsets along with it.
    const address: StyleAddress = {
      state,
      breakpoint,
      property: property.property,
      path: variant.path,
    };
    // Read at this position for the same reason: `property.set` answers for the
    // whole property, which is true whenever any sibling holds a value.
    if (readStyleValue(current.styles, address) === undefined) return;
    // Through the batch layer as a group of ONE, like every other style write
    // in this panel. A refusal or an already-absent value both come back as no
    // ops, which is what the two conditions here used to say separately.
    const cleared = batchStyleClearOps([current], address, policy);
    if (cleared.ops.length > 0) editor.applyAll(cleared.ops);
  };

  return (
    <div className="nx-inspector__field" data-form-choice={property.property}>
      <Label htmlFor={id}>
        {/*
          The PROPERTY's name at the root, because a property whose shape is a
          union at the top draws one control and therefore no heading — so
          `fontWeight`, `lineHeight` and `fontStyle` would all offer a selector
          called "Form". Below the root the heading is rendered, so the position
          is enough to tell them apart.
        */}
        {variant.path.length === 0
          ? `${property.label} form`
          : `${fieldLabel(variant.path[variant.path.length - 1] ?? "")} form`}
      </Label>
      <Select value={String(variant.active)} onValueChange={choose}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {variant.kinds.map((kind, index) => (
            <SelectItem key={`${index}:${kind}`} value={String(index)}>
              {FORM_LABEL[kind] ?? kind}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * What a commit did to the document.
 *
 * Three outcomes rather than a boolean, because the surface showing the value
 * has to do something different in each and two of them are easy to conflate.
 * `refused` KEEPS what the author typed, so they can correct it beside the
 * message. `unchanged` means the write was valid and the document already held
 * that value — `01` where it holds `1` — so the field has to go back to what
 * the document says, and nothing else will make it: the stored value never
 * moved, so no effect keyed on it fires.
 */
type CommitOutcome = "applied" | "refused" | "unchanged";

/** One editable position, drawn as the control its leaf kind resolves to. */
function StyleControlField({
  control,
  label,
  summary,
  propertyLabel,
  clearOnly,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
  tokens,
  prefersDark,
  provenanceOf,
  editing,
}: {
  control: StyleControl;
  label: string;
  summary: string | undefined;
  /**
   * The whole property's name, for naming an ACTION rather than a field.
   *
   * A field is labelled by its position — "Block start" — which is enough
   * beside its own property's heading and not enough on a button: `padding` and
   * `margin` both have a block start, so two buttons called "Clear block start"
   * name the same thing twice and a screen-reader user cannot tell which style
   * each removes.
   */
  propertyLabel: string;
  /**
   * Whether this value may only be REMOVED, not changed.
   *
   * True for a property the block's `supports` no longer declares. The value is
   * still emitted — nothing in validation or compilation reads `supports` — so
   * withholding the control entirely would leave styling on the page that the
   * author can see and cannot remove. Letting them go on EDITING it is the
   * other error: it writes new values through a capability the block has
   * withdrawn, which is the definition the panel is supposed to be reading.
   */
  clearOnly: boolean;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
  tokens: SiteTokenSet | undefined;
  prefersDark: boolean;
  provenanceOf: ProvenanceOf;
  editing: EditedAddress;
}): React.JSX.Element {
  const id = React.useId();
  // The message's own id, so the control can point at it. A `role="alert"`
  // announces once and then it is gone: a screen-reader user who returns to the
  // field, or meets several rejected controls, has no way to tell which message
  // belongs to which without the relationship being stated.
  const errorId = `${id}-error`;
  const address: StyleAddress = {
    state,
    breakpoint,
    property: control.property,
    path: control.path,
  };
  // Read ONCE and shared by both lookups below, so the control's own value and
  // its contrast partner cannot come from two different reads of the document.
  const styles = findNode(editor.document.nodes, nodeId)?.styles;
  const stored = readStyleValue(styles, address);
  const pairedColour = partnerColour(control.leaf, styles, address);
  // This node's own styles first, then every ancestor's. An ancestor's
  // `opacity`, `filter` or `mixBlendMode` composites this node along with the
  // rest of the subtree, so both colours reach the eye altered and the ratio
  // between the two stored values describes a rendering that does not happen.
  const obscuredBy =
    contrastObscuredIn(styles) ??
    contrastObscuredAbove(editor.document.nodes, nodeId);
  const actionName = actionNameFor(propertyLabel, label);
  const [issue, setIssue] = React.useState<string | null>(null);

  // A refusal describes the draft that produced it, so it stops describing
  // anything the moment the document holds a different value here. Clearing on
  // the stored value rather than only on the next commit is what covers an undo
  // or an edit applied from elsewhere: the remount key changes with the
  // SELECTION, and neither of those changes the selection.
  React.useEffect(() => {
    setIssue(null);
  }, [stored]);

  const commit = (value: StyleValue | null): CommitOutcome =>
    writeStyleValue({ editor, nodeId, address, policy, value, setIssue });
  /*
   * The provenance and its breakpoint reading, from ONE ranking of the trace.
   * The dot and the action are two readings of one answer, not two answers.
   */
  const answer = provenanceOf(control.leaf);

  const readOnly = showsNoField(control, stored, clearOnly);
  const labelId = `${id}-label`;
  // Computed once and used by both the control and its message: two spellings
  // of "is there an error" is the shape that drifts into a control described by
  // a message it is not marked invalid for.
  const describedBy = issue === null ? undefined : errorId;

  if (!control.supported) {
    return (
      <UnsupportedField
        labelId={labelId}
        label={label}
        summary={summary}
        actionName={actionName}
        leafKind={control.leaf.kind}
        stored={stored}
        onClear={() => commit(null)}
      />
    );
  }

  return (
    <div className="nx-inspector__field" data-control={control.kind}>
      <Label id={labelId} htmlFor={readOnly ? undefined : id} title={summary}>
        {label}
        <ProvenanceDot
          answer={answer}
          editing={editing}
          descendant={control.leaf.descendant}
        />
      </Label>
      <ControlValue
        id={id}
        labelledBy={labelId}
        control={control}
        stored={stored}
        actionName={actionName}
        clearOnly={clearOnly}
        tokens={tokens}
        prefersDark={prefersDark}
        pairedColour={pairedColour}
        obscuredBy={obscuredBy}
        describedBy={describedBy}
        onCommit={commit}
      />
      <BreakpointAction
        answer={answer}
        label={actionName}
        editing={editing}
        fieldId={id}
        onReset={() => commit(null)}
      />
      {issue === null ? null : (
        <p className="nx-inspector__error" id={errorId} role="alert">
          {issue}
        </p>
      )}
    </div>
  );
}

/**
 * The node the declarations describe, or `undefined` with nothing selected.
 *
 * Read from the CASCADE's own tree where there is one. Asking the raw document
 * instead would answer about a node the declarations may not describe — read
 * time repair can drop or replace one — and the fallback is only for a panel
 * with no cascade at all, where no indicator is drawn and the subject is read
 * for the block type alone.
 */
function selectedSubject(
  editor: EditorState,
  cascade: PageStyleCascade | undefined
): StyleSubject | undefined {
  if (editor.selectedId === null) return undefined;
  return styleSubjectFor(
    cascade?.nodes ?? editor.document.nodes,
    editor.selectedId
  );
}

/**
 * The reader that answers, per control, where its value came from.
 *
 * Built OUTSIDE the panel because nothing in it is React: it is a pure function
 * of inputs the panel has already resolved — one subject, one live set, one
 * trace — and closing over them inside the component put the whole derivation
 * into a body that also renders.
 */
function provenanceReader({
  cascade,
  subject,
  live,
  state,
  breakpoint,
  breakpoints,
  onJumpToBreakpoint,
}: {
  cascade: PageStyleCascade | undefined;
  subject: StyleSubject | undefined;
  live: readonly BreakpointId[] | undefined;
  state: StyleState;
  breakpoint: BreakpointId;
  breakpoints: BreakpointSet | undefined;
  onJumpToBreakpoint: ((breakpoint: BreakpointId) => void) | undefined;
}): ProvenanceOf {
  return leaf => {
    // Absent means the question was never asked. A host that supplies no cascade
    // gets no indicators, which is the honest answer for a surface that cannot
    // compile — and not the same as "nothing is inherited".
    if (cascade === undefined || subject === undefined) return undefined;
    /*
     * The same answer while the canvas is previewing and nobody has said which
     * tier the preview BOX is showing.
     *
     * Under a preview compile the viewport tiers are container queries, and a
     * `matchMedia` caller cannot evaluate them — so the window-derived set is
     * the base context alone. Passed on, that is not silence: `["base"]` is the
     * CLAIM that base is what the browser is applying, and a narrow box showing
     * the mobile tier would have every mobile declaration excluded and the base
     * value reported as the visible winner.
     *
     * No dot says "not asked", which is true until a caller observes the box.
     */
    if (live === undefined) return undefined;
    const query = {
      trace: cascade.entries,
      subject,
      // The control's own leaf, never the catalog key: two keys can write one
      // CSS property, and the trace records what was WRITTEN.
      cssProperty: leaf.cssProperty,
      descendant: leaf.descendant,
      state: state,
      breakpoint: breakpoint,
      /*
       * What the BROWSER is applying, and ONLY that. The edited breakpoint is a
       * different fact and travels separately in `breakpoint`: it says where a
       * write lands, not what is on screen.
       *
       * An earlier version forced the edited breakpoint into this set so a value
       * authored there could be called "authored here". That inverted the
       * premise — a host editing `mobile` while the canvas sits at desktop width
       * would have the mobile declaration reported as the visible winner, which
       * is a value the browser is not showing.
       *
       * The consequence is deliberate: editing a breakpoint whose query does not
       * match reports its controls as unset. That is the honest answer, because
       * the dot describes what is DISPLAYED rather than what is stored.
       */
      liveBreakpoints: live,
    };
    /*
     * ONE query, ONE ranking, read twice. The badge is the breakpoint dimension
     * of the same answer rather than a second opinion about it — two rankings
     * of one trace would first disagree at exactly the boundaries the trace
     * exists to settle.
     */
    const provenance = styleProvenance(query);
    const badge = breakpointBadge(query, provenance, breakpoints);
    /*
     * Offered only for a tier a canvas can actually be taken to. A declaration
     * stored under an id that lost its bound still names a real tier — worth
     * saying — but a jump to it cannot be honoured, and the host would read the
     * absent width as the unconditional tier and release the canvas instead.
     */
    const target =
      badge.kind === "inherited" && badge.source.selectable
        ? badge.source.breakpoint
        : undefined;
    return {
      provenance,
      badge,
      ...(onJumpToBreakpoint === undefined || target === undefined
        ? {}
        : { jump: () => onJumpToBreakpoint(target) }),
    };
  };
}

/**
 * The action a control's breakpoint provenance earns, or nothing.
 *
 * Rendered ONLY where it means something: a Reset for a value authored at the
 * tier being edited, a Jump for a value that arrived from another tier, and
 * nothing at all for the unset controls that are the large majority of a panel.
 *
 * That bound is the whole design. {@link ProvenanceDot} refuses to be focusable
 * because a stop per control would double the presses to cross a section of
 * eight or more — and the same objection would apply here if every control
 * carried a button. Tying the affordance to the state that makes it meaningful
 * puts the cost only on controls the author has actually touched.
 *
 * AFTER the input in DOM order, so a keyboard user reaches the value first and
 * the action second. Before it, every control would answer its own question in
 * the wrong order: what to do about a value, then the value.
 *
 * Jump is withheld when no handler is supplied rather than rendered inert. A
 * host that cannot move the canvas — one with no width to move — would
 * otherwise offer a button that does nothing, which is worse than a missing
 * affordance because it reads as a broken one.
 */
function BreakpointAction({
  answer,
  label,
  editing,
  fieldId,
  onReset,
}: {
  answer: ProvenanceAnswer | undefined;
  /**
   * The control's ACTION NAME — the containing property and the leaf together.
   *
   * The leaf label alone is not unique: `margin` and `padding` both have a
   * block start, so two controls would offer buttons called "Reset Block start"
   * and a screen-reader user could not tell which style each removes. The panel
   * already computes this for exactly that reason, and `Clear` on a token value
   * uses it.
   */
  label: string;
  editing: EditedAddress;
  /** The field this control's actions write, passed on to {@link ResetAction}. */
  fieldId: string;
  onReset: () => void;
}): React.JSX.Element | null {
  const badge = answer?.badge;
  // `none` is also refused below, by having no handler bound for it — this is
  // the readable exit rather than the load-bearing one.
  if (badge === undefined || badge.kind === "none") return null;
  if (badge.kind === "authored") {
    return (
      <ResetAction
        revealed={badge.revealed}
        label={label}
        editing={editing}
        fieldId={fieldId}
        onReset={onReset}
      />
    );
  }
  if (answer?.jump === undefined) return null;
  return (
    <JumpAction source={badge.source} label={label} onJump={answer.jump} />
  );
}

/**
 * What to call a breakpoint source in front of an author.
 *
 * ONE naming for both actions. `BreakpointSource` carries the axis precisely
 * because a site defining both makes a bare tier name ambiguous — and a
 * container tier may share its label with a viewport one — so a reset saying
 * "showing the value from Tablet" while a jump says "Tablet (container)" leaves
 * the author to work out that the two Tablets are different tiers.
 */
function sourceLabel(source: BreakpointSource): string {
  return source.axis === "container"
    ? `${source.label} (container)`
    : source.label;
}

/**
 * Clear this control at the tier being edited, saying what will show through.
 *
 * "Reset" alone asks an author to guess whether the control becomes unset or
 * falls back to a wider tier's value. In a desktop-first cascade it is usually
 * the second, and not always base — so the fallback is named, in the accessible
 * name AND in visible text, because computing it exists to remove that guess
 * for everybody rather than for screen-reader users alone.
 */
/**
 * Whether Control held with a primary press means a CONTEXT MENU here.
 *
 * It does on macOS and nowhere else: there the platform opens a menu and no
 * click follows, while on Windows and Linux a Control-click is an ordinary
 * modified click and the button runs exactly as it always does.
 *
 * So this cannot be answered without asking the platform, and the platform is
 * asked by NAME because nothing else decides it. There is no structural probe
 * for "will a click follow this press" that can be run before the click either
 * arrives or does not — which is the same reason the whole supersede is
 * predicted at press time rather than confirmed.
 *
 * `userAgentData` first because `platform` is deprecated, and both because the
 * modern one is Chromium-only. Neither present — a non-browser runtime —
 * answers `false`, which is the ordinary-click reading and the one that keeps
 * the two-write defect closed.
 */
function contextMenuModifier(): boolean {
  const agent: { platform?: string } | undefined = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const name = agent?.platform ?? navigator.platform ?? "";
  return /mac/i.test(name);
}

/**
 * Whether a press can actually RUN the control it landed on.
 *
 * Only a press that will be followed by a click can, and two gestures report a
 * pointer press while invoking nothing: a secondary press anywhere, and a
 * Control-held primary press on macOS.
 *
 * Both directions cost something, which is why the platform is asked rather
 * than the modifier alone. Reading a context menu as an activation discards the
 * colour an author was composing on behalf of a button that never ran. Reading
 * an ordinary Control-click as a context menu does the opposite: the picker
 * commits its draft on dismissal AND the button's click writes, so one gesture
 * becomes two edits and the first undo restores the colour they pressed Reset
 * to be rid of — the defect the supersede exists to prevent, reintroduced.
 *
 * The remainder is stated rather than left to be discovered: a primary press
 * that DRAGS OFF the control and releases elsewhere fires no click either, and
 * is still read here as an activation. Closing that needs the write to confirm
 * the discard instead of the press predicting it — either holding the draft for
 * a later signal, which is the timer this module removed and whose cancellation
 * cost a race, or routing the marked control's write back through this field,
 * which the declaration exists to avoid.
 */
function activates(event: PointerEvent): boolean {
  if (event.button !== 0) return false;
  return !(event.ctrlKey && contextMenuModifier());
}

/**
 * Which field a control writes the value of, when it is not that field.
 *
 * The colour picker commits its gesture when the popover closes, and pressing
 * anything outside it closes the popover first. A control that writes the SAME
 * value the picker is composing therefore has to say so, or one intent produces
 * two edits and the first undo restores the value the author pressed the
 * control to be rid of.
 *
 * Stated as the field's id rather than as a bare flag, because the question is
 * not "does this control write" — every control does — but "does it write what
 * this picker is holding". A bare flag makes Reset on `background-color`
 * supersede an open picker on `color`, discarding a gesture nothing replaced.
 *
 * Declared on the element rather than handed down as a ref, because the
 * controls making the promise live in components with no path to the picker:
 * a breakpoint Reset is drawn beside the control, not inside it.
 */
const COMMITS_FOR = "data-nx-commits-for";

/**
 * How a picker's popover closed: with its gesture written, or superseded.
 *
 * Named rather than left as a boolean, because the two are not "did something
 * happen" — both are outcomes the host must ACT on, and the discard is the one
 * a boolean invites a caller to express by doing nothing.
 */
type PickerClose = "committed" | "superseded";

/** The attributes marking a control as writing `fieldId`'s value itself. */
function commitsFor(fieldId: string): Record<string, string> {
  return { [COMMITS_FOR]: fieldId };
}

/**
 * Whether an interaction outside the picker writes `fieldId`'s value itself.
 *
 * Asked of the ancestor chain rather than of the target alone: the press lands
 * on whatever the control renders inside its button, and a control that puts a
 * span or an icon in there would otherwise stop making the promise.
 */
function supersedes(target: EventTarget | null, fieldId: string): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(`[${COMMITS_FOR}]`)?.getAttribute(COMMITS_FOR) === fieldId
  );
}

function ResetAction({
  revealed,
  label,
  editing,
  fieldId,
  onReset,
}: {
  revealed: BreakpointSource | undefined;
  label: string;
  editing: EditedAddress;
  /** The field whose value this press writes. See {@link commitsFor}. */
  fieldId: string;
  onReset: () => void;
}): React.JSX.Element {
  const reveals =
    revealed === undefined
      ? "leaving it unset"
      : `showing the value from ${sourceLabel(revealed)}`;
  return (
    <button
      type="button"
      className="nx-style-inspector__breakpoint-action"
      data-action="reset"
      /*
       * This press writes THIS field's value, which a picker mid-gesture on it
       * needs to know.
       *
       * The colour picker commits its draft when the popover closes, and
       * pressing anything outside it closes the popover first — so without this
       * one Reset gesture writes twice: the draft the author was discarding,
       * then the clear. The first undo would then restore the very colour they
       * pressed Reset to be rid of.
       *
       * Declared on the element rather than held as a ref by each picker,
       * because the rule is about what a CONTROL does, not about which specific
       * button a particular field happens to know.
       */
      {...commitsFor(fieldId)}
      onClick={onReset}
      aria-label={`Reset ${label} at ${editing.labelOf(editing.breakpoint)}, ${reveals}`}
    >
      Reset
      {/*
       * `aria-hidden`, because the accessible name above already carries this
       * sentence: read out twice it is a stutter rather than emphasis.
       */}
      <span
        className="nx-style-inspector__breakpoint-reveals"
        aria-hidden="true"
      >
        {revealed === undefined ? "to unset" : `to ${sourceLabel(revealed)}`}
      </span>
    </button>
  );
}

/**
 * Take the canvas to the tier this control's value was authored at.
 *
 * The AXIS is named beside the tier, since a site defining both makes a bare
 * tier name ambiguous and the container axis is the one an author is least
 * likely to be holding in mind.
 */
function JumpAction({
  source,
  label,
  onJump,
}: {
  source: BreakpointSource;
  label: string;
  onJump: () => void;
}): React.JSX.Element {
  const where = sourceLabel(source);
  return (
    <button
      type="button"
      className="nx-style-inspector__breakpoint-action"
      data-action="jump"
      onClick={onJump}
      aria-label={`Edit ${label} at ${where}, where its value was set`}
    >
      Go to {where}
    </button>
  );
}

/**
 * The surface one value is shown through: read-only, a token, or editable.
 *
 * Its own component rather than a chain of conditionals inside the field,
 * because the three are genuinely different surfaces — one of them cannot be
 * typed into at all — and reading them as early returns says that, where a
 * nested ternary reads as one control with two exceptions.
 */
function ControlValue({
  id,
  labelledBy,
  control,
  stored,
  actionName,
  clearOnly,
  tokens,
  prefersDark,
  pairedColour,
  obscuredBy,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  actionName: string;
  clearOnly: boolean;
  tokens: SiteTokenSet | undefined;
  /** Whether the viewer's system asks for dark, for a site on the media strategy. */
  prefersDark: boolean;
  /** The other half of this control's contrast pair, when its leaf has one. */
  pairedColour: StyleValue | undefined;
  /**
   * A property on this node that puts something between the pair, or
   * `undefined` when none does. A verdict is withheld while one is set.
   */
  obscuredBy: string | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  if (clearOnly) {
    return (
      <RetainedValue
        labelledBy={labelledBy}
        label={actionName}
        stored={stored}
        onClear={() => onCommit(null)}
      />
    );
  }
  /*
   * A colour draws its own surface, INCLUDING for a stored token reference.
   *
   * Placed before the token branch below rather than after it, because that one
   * returns for every reference and a colour control would never see one. It
   * exists for controls that cannot offer a token picker, and says so: choosing
   * a token was "the token picker's job and it does not exist yet". For a
   * colour it now does, so a reference here is editable rather than read-only.
   *
   * Narrowed on the LEAF rather than on `control.kind`, because the leaf is what
   * carries `tokenKinds` and `cssProperty` — the two facts the colour surface
   * asks the catalog for — so passing it narrowed means neither is re-derived.
   *
   * Guarded by {@link colourShowable}, so a value NO colour control can
   * represent — an object at a scalar position from an import or the API — does
   * not take this branch and skip the read-only surface below. Without it the
   * field projects that object to an empty draft and reads as unset while the
   * value goes on compiling, which is the failure the surface below exists to
   * prevent.
   */
  if (control.leaf.kind === "color" && colourShowable(stored)) {
    return (
      <ColourField
        id={id}
        labelledBy={labelledBy}
        control={{ ...control, leaf: control.leaf }}
        stored={stored}
        actionName={actionName}
        tokens={tokens}
        prefersDark={prefersDark}
        pairedColour={pairedColour}
        obscuredBy={obscuredBy}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  if (isTokenRef(stored)) {
    return (
      <TokenValue
        labelledBy={labelledBy}
        label={actionName}
        name={stored.$token}
        onClear={() => onCommit(null)}
      />
    );
  }
  // A value the editing surface below cannot represent. Drawing it anyway is
  // the worst of the three outcomes: the control reads as unset, the value goes
  // on compiling, and the keystroke that would clear it is the one the field
  // refuses. Shown and removable instead, which is what the other two branches
  // already do for the other two kinds of unteachable value.
  if (editableText(control, stored) === undefined) {
    return (
      <RetainedValue
        labelledBy={labelledBy}
        label={actionName}
        stored={stored}
        note="No control here can edit this value. It is still on the page and can be cleared."
        onClear={() => onCommit(null)}
      />
    );
  }
  return (
    <ValueField
      id={id}
      labelledBy={labelledBy}
      control={control}
      stored={stored}
      actionName={actionName}
      describedBy={describedBy}
      onCommit={onCommit}
    />
  );
}

/**
 * A stored design-token reference, which is a value no text field can edit.
 *
 * Shown by name with a way to remove it rather than as editable text: `{$token}`
 * is one value spelled as an object, and typing over it would store the token's
 * NAME as a literal — a value that looks right in the field and compiles to
 * nothing. Choosing a token is the token picker's job and it does not exist
 * yet, so what is offered here is the honest half: see it, or clear it.
 */
function TokenValue({
  labelledBy,
  label,
  name,
  onClear,
}: {
  /** The id of the label element that names this value. */
  labelledBy: string;
  label: string;
  name: string;
  onClear: () => void;
}): React.JSX.Element {
  return (
    // Named by the property's own label, and given a role that can CARRY a
    // name: a bare paragraph maps to the ARIA `paragraph` role, which prohibits
    // one, so `aria-labelledby` on it may be dropped outright. The button is
    // named for the PROPERTY as well, because a panel with several
    // token-valued properties otherwise offers a column of buttons all called
    // "Clear" and a screen-reader user cannot tell which style each removes.
    <p
      className="nx-style-inspector__token"
      role="group"
      aria-labelledby={labelledBy}
      tabIndex={-1}
    >
      <span>{name}</span>
      <button type="button" onClick={onClear} aria-label={`Clear ${label}`}>
        Clear
      </button>
    </p>
  );
}

/**
 * A value that is live on the page and cannot be edited here: shown, and
 * removable.
 *
 * Three different reasons reach this one surface — the block's `supports` no
 * longer declares the property, no control in this build can draw the leaf's
 * kind, or the stored value has a shape the control cannot represent — and they
 * share it because the author's position is identical in all three: the styling
 * is on the page, nothing here can change it, and the panel owes them the
 * action that removes it. `note` is what tells them WHICH of the three, since
 * only the first has a notice of its own beside the property.
 *
 * Named for the property for the same reason the token control is — several of
 * these on one panel would otherwise be a column of identical "Clear" buttons.
 */
function RetainedValue({
  labelledBy,
  label,
  stored,
  note,
  onClear,
}: {
  /** The id of the label element that names this value. */
  labelledBy: string;
  label: string;
  stored: StyleValue | undefined;
  /** Why this value cannot be edited, where the property does not already say. */
  note?: string;
  onClear: () => void;
}): React.JSX.Element {
  const noteId = React.useId();
  return (
    <>
      {/*
        `group` for the reason {@link TokenValue} carries one: the ARIA
        `paragraph` role a bare paragraph maps to prohibits an accessible name.

        The note is pointed AT rather than left beside: it is the only thing
        saying why this value cannot be edited, and a group announced with its
        name and its Clear button but not its reason tells a screen-reader user
        that a field is read-only without ever saying what made it so.
      */}
      <p
        className="nx-style-inspector__token"
        role="group"
        aria-labelledby={labelledBy}
        aria-describedby={note === undefined ? undefined : noteId}
        tabIndex={-1}
      >
        {/*
          `displayText` rather than the text-field projection, which answers
          `""` for a shape it cannot type — and an empty span beside a Clear
          button asks an author to remove something they cannot see.
        */}
        <span>{displayText(stored)}</span>
        <button type="button" onClick={onClear} aria-label={`Clear ${label}`}>
          Clear
        </button>
      </p>
      {note === undefined ? null : (
        <p className="nx-inspector__note" id={noteId}>
          {note}
        </p>
      )}
    </>
  );
}

/**
 * A closed vocabulary of more than two keywords, as a menu.
 *
 * Its own component rather than a branch inside the router, so that deciding
 * WHICH surface a leaf gets and drawing one are separate readings: the router
 * is then short enough to see all three choices at once, which is the thing a
 * reader comes to it for.
 */
function SelectField({
  id,
  control,
  stored,
  actionName,
  describedBy,
  onCommit,
}: {
  id: string;
  control: StyleControl & { leaf: Extract<StyleLeaf, { kind: "keyword" }> };
  stored: StyleValue | undefined;
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const current = typeof stored === "string" ? stored : "";
  // The validator accepts a keyword case-insensitively, with surrounding CSS
  // whitespace and escapes, and accepts the CSS-wide keywords everywhere — so
  // a stored `Bold` or `inherit` is live and compiles while matching no item
  // here, and the select would render empty over a value that is doing
  // something. Offered VERBATIM as its own item rather than normalised: any
  // rule written here to fold spellings would be a second copy of the
  // engine's, and the stored string is the one thing that needs no rule.
  const extra =
    current !== "" && !control.leaf.values.includes(current) ? current : null;
  return (
    <div className="nx-style-inspector__select">
      <Select value={current} onValueChange={value => onCommit(value)}>
        <SelectTrigger
          id={id}
          aria-describedby={describedBy}
          aria-invalid={describedBy === undefined ? undefined : true}
        >
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent>
          {extra === null ? null : (
            <SelectItem value={extra}>{extra}</SelectItem>
          )}
          {control.leaf.values.map(option => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/*
          A select cannot offer "unset" as an item: an empty value is not a
          choice the list can carry, and a sentinel standing for it would mean
          two things at once. A button beside it clears, which is the same act
          an emptied text field performs.
        */}
      {current === "" ? null : (
        <button
          type="button"
          onClick={() => onCommit(null)}
          aria-label={`Clear ${actionName}`}
        >
          Clear
        </button>
      )}
    </div>
  );
}
/**
 * What this control's clear action removes, named for the author.
 *
 * The property alone where a property draws one control, and the property plus
 * the position where it draws several: `padding` and `margin` both have a block
 * start, so two buttons called "Clear block start" name the same thing twice
 * and a screen-reader user cannot tell which style each removes.
 */
function actionNameFor(propertyLabel: string, label: string): string {
  return propertyLabel === label
    ? propertyLabel
    : `${propertyLabel} ${label.toLowerCase()}`;
}

/**
 * Whether this position renders no element a label can be attached to.
 *
 * HTML's `for` only associates a label with a LABELABLE element — input,
 * select, textarea, button, output, meter, progress. Pointing it at the
 * paragraph the read-only surfaces render drops the association SILENTLY, so
 * the label carries an id of its own and the value points back at it instead.
 *
 * `control.supported` is not a term here: the caller returns before this is
 * read, so including it would be a condition that can never be true where it
 * is used.
 */
function showsNoField(
  control: StyleControl,
  stored: StyleValue | undefined,
  clearOnly: boolean
): boolean {
  if (clearOnly) return true;
  // Every reference, whatever the control. The colour surface reaches this the
  // same way the others do: it draws a name and a button for a reference and a
  // text field only for a literal, so a reference has no field there either.
  if (isTokenRef(stored)) return true;
  return editableText(control, stored) === undefined;
}

/**
 * A position this build has no control for: shown by value, and removable.
 *
 * Its own component because it is a different SURFACE rather than a variation
 * of one — nothing here is editable, so no labelable element exists and the
 * label has to name the value by id instead of pointing at a field.
 *
 * UNTESTED as a CATALOG case, and stated rather than left to be assumed: every
 * leaf kind the engine ships resolves to a control, so only a catalog written
 * by a newer engine reaches this — and the catalog is compiled in rather than
 * registered, so no fixture can hand this panel an unknown kind. What IS
 * reachable and IS covered is the value: a node can store one at such a leaf,
 * and it compiles.
 */
function UnsupportedField({
  labelId,
  label,
  summary,
  actionName,
  leafKind,
  stored,
  onClear,
}: {
  labelId: string;
  label: string;
  summary: string | undefined;
  actionName: string;
  leafKind: StyleLeaf["kind"];
  stored: StyleValue | undefined;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <div className="nx-inspector__field" data-unsupported={leafKind}>
      {/* No `htmlFor`: this branch renders no labelable element. */}
      <Label id={labelId} title={summary}>
        {label}
      </Label>
      <RetainedValue
        labelledBy={labelId}
        label={actionName}
        stored={stored}
        note={`This build has no control for ${leafKind} values.`}
        onClear={onClear}
      />
    </div>
  );
}

/**
 * Apply one control's edit to the document, and say what happened to it.
 *
 * Lifted out of the field because it is a different question from drawing one:
 * the field owns what the author is looking at, and this owns the write — which
 * of two ops to build, which refusals are reportable, and which of the three
 * outcomes each produces.
 *
 * Read the node at COMMIT TIME rather than closing over one. A field committing
 * on blur can fire after another edit has already replaced the node, and
 * writing from the older copy would resurrect its styles.
 */
function writeStyleValue({
  editor,
  nodeId,
  address,
  policy,
  value,
  setIssue,
}: {
  editor: EditorState;
  nodeId: string;
  address: StyleAddress;
  policy: StylePolicy | undefined;
  /** `null` clears, which is not the same as writing an empty value. */
  value: StyleValue | null;
  setIssue: (message: string | null) => void;
}): CommitOutcome {
  const current = findNode(editor.document.nodes, nodeId);
  if (current === undefined) return "refused";
  /*
   * A ONE-NODE BATCH, and the single write path for a style edit in this
   * builder.
   *
   * Not because this panel needs batching — it edits one block — but because
   * the alternative is two implementations of "what ops set this address".
   * They agree the day they are written: `batchStyleWriteOps` was in fact
   * written from this function. Then one of them learns something — a policy
   * that varies, a refusal worded differently, a value the other still
   * accepts — and the surface an author reaches through a multi-selection
   * behaves unlike the one they reach through a single click, for a reason no
   * test names because each path passes its own.
   *
   * A group of one is exactly the single-op case: `applyAll(ops)` and
   * `apply(op)` are both `run(ops, "new")` in the store, so one op through
   * here costs one history entry and behaves identically. The batch layer is
   * therefore not a detour around the simple case — it IS the simple case,
   * with the count left open.
   */
  const write =
    value === null
      ? batchStyleClearOps([current], address, policy)
      : batchStyleWriteOps([current], address, value, policy);
  if (write.refused !== undefined) {
    setIssue(write.refused);
    return "refused";
  }
  setIssue(null);
  // No ops is the document already holding this value, which is the ordinary
  // case for a field blurred without being changed. Applying an empty group
  // would ask the op store for a history entry that undoes to no visible
  // effect, which it refuses.
  if (write.ops.length === 0) return "unchanged";
  // The store's own refusal, which the validator cannot anticipate: it judges
  // the edited leaf, while `applyOp` judges the whole document — a page at its
  // byte limit rejects an edit whose value is perfectly valid. Unreported, the
  // field goes on showing the draft and reads as saved while neither the
  // document nor the undo history moved.
  if (editor.applyAll(write.ops) === null) {
    setIssue("This edit could not be applied to the document.");
    return "refused";
  }
  return "applied";
}

/**
 * Where a control's value came from, as a dot beside its label.
 *
 * Three visible states, following the affordance `style-provenance.ts` already
 * says it follows: nothing set draws no dot at all, a value authored here is
 * accented, and one arriving from anywhere else is warned. An author scanning a
 * section sees at a glance which fields are theirs and which they would be
 * taking over by typing.
 *
 * **A dot rather than a written badge**, because a section holds eight or more
 * controls and a label naming the source would have to name its AXIS too once
 * breakpoints are in play — which does not fit beside a numeric input without
 * widening the panel or wrapping every row.
 *
 * **The source is named in the accessible label, not only in the tooltip.** A
 * `title` reaches a mouse and nothing else, so a dot carrying its meaning only
 * there is decoration to a screen-reader user and to anyone navigating by
 * keyboard. The text is the same in both.
 *
 * **`ambiguous` deliberately draws NOTHING.** One CSS property can be written by
 * two catalog controls — `background-image` comes from both `background.url`
 * and `backgroundGradient` — and with one of the pair stored, the trace cannot
 * say which control wrote it. A dot claiming a value this control does not hold
 * is worse than no dot, which is the same judgement `StyleProvenance` makes by
 * reporting the case rather than guessing.
 */
function ProvenanceDot({
  answer,
  editing,
  descendant,
}: {
  answer: ProvenanceAnswer | undefined;
  editing: EditedAddress;
  /** The control's own descendant selector, to tell its rules from a sibling's. */
  descendant: string | undefined;
}): React.JSX.Element | null {
  const described = describeProvenance(answer?.provenance, editing, descendant);
  if (described === null) return null;
  return (
    <>
      <span
        className="nx-style-inspector__provenance"
        data-provenance={described.kind}
        title={described.text}
        /*
         * A role, because the element is empty: the dot is drawn by the
         * stylesheet, so without one the label is the only content and assistive
         * technology has nothing to attach the description to.
         */
        role="img"
        aria-label={described.text}
      />
      {/*
       * The same sentence, for a sighted keyboard user.
       *
       * `title` reaches a POINTER and nothing else, and `aria-label` reaches
       * assistive technology and nothing else. Between them sits the person who
       * tabs to a control and can see the screen: they got a coloured dot with
       * no way to learn what it means, which is the one group the first two
       * accommodations do not cover.
       *
       * Revealed on `:focus-within` of the field rather than made focusable
       * itself. A focusable dot would put a second tab stop in front of every
       * control in a panel that already has eight or more per section, so
       * reaching the last field would cost twice the presses — fixing the
       * explanation by damaging the navigation it explains.
       *
       * `aria-hidden` because the dot beside it already carries this text: two
       * copies in the accessibility tree is the same sentence announced twice,
       * which reads as a stutter rather than as emphasis.
       */}
      <span className="nx-style-inspector__provenance-text" aria-hidden="true">
        {described.text}
      </span>
    </>
  );
}

/**
 * The dot's state and the sentence that names it, or `null` to draw nothing.
 *
 * Separated from the component so the wording is testable without rendering,
 * and so the two cannot drift: the tooltip and the accessible label are the same
 * string by construction rather than by two call sites agreeing.
 */
export function describeProvenance(
  provenance: StyleProvenance | undefined,
  editing: EditedAddress,
  controlDescendant?: string
): { kind: "authored" | "inherited"; text: string } | null {
  if (provenance === undefined) return null;
  if (provenance.kind === "authored") {
    return { kind: "authored", text: "Set here" };
  }
  if (provenance.kind !== "inherited") return null;
  return {
    kind: "inherited",
    text: `Inherited from ${originName(provenance.from, provenance.entry, editing, controlDescendant)}`,
  };
}

/**
 * Which block, class or tier a value came from — the SUBJECT of the phrase.
 *
 * Split from {@link originName} because the address that qualifies it is the
 * same for every tier while the subject is different for each, and composing
 * both in one function made the tier answers hard to read past the qualifiers.
 *
 * A same-node origin resolves to the CONTROL where one differs, because there
 * the control is what the author must open: a rule reaches a control whose
 * descendant selector is more specific than its own — `linkColorHover` displays
 * the plain `a` declaration when no hover value exists — and told "this block",
 * the author cannot find the field that holds it.
 */
function originSubject(
  origin: StyleOrigin,
  editing: EditedAddress,
  control: string | undefined
): string {
  switch (origin.kind) {
    case "class":
      return `.${origin.slug}`;
    case "blockType":
      /*
       * The same problem the `node` case has, and it arrives by the same route:
       * `reachesThroughAncestor` asks `reachesNode` about each ancestor, and
       * that matches a `blockType` origin against the ANCESTOR's type. So a
       * descendant rule from an enclosing block's defaults reaches this control
       * carrying that block's type, not this one's.
       */
      return origin.type === editing.blockType
        ? "this block's defaults"
        : "an enclosing block's defaults";
    case "page":
      return "the page";
    // Named for what an author can act on. "the `h1` baseline" rather than the
    // tier's internal name, because the next thing they do is either override
    // it on this block or replace the baseline for the whole site, and both
    // start from knowing which element it keys on.
    case "element":
      return `the ${origin.tag} typography baseline`;
    case "node":
      if (origin.id !== editing.nodeId) return "an enclosing block";
      return control ?? "this block";
  }
}

/**
 * The control a declaration came from, when it was not this one.
 *
 * `undefined` when the declaration belongs to this control's own address.
 *
 * The catalog is asked rather than the selector rendered: ` a` is not a name an
 * author has seen anywhere, while the property that writes it is the field they
 * are looking at.
 *
 * The multiple-writers guard is NOT currently reachable, and that is recorded
 * rather than left for someone to rediscover. Measured over the whole catalog,
 * exactly one `(cssProperty, descendant)` pair has two writers —
 * `background-image` with no descendant, from `background` and
 * `backgroundGradient` — and nothing writes `background-image` at a descendant
 * at all. So a differing descendant always resolves to one property today.
 *
 * It is kept because it is not redundant: nothing else stops this naming one of
 * two writers arbitrarily, and a control labelled with a field the author did
 * not touch is the failure this whole indicator exists to avoid. A catalog leaf
 * added at a descendant would reach it on the day it lands.
 */
function sourceControl(
  entry: StyleTraceEntry,
  controlDescendant: string | undefined
): string | undefined {
  const mine = (controlDescendant ?? "").trim();
  const theirs = (entry.descendant ?? "").trim();
  if (mine === theirs) return undefined;
  const writers = propertiesWriting(entry.property, entry.descendant);
  if (writers.length !== 1) return undefined;
  return `the ${fieldLabel(writers[0] ?? "")} control`;
}

/**
 * A breakpoint's author-facing name, or its id when the site defines no such
 * breakpoint.
 *
 * Resolved through `breakpointContexts` — the engine's own normalisation — and
 * not by searching the stored axes. The two disagree, and the disagreement is
 * exactly the case a label matters in. `breakpointContexts` sorts each axis
 * WIDEST-FIRST and then claims each id once, so of two rows storing the same id
 * the wider one survives and emits the rule; a raw search returns whichever was
 * stored first. With a narrow `dup` above a wider `dup`, the value on screen
 * comes from the wide row while the tooltip names the narrow one — an author
 * sent to a definition that did not produce the value.
 *
 * The surviving DEFINITION is then matched by axis and bound rather than by id
 * alone, because id alone is what is ambiguous here. Two rows sharing an id and
 * a bound differ only in their label, and the compiler's sort is stable, so the
 * first of those is the one it kept.
 *
 * Falling back to the id rather than to a placeholder: a value keyed to a
 * breakpoint the settings no longer define is exactly the case an author needs
 * to recognise, and "unknown" tells them nothing they can act on.
 */
export function breakpointLabel(
  breakpoints: BreakpointSet | undefined,
  id: BreakpointId
): string {
  // One matcher, in `style-provenance`. The survivor is found by BOUND as well
  // as id — among definitions sharing an id the compiler keeps one — and a
  // second lookup here would be a second place to lose that.
  return breakpointSource(id, breakpoints)?.label ?? id;
}

/**
 * Whether the stored document holds this id more than once.
 *
 * Asked of the STORED document rather than of the cascade's tree, which is the
 * whole point: preparation drops the later duplicate, so the tree the
 * declarations describe never contains one and could never report this.
 *
 * `walkNodes` rather than a walk written here — it is cycle-safe and
 * depth-bounded, and it deliberately visits the same node object twice when it
 * sits in two slots, which is precisely the shape being counted.
 */
function sharesItsId(editor: EditorState, id: string): boolean {
  let seen = 0;
  walkNodes(editor.document.nodes, node => {
    if (node.id === id) seen += 1;
  });
  return seen > 1;
}

/** Which node, state and breakpoint the panel is editing, to say what DIFFERS. */
export interface EditedAddress {
  readonly nodeId: string;
  /** The selected block's type, to tell its own defaults from an ancestor's. */
  readonly blockType: string | undefined;
  readonly state: StyleState;
  readonly breakpoint: BreakpointId;
  /** A breakpoint's author-facing name, for saying which one a value came from. */
  readonly labelOf: (breakpoint: BreakpointId) => string;
}

/**
 * What to call the place a value came from, as ONE address.
 *
 * Every axis that differs from what the panel is editing is named, not just the
 * first. Naming a subset is not a vaguer answer, it is a WRONG one: editing
 * hover at Tablet, a value arriving from base at Mobile labelled "this block at
 * Mobile" sends the author to a real address that does not hold the value, and
 * finding nothing there they conclude the indicator is broken.
 *
 * The qualifiers apply to EVERY tier, not only to a node. A class carries
 * responsive and interaction-state values of its own, so `.card` alone leaves an
 * author who opens the class editor at base looking at the wrong row — the same
 * misdirection, one tier over.
 *
 * The control is the SUBJECT for a same-node origin and a `via` clause for every
 * other tier, because that is what it means in each: on this block it is the
 * field to open, while on a class or an enclosing block it says which field's
 * rule reached here, and the place to go is still the class or the block.
 */
function originName(
  origin: StyleOrigin,
  entry: StyleTraceEntry,
  editing: EditedAddress,
  controlDescendant: string | undefined
): string {
  const control = sourceControl(entry, controlDescendant);
  const ownControl = origin.kind === "node" && origin.id === editing.nodeId;
  const parts = [originSubject(origin, editing, control)];
  if (!ownControl && control !== undefined) parts.push(`via ${control}`);
  if (entry.breakpoint !== editing.breakpoint) {
    parts.push(`at ${editing.labelOf(entry.breakpoint)}`);
  }
  if (entry.state !== editing.state) {
    parts.push(`in its ${entry.state} state`);
  }
  return parts.join(" ");
}

/**
 * The other half of a contrast pair, for a leaf that has one.
 *
 * Read from THIS node at the same state and breakpoint the control edits,
 * which is narrower than the cascade and is the honest limit of what this panel
 * can answer today: a background arriving from a named class, a block default
 * or a wider breakpoint is not seen, so the readout reports nothing rather than
 * measuring against a background that is not the one on the page.
 *
 * Answering it properly means asking `styleProvenance`, which has already
 * settled tier order, both breakpoint axes, states and specificity — and which
 * needs a `trace` of compiled declarations that nothing supplies to this panel.
 * Walking the cascade a second time HERE is the thing that must not happen.
 *
 * The address is reused rather than rebuilt so the state and breakpoint cannot
 * drift from the ones the control is reading its own value at — a pair measured
 * across two breakpoints is two colours that are never drawn together.
 */
function partnerColour(
  leaf: StyleLeaf,
  styles: NodeStyles | undefined,
  address: StyleAddress
): StyleValue | undefined {
  const property = contrastPartnerOf(leaf);
  if (property === undefined) return undefined;
  return readStyleValue(styles, { ...address, property, path: [] });
}

/**
 * Every id describing one control, or `undefined` when nothing does.
 *
 * A refusal message and a contrast verdict are both descriptions and neither
 * replaces the other: a control pointed only at the refusal never announces the
 * verdict, and one pointed only at the verdict drops the reason its last value
 * was refused. Joined here so the two cannot be traded off at a call site.
 *
 * Note what this deliberately does NOT decide: whether the control is INVALID.
 * A passing 21:1 contrast note is supplementary text, and a control inferring
 * invalidity from having a description announced a perfectly good colour as an
 * error.
 */
function describedByAll(
  refusal: string | undefined,
  verdict: string | undefined
): string | undefined {
  return (
    [refusal, verdict].filter(part => part !== undefined).join(" ") || undefined
  );
}

/**
 * Whether opening the picker here would REPLACE something the author has.
 *
 * True when the surface cannot show the stored value and there is a stored
 * value to lose — a reference, or non-empty text. The picker then starts at its
 * fallback rather than at the value, so the first movement writes something
 * unrelated to what was there, and the author is owed a warning first.
 *
 * The reference has to be tested explicitly: `storedText` answers `""` for one,
 * so a predicate reading the draft alone missed every token — including the two
 * that most need the warning, a token the site no longer defines and one whose
 * value this package cannot resolve.
 */
function wouldReplace(
  shown: string | undefined,
  reference: string | null,
  draft: string
): boolean {
  if (shown !== undefined) return false;
  return reference !== null || draft !== "";
}

/**
 * The text a control is editing, over the value the document holds.
 *
 * One implementation for both fields that need it. A draft is not just local
 * state: it has to be REPLACED whenever the stored value moves underneath — an
 * undo, an edit applied from elsewhere — or the control goes on showing a value
 * the document no longer has, and the remount key changes with the SELECTION,
 * which neither of those changes.
 *
 * `edited` is the same comparison every caller was making to decide whether a
 * commit is worth attempting, so it is answered here rather than at each.
 */
function useDraft(stored: StyleValue | undefined): {
  draft: string;
  setDraft: (value: string) => void;
  edited: boolean;
  reset: () => void;
} {
  const [draft, setDraft] = React.useState(() => storedText(stored));
  React.useEffect(() => {
    setDraft(storedText(stored));
  }, [stored]);
  return {
    draft,
    setDraft,
    edited: draft !== storedText(stored),
    reset: () => setDraft(storedText(stored)),
  };
}

/**
 * The hex a picker opens on when the stored value cannot be decomposed.
 *
 * Black, and it is never WRITTEN by being shown: the picker reports a colour
 * only when the author moves something. So this is where the surface starts for
 * a value it cannot represent, not a value substituted for one.
 */
const PICKER_FALLBACK = "#000000";

/**
 * A colour: a swatch that opens a picker, beside the field that owns the value.
 *
 * **The text field remains the control**, exactly as it does for a length. A
 * stored colour may be `oklch()`, `color-mix()`, a named colour, `currentcolor`,
 * a CSS-wide keyword or a `var()`, and a control that modelled the value as
 * RGBA would write every one of them away the moment it opened. The picker is
 * an affordance on top, and it reports nothing until the author moves it.
 *
 * **A token reference is EDITABLE here rather than read-only**, which is the
 * other half of what this control adds. `TokenValue` shows a reference and
 * offers only Clear because choosing a token had nowhere to happen; a colour
 * control has the site's table, so it shows the token's CURRENT name and lets
 * the author swap it, replace it with a literal, or remove it.
 *
 * **A token is stored by IDENTITY, never by the name shown.** The two differ
 * after a rename, and `ColourToken` carries both for that reason — the picker
 * hands back the swatch it was given, so the identity travels with it and the
 * label never reaches the document.
 *
 * **Literal and token are exclusive**, which is what the two layouts express.
 * The same rule Gutenberg's palette follows: a value is a reference or a
 * colour, and nothing sensible reads as both at once.
 */
function ColourField({
  id,
  labelledBy,
  control,
  stored,
  actionName,
  tokens,
  prefersDark,
  pairedColour,
  obscuredBy,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  control: StyleControl & { leaf: Extract<StyleLeaf, { kind: "color" }> };
  stored: StyleValue | undefined;
  actionName: string;
  tokens: SiteTokenSet | undefined;
  prefersDark: boolean;
  pairedColour: StyleValue | undefined;
  /**
   * A property on this node that puts something between the pair, or
   * `undefined` when none does. A verdict is withheld while one is set.
   */
  obscuredBy: string | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const noteId = React.useId();
  // Lifted out of the text field because two controls edit one value: a draft
  // private to the field would leave the swatch painting a superseded one.
  const { draft, setDraft, edited, reset } = useDraft(stored);

  const reference = isTokenRef(stored) ? stored.$token : null;
  const mode = activeTokenMode(tokens, prefersDark);
  const choices = colourTokensFor(control.leaf, tokens, mode);
  // What the picker composed, written once the gesture is over. Compared
  // against the stored text so closing a picker nobody moved writes nothing.
  // What the picker has produced and not yet written. Held in a ref as well as
  // in state because the unmount flush below reads it from a cleanup that runs
  // once, where the closed-over `draft` would be the value at first render.
  const pending = React.useRef<string | null>(null);
  /*
   * A discrete choice, which SUPERSEDES anything the picker was mid-way through.
   *
   * Dropping the pending value is the whole of it. Pressing this control also
   * dismisses the picker, and the close reads `pending.current` to decide what
   * the gesture produced — so clearing it first leaves that close with nothing
   * to write, and the discrete choice is the only edit. One rule expressed
   * once: a second expression of it is what drifts.
   */
  const commitInstead = (value: StyleValue | null): void => {
    pending.current = null;
    onCommit(value);
  };
  /*
   * The picker closed, whichever outcome that close had.
   *
   * ONE handler for both, because the two differ only in whether the gesture is
   * written — the pending value is dropped either way. Expressed as two
   * handlers, the supersede path is the one that silently does nothing: it
   * would leave the draft queued, and the unmount flush below would write it
   * back OVER the edit that superseded it, as a later op with no gesture behind
   * it.
   *
   * Synchronous, because an author can leave the editor entirely in the same
   * interaction that dismisses this popover: the page builder hands the current
   * document to its host form and unmounts, and a write scheduled for after
   * that lands on an editor nobody is reading any more. The gesture is simply
   * gone from the document handed over.
   *
   * Which is why the supersede below is decided by WHERE the interaction went
   * rather than by giving a later handler time to cancel a scheduled write. A
   * timer bought that cancellation and paid for it with this race.
   */
  const closed = (outcome: PickerClose): void => {
    const unwritten = pending.current;
    pending.current = null;
    if (outcome === "superseded" || unwritten === null) return;
    if (onCommit(unwritten) === "unchanged") reset();
  };
  // The current writer, held so the teardown below depends on nothing. A
  // teardown listing `onCommit` would re-run its cleanup on every render that
  // gives the field a new callback — which is every render — and flush a
  // gesture the author is still making.
  const write = React.useRef(onCommit);
  React.useEffect(() => {
    write.current = onCommit;
  });
  /*
   * Write an unfinished gesture when this field goes away, and do it NOW.
   *
   * Two ways to leave without closing the popover: selecting another block in
   * the canvas iframe cannot reach the outside-dismiss handler, and the
   * selection change remounts this field without firing `onOpenChange`. A
   * scheduled write would not survive either, so the timer is cancelled and the
   * value written synchronously rather than left to a callback whose component
   * has gone.
   */
  React.useEffect(
    () => () => {
      const unwritten = pending.current;
      pending.current = null;
      // The outcome is DROPPED, and that is the honest limit rather than an
      // oversight. A refusal here — a document at its byte limit, say — is
      // reported through state belonging to a component that is going away, so
      // there is nobody left to show it to and nowhere to keep the value: the
      // ref does not survive the remount either. Writing when the document
      // accepts strictly improves on not writing at all, and cannot improve the
      // case where it does not.
      //
      // Closing it properly means the pending edit living somewhere that
      // outlives one field, which is the same thing undo and the unsaved-work
      // guard need and is tracked with them.
      if (unwritten !== null) write.current(unwritten);
    },
    []
  );
  // What the surface is currently SHOWING: the draft while a literal is being
  // typed, so the swatch follows the field, and the stored value for a
  // reference, which no field is editing. Named once and resolved once, rather
  // than resolved in each branch — two calls to the same resolver is the shape
  // that drifts.
  // Once the draft has MOVED, it is what the surface shows — including over a
  // stored token. Pinned to `stored` for a reference, the picker was handed the
  // token's own hex again on every render, and its prop-sync effect reset the
  // surface to it: the controls snapped back mid-drag and a token could not be
  // replaced with a literal by using the picker at all.
  const storedLabel = storedTokenLabel(reference, tokens, mode, choices);
  const showing = reference === null || edited ? draft : stored;
  const shown = colourHexOf(showing, tokens, mode);
  // Measured from what the surface is SHOWING, which is the same value the
  // swatch is painted from. Reading `stored` instead left the verdict describing
  // the old colour for the whole of a picker gesture — stale exactly while an
  // author is choosing, which is when a contrast readout is for — and put the
  // swatch and the figure beside it on two different colours.
  const contrast =
    obscuredBy === undefined
      ? contrastAtLeaf(control.leaf, showing, pairedColour, tokens, mode)
      : undefined;
  const describes = describedByAll(
    describedBy,
    contrast === undefined ? undefined : noteId
  );

  return (
    <>
      <div
        className="nx-style-inspector__colour"
        // Named as a GROUP only where there is no field to carry the name: with
        // a text input present the label points at it directly, and a group
        // wrapping a named control announces the property twice.
        {...(reference === null
          ? {}
          : { role: "group", "aria-labelledby": labelledBy })}
      >
        <ColourPicker
          shown={shown}
          choices={choices}
          actionName={actionName}
          describedBy={describes}
          invalid={describedBy !== undefined}
          unrepresented={wouldReplace(shown, reference, draft)}
          // The draft moves with the pointer and the DOCUMENT does not. A drag
          // across the saturation surface fires `onColorChange` on every
          // pointer event, and committing each one writes an editor op each
          // time: one gesture becomes dozens of undo entries, and `MAX_HISTORY`
          // is 100, so a single drag can evict unrelated earlier edits and
          // leave undo walking intermediate colours instead of reverting the
          // gesture. This is the rule the text fields already follow — an op
          // per keystroke would make one undo remove one character.
          onColour={value => {
            pending.current = value;
            setDraft(value);
          }}
          // The gesture ends where the picker closes, whichever way it closed.
          onClosed={closed}
          /*
           * Any control that writes THIS field's value for itself, declared on
           * the element. The token clear beside this picker is one; a
           * breakpoint Reset is another, and it lives in a different component
           * that has no way to hand a ref down here.
           */
          supersededBy={target => supersedes(target, id)}
          // A preset is one discrete choice rather than a gesture, so it
          // commits immediately, exactly as the select and toggle controls do.
          onToken={identity => commitInstead({ $token: identity })}
        />
        {reference === null ? (
          // The SAME field every other text control uses, rather than one
          // written here. Commit on blur, Enter, the empty draft that clears
          // instead of storing `""`, and the `unchanged` case that puts back
          // what the document holds are one contract — and a second copy of it
          // beside the first is what drifts, silently, in the direction of
          // losing an edit.
          <TextField
            id={id}
            control={control}
            stored={stored}
            draft={draft}
            setDraft={setDraft}
            describedBy={describes}
            // The REFUSAL alone. `describes` also carries the contrast verdict,
            // which is supplementary text and never a complaint.
            invalid={describedBy !== undefined}
            onCommit={onCommit}
          />
        ) : (
          <TokenName
            label={storedLabel}
            actionName={actionName}
            fieldId={id}
            onClear={() => commitInstead(null)}
          />
        )}
      </div>
      <ContrastNote id={noteId} contrast={contrast} />
    </>
  );
}

/**
 * The swatch, and the surface it opens onto.
 *
 * Its own component because CHOOSING a colour is a different question from
 * showing one: the row below owns the stored value and its text, and this owns
 * the picker, the token swatches and what the trigger is painted with. Kept
 * together here because all three read the one resolved colour, and split from
 * the row because neither half needs the other's state.
 *
 * The two callbacks stay separate for the reason `ColorPicker` keeps them
 * separate: only the host knows what a swatch MEANS. A token hands back its
 * identity and never the colour it currently resolves to — storing that would
 * turn a reference into a literal and stop the page following the token.
 */
function ColourPicker({
  shown,
  choices,
  actionName,
  describedBy,
  invalid,
  unrepresented,
  onColour,
  onClosed,
  supersededBy,
  onToken,
}: {
  /** The resolved colour, or `undefined` when nothing here can resolve one. */
  shown: string | undefined;
  choices: readonly ColourToken[];
  actionName: string;
  /** Everything describing the control: a refusal, a contrast verdict, or both. */
  describedBy: string | undefined;
  /** Whether the last value was refused. A contrast verdict is not a refusal. */
  invalid: boolean;
  /** Whether the stored value is one the picker cannot show. */
  unrepresented: boolean;
  /** The picker moved. Fires on every pointer event during a drag. */
  onColour: (hex: string) => void;
  /**
   * The picker closed, and how.
   *
   * The outcome is a value rather than the presence or absence of a call,
   * because "superseded" is an instruction to DISCARD the gesture, not an
   * absence of one — and a host given only the write path has nowhere to drop
   * what it was holding.
   */
  onClosed: (outcome: PickerClose) => void;
  /**
   * Whether the control being PRESSED outside the popover writes THIS field's
   * value itself.
   *
   * Asked before the dismissal is turned into a write, so a control that both
   * closes this picker and commits the same value does not produce two edits
   * for one intent — the author would otherwise undo the reset and get back the
   * colour they pressed it to be rid of.
   *
   * The target is a press rather than any interaction, because Radix dismisses
   * on focus as well and a focused button has not written anything. See where
   * this is bound.
   */
  supersededBy: (target: EventTarget | null) => boolean;
  onToken: (identity: string) => void;
}): React.JSX.Element {
  // Whether the dismissal in progress belongs to a control that writes for
  // itself. Read once by the close below and reset there, so it cannot leak
  // into the next open.
  const superseded = React.useRef(false);
  return (
    <Popover
      onOpenChange={open => {
        if (open) return;
        const own = superseded.current;
        superseded.current = false;
        onClosed(own ? "superseded" : "committed");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="nx-style-inspector__swatch"
          aria-label={`Colour for ${actionName}`}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          // Painted through a custom property rather than `background-color`
          // directly, so the chequerboard beneath a translucent colour stays
          // visible through it. `undefined` leaves the class's own "nothing
          // here" appearance rather than a colour this cannot vouch for.
          style={
            shown === undefined
              ? undefined
              : ({ "--nx-swatch": shown } as React.CSSProperties)
          }
          data-empty={shown === undefined ? "" : undefined}
        />
      </PopoverTrigger>
      <PopoverContent
        className="nx-style-inspector__picker"
        /*
         * A PRESS, not any dismissal whose target happens to be such a control.
         *
         * `onInteractOutside` also fires when focus merely LEAVES the popover —
         * a keyboard author tabbing out lands on the Reset beside this control
         * and dismisses it without activating anything. Read there, the gesture
         * they were composing is discarded by a button they never pressed, and
         * tabbing onward loses it silently.
         *
         * The question is not which cause dismissed the popover but whether a
         * control is about to WRITE, and only a pointer press implies that: the
         * press is followed by the click that runs the handler. Focus is not,
         * so a focus dismissal falls through to the ordinary close and the
         * gesture is committed — which is what leaving a control does
         * everywhere else in this panel, the text fields included.
         */
        onPointerDownOutside={event => {
          // Only a press that can RUN the control supersedes. See `activates`.
          superseded.current =
            activates(event.detail.originalEvent) && supersededBy(event.target);
        }}
      >
        {unrepresented ? (
          <p className="nx-inspector__note">
            This value cannot be shown on the picker. Choosing here replaces it.
          </p>
        ) : null}
        <ColorPicker<ColourToken>
          // A fallback only where nothing could be resolved, and it is never
          // WRITTEN by being shown: the picker reports a colour only once the
          // author moves something, so opening it over a value it cannot
          // represent changes nothing.
          color={shown ?? PICKER_FALLBACK}
          showAlpha
          swatches={choices.map(choice => ({
            // The IDENTITY as the swatch id, which is what keeps the list
            // stable across a rename: a key built from the label would remount
            // every renamed token's swatch, and would collide between a renamed
            // token and a new one that took its old name.
            id: choice.identity,
            // Qualified with the identity only where another offered token
            // shares this name. Two presets under one label with equal or
            // unresolvable colours are indistinguishable, and choosing either
            // stores an identity the author could not have predicted.
            label: colourTokenLabel(choice, choices),
            // The RESOLVED colour, never the token's raw value. A preset button
            // paints what it is handed, so a token holding `var(--brand)`,
            // `currentcolor` or a CSS-wide keyword would resolve against the
            // inspector rather than the canvas and show a colour the page does
            // not have — the same failure the main swatch refuses. A token this
            // package cannot resolve paints nothing and stays choosable, which
            // is what keeps the reference reachable.
            color: choice.swatch ?? "transparent",
            value: choice,
          }))}
          onColorChange={onColour}
          onSwatchSelect={swatch => {
            if (swatch.value !== undefined) onToken(swatch.value.identity);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * What a STORED reference is called, for the row that displays it.
 *
 * Three answers to one question, which is why it is asked in one place: a
 * reference the site still defines reads as that token's current name; one
 * whose name another offered token shares is qualified with its identity, so
 * the two rows cannot be confused; and one the site no longer defines at all
 * reads as the raw identity the document holds. That last case is a warning
 * rather than an error — the value goes on compiling — so showing the stored
 * string is more use than showing an empty space.
 *
 * Separate from {@link colourTokenLabel} because that one answers about a token
 * in hand, and this one has to find the token first, or account for there being
 * none.
 */
function storedTokenLabel(
  reference: string | null,
  tokens: SiteTokenSet | undefined,
  mode: TokenMode,
  among: readonly ColourToken[]
): string {
  if (reference === null) return "";
  const token = colourTokenFor(reference, tokens, mode);
  return token === undefined ? reference : colourTokenLabel(token, among);
}

/**
 * A stored token, by the name an author reads, with the way to remove it.
 *
 * The name is resolved by the caller and the fallback is the stored identity,
 * which is the honest answer for a reference to a token the site no longer
 * defines: an unknown token is a warning rather than an error, so the value
 * goes on compiling and the author is shown the string their document holds
 * rather than an empty space.
 */
function TokenName({
  label,
  actionName,
  fieldId,
  onClear,
}: {
  /**
   * What to show: the token's current name, qualified with its identity where
   * another offered token shares that name, and the identity alone when the
   * site defines no token for it. Resolved by the caller, which is the only
   * place that holds the list the collision would be against.
   */
  label: string;
  actionName: string;
  /** The field whose value this clear writes. See {@link commitsFor}. */
  fieldId: string;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <>
      <span className="nx-style-inspector__colour-token">{label}</span>
      <button
        /*
         * This press writes this field's value: it commits the clear, and the
         * picker must not also write the draft its dismissal would otherwise
         * flush. Declared rather than handed up as a ref, so any control making
         * the same promise says so the same way.
         */
        {...commitsFor(fieldId)}
        type="button"
        onClick={onClear}
        aria-label={`Clear ${actionName}`}
      >
        Clear
      </button>
    </>
  );
}

/**
 * How a colour pair fares, or nothing at all.
 *
 * `undefined` renders NOTHING rather than a placeholder, an approximation or a
 * last-known figure. That is the engine's own reasoning carried up one level:
 * a ratio computed from a colour that was misread "is worse than no figure,
 * because it is a number somebody will act on", and there is no honest estimate
 * of the contrast against a `var()` whose value the page decides at render.
 *
 * A failing pair is a WARNING and never a refusal — the value is valid, stored
 * and compiling, and the author may have a reason. The same position
 * Gutenberg's contrast checker takes.
 */
function ContrastNote({
  id,
  contrast,
}: {
  id: string;
  contrast: ContrastResult | undefined;
}): React.JSX.Element {
  return (
    <p
      className="nx-style-inspector__contrast"
      id={id}
      // Announced as it changes, because the verdict moves while focus is
      // INSIDE the picker — on the saturation square, the hue strip, the alpha
      // strip or the hex field — and none of those controls is described by
      // this note. `aria-describedby` is read when a control receives focus, so
      // a figure that changes during the interaction is never spoken. Polite
      // rather than assertive: it coalesces while a drag is moving and speaks
      // once the author pauses, which is when the number is wanted.
      aria-live="polite"
      // Mounted even with nothing to say. A live region announces CHANGES to
      // its contents, so one that arrives with its text already in place is not
      // a change and is silent — the state this note is in every time a colour
      // first becomes measurable. Empty it occupies no space; `:empty` drops
      // the margin rather than the box, because `display: none` would take it
      // out of the accessibility tree and stop it announcing at all.
      {...(contrast === undefined ? {} : { "data-level": contrast.level })}
    >
      {contrast === undefined
        ? ""
        : `Contrast ${contrastRatioText(contrast)} — ${
            contrast.passesBodyText
              ? `passes AA for body text (${contrast.level})`
              : "below AA for body text"
          }`}
    </p>
  );
}

/**
 * The control a leaf's kind resolves to.
 *
 * A keyword leaf carries a closed vocabulary: two values get a toggle and more
 * than two get a select over them. Every other kind is drawn as a text field
 * that accepts whatever the catalog judges — `length`, `number`, `color`, `css`
 * and `url` all store a scalar — with the numeric affordances layered on top
 * where the stored value is a single measurement.
 *
 * Layered rather than substituted, which is the decision worth keeping. A field
 * that MODELLED a length as a number and a unit could not hold `auto`,
 * `clamp(...)`, a two-part shorthand or a token, and would write each of them
 * away on the first edit. So the text field remains the control and the stepper
 * and unit menu are affordances it grows when the value is simple enough to
 * carry them; `style-numeric.ts` decides when that is, and answers `undefined`
 * rather than guessing.
 */
function ValueField({
  id,
  labelledBy,
  control,
  stored,
  actionName,
  describedBy,
  onCommit,
}: {
  id: string;
  /** The field label's id, so a group of buttons can be named by it. */
  labelledBy: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  /** What this control's clear action removes, named for the property. */
  actionName: string;
  /**
   * The id of the message explaining why this control's last value was refused,
   * or `undefined` when nothing was. Also what marks the control invalid: the
   * two travel together because a control described by an error message and not
   * marked invalid reads as one carrying a hint.
   */
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  // Decided BEFORE the menu, because every keyword leaf resolves to the
  // `select` control kind — so a branch on that kind placed first would return
  // for all of them and the toggle could never be reached.
  const toggle = toggleOptionsFor(control.leaf);
  if (toggle !== undefined && toggleShows(toggle, stored)) {
    return (
      <ToggleField
        id={id}
        labelledBy={labelledBy}
        options={toggle}
        stored={stored}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }

  // A keyword vocabulary too wide for a toggle is a menu. Narrowed here rather
  // than inside the component so the leaf carries its own kind through.
  if (control.kind === "select" && control.leaf.kind === "keyword") {
    return (
      <SelectField
        id={id}
        control={{ ...control, leaf: control.leaf }}
        stored={stored}
        actionName={actionName}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  return (
    <NumericField
      id={id}
      control={control}
      stored={stored}
      actionName={actionName}
      describedBy={describedBy}
      onCommit={onCommit}
    />
  );
}

/**
 * Two keywords as two buttons, with the current one pressed.
 *
 * `aria-pressed` rather than a radio group: these are two states of one
 * property rather than a choice among options that includes "neither", and the
 * clear affordance beside them is what expresses unset. Labelled by the field's
 * own label, so a screen reader reads the property name before the state.
 */
function ToggleField({
  id,
  labelledBy,
  options,
  stored,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  options: readonly [string, string];
  stored: StyleValue | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  return (
    <div
      // The field's id sits on the GROUP rather than on either button. The
      // field label carries `htmlFor`, and a label pointing at a button
      // forwards a click to it — so naming the first option that way would make
      // clicking the property label press it, or clear it when already pressed,
      // and write an edit the author never asked for. A `div` is not labelable,
      // so the association is inert and the group is named by `aria-labelledby`
      // instead, which is what a screen reader reads either way.
      id={id}
      className="nx-style-inspector__toggle"
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      {options.map(option => {
        const pressed = stored === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            // Marked on the BUTTONS rather than on the group, which carries the
            // description. `aria-invalid` is not a state `role="group"`
            // supports, so setting it there would be an attribute a screen
            // reader is entitled to ignore — and the file's own rule is that a
            // control described by a refusal must also read as invalid, or it
            // announces the message as a hint rather than as a failure.
            aria-invalid={describedBy === undefined ? undefined : true}
            // Pressing the pressed option CLEARS rather than re-writing it,
            // which is the only way a two-button group can reach unset without
            // a third button standing for "neither".
            onClick={() => onCommit(pressed ? null : option)}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The text field, plus the affordances a value that is one measurement earns.
 *
 * The input stays a TEXT field whatever the value is, which is the whole design:
 * `auto`, `clamp(...)`, a shorthand and a token all remain typeable and none is
 * rewritten. The numeric behaviour is LAYERED on — arrow keys step the quantity
 * and a menu swaps the unit — and both disengage silently when the current value
 * is not a single measurement, so nothing an author can express is taken away by
 * the field being clever about the common case.
 */
function NumericField({
  id,
  control,
  stored,
  actionName,
  describedBy,
  onCommit,
}: {
  id: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  /**
   * This control's own name, position included.
   *
   * Taken from the caller rather than derived from the property here: a
   * composite draws one of these per side, and a name built from the property
   * alone would give all four of `padding`'s menus the same accessible name,
   * leaving a screen reader no way to tell which side one edits.
   */
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const units = unitChoicesFor(control.leaf);
  // The draft lives HERE rather than inside the text field, because two
  // controls edit one value and the unit menu was reading the other copy. An
  // author who types `20` over `12px` and then picks `rem` had the blur refuse
  // the unitless draft, leaving `12px` stored — and the menu composed from
  // THAT, committing `12rem` and discarding the 20 they were looking at.
  const { draft, setDraft } = useDraft(stored);
  // Read from the DRAFT, so the menu offers units for the quantity on screen
  // and swaps the unit on that quantity rather than on a superseded one.
  const measurement = measurementOfText(draft);
  // The menu is shown only where it can act. Rendered against a value it cannot
  // decompose, every choice in it would be a no-op, and a disabled-looking
  // control that silently does nothing is worse than one that is not there.
  //
  // A UNITLESS draft keeps the menu rather than losing it, because typing the
  // quantity and then choosing the unit is an ordinary way to write one — and a
  // control that vanishes mid-edit is worse than one showing no selection. A
  // leaf with no units to offer never reaches this: `unitChoicesFor` answers
  // empty for anything that is not a dimension, so `line-height` as a number
  // has no menu to gain a unit from.
  const showUnits = units.length > 0 && measurement !== undefined;
  // A stored unit the candidate list does not carry — `ch`, or an uppercase
  // `PX` the validator folds — is live and compiles while matching no item, and
  // a controlled select over it renders an EMPTY trigger above a value that is
  // doing something. Offered verbatim as its own item, which is what the
  // keyword select above already does for a value outside its vocabulary.
  const extraUnit =
    measurement !== undefined &&
    measurement.unit !== "" &&
    !units.includes(measurement.unit)
      ? measurement.unit
      : null;

  return (
    <div className="nx-style-inspector__numeric">
      <TextField
        id={id}
        control={control}
        stored={stored}
        draft={draft}
        setDraft={setDraft}
        describedBy={describedBy}
        invalid={describedBy !== undefined}
        onCommit={onCommit}
        onStep={(draft, delta) => {
          const next = steppedValue(control.leaf, draft, delta);
          // `undefined` means this value cannot be stepped or the result would
          // be refused, so the key does nothing rather than writing a value the
          // document then rejects.
          if (next === undefined) return null;
          onCommit(next);
          return String(next);
        }}
      />
      {showUnits ? (
        <Select
          // The empty string, never `undefined`. Radix reads `""` as "no
          // selection" and shows the placeholder, while `undefined` switches it
          // from controlled to UNCONTROLLED — where it keeps whatever was last
          // picked, so a unit added and then undone leaves the trigger still
          // displaying it while the draft has none. The draft is the only unit
          // state, and passing `undefined` would give it a second one.
          value={measurement.unit}
          onValueChange={unit => {
            // Composed from the draft, which is what the author is looking at.
            const next = withUnit(control.leaf, draft, unit);
            if (next === undefined) return;
            if (onCommit(next) !== "refused") setDraft(next);
          }}
        >
          <SelectTrigger
            className="nx-style-inspector__unit"
            aria-label={`Unit for ${actionName}`}
            // A unit change can be refused — a document at its byte limit, a
            // value the validator rejects — and the message that explains it is
            // rendered once for the field. Pointed at from HERE as well as from
            // the text input, because a screen-reader user who returns to the
            // menu is otherwise on the control that failed with nothing saying
            // so and no way to reach the reason.
            aria-describedby={describedBy}
            aria-invalid={describedBy === undefined ? undefined : true}
          >
            <SelectValue placeholder="unit" />
          </SelectTrigger>
          <SelectContent>
            {extraUnit === null ? null : (
              <SelectItem value={extraUnit}>{extraUnit}</SelectItem>
            )}
            {units.map(unit => (
              <SelectItem key={unit} value={unit}>
                {unit}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

/**
 * A text field over one stored value.
 *
 * The draft is local so a half-typed value — `16` on the way to `16px` — is not
 * sent to the validator on every keystroke and refused four times while the
 * author is still typing.
 */
function TextField({
  id,
  control,
  stored,
  draft,
  setDraft,
  describedBy,
  invalid,
  onCommit,
  onStep,
}: {
  id: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  /**
   * The text being edited, owned by the caller.
   *
   * Lifted because a numeric row has TWO controls over one value — the field
   * and the unit menu — and a draft private to this one leaves the other
   * reading the stored value instead, which is a different and usually older
   * answer to what the author is editing.
   */
  draft: string;
  setDraft: (value: string) => void;
  /**
   * Everything describing this field: a refusal message, a contrast verdict, or
   * both.
   *
   * Separate from {@link invalid}, and that separation is the point. A
   * description is not a complaint — a passing 21:1 contrast note is
   * supplementary text — so a field that inferred invalidity from having a
   * description would announce a perfectly good colour as invalid.
   */
  describedBy: string | undefined;
  /** Whether the LAST value was refused, which is the only thing that invalidates. */
  invalid: boolean;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  /**
   * Applies one arrow-key step to the text currently shown, answering the text
   * that was written or `null` when nothing was.
   *
   * `null` leaves the key to its default behaviour, which is what keeps a value
   * that is not a single measurement — a shorthand, a function, a keyword —
   * behaving like ordinary text under the caret. The DRAFT is passed rather
   * than read from the store, so a step lands on what the author is looking at.
   */
  onStep?: (draft: string, delta: number) => string | null;
}): React.JSX.Element {
  const commit = () => {
    if (draft === storedText(stored)) return;
    // CSS whitespace here too, not JavaScript's. `String.prototype.trim` also
    // strips NBSP and the Unicode spaces, so a draft of nothing but a
    // non-breaking space would read as empty and DELETE the declaration —
    // where the engine treats it as a value and refuses it.
    const emptied = trimCssWhitespace(draft) === "";
    const outcome = onCommit(
      emptied ? null : committedValue(control.kind, draft)
    );
    // The document did not move because it already holds this value in another
    // spelling: `01`, `+1` and `1e0` all commit as the `1` that is stored. The
    // effect above cannot cover it — `stored` is identical, so it does not fire
    // — and without this the field goes on showing text the document does not
    // contain until something remounts it. A REFUSAL deliberately keeps the
    // draft: the author has to be able to correct what they typed.
    if (outcome === "unchanged") setDraft(storedText(stored));
  };

  return (
    <Input
      id={id}
      value={draft}
      placeholder={placeholderFor(control)}
      aria-describedby={describedBy}
      aria-invalid={invalid ? true : undefined}
      // Committed on blur and on Enter, matching the content tab: an op per
      // keystroke would make one undo remove one character.
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (commitOnEnter(event, commit)) return;
        if (onStep === undefined) return;
        const delta = arrowStep(event);
        if (delta === null) return;
        // Stepped from the DRAFT rather than from what is stored, so the key
        // works while an author is mid-edit — which is most of when they reach
        // for it. Reading `stored` instead would either discard an uncommitted
        // edit or, if it declined to act, leave the arrow doing nothing in a
        // text input that has no numeric fallback: an affordance that appears
        // broken exactly while it is being used.
        const next = onStep(draft, delta);
        if (next === null) return;
        // The draft follows the value that was written, so the field shows the
        // step immediately rather than waiting for `stored` to come back.
        setDraft(next);
        // Only once the step was applied, so an unsteppable value keeps the
        // caret movement the key would otherwise perform.
        event.preventDefault();
      }}
    />
  );
}

/**
 * The step one key press asks for, or `null` when it asks for none.
 *
 * Separated from the handler so that WHICH keys are claimed is one readable
 * answer rather than a run of early returns inside an event callback — and so
 * the two rules it encodes sit together, since they are easy to change apart
 * and wrong apart.
 *
 * Arrow steps by one and Shift by ten, which is what Figma, Framer and Webflow
 * all do: an author arrives already knowing it, and a different scale here
 * would cost them for no gain.
 *
 * Alt, Control and Meta are refused outright. Those chords are platform,
 * browser and assistive-navigation shortcuts, so claiming one would mutate a
 * style and add an undo entry from a keystroke aimed somewhere else entirely.
 */
function arrowStep(event: React.KeyboardEvent): number | null {
  // A keystroke arriving mid-composition belongs to the IME, which uses the
  // arrows to move through conversion candidates. Stepping there would edit the
  // style AND suppress the candidate move, so the author loses both. The
  // shortcut manager states the same rule for the same reason, and this is the
  // second reader of a keyboard event in this repository that has to know it.
  if (event.nativeEvent.isComposing) return null;
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const direction =
    event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
  if (direction === 0) return null;
  return direction * (event.shiftKey ? 10 : 1);
}

/**
 * Which section is open, given what the author has said.
 *
 * Three states, not two: not yet chosen falls back to the first section so the
 * panel never opens onto a column of headings; the empty string is an explicit
 * collapse and is honoured; and a section the newly selected block does not
 * offer falls back, because an accordion asked to open one it does not have
 * shows nothing open at all.
 */
function openSection(
  chosen: string | null,
  available: ReadonlySet<string>,
  first: string
): string {
  if (chosen === null) return first;
  if (chosen === "") return "";
  return available.has(chosen) ? chosen : first;
}

/** A stored value as a text field shows it. */
function storedText(value: StyleValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** How much of an unrepresentable value is worth showing before it stops helping. */
const DISPLAY_LIMIT = 80;

/**
 * A stored value as a READ-ONLY surface shows it, including one no field can
 * edit.
 *
 * Separate from {@link storedText}, which answers what a text field's draft
 * starts as and is right to give `""` for a shape it cannot type. Here `""`
 * would be a lie: the surface exists precisely because something IS stored, and
 * a blank one beside a Clear button tells an author to remove they-cannot-see-
 * what.
 */
function displayText(value: StyleValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isTokenRef(value)) return value.$token;
  // Its own JSON, because there is nothing else honest to show: the value is
  // live on the page and the author is being asked whether to remove it.
  // Truncated because a panel column is not a document viewer, and a value long
  // enough to need this is already one nothing here can repair.
  const json = jsonText(value);
  return json.length > DISPLAY_LIMIT
    ? `${json.slice(0, DISPLAY_LIMIT)}…`
    : json;
}

/**
 * A value's JSON, or a stand-in when it has none.
 *
 * `JSON.stringify` THROWS on a circular reference rather than declining to
 * answer, and a panel that throws while rendering leaves the author with no
 * Clear button at all — which is the exact failure this surface exists to
 * prevent, arrived at from the other direction. Nothing in the document
 * pipeline can produce one today, since a stored document is parsed from JSON;
 * the guard is here because it costs one branch on a path that already decided
 * the value is unrepresentable.
 *
 * The fallback makes no claim about the value beyond being unable to show it,
 * which is what keeps it honest: the Clear beside it still works.
 */
function jsonText(value: StyleValue): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "(value cannot be shown)";
  }
}

/**
 * A stored value as this control's EDITING surface shows it, or `undefined`
 * when that surface cannot show it at all.
 *
 * Two shapes reach this. An object at a scalar position — `fontSize: {value:
 * "12px"}` from an import or the API — has no text spelling, and a text field
 * given `""` for it reads as UNSET while the value compiles; worse, the one
 * keystroke that would clear it is refused, because an emptied draft already
 * equals that empty projection. And a number stored where the leaf's vocabulary
 * is keywords has no item to be current, so the select renders its "Not set"
 * placeholder over a value that is doing something.
 *
 * Both are the same question — can the author see and change this here — so
 * they get one answer rather than a check in each control.
 */
function editableText(
  control: StyleControl,
  value: StyleValue | undefined
): string | undefined {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "number") return undefined;
  return control.kind === "select" ? undefined : String(value);
}

/**
 * What a typed string is stored as.
 *
 * A `number` leaf takes a NUMBER, and accepts a string only as one of the
 * CSS-wide keywords — measured: `opacity: "0.5"` is refused where `opacity: 0.5`
 * is accepted. So a numeric-looking draft is converted and anything else is
 * passed through, which is what lets `inherit` reach a numeric property and
 * lets every other refusal carry the catalog's own message.
 *
 * Every other kind stores its value as written: a `dimension` accepts the
 * string `"0"` as readily as the number, so converting there would change what
 * is stored without changing what is valid.
 */
function committedValue(
  kind: StyleControlKind | undefined,
  draft: string
): StyleValue {
  if (kind !== "number") return draft;
  // The engine's own trim, not `String.prototype.trim`, which also strips NBSP
  // and the Unicode spaces where CSS strips neither. Trimming wider than CSS
  // does turns a spelling the engine REFUSES into a number it accepts: pasting
  // a non-breaking space before a digit would silently store the digit.
  const trimmed = trimCssWhitespace(draft);
  // `Number` reads spellings CSS does not: `0x10` becomes 16, `0b10` becomes 2,
  // `0o10` becomes 8. Converting those would store a number the author never
  // typed and pass validation, so only the grammar CSS calls a <number> is
  // converted and everything else is left for the catalog to judge.
  if (!CSS_NUMBER.test(trimmed)) return draft;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : draft;
}

/**
 * The hint for a kind whose form does not vary with the leaf's own fields.
 *
 * Partial on purpose, and the one place in this lane where a fallthrough is the
 * right answer: a placeholder is advisory text, so a leaf kind this build has
 * not learned about gets a generic hint rather than a compile error. Whether
 * the kind can be DRAWN at all is a different question, and `style-controls.ts`
 * already answers it with a mapped type that does fail to compile.
 */
const FIXED_PLACEHOLDER: Partial<Record<StyleLeaf["kind"], string>> = {
  keyword: "Not set",
  cssValue: "Not set",
  // The FORM rather than an example, as the length and number hints are. A
  // literal here would also be a hardcoded colour, which this repository bans
  // outright — the rule reads source, not intent, and it is right to: a hex in
  // a placeholder is one copy away from a hex in a style.
  color: "hex, rgb(), or a colour name",
  url: "https://…",
};

/** A length's hint, which depends on what the catalog lets this one hold. */
function dimensionHint(
  leaf: Extract<StyleLeaf, { kind: "dimension" }>
): string {
  const units = leaf.allowPercentage === true ? "16px or 50%" : "16px";
  // The catalog's helper always writes this field, and the TYPE leaves it
  // optional — so a leaf assembled by hand, which every fixture in this package
  // is, legitimately arrives without one.
  const keywords = leaf.keywords ?? [];
  return keywords.length > 0 ? `${units}, or ${keywords.join(", ")}` : units;
}

/** A number's hint, which names its bounds when the catalog gives it both. */
function numberHint(leaf: Extract<StyleLeaf, { kind: "number" }>): string {
  if (leaf.min === undefined || leaf.max === undefined) return "a number";
  return `${leaf.min} to ${leaf.max}`;
}

/** A hint at the form this leaf takes, from the catalog rather than a list here. */
function placeholderFor(control: StyleControl): string {
  const { leaf } = control;
  if (leaf.kind === "dimension") return dimensionHint(leaf);
  if (leaf.kind === "number") return numberHint(leaf);
  return FIXED_PLACEHOLDER[leaf.kind] ?? "Not set";
}
