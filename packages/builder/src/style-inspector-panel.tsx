"use client";

/**
 * The Style tab: editing the selected block's style values.
 *
 * Draws what `style-inspector` decides and decides nothing itself — which
 * sections a block offers, which properties sit in each, and which control each
 * property draws all live there, where they can be asserted without a DOM.
 *
 * **Sections fold on their own**, and stay as the author left them across
 * selections and visits (`panel-folds`), because an author working on spacing
 * selects one block after another and means to keep Spacing open; a section
 * nothing remembers opens when it holds a value or is the first.
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
 * ## Where each part lives
 *
 * This file holds the panel itself and its body. The rest:
 *
 * - `style-panel-sections.tsx`: the sections a block offers, each section's
 *   fields, the overlay offer and More properties.
 * - `style-block-shortcuts.tsx`: the columns layout, block shortcuts and
 *   presets.
 * - `spacing-box-fields.tsx`: the spacing box as drawn (box, ring, side
 *   frame).
 * - `style-property-fields.tsx`: one control per property, and the form
 *   toggle.
 * - `style-field-shell.tsx`: the label, control field, issue line, and the
 *   reset and jump actions.
 * - `style-provenance-indicators.tsx`: the shared value line, the provenance
 *   dot and its description, and the breakpoint label.
 * - `style-control-value.tsx`: which control a property draws.
 * - `style-colour-field.tsx`: the colour field and its picker.
 * - `style-value-fields.tsx`, `style-numeric-field.tsx` and
 *   `style-text-field.tsx`: the value fields.
 * - `style-field-target.ts`: what a field reads and writes.
 * - `style-panel-reading.ts`: what the panel reads about the selection.
 * - `style-field-surroundings.ts`: the shapes and contexts every part reads.
 *
 * @module style-inspector-panel
 */
import {
  findNode,
  walkNodes,
  type BreakpointId,
  type BreakpointSet,
  type SiteTokenSet,
  type TokenMode,
  type StyleState,
  previewContainerName,
} from "@nextlyhq/blocks-engine";
import type { PageStyleCascade } from "@nextlyhq/blocks-react";
import * as React from "react";

import { breakpointQueries, matchedBreakpoints } from "./breakpoints";
import { useCanvasFrame } from "./canvas/canvas-frame-context";
import {
  CanvasTokenModeProvider,
  useCanvasTokenModeAt,
} from "./canvas/prefers-dark";
import { CssNamesProvider } from "./css-names-context";
import type { EditorState } from "./editor-state";
import { FocalFrame } from "./focal-frame";
import { FontChoicesContext, type FontChoices } from "./font-family-field";
import { PanelFoldsProvider } from "./panel-folds-context";
import { layerLabel } from "./panels/layers/layers";
import type { SideOrientation } from "./side-orientation";
import {
  BLOCK_TARGET,
  StyleTargetContext,
  TokenPrefixContext,
  tokenPrefixOf,
  type StyleFieldSurroundings,
  AppliedAtTier,
  BeneathAtTier,
  type EditedAddress,
} from "./style-field-surroundings";
import {
  fieldStyles,
  sharedStyleNamer,
  targetProvenance,
  targetReadOnly,
  targetCascade,
  targetStyles,
} from "./style-field-target";
import { ParentArrangementContext } from "./plain-parent-controls";
import { useReportStyle } from "./settings-filter";
import { inspectStyle, type StyleInspection } from "./style-inspector";
import {
  appliedAtReader,
  beneathAtReader,
  selectedSubject,
  cascadeFor,
  provenanceReader,
} from "./style-panel-reading";
import { StyleSections, rendersMedia } from "./style-panel-sections";
import { breakpointLabel } from "./style-provenance-indicators";
import type { StyleTarget } from "./style-target";
import type { StylePolicy } from "./style-values";

export { commitsFor, supersedes } from "./style-colour-field";
export { pickedReference } from "./style-control-value";
// Part of this module's exported names; no importer in the package reads it.
// fallow-ignore-next-line unused-type
export type { EditedAddress } from "./style-field-surroundings";
export { describedWithUnit } from "./style-numeric-field";
export {
  breakpointLabel,
  describeProvenance,
} from "./style-provenance-indicators";

export interface StyleInspectorPanelProps {
  /**
   * The mode the selected block is drawn in, when the caller already reads
   * it for a sibling surface: one canvas subscription, not two.
   */
  tokenMode?: TokenMode;
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
  /**
   * The element the selected node is DRAWN as, or `undefined` when nobody can
   * say.
   *
   * Only the typographic baseline needs it: those rules land on `h1` itself, so
   * nothing in the document says whether one reaches this node — `core/heading`
   * takes its tag from a prop, and `core/rich-text` renders a `div` with its
   * headings inside.
   *
   * Resolved by the caller rather than read here, the same way `cascade` and
   * `liveBreakpoints` are. Reading it needs a subscription to the canvas, and
   * the reader that decides which control shows a value should not also own
   * one. Omitted, a heading's baseline is reported as reaching nothing, which
   * is the quiet answer a host that cannot supply a canvas should get rather
   * than a guess.
   */
  renderedTag?: string;
  /**
   * How the selected node's element runs, when the canvas could be read.
   *
   * `undefined` is NOT KNOWN rather than left-to-right. A per-side property is
   * drawn as a box only when this resolves, because the arrangement is a claim
   * about which physical edge each logical side is and only the edited element
   * settles it. Resolved by the wrapper, which owns the canvas subscription.
   */
  sideOrientation?: SideOrientation;
  /**
   * The interaction state being edited. `base` when the host says nothing.
   *
   * A host that renders a canvas should hand the SAME value to
   * `Canvas.forcedState`, and the two are one decision rather than two.
   * Provenance depends on it: this panel states no `liveStates`, so
   * `styleProvenance` falls back to the edited state plus base — correct
   * exactly when the canvas is simulating the state being edited, and wrong the
   * moment it is not. Wired from one value, that precondition holds by
   * construction; wired from two, a control reports a value the browser is not
   * showing and nothing says so.
   *
   * Measuring the real pseudo-classes instead was considered and declined. The
   * pointer is in the inspector whenever anyone is reading the panel, so a
   * measured `:hover` is false every time and every hover control would report
   * unset permanently — the affordance switched off in the exact state the
   * author opened it to inspect.
   */
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
   * What an edit changes: the block, or one of the shared styles it wears.
   * The block when omitted. The Style tab holds the choice and its bar shows
   * it; the controls read and write the target's values, so the two cannot
   * disagree about what an edit changes.
   */
  target?: StyleTarget;
  /**
   * The site's fonts, for the Font control. It lists only what the site can
   * draw: its font variables, the families it has files for, and the system
   * families. Absent, it lists the variables and the system families.
   */
  fonts?: FontChoices;
  /**
   * Whether the tab says above its controls why a held block's design can't
   * be changed. True when omitted. A host that says it already, as the
   * inspector's block card does, turns it off, so the reason is said once.
   */
  showReadOnlyReason?: boolean;
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
 * The Style tab. The site's fonts reach the Font control through a context, so
 * they are not handed down every section and row between here and there.
 */
export function StyleInspectorPanel(
  props: StyleInspectorPanelProps
): React.JSX.Element {
  return (
    <FontChoicesContext.Provider value={props.fonts}>
      {/* The panel's own folds where nothing above lends them. */}
      <PanelFoldsProvider>
        <CssNamesProvider>
          {props.tokenMode === undefined ? (
            <StyleInspectorOwnMode {...props} />
          ) : (
            <StyleInspectorBody {...props} tokenMode={props.tokenMode} />
          )}
        </CssNamesProvider>
      </PanelFoldsProvider>
    </FontChoicesContext.Provider>
  );
}

/** The panel reading its block's mode itself, where no caller hands it one. */
function StyleInspectorOwnMode(
  props: StyleInspectorPanelProps
): React.JSX.Element {
  const tokenMode = useCanvasTokenModeAt(props.editor.selectedId);
  return <StyleInspectorBody {...props} tokenMode={tokenMode} />;
}

function StyleInspectorBody({
  editor,
  renderedTag,
  sideOrientation,
  policy,
  tokens,
  state,
  breakpoint,
  cascade,
  breakpoints,
  previewContainer,
  liveBreakpoints,
  onJumpToBreakpoint,
  target = BLOCK_TARGET,
  showReadOnlyReason = true,
  tokenMode,
}: StyleInspectorPanelProps & { tokenMode: TokenMode }): React.JSX.Element {
  // The form an author chose at a union position, keyed by property and path.
  // Panel state rather than document state: it is only consulted where nothing
  // is stored, so there is nothing to persist — the moment a value exists, the
  // value decides its own form.
  const [chosenForms, setChosenForms] = React.useState<Record<string, number>>(
    {}
  );
  // The mode the selected block is drawn in, its nearest theme marker first
  // and the device after, read once above and handed to every control below.
  const prefersDark = tokenMode === "dark";
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
  /*
   * ONE subject for the whole panel, and one live-breakpoint set.
   *
   * Every control on this panel asks about the SAME node, so building either per
   * control would walk the document per control — which is the cost this file's
   * own comments say the indicator must not pay. The inspection reads it too,
   * to judge which tier's controls show by the display the cascade applies.
   *
   * Recomputed each render rather than memoised, exactly as the inspection is:
   * both are only valid against the document they were read from, and an edit
   * anywhere changes the document and the values shown together.
   */
  // The picture the canvas draws for the node, lent by the inspector.
  const renderedPicture = React.useContext(FocalFrame).picture;
  const subject = selectedSubject(editor, cascade, renderedTag);
  const inspection = inspectStyle(editor.document, editor.selectedId, {
    ...policy,
    state,
    breakpoint,
    variantAt: (property, path) => chosenForms[formKey(property, path)],
    media: rendersMedia(renderedTag, renderedPicture),
    breakpoints,
    cascade: targetCascade(target, cascadeFor(cascade, subject)),
    // A shared target's values are the style's own, so the controls show
    // and offer what the style stores rather than what the block does.
    styles: targetStyles(target),
  });

  // What the panel's filter keeps in Style: what these controls draw.
  useReportStyle(
    inspection?.nodeId,
    inspection?.sections,
    target.kind === "shared",
    editedStyles(target, editor),
    inspection?.parent
  );

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
    sharedStyleName: sharedStyleNamer(target),
    nameOf: id => {
      const node = findNode(editor.document.nodes, id);
      return node === undefined ? undefined : layerLabel(node);
    },
  };
  const blockProvenance = provenanceReader({
    cascade,
    subject,
    live,
    state: inspected.state,
    breakpoint: inspected.breakpoint,
    breakpoints,
    onJumpToBreakpoint,
  });
  /*
   * The cascade traces the block, so its dots describe the block's values;
   * a shared target's values are the style's, which say where they come
   * from in their own line (set on this block, Move to) instead.
   */
  const provenanceOf = targetProvenance(target, blockProvenance);

  /*
   * Why the design is read-only, read from the document's own locks: the
   * same answer the write path refuses by, so the controls drawn and the
   * writes allowed cannot disagree. A shared target is read-only for its own
   * reasons (locked, or the author may not change the site's design), and
   * the block's lock does not hold a site-wide style.
   */
  const readOnlyReason = targetReadOnly(target, editor, inspected.nodeId);
  /*
   * What every section and field below needs from this panel, assembled once.
   *
   * One object rather than ten props repeated at the call site: the section
   * forwards the identical set to each property, so a value spelled here and
   * again there is a value that can go missing from one of them silently.
   */
  const surroundings: StyleFieldSurroundings = {
    orientation: sideOrientation,
    nodeId: inspected.nodeId,
    state: inspected.state,
    breakpoint: inspected.breakpoint,
    editor,
    policy,
    tokens,
    prefersDark,
    provenanceOf,
    editing,
    onChooseForm: chooseForm,
    breakpoints,
  };

  return (
    <StyleTargetContext.Provider value={target}>
      <TokenPrefixContext.Provider value={tokenPrefixOf(cascade)}>
        <ParentArrangementContext.Provider value={inspection?.parent}>
          <AppliedAtTier.Provider
            value={appliedAtReader({
              cascade,
              subject,
              state: inspected.state,
              breakpoints,
              nodeId: inspected.nodeId,
            })}
          >
            <BeneathAtTier.Provider
              value={beneathAtReader({
                cascade,
                subject,
                state: inspected.state,
                breakpoints,
                nodeId: inspected.nodeId,
              })}
            >
              <CanvasTokenModeProvider value={tokenMode}>
                {/*
                 * Spell-check off for the tab's fields: they hold numbers,
                 * lengths, colours and keywords, which a spell-checker marks as
                 * misspelt with the same red line an error would show. Set once
                 * here because the attribute is inherited by every field inside,
                 * including the ones other components draw and any added later.
                 * The Content tab is a different element and keeps its own.
                 */}
                <div
                  className="nx-style-inspector"
                  data-style-target={target.kind}
                  spellCheck={false}
                >
                  {showReadOnlyReason ? (
                    <ReadOnlyNote target={target} reason={readOnlyReason} />
                  ) : null}
                  <NoStyleProperties count={inspected.sections.length} />
                  <StyleSections
                    sections={inspected.sections}
                    readOnlyReason={readOnlyReason}
                    surroundings={surroundings}
                    fit={inspected.objectFit}
                  />
                </div>
              </CanvasTokenModeProvider>
            </BeneathAtTier.Provider>
          </AppliedAtTier.Provider>
        </ParentArrangementContext.Provider>
      </TokenPrefixContext.Provider>
    </StyleTargetContext.Provider>
  );
}

/**
 * The breakpoints whose rules the browser is applying right now.
 *
 * Modelled on `usePrefersDark` in `prefers-dark.ts`, and for the same reason:
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
  /*
   * The CANVAS's window, a frame's when the canvas is in one. A frame is as
   * wide as the device it previews, so its media queries are the ones the
   * page's breakpoints answer to; the editor's window is as wide as the
   * admin, and asking it reports the tiers of a screen nobody is previewing.
   */
  const view = useCanvasFrame().window;
  React.useEffect(() => {
    // Detected by CALLABILITY rather than presence, the lesson `usePrefersDark`
    // records: `"matchMedia" in window` is true under jsdom while the value is
    // not a function, so the property test passes and the call throws.
    if (view === null || typeof view.matchMedia !== "function") return;
    const ask = (query: string): boolean => view.matchMedia(query).matches;
    const read = (): void =>
      setMatches(matchedBreakpoints(breakpoints, ask, options));
    read();
    /*
     * Subscribed to every emitted query, not to a resize. A resize fires
     * continuously and would re-measure on each frame of a drag, while a media
     * query change event fires exactly when an answer here would differ.
     */
    const lists = breakpointQueries(breakpoints, options).map(query =>
      view.matchMedia(query)
    );
    for (const list of lists) list.addEventListener("change", read);
    return () => {
      for (const list of lists) list.removeEventListener("change", read);
    };
  }, [breakpoints, options, view]);
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

/**
 * The note shown when a block offers no style properties at all.
 *
 * A component rather than a conditional in the panel's own body: the panel
 * decides what to draw, and "there is nothing to draw" is this element's own
 * business. It returns nothing when there is something.
 *
 * @param props - how many sections the block offers
 * @returns the note, or nothing
 */
function NoStyleProperties({
  count,
}: {
  count: number;
}): React.JSX.Element | null {
  if (count > 0) return null;
  return (
    <p className="nx-inspector__note" data-empty="no-style-support">
      This block does not offer style properties.
    </p>
  );
}

/** The panel-state key for one union position. */
function formKey(property: string, path: readonly string[]): string {
  return [property, ...path].join(".");
}

/**
 * Why the controls are read-only, above them, for the block. A shared
 * target's reason (locked, or no right to change design) is said in the bar
 * already, and once is enough.
 */
function ReadOnlyNote({
  target,
  reason,
}: {
  target: StyleTarget;
  reason: string | undefined;
}): React.JSX.Element | null {
  if (reason === undefined || target.kind === "shared") return null;
  return (
    <p className="nx-inspector__note" data-read-only="style">
      {reason}
    </p>
  );
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

/**
 * The edited target's own styles at every state and device, as the controls
 * read them: a shared style's while one is the target, the block's otherwise.
 */
function editedStyles(target: StyleTarget, editor: EditorState): unknown {
  if (editor.selectedId === null) return undefined;
  return fieldStyles(target, editor, editor.selectedId).styles;
}
