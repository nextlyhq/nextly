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
  DEFAULT_TOKEN_PREFIX,
  findNode,
  isRawColour,
  isStyleLeaf,
  isTokenRef,
  OVERLAY_STRENGTH,
  paintsBackgroundImage,
  STYLE_CATALOG,
  trimCssWhitespace,
  walkNodes,
  type BreakpointId,
  type BreakpointSet,
  type ContrastResult,
  type FontFaceDef,
  type NodeStyles,
  type StyleValues,
  type SiteTokenSet,
  type TokenMode,
  type StyleLeaf,
  type StyleOrigin,
  type StyleState,
  type StyleSubject,
  type StyleTraceEntry,
  type StyleValue,
  previewContainerName,
  tokenRef,
} from "@nextlyhq/blocks-engine";
import type { PageStyleCascade } from "@nextlyhq/blocks-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ColorPicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Slider,
  TooltipProvider,
} from "@nextlyhq/ui";
import { ChevronDown, RotateCcw } from "lucide-react";
import * as React from "react";

import { AspectRatioField, drawsAspectRatio } from "./aspect-ratio-field";
import { batchStyleClearOps, batchStyleWriteOps } from "./batch-style";
import { reachingBeneath } from "./block-shortcuts";
import {
  BlockShortcutsControl,
  MinHeightPresets,
} from "./block-shortcuts-field";
import {
  breakpointQueries,
  editedTierLive,
  matchedBreakpoints,
} from "./breakpoints";
import { useSurvivingReport } from "./builder-notices";
import { useCanvasFrame } from "./canvas-frame-context";
import { breakpointsAtWidth } from "./canvas-width";
import { ChoiceList } from "./choice-list";
import { ChromeTooltip } from "./chrome-tooltip";
import { COLUMNS_ROW, type AppliedAt } from "./columns-layout";
import { ColumnsLayoutControl } from "./columns-layout-field";
import { commitOnEnter } from "./commit-on-enter";
import { DecorationField, drawsDecoration } from "./decoration-field";
import { isElement } from "./dom-kind";
import type { EditorState } from "./editor-state";
import { FocalFrame } from "./focal-frame";
import { FocalPointField } from "./focal-point-field";
import {
  FontChoicesContext,
  FontFamilyField,
  fontFamilyShowable,
  type FontChoices,
} from "./font-family-field";
import { IconChoiceField } from "./icon-choice-field";
import { InheritedValue, useUnsetHint } from "./inherited-value";
import {
  designIsWritable,
  designReadOnlyReason,
  fieldLabel,
  lockViewOf,
} from "./inspector";
import type { InspectorSectionKey } from "./inspector-sections";
import {
  LabelScrubRow,
  useLabelScrub,
  useLabelScrubProps,
} from "./label-scrub";
import { layerLabel } from "./layers";
import {
  CanvasTokenModeProvider,
  useCanvasTokenMode,
  useCanvasTokenModeAt,
} from "./prefers-dark";
import { radioGroupStep } from "./roving-radios";
import { fieldStep, scrubModifiersOf } from "./scrub-gesture";
import { SectionHeld } from "./section-held";
import type { SharedStyleRow } from "./shared-style-library";
import {
  moveToSharedStyleClear,
  planMoveToSharedStyle,
  sharedStyleChange,
  sharedStyleWrite,
} from "./shared-style-target";
import type { SideOrientation } from "./side-orientation";
import { stateLabel } from "./state-switcher";
import {
  alignmentGroupFor,
  drawsIcons,
  flowOf,
  type Flow,
} from "./style-alignment-icons";
import { BASELINE_WITHHELD_HINT } from "./style-baseline";
import {
  activeTokenMode,
  colourHexOf,
  colourShowable,
  foldedLeaf,
  variableFor,
  variableLabel,
  variablesFor,
  contrastAtLeaf,
  contrastObscuredAbove,
  contrastObscuredIn,
  contrastPartnerOf,
  contrastRatioText,
  type SiteVariable,
} from "./style-colour";
import {
  formNamesOf,
  type StyleControl,
  type StyleControlKind,
  type StyleControlVariants,
} from "./style-controls";
import {
  fontWeightOptions,
  foldedControlFor,
  lineHeightFromText,
  lineHeightLeafFor,
  lineHeightScrubOrigin,
  storedKey,
  type FoldedControl,
  type FoldedOption,
} from "./style-folded";
import {
  inspectStyle,
  type StyleInspectionOptions,
  type InspectedStyleProperty,
  type StyleSection,
  type StyleInspection,
} from "./style-inspector";
import { keywordLabel, menuKeywords } from "./style-keyword-labels";
import {
  CSS_NUMBER,
  measurementOf,
  measurementOfText,
  scrubbedValue,
  scrubOrigin,
  steppedValue,
  toggleOptionsFor,
  toggleShows,
  unitChoicesFor,
  withDefaultUnit,
  withUnit,
} from "./style-numeric";
import {
  breakpointBadge,
  breakpointSource,
  inheritedProvenance,
  propertiesWriting,
  provenanceBeneath,
  type BreakpointBadge,
  type BreakpointSource,
  type StyleProvenance,
} from "./style-provenance";
import {
  isLogicalSide,
  physicalCornerName,
  physicalSideName,
  sideBoxFor,
  sideOf,
  type SideBox,
} from "./style-sides";
import { styleSubjectFor } from "./style-subject";
import type { StyleTarget } from "./style-target";
import {
  readStyleValue,
  type StyleAddress,
  type StylePolicy,
} from "./style-values";
import { tokenForTypedName } from "./style-variables";
import { VariableChip, VariableChoice } from "./variable-choice";
import { ColourPair, swatchStyle } from "./variable-swatch";

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
  /**
   * What the control would show without the block's own value at the
   * position being edited, judged at the edited tier: the source the
   * "overrides" line names, and what its Reset shows again.
   */
  beneath: StyleProvenance;
}

type ProvenanceOf = (leaf: StyleLeaf) => ProvenanceAnswer | undefined;

/** Editing the block itself, wearing nothing: the target when none is given. */
const BLOCK_TARGET: StyleTarget = { kind: "block", worn: [] };

/**
 * What the controls edit, for the field that reads and writes a value.
 *
 * A context rather than one more prop threaded through every section and row
 * between the panel and the field: none of them reads it.
 */
const StyleTargetContext = React.createContext<StyleTarget>(BLOCK_TARGET);

/**
 * The prefix the cascade's token references were written under, for a reader
 * matching a value reaching from elsewhere to one token exactly; the default
 * prefix while no cascade answers.
 */
const TokenPrefixContext = React.createContext<string>(DEFAULT_TOKEN_PREFIX);

/** The cascade's token prefix, or the default while no cascade answers. */
function tokenPrefixOf(cascade: PageStyleCascade | undefined): string {
  return cascade?.tokenPrefix ?? DEFAULT_TOKEN_PREFIX;
}

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
      {props.tokenMode === undefined ? (
        <StyleInspectorOwnMode {...props} />
      ) : (
        <StyleInspectorBody {...props} tokenMode={props.tokenMode} />
      )}
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
  const groups = inspected.sections.map(section => section.key);
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
        <AppliedAtTier.Provider
          value={appliedAtReader({
            cascade,
            subject,
            state: inspected.state,
            breakpoints,
            nodeId: inspected.nodeId,
          })}
        >
          <CanvasTokenModeProvider value={tokenMode}>
            <div className="nx-style-inspector" data-style-target={target.kind}>
              {showReadOnlyReason ? (
                <ReadOnlyNote target={target} reason={readOnlyReason} />
              ) : null}
              <NoStyleProperties count={inspected.sections.length} />
              <StyleSections
                sections={inspected.sections}
                nodeId={inspected.nodeId}
                open={open}
                onOpen={setOpenGroup}
                readOnlyReason={readOnlyReason}
                surroundings={surroundings}
                fit={inspected.objectFit}
              />
            </div>
          </CanvasTokenModeProvider>
        </AppliedAtTier.Provider>
      </TokenPrefixContext.Provider>
    </StyleTargetContext.Provider>
  );
}

/**
 * The panel's sections, one open at a time, with the block's picture and fit
 * for the focal point drawn over it.
 */
function StyleSections({
  sections,
  nodeId,
  open,
  onOpen,
  readOnlyReason,
  surroundings,
  fit,
}: {
  sections: readonly StyleSection[];
  nodeId: string;
  open: string;
  onOpen: (group: string) => void;
  readOnlyReason: React.ComponentProps<
    typeof StyleSectionItem
  >["readOnlyReason"];
  surroundings: StyleFieldSurroundings;
  fit: string | undefined;
}): React.JSX.Element {
  // The picture lent from above, with the fit in force here.
  const { picture, position } = React.useContext(FocalFrame);
  return (
    <FocalFrame.Provider value={{ picture, position, fit }}>
      <Accordion type="single" collapsible value={open} onValueChange={onOpen}>
        {sections.map(section => (
          <StyleSectionItem
            // Keyed by node AND group: a bare group would let React reuse one
            // block's inputs for the next block's same-named section, so a
            // field would keep the previous block's uncommitted text.
            key={`${nodeId}:${section.key}`}
            section={section}
            readOnlyReason={readOnlyReason}
            {...surroundings}
          />
        ))}
      </Accordion>
    </FocalFrame.Provider>
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

/**
 * Everything a style field needs from the panel around it.
 *
 * Named once because the section and the property list pass the identical set
 * down, and two copies of ten props drift the moment one gains an eleventh —
 * silently, since the section would simply stop forwarding what it no longer
 * declares.
 */
interface StyleFieldSurroundings {
  /**
   * How the edited element runs, or `undefined` when the canvas could not say.
   *
   * Only the per-side box reads it, and `undefined` means NOT KNOWN rather than
   * left-to-right: a box drawn on an unknown orientation is a positional claim
   * with nothing behind it.
   */
  orientation: SideOrientation | undefined;
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
  /** The site's devices, for a control that writes at another one. */
  breakpoints: BreakpointSet | undefined;
}

/**
 * The element that carries the box arrangement, wrapping ONLY the four sides.
 *
 * Its own element rather than the property container, and that is the whole
 * point of it. The container also holds the property's heading, the form
 * selectors and the notice for a withdrawn property, and those must go on
 * reading in the PANEL's axes. Putting the edited element's `writing-mode` on
 * the container rotated everything inside it: in a vertical writing mode the
 * row reserved above the diagram becomes a physical column beside it, so the
 * heading ends up next to the box rather than over it, and the narrow fallback
 * — which stacks the sides with `flex-direction: column` — runs sideways.
 *
 * Scoped here, the axes reach exactly what they are about: the grid whose
 * columns and rows ARE the inline and block axes of the element being edited.
 *
 * A plain wrapper when there is no box, so the fields stay direct children of
 * the property in the ordinary case and nothing about the row layout changes.
 *
 * @param props - the settled box decision and the fields to place
 * @returns the sides, framed if they are a box
 */
function SideBoxFrame({
  box,
  ring,
  children,
}: {
  box: SideBox;
  /** Which ring of the spacing box this is, when it is one. */
  ring?: "margin" | "padding";
  children: React.ReactNode;
}): React.JSX.Element {
  if (!box.boxed || box.axes === undefined) return <>{children}</>;
  return (
    <div
      className="nx-style-inspector__side-box"
      // Read by the stylesheet, which owns the arrangement.
      data-sides="logical"
      data-ring={ring}
      /*
       * The EDITED ELEMENT's axes, so this grid's own placement resolves in
       * them: columns run along the inline axis and rows along the block axis,
       * so column one is the inline start in either direction and a vertical
       * mode transposes the pair — with no table of physical edges written here
       * to keep in step with CSS.
       *
       * Passed as custom PROPERTIES rather than applied as `writing-mode` and
       * `direction` directly. An inline declaration outranks every selector, so
       * the stylesheet could then only take the axes back by shouting; handed
       * over as values, the property that uses them is set by a rule, and the
       * narrow fallback overrides it by ordinary cascade order.
       */
      style={
        {
          "--nx-side-writing-mode": box.axes.writingMode,
          "--nx-side-direction": box.axes.direction,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

/**
 * The elements whose content is an external resource the box fits, which is
 * where the media fit properties show without being asked for. Not
 * `<picture>`: it only chooses a source, and the `<img>` inside it is the
 * element `object-fit` applies to.
 */
const REPLACED_ELEMENTS: ReadonlySet<string> = new Set([
  "img",
  "video",
  "iframe",
  "embed",
  "object",
  "canvas",
]);

/** Whether the block renders as one of {@link REPLACED_ELEMENTS}. */
function rendersMedia(
  renderedTag: string | undefined,
  renderedPicture?: string
): boolean {
  // A replaced element, or a picture of the block's own inside a link or a
  // figure: a captioned or linked image's root is not the image.
  if (renderedPicture !== undefined) return true;
  return renderedTag !== undefined && REPLACED_ELEMENTS.has(renderedTag);
}

/**
 * One section: its common properties, any that hold a value, and the rest
 * behind "+ More".
 *
 * **The header marks a section that holds values** with a dot and the words
 * "has values" for a screen reader, so an author can see which sections they
 * have touched without opening each one, and the dot is never colour alone.
 */
function StyleSectionItem({
  section,
  readOnlyReason,
  orientation,
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
  breakpoints,
}: {
  section: StyleSection;
  /** Why every control is read-only, which also withholds "+ More". */
  readOnlyReason: string | undefined;
} & StyleFieldSurroundings): React.JSX.Element {
  const readOnly = readOnlyReason !== undefined;
  /*
   * What the author brought out from "+ More". Held here, by a section keyed
   * by node and section, so it lasts while this block stays selected and
   * starts empty for the next. Panel state, like the open section: what the
   * author chose to look at, not anything the page stores — and a property
   * holding a value shows whatever this says, so it can hide nothing set.
   */
  const [revealed, setRevealed] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  const isRevealed = (property: string) => revealed.has(property);
  const holdsValues = section.properties.some(property => property.set);
  const shown = section.properties.filter(
    property => property.common || isRevealed(property.property)
  );
  const more = section.properties.filter(
    property => !property.common && !isRevealed(property.property)
  );
  const surroundings: StyleFieldSurroundings = {
    orientation,
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
    breakpoints,
  };
  return (
    <AccordionItem value={section.key} data-section={section.key}>
      <SectionHeading label={section.label} holdsValues={holdsValues} />
      <AccordionContent>
        <SectionFields
          sectionKey={section.key}
          shown={shown}
          readOnly={readOnly}
          surroundings={surroundings}
        />
        {readOnly || more.length === 0 ? null : (
          <MoreProperties
            sectionLabel={section.label}
            properties={more}
            onReveal={property =>
              setRevealed(current => new Set(current).add(property))
            }
          />
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

/** A section's heading: its name, the dot when it holds values, the chevron. */
function SectionHeading({
  label,
  holdsValues,
}: {
  label: string;
  holdsValues: boolean;
}): React.JSX.Element {
  return (
    // The panel's own class sets the heading's height and turns the shared
    // chevron to point right while closed and down while open.
    <AccordionTrigger className="nx-style-inspector__section-trigger">
      <span className="nx-style-inspector__section-label">
        {label}
        {/* Beside the name it qualifies, as the design sets it. */}
        {holdsValues ? (
          <span className="nx-style-inspector__section-dot" data-has-values="">
            <span aria-hidden="true" className="nx-style-inspector__dot" />
            <span className="nx-sr-only">has values</span>
          </span>
        ) : null}
      </span>
    </AccordionTrigger>
  );
}

/**
 * A section's fields: the spacing box where the section draws one, then each
 * shown property as before.
 */
function SectionFields({
  sectionKey,
  shown,
  readOnly,
  surroundings,
}: {
  sectionKey: InspectorSectionKey;
  shown: readonly InspectedStyleProperty[];
  readOnly: boolean;
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element {
  const target = React.useContext(StyleTargetContext);
  const rings =
    sectionKey === "spacing"
      ? spacingRings(shown, surroundings.orientation)
      : undefined;
  return (
    <fieldset className="nx-inspector__fields" disabled={readOnly}>
      <SectionHeld.Provider value={readOnly}>
        {sectionKey === "layout" ? (
          <ColumnsLayoutFields surroundings={surroundings} />
        ) : null}
        {sectionKey === "size" ? (
          <BlockShortcutsFields
            surroundings={surroundings}
            minHeightDrawn={(rings?.rest ?? shown).some(
              property => property.property === "minHeight"
            )}
          />
        ) : null}
        {rings === undefined ? null : (
          <SpacingBox
            margin={rings.margin}
            padding={rings.padding}
            surroundings={surroundings}
          />
        )}
        {(rings?.rest ?? shown).map(property => (
          <React.Fragment key={`${surroundings.nodeId}:${property.property}`}>
            {property.property === "minHeight" ? (
              <BlockPresetsOver surroundings={surroundings} />
            ) : null}
            <StylePropertyFields
              property={withOverlayOffered(property, surroundings, target)}
              namesSection={property.property === sectionKey}
              {...surroundings}
            />
          </React.Fragment>
        ))}
        {shown.length === 0 ? (
          <p className="nx-inspector__note">
            Nothing set here yet. Add a property from More.
          </p>
        ) : null}
      </SectionHeld.Provider>
    </fieldset>
  );
}

/**
 * A Columns row's layout tiles and stacking, at the top of its Layout
 * section. Only for the row itself: a shared style's values reach many rows,
 * and its tiles would add or remove columns in none of them.
 */
function ColumnsLayoutFields({
  surroundings,
}: {
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element | null {
  const target = React.useContext(StyleTargetContext);
  const applied = React.useContext(AppliedAtTier);
  if (
    target.kind !== "block" ||
    surroundings.editing.blockType !== COLUMNS_ROW
  ) {
    return null;
  }
  return (
    <ColumnsLayoutControl
      editor={surroundings.editor}
      nodeId={surroundings.nodeId}
      state={surroundings.state}
      breakpoint={surroundings.breakpoint}
      breakpoints={surroundings.breakpoints}
      inherited={reachingLayout(surroundings.provenanceOf)}
      applied={applied}
    />
  );
}

/**
 * What the cascade applies to the edited block at another tier, lent to a
 * control that writes at tiers other than the one being edited (where a row
 * stacks). Absent where the host compiles no cascade.
 */
const AppliedAtTier = React.createContext<AppliedAt | undefined>(undefined);

/**
 * The same provenance reading the dots use, asked at a tier: what a canvas at
 * that tier's width applies, through the one ranking of the trace.
 */
function appliedAtReader({
  cascade,
  subject,
  state,
  breakpoints,
  nodeId,
}: {
  cascade: PageStyleCascade | undefined;
  subject: StyleSubject | undefined;
  state: StyleState;
  breakpoints: BreakpointSet | undefined;
  nodeId: string;
}): AppliedAt | undefined {
  if (cascade === undefined || subject === undefined) return undefined;
  return (tier, cssProperty) => {
    const width = breakpoints?.viewport.find(
      each => each.id === tier
    )?.maxWidth;
    const read = provenanceReader({
      cascade,
      subject,
      live: breakpointsAtWidth(breakpoints, width),
      state,
      breakpoint: tier,
      breakpoints,
      onJumpToBreakpoint: undefined,
    });
    const provenance = read({
      kind: "cssValue",
      cssProperty,
      tokenKinds: [],
    })?.provenance;
    if (provenance === undefined || provenance.kind === "unset")
      return undefined;
    const { entry } = provenance;
    return {
      value: entry.value,
      breakpoint: entry.breakpoint,
      own: entry.origin.kind === "node" && entry.origin.id === nodeId,
    };
  };
}

/**
 * A Section's Height and a Button's Size and Full width, at the top of its
 * Size section. Only for the block itself: a shared style's values are not
 * the block's to size.
 */
function BlockShortcutsFields({
  surroundings,
  minHeightDrawn,
}: {
  surroundings: StyleFieldSurroundings;
  /** Whether the Min height field is drawn, which then carries its presets. */
  minHeightDrawn: boolean;
}): React.JSX.Element | null {
  const target = React.useContext(StyleTargetContext);
  const tokenPrefix = React.useContext(TokenPrefixContext);
  if (target.kind !== "block") return null;
  const where = shortcutWhere(surroundings, tokenPrefix);
  return (
    <>
      <BlockShortcutsControl {...where} />
      {minHeightDrawn ? null : <MinHeightPresets {...where} over={false} />}
    </>
  );
}

/** A Section's Min height presets, over the Min height field it presets. */
function BlockPresetsOver({
  surroundings,
}: {
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element | null {
  const target = React.useContext(StyleTargetContext);
  const tokenPrefix = React.useContext(TokenPrefixContext);
  if (target.kind !== "block") return null;
  return (
    <MinHeightPresets {...shortcutWhere(surroundings, tokenPrefix)} over />
  );
}

/**
 * Where a shortcut writes, and what reaches it from elsewhere: the value the
 * panel's own provenance reports as inherited, the one ranking of the trace.
 */
function shortcutWhere(
  surroundings: StyleFieldSurroundings,
  tokenPrefix: string
) {
  return {
    editor: surroundings.editor,
    nodeId: surroundings.nodeId,
    state: surroundings.state,
    breakpoint: surroundings.breakpoint,
    tokenPrefix,
    reaching: reachingBeneath(cssProperty =>
      surroundings.provenanceOf({
        kind: "cssValue",
        cssProperty,
        tokenKinds: [],
      })
    ),
  };
}

/** The background's overlay fields, offered only over an image. */
const OVERLAY_FIELDS: ReadonlySet<string> = new Set([
  "overlay",
  "overlayStrength",
]);

/** The leaf an image or a gradient is traced by. */
const BACKGROUND_IMAGE_LEAF: StyleLeaf = {
  kind: "cssValue",
  cssProperty: "background-image",
  tokenKinds: [],
};

/**
 * The background's controls without its overlay while there is nothing for
 * one to cover: no image or gradient reaching what is edited (from the
 * cascade where it answers, else from what the target stores anywhere), and
 * no overlay of its own to clear.
 */
function withOverlayOffered(
  property: InspectedStyleProperty,
  surroundings: StyleFieldSurroundings,
  target: StyleTarget
): InspectedStyleProperty {
  if (property.property !== "background") return property;
  if (overlayCovers(surroundings, target)) return property;
  return {
    ...property,
    controls: property.controls.filter(
      control => !OVERLAY_FIELDS.has(control.path[0] ?? "")
    ),
  };
}

/**
 * Whether the overlay has something to cover where it is edited, or an overlay
 * of its own to clear. Where the cascade answers, the image that wins here
 * decides, judged as the compiler paints it, so `none` covers nothing whatever
 * another device or state stores; where it cannot answer (a shared style being
 * edited, which the panel does not trace), what the target stores anywhere.
 */
function overlayCovers(
  surroundings: StyleFieldSurroundings,
  target: StyleTarget
): boolean {
  const { styles } = fieldStyles(
    target,
    surroundings.editor,
    surroundings.nodeId
  );
  if (anyAddress(styles, storesOverlay)) return true;
  const answer = surroundings.provenanceOf(BACKGROUND_IMAGE_LEAF);
  if (answer !== undefined) return winningImagePaints(answer.provenance);
  return anyAddress(styles, paintsImage);
}

/**
 * Whether the image a provenance names paints one: a value rather than a
 * keyword that clears it, by the compiler's own judgement. The image and the
 * gradient both write `background-image`, so the trace often cannot say which
 * control wrote the winner; it is still the winner, and its value decides.
 */
function winningImagePaints(provenance: StyleProvenance): boolean {
  return (
    provenance.kind !== "unset" &&
    paintsBackgroundImage("gradient", provenance.entry.value)
  );
}

/** Whether any state and device of these styles holds what `test` asks. */
function anyAddress(
  styles: NodeStyles | undefined,
  test: (values: StyleValues | undefined) => boolean
): boolean {
  return Object.values(styles ?? {}).some(byBreakpoint =>
    Object.values(byBreakpoint ?? {}).some(test)
  );
}

/** One address's background, when it is an object. */
function backgroundAt(
  values: StyleValues | undefined
): Record<string, unknown> | undefined {
  const background = values?.background;
  return typeof background === "object" &&
    background !== null &&
    !Array.isArray(background)
    ? (background as Record<string, unknown>)
    : undefined;
}

/** Whether one address stores an overlay of its own. */
function storesOverlay(values: StyleValues | undefined): boolean {
  const background = backgroundAt(values);
  return (
    background !== undefined &&
    [...OVERLAY_FIELDS].some(field => Object.hasOwn(background, field))
  );
}

/**
 * Whether one address's values paint an image or a gradient, judged as the
 * compiler judges it: `none` clears an image, and an overlay over it would
 * cover nothing.
 */
function paintsImage(values: StyleValues | undefined): boolean {
  return (
    paintsBackgroundImage("gradient", values?.backgroundGradient) ||
    paintsBackgroundImage("url", backgroundAt(values)?.url)
  );
}

/** The catalog's leaf for a row's column template, which the trace records. */
const TEMPLATE_LEAF: StyleLeaf | undefined = (() => {
  const shape = STYLE_CATALOG.find(
    entry => entry.property === "gridTemplateColumns"
  )?.shape;
  return shape !== undefined && isStyleLeaf(shape) ? shape : undefined;
})();

/**
 * The column template reaching the row from elsewhere (a wider device, a
 * shared style it wears, another state), as the cascade the dots read
 * answers it: one reading of the cascade, never a second walk of it.
 */
function reachingLayout(provenanceOf: ProvenanceOf): string | undefined {
  const answer =
    TEMPLATE_LEAF === undefined ? undefined : provenanceOf(TEMPLATE_LEAF);
  return answer?.provenance.kind === "inherited"
    ? answer.provenance.entry.value
    : undefined;
}

/** Margin and padding drawn as one box, and what the section shows besides. */
interface SpacingRings {
  readonly margin: InspectedStyleProperty | undefined;
  readonly padding: InspectedStyleProperty;
  readonly rest: readonly InspectedStyleProperty[];
}

/**
 * Whether the spacing section draws its box model, and from which properties.
 *
 * Drawn when padding is shown, offered and drawn as a box, which needs the
 * element's axes; margin joins as the outer ring under the same conditions.
 * Anything else the section shows is drawn as before, beneath the box.
 */
function spacingRings(
  shown: readonly InspectedStyleProperty[],
  orientation: SideOrientation | undefined
): SpacingRings | undefined {
  const ring = (key: string) =>
    shown.find(
      property =>
        property.property === key &&
        property.offered &&
        sideBoxFor(property.controls, orientation).boxed
    );
  const padding = ring("padding");
  if (padding === undefined) return undefined;
  const margin = ring("margin");
  return {
    margin,
    padding,
    rest: shown.filter(property => property !== padding && property !== margin),
  };
}

/**
 * Fields drawn compact: the spacing box's sides, which take a value typed
 * with its unit, show no unit menu, and say "–" while unset rather than a
 * hint there is no room for.
 */
const CompactSides = React.createContext(false);

/**
 * Whether this field's form toggle is drawn just above it. A single control
 * there keeps its label for assistive technology and drops the visible copy:
 * the toggle's row already says the name.
 */
const NamedAbove = React.createContext(false);

/**
 * The spacing section as the design draws it: one box, margin the outer ring
 * and padding the inner, around the element.
 *
 * Each side keeps its own field, so it commits on its own, undoes on its own,
 * and shows where its value comes from, exactly as a side drawn in a row does.
 * The box is the drawing alone.
 */
function SpacingBox({
  margin,
  padding,
  surroundings,
}: {
  margin: InspectedStyleProperty | undefined;
  padding: InspectedStyleProperty;
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element {
  const inner = (
    <SpacingRing
      property={padding}
      ring="padding"
      surroundings={surroundings}
    />
  );
  return (
    <div className="nx-spacing-box">
      <CompactSides.Provider value={true}>
        {margin === undefined ? (
          inner
        ) : (
          <SpacingRing
            property={margin}
            ring="margin"
            surroundings={surroundings}
          >
            <div className="nx-spacing-box__centre">{inner}</div>
          </SpacingRing>
        )}
      </CompactSides.Provider>
    </div>
  );
}

/** One ring of the spacing box: a property's four sides, and what it holds. */
function SpacingRing({
  property,
  ring,
  surroundings,
  children,
}: {
  property: InspectedStyleProperty;
  ring: "margin" | "padding";
  surroundings: StyleFieldSurroundings;
  children?: React.ReactNode;
}): React.JSX.Element {
  const { orientation, state, breakpoint } = surroundings;
  const box = sideBoxFor(property.controls, orientation);
  return (
    <div
      className="nx-style-inspector__property"
      data-property={property.property}
    >
      <SideBoxFrame box={box} ring={ring}>
        {/* Seen, not heard: every side's own name already says it. */}
        <span className="nx-spacing-box__caption" aria-hidden="true">
          {property.label}
        </span>
        {box.controls.map(control => {
          const name = spacingSideName(property, box, control);
          return (
            <StyleControlField
              key={[state, breakpoint, property.property, ...control.path].join(
                "."
              )}
              control={control}
              side={sideOf(box, control)}
              label={name}
              summary={undefined}
              // The side's whole name, so its actions say "Reset Margin top"
              // rather than naming the property twice.
              propertyLabel={name}
              clearOnly={control.withheld}
              nodeId={surroundings.nodeId}
              state={state}
              breakpoint={breakpoint}
              editor={surroundings.editor}
              policy={surroundings.policy}
              tokens={surroundings.tokens}
              prefersDark={surroundings.prefersDark}
              provenanceOf={surroundings.provenanceOf}
              editing={surroundings.editing}
            />
          );
        })}
        {children}
      </SideBoxFrame>
    </div>
  );
}

/**
 * "Margin top": the property and the side in plain words, where the element's
 * axes give the side a physical name, and the logical one where they do not.
 */
function spacingSideName(
  property: InspectedStyleProperty,
  box: SideBox,
  control: StyleControl
): string {
  const side = sideOf(box, control);
  const physical =
    side === undefined || box.axes === undefined
      ? undefined
      : physicalSideName(side, box.axes);
  const sideName =
    physical ?? fieldLabel(control.path[control.path.length - 1] ?? "");
  return `${property.label} ${sideName.toLowerCase()}`;
}

/**
 * The section's "+ More": a menu of the properties it does not show yet.
 *
 * Choosing one shows its control; it stays shown for this block until the
 * panel is left, and for good once it holds a value.
 */
function MoreProperties({
  sectionLabel,
  properties,
  onReveal,
}: {
  sectionLabel: string;
  properties: readonly InspectedStyleProperty[];
  onReveal: (property: string) => void;
}): React.JSX.Element {
  return (
    // Not modal: a modal menu marks the editor around it aria-hidden while
    // its controls stay focusable (axe: aria-hidden-focus).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="nx-style-inspector__more"
          aria-label={`More ${sectionLabel.toLowerCase()} properties`}
        >
          + More
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {properties.map(property => (
          <DropdownMenuItem
            key={property.property}
            onSelect={() => onReveal(property.property)}
            title={property.summary}
          >
            {property.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One catalog property, which is one control or several.
 *
 * `margin` is four logical sides and `position` is a scheme, four offsets and a
 * stacking order, so a property is a GROUP of controls rather than a field. The
 * heading is drawn only when there is more than one, because a lone control
 * already carries the property's name, and not when the section is titled
 * with it.
 */
function StylePropertyFields({
  property,
  orientation,
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
  namesSection,
}: {
  property: InspectedStyleProperty;
  /**
   * Whether the property shares its section's name, as `border` does in the
   * Border section: its heading would say the section's title again.
   */
  namesSection: boolean;
} & StyleFieldSurroundings): React.JSX.Element {
  const many = property.controls.length > 1;
  const fold = property.offered
    ? foldedControlFor(property.property)
    : undefined;
  const choices = (property.offered ? property.variants : [])
    // A folded property's root form follows from its value; see
    // `style-folded.ts`. Its other choices, if any, stay.
    .filter(
      variant =>
        variant.count > 1 && (fold === undefined || variant.path.length > 0)
    );
  // A toggle at the root is drawn on a row named for the property, so the
  // property needs no heading over it as well.
  const headed =
    many && !namesSection && !choices.some(choice => choice.path.length === 0);
  /*
   * Whether this property is drawn as a box, and in what order — one decision,
   * settled outside the component. Each side still keeps its own control, so it
   * commits on its own and undo stays per side; the grouping is for the DRAWING
   * only.
   */
  const box = sideBoxFor(property.controls, orientation);
  const { above, before, toggled } = placeChoices(choices, box.boxed);
  const toggle = (variant: StyleControlVariants) => (
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
  );
  return (
    <div
      className="nx-style-inspector__property"
      data-property={property.property}
    >
      {headed ? (
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
      {above.map(toggle)}
      {property.offered ? null : (
        <p className="nx-inspector__note" data-not-offered={property.property}>
          {/* Not "no longer": a value written through the API is stored on
              blocks that never offered the property. Said plainly so the
              author knows clearing it changes the page. */}
          This block doesn&apos;t offer {property.label}. The value set here
          still applies; clearing it removes it.
        </p>
      )}
      {/* The container's flow, which alignment icons are drawn in. */}
      <AlignmentFlow.Provider
        value={flowOf(
          findNode(editor.document.nodes, nodeId)?.styles,
          state,
          breakpoint,
          orientation
        )}
      >
        {/* A folded union's one control, read where the value field is drawn;
          see `style-folded.ts`. Its controls sit at the root, so the whole
          property is the fold's. */}
        <FoldedUnion.Provider
          value={
            fold === undefined
              ? undefined
              : { kind: fold, property: property.property }
          }
        >
          <SideBoxFrame box={box}>
            {box.controls.map(control => (
              <React.Fragment
                // The ADDRESS, not just the position: a host switching state or
                // breakpoint leaves this field mounted, and where the old and new
                // addresses hold the same value — both unset, most often — the
                // synchronisation effect does not run either. An unfinished draft
                // from the base breakpoint would then commit into the hover state.
                key={[
                  state,
                  breakpoint,
                  property.property,
                  ...control.path,
                ].join(".")}
              >
                {before(control.path).map(toggle)}
                <NamedAbove.Provider
                  value={toggled.includes(control.path.join("."))}
                >
                  <StyleControlField
                    control={control}
                    side={sideOf(box, control)}
                    label={
                      many
                        ? positionLabel(control, orientation)
                        : property.label
                    }
                    summary={many ? undefined : property.summary}
                    propertyLabel={property.label}
                    clearOnly={!property.offered || control.withheld}
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
                </NamedAbove.Provider>
              </React.Fragment>
            ))}
          </SideBoxFrame>
        </FoldedUnion.Provider>
      </AlignmentFlow.Provider>
    </div>
  );
}

/**
 * Where each form toggle is drawn. A nested form's toggle sits just above its
 * own control where the controls are a list; a box places its sides itself,
 * so its toggles stay above it. Only a control with its toggle just above
 * drops its own visible name (`toggled`, by path).
 */
function placeChoices(
  choices: readonly StyleControlVariants[],
  boxed: boolean
): {
  above: readonly StyleControlVariants[];
  before: (path: readonly string[]) => readonly StyleControlVariants[];
  toggled: readonly string[];
} {
  const inline = boxed ? [] : choices.filter(c => c.path.length > 0);
  const above = choices.filter(choice => !inline.includes(choice));
  const toggled = [
    ...above.filter(choice => choice.path.length === 0),
    ...inline,
  ].map(choice => choice.path.join("."));
  return {
    above,
    before: path =>
      inline.filter(choice => choice.path.join(".") === path.join(".")),
    toggled,
  };
}

/**
 * A control's name within its property: a side or a corner in plain words
 * ("Top", "Bottom left"), as the element's measured axes place it, rather
 * than CSS's logical words ("Block start", "End start"); any other position
 * by its key. Logical until the canvas has said which way the element runs:
 * on a right-to-left or vertical page a guessed "Left" would be wrong, and
 * the logical word is true either way.
 */
function positionLabel(
  control: StyleControl,
  orientation: SideOrientation | undefined
): string {
  const key = control.path[control.path.length - 1] ?? "";
  if (orientation === undefined) return fieldLabel(key);
  const plain =
    (isLogicalSide(key) ? physicalSideName(key, orientation) : undefined) ??
    physicalCornerName(key, orientation);
  return plain === undefined
    ? fieldLabel(key)
    : plain.charAt(0).toUpperCase() + plain.slice(1);
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
 * The choice of form at one union position: a toggle of its forms, named in
 * plain words ("All | Corners", "Number | Auto"), on a row named for the
 * property, where a menu labelled "Border radius form" put an internal word in
 * front of authors.
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
  const labelId = React.useId();
  const radios = React.useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (arm: number) => {
    if (arm === variant.active) return;
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
  // As a radio group's arrow keys do: move and choose together, wrapping.
  const step = (event: React.KeyboardEvent) => {
    const delta = radioGroupStep(event.key);
    if (delta === null) return;
    event.preventDefault();
    const next = (variant.active + delta + variant.count) % variant.count;
    choose(next);
    radios.current[next]?.focus();
  };

  return (
    <div className="nx-inspector__field" data-form-choice={property.property}>
      {/*
        The PROPERTY's name at the root, and the position's below it, where the
        heading names the property: a toggle called "Form" would tell a
        screen-reader user nothing about which property it changes. Plain text
        rather than a label, which would forward a click to a radio.
      */}
      <p className="nx-inspector__field-name" id={labelId}>
        {variant.path.length === 0
          ? property.label
          : fieldLabel(variant.path[variant.path.length - 1] ?? "")}
      </p>
      <div
        className="nx-style-inspector__toggle"
        role="radiogroup"
        aria-labelledby={labelId}
      >
        {formNamesOf(variant).map((name, index) => {
          const checked = index === variant.active;
          return (
            <button
              key={`${index}:${name}`}
              ref={button => {
                radios.current[index] = button;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              // The group's one tab stop is the chosen form.
              tabIndex={checked ? 0 : -1}
              onClick={() => choose(index)}
              onKeyDown={step}
            >
              {name}
            </button>
          );
        })}
      </div>
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
/**
 * A style field's label: its words, and the dot saying where the value came from.
 *
 * Its own component because the two parts are hidden INDEPENDENTLY. Inside a
 * box of logical sides the words are noise — position is saying which edge this
 * is — while the provenance dot says whether the side is authored or inherited,
 * which position cannot tell anyone. So the words are wrapped in an element the
 * stylesheet can clip on its own; clipping the label would take the dot and its
 * focus-revealed explanation with it.
 *
 * @param props - the label's identity, its words, and the provenance to show
 * @returns the label element
 */
function StyleFieldLabel({
  id,
  htmlFor,
  readOnly,
  focusOnly,
  title,
  label,
  answer,
  editing,
  descendant,
}: {
  id: string;
  htmlFor: string;
  /**
   * Whether the control cannot be edited, in which case the label names NOTHING.
   *
   * A label pointing at a read-only field would move focus into a control an
   * author cannot use. Decided here rather than by the caller so the field is
   * left saying what it wants drawn rather than how to draw it.
   */
  readOnly: boolean;
  /**
   * Whether the control is a group of buttons. A label's `for` would CLICK
   * a button, choosing or clearing a value; this label only moves focus to
   * the element the id names, the group's tab stop.
   */
  focusOnly: boolean;
  title: string | undefined;
  label: string;
  answer: ProvenanceAnswer | undefined;
  editing: EditedAddress;
  descendant: string | undefined;
}): React.JSX.Element {
  const namedAbove = React.useContext(NamedAbove);
  // Dragging the label to change a number field's value, while it can.
  const scrub = useLabelScrubProps();
  return (
    <Label
      id={id}
      htmlFor={readOnly || focusOnly ? undefined : htmlFor}
      title={title}
      data-named-above={namedAbove ? "" : undefined}
      // A read-only field's label names nothing, so it drags nothing either.
      {...(readOnly ? {} : scrub)}
      {...(focusOnly && !readOnly
        ? {
            onClick: (event: React.MouseEvent<HTMLLabelElement>) =>
              event.currentTarget.ownerDocument
                .getElementById(htmlFor)
                ?.focus(),
          }
        : {})}
    >
      <span className="nx-style-inspector__field-label-text">{label}</span>
      <ProvenanceDot
        answer={answer}
        editing={editing}
        descendant={descendant}
      />
    </Label>
  );
}

/**
 * What reaches a control from another tier, shown in it while nothing is set
 * here. Read from the same answer as the dot, so the two never disagree.
 */
function inheritedShown(
  stored: StyleValue | undefined,
  answer: ProvenanceAnswer | undefined
): string | undefined {
  if (stored !== undefined || answer?.provenance.kind !== "inherited") {
    return undefined;
  }
  return answer.provenance.entry.value;
}

function StyleControlField({
  control,
  side,
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
  /**
   * Which side of a box this field draws, when the property is drawn as one.
   *
   * Present only where the panel decided a box is justified, and read by the
   * stylesheet to PLACE the field. Placement by identity rather than by the
   * field's position among its siblings, because that list varies: the property
   * heading, a form selector and the notice for a withdrawn property are all
   * siblings, so a rule counting elements moves every side the moment one of
   * them appears.
   */
  side?: string;
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
  const writes = useFieldTarget({ editor, nodeId, address, policy });
  const { target, nodeStyles, styles, stored, issue } = writes;
  const pairedColour = partnerColour(control.leaf, styles, address);
  // This node's own styles first, then every ancestor's. An ancestor's
  // `opacity`, `filter` or `mixBlendMode` composites this node along with the
  // rest of the subtree, so both colours reach the eye altered and the ratio
  // between the two stored values describes a rendering that does not happen.
  const obscuredBy =
    contrastObscuredIn(styles) ??
    contrastObscuredAbove(editor.document.nodes, nodeId);
  const actionName = actionNameFor(propertyLabel, label);

  const commit = writes.commit;
  /*
   * The provenance and its breakpoint reading, from ONE ranking of the trace.
   * The dot and the action are two readings of one answer, not two answers.
   */
  const answer = provenanceOf(control.leaf);
  const inherited = inheritedShown(stored, answer);

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
    <div
      className="nx-inspector__field"
      data-control={control.kind}
      // Absent when this is not a side: React omits an `undefined` attribute, so
      // the value says whether the field is in a box without a branch here.
      data-side={side}
      {...writes.caption}
    >
      {/* The label drags the value the number field below offers it. */}
      <LabelScrubRow subject={`${nodeId} ${targetKey(writes.target)}`}>
        <StyleFieldLabel
          id={labelId}
          htmlFor={id}
          readOnly={readOnly}
          focusOnly={labelFocusOnly(control.leaf, stored)}
          title={summary}
          label={label}
          answer={answer}
          editing={editing}
          descendant={control.leaf.descendant}
        />
        <InheritedValue.Provider value={inherited}>
          <ControlOrFont
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
        </InheritedValue.Provider>
      </LabelScrubRow>
      <BreakpointAction
        answer={answer}
        label={actionName}
        editing={editing}
        fieldId={id}
        onReset={() => commit(null)}
        stored={stored}
        readOnly={readOnly}
      />
      <SharedValueLine
        target={target}
        answer={answer}
        nodeStyles={nodeStyles}
        address={address}
        actionName={actionName}
        onResetBlock={writes.resetBlock}
        onMoveTo={writes.moveTo}
      />
      <FieldIssue id={errorId} issue={issue} />
    </div>
  );
}

/** A field's refusal, which the control points at by its id; nothing without one. */
function FieldIssue({
  id,
  issue,
}: {
  id: string;
  issue: string | null;
}): React.JSX.Element | null {
  if (issue === null) return null;
  return (
    <p className="nx-inspector__error" id={id} role="alert">
      {issue}
    </p>
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
  cascade: PageStyleCascade | undefined,
  tag: string | undefined
): StyleSubject | undefined {
  if (editor.selectedId === null) return undefined;
  const subject = styleSubjectFor(
    cascade?.nodes ?? editor.document.nodes,
    editor.selectedId
  );
  // Spread only when there is one, so a host with no canvas leaves the field
  // ABSENT rather than present-and-undefined. `styleOrigin` reads it as "the
  // caller cannot say" either way, and an absent key says that more plainly to
  // anyone reading a logged subject.
  if (subject === undefined || tag === undefined) return subject;
  return { ...subject, tag };
}

/**
 * The cascade as the inspection reads it, or `undefined` where there is no
 * cascade or no subject in it: both are needed to ask what applies here.
 */
function cascadeFor(
  cascade: PageStyleCascade | undefined,
  subject: StyleSubject | undefined
): StyleInspectionOptions["cascade"] {
  if (cascade === undefined || subject === undefined) return undefined;
  return { trace: cascade.entries, subject };
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
    const provenance = inheritedProvenance(query);
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
    /*
     * At the tiers that match where the write lands rather than at the
     * canvas's width: the line describes the position being edited.
     */
    const beneath = provenanceBeneath({
      ...query,
      liveBreakpoints: editedTierLive(breakpoints, breakpoint, live),
    });
    return {
      provenance,
      badge,
      beneath,
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
  stored,
  readOnly,
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
  /** What this address stores: with no cascade, reset while it holds anything. */
  stored: StyleValue | undefined;
  /** A field drawn as a retained value, whose own Clear already resets it. */
  readOnly: boolean;
}): React.JSX.Element | null {
  /*
   * The row's one way back, so a list or an icon group needs no Clear of its
   * own. With a cascade it follows the cascade's answer: a value authored at
   * this tier is reset, revealing whatever shows through, and one arriving
   * from another tier is a jump there.
   *
   * Where the cascade gives no answer for this row — none was supplied, or
   * the tier being edited is one the canvas is not showing, so its values
   * read as unset — a value stored at this address is still reset, unless the
   * field is a retained value with a Clear of its own. What it reveals is not
   * known there, so the reset does not claim it.
   */
  const badge = answer?.badge;
  if (badge === undefined || badge.kind === "none") {
    if (stored === undefined || readOnly) return null;
    return (
      <ResetAction
        revealed="unknown"
        label={label}
        editing={editing}
        fieldId={fieldId}
        onReset={onReset}
      />
    );
  }
  if (badge.kind === "authored") {
    return (
      <ResetAction
        revealed={revealedBy(badge)}
        label={label}
        editing={editing}
        fieldId={fieldId}
        onReset={onReset}
      />
    );
  }
  /*
   * The value showing came from another tier. A value stored HERE as well is
   * shadowed by it, and is still this row's to remove: the reset stays beside
   * the jump, naming nothing it reveals, since what shows here once it is
   * gone is the winning tier's business.
   */
  const reset =
    stored === undefined || readOnly ? null : (
      <ResetAction
        revealed="unknown"
        label={label}
        editing={editing}
        fieldId={fieldId}
        onReset={onReset}
      />
    );
  if (answer?.jump === undefined) return reset;
  return (
    <>
      {reset}
      <JumpAction source={badge.source} label={label} onJump={answer.jump} />
    </>
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

/**
 * The attributes marking a control as writing `fieldId`'s value itself.
 *
 * Exported with {@link supersedes} so the pair can be checked together.
 */
export function commitsFor(fieldId: string): Record<string, string> {
  return { [COMMITS_FOR]: fieldId };
}

/**
 * Whether an interaction outside the picker writes `fieldId`'s value itself.
 *
 * Asked of the ancestor chain rather than of the target alone: the press lands
 * on whatever the control renders inside its button, and a control that puts a
 * span or an icon in there would otherwise stop making the promise.
 *
 * The target is classified by `dom-kind` rather than by `instanceof Element`,
 * which answers only for elements this window built.
 */
export function supersedes(
  target: EventTarget | null,
  fieldId: string
): boolean {
  if (!isElement(target)) return false;
  return (
    target.closest(`[${COMMITS_FOR}]`)?.getAttribute(COMMITS_FOR) === fieldId
  );
}

/**
 * What a reset reveals, from an authored badge: another tier, nothing, or a
 * value passed down from an enclosing block or the page, which no tier names.
 */
function revealedBy(
  badge: Extract<BreakpointBadge, { kind: "authored" }>
): BreakpointSource | "unset" | "unknown" {
  if (badge.revealed !== undefined) return badge.revealed;
  return badge.passedDown === true ? "unknown" : "unset";
}

function ResetAction({
  revealed,
  label,
  editing,
  fieldId,
  onReset,
}: {
  /**
   * What shows once this value is gone: another tier's value, nothing, or
   * `"unknown"` where no ranking of the cascade covers this tier, which the
   * names then leave unsaid rather than guess.
   */
  revealed: BreakpointSource | "unset" | "unknown";
  label: string;
  editing: EditedAddress;
  /** The field whose value this press writes. See {@link commitsFor}. */
  fieldId: string;
  onReset: () => void;
}): React.JSX.Element {
  const at = `Reset ${label} at ${editing.labelOf(editing.breakpoint)}`;
  const named =
    revealed === "unknown"
      ? at
      : revealed === "unset"
        ? `${at}, leaving it unset`
        : `${at}, showing the value from ${sourceLabel(revealed)}`;
  const tip =
    revealed === "unknown"
      ? "Reset"
      : revealed === "unset"
        ? "Reset to unset"
        : `Reset to ${sourceLabel(revealed)}`;
  return (
    <TooltipProvider delayDuration={300}>
      <ChromeTooltip content={tip}>
        <button
          type="button"
          className="nx-style-inspector__breakpoint-action"
          data-action="reset"
          {...commitsFor(fieldId)}
          onClick={onReset}
          aria-label={named}
        >
          {/* An icon at the row's end, where a "Reset to unset" line under
                every set control made each one two rows. The words are its
                tooltip and, in full, its name. */}
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      </ChromeTooltip>
    </TooltipProvider>
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
      {/* The source, as the caption beside an inherited value says it, and
          the way there: one line rather than a caption and a "Go to". */}
      From {where}
    </button>
  );
}

/** No faces, as one value, so the Font control's list is not rebuilt each render. */
const NO_FACES: readonly FontFaceDef[] = Object.freeze([]);

/**
 * The Font control where the leaf is `font-family`, chosen from what the site
 * can draw before any other surface (a stored variable shows as the choice it
 * is); every other value as {@link ControlValue} draws it. A value that can
 * only be cleared stays that way.
 */
function ControlOrFont(
  props: Parameters<typeof ControlValue>[0]
): React.JSX.Element {
  const fonts = React.useContext(FontChoicesContext);
  const font = props.clearOnly ? null : fontControl({ ...props, fonts });
  return font ?? <ControlValue {...props} />;
}

/**
 * The Font control, for the `font-family` leaf: CHOSEN from what the site can
 * draw rather than typed, since a typed family the site has no file for
 * renders in whatever the reader's device has. `null` for any other leaf, or
 * a stored value the picker cannot show.
 */
function fontControl({
  id,
  labelledBy,
  control,
  stored,
  tokens,
  fonts,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  control: Parameters<typeof ControlValue>[0]["control"];
  stored: Parameters<typeof ControlValue>[0]["stored"];
  tokens: Parameters<typeof ControlValue>[0]["tokens"];
  fonts: FontChoices | undefined;
  onCommit: Parameters<typeof ControlValue>[0]["onCommit"];
}): React.JSX.Element | null {
  const isFontFamily =
    control.leaf.kind === "cssValue" &&
    control.leaf.cssProperty === "font-family";
  if (!isFontFamily || !fontFamilyShowable(stored)) return null;
  const manage = fonts?.onManageFonts;
  return (
    <FontFamilyField
      id={id}
      labelledBy={labelledBy}
      stored={stored}
      tokens={tokens}
      faces={fonts?.faces}
      fromCode={fonts?.fromCode ?? NO_FACES}
      onCommit={onCommit}
      {...(manage === undefined ? {} : { onManageFonts: manage })}
    />
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
  // Read before any branch, as hooks must be: a folded union offers the
  // variables either of its arms takes, and a side of the spacing box has
  // room for a held variable's name and its clear, not a ◇ as well.
  const fold = React.useContext(FoldedUnion);
  const compact = React.useContext(CompactSides);
  if (clearOnly) {
    return (
      <RetainedValue
        labelledBy={labelledBy}
        label={actionName}
        stored={stored}
        // A value the Baseline gate no longer offers says why it is clear-only.
        note={control.withheld ? BASELINE_WITHHELD_HINT : undefined}
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
  /*
   * A held variable, by name in place of the typed value, with the ◇ beside it
   * to choose another. Every reference reaches this, including one at a leaf
   * that takes no variable or to a variable the site no longer has: the chip
   * still names it and removes it, and the ◇ draws only where a choice exists.
   * Typing over a reference is not offered, because the text would store the
   * variable's NAME as a literal, which compiles to nothing.
   */
  if (isTokenRef(stored)) {
    return (
      <HeldVariable
        id={id}
        labelledBy={labelledBy}
        leaf={variableLeafOf(control.leaf, fold)}
        identity={stored.$token}
        times={stored.times}
        actionName={actionName}
        tokens={tokens}
        compact={compact}
        onCommit={onCommit}
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
      tokens={tokens}
      describedBy={describedBy}
      onCommit={onCommit}
    />
  );
}

/**
 * A field holding a variable: the chip naming it, and the ◇ to choose
 * another, or, in a side of the spacing box, where there is no room for both,
 * the chip alone with its name as the way to choose.
 */
/**
 * The reference a chip commits when another variable replaces its own: the
 * new variable at the held one's scale, which is the size it was set to (a
 * Small button's padding), not a property of the variable.
 */
export function pickedReference(
  picked: string,
  times: number | undefined
): { $token: string; times?: number } {
  // Built by the engine's one constructor, which a reader of stored text
  // derives the reference's spelling from.
  return tokenRef(picked, times);
}

function HeldVariable({
  id,
  labelledBy,
  leaf,
  identity,
  times,
  actionName,
  tokens,
  compact,
  onCommit,
}: {
  /** The id the typed field takes again once the variable is cleared. */
  id: string;
  labelledBy: string;
  /** The leaf the field's variables are offered for; see `variableLeafOf`. */
  leaf: StyleLeaf;
  identity: string;
  /** The factor the variable is scaled by, if it is. */
  times?: number | undefined;
  actionName: string;
  tokens: SiteTokenSet | undefined;
  compact: boolean;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  // A scaled variable stays scaled when another replaces it: the factor is
  // the size it was set to (a Small button's padding), not the variable's.
  const pick = (picked: string): CommitOutcome =>
    onCommit(pickedReference(picked, times));
  const clear = (): void => {
    // Removing the variable puts the typed field back in the chip's place, and
    // the ✕ that held focus is gone: focus goes to that field once it is
    // drawn, rather than falling to the page.
    if (onCommit(null) === "refused") return;
    requestAnimationFrame(() => {
      document.getElementById(id)?.focus();
    });
  };
  return (
    <div className="nx-style-inspector__numeric">
      <VariableChip
        // In a side the name itself opens the list.
        {...(compact ? { onPick: pick } : {})}
        leaf={leaf}
        tokens={tokens}
        identity={identity}
        times={times}
        label={actionName}
        labelledBy={labelledBy}
        onClear={clear}
      />
      {compact ? null : (
        <VariableChoice
          leaf={leaf}
          tokens={tokens}
          bound
          current={identity}
          label={actionName}
          onPick={pick}
        />
      )}
    </div>
  );
}

/**
 * The leaf a field's variables are offered for: the control's own, or, for a
 * folded union drawn as one field, one leaf over all its forms, which takes
 * every kind any form takes and judges each variable by the form its kind is
 * written in (see `foldedLeaf`).
 */
function variableLeafOf(leaf: StyleLeaf, fold: Fold | undefined): StyleLeaf {
  return fold === undefined ? leaf : foldedLeafFor(fold.property, leaf);
}

/**
 * The folded leaf for one catalog property, made once: its forms are the
 * catalog's, which do not change, and one leaf object keeps the forms it
 * carries attached. The control's own leaf stands in if the catalog has no
 * union there.
 */
function foldedLeafFor(property: string, fallback: StyleLeaf): StyleLeaf {
  const made = FOLDED_LEAVES.get(property);
  if (made !== undefined) return made;
  const shape = STYLE_CATALOG.find(entry => entry.property === property)?.shape;
  const arms =
    shape?.kind === "union" ? shape.of.filter(isStyleLeaf) : [fallback];
  // With its union, so each variable is judged by the arm the engine picks
  // for its value.
  const leaf =
    shape?.kind === "union" && arms.length > 0
      ? foldedLeaf(arms, shape)
      : foldedLeaf(arms.length > 0 ? arms : [fallback]);
  FOLDED_LEAVES.set(property, leaf);
  return leaf;
}

const FOLDED_LEAVES = new Map<string, StyleLeaf>();

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
 * Named for the property for the same reason the variable chip is — several of
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
        `group` for the reason the variable chip carries one: the ARIA
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
  describedBy,
  onCommit,
}: {
  id: string;
  control: StyleControl & { leaf: Extract<StyleLeaf, { kind: "keyword" }> };
  stored: StyleValue | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const current = typeof stored === "string" ? stored : "";
  const hint = useUnsetHint("Not set");
  // The validator accepts a keyword case-insensitively, with surrounding CSS
  // whitespace and escapes, and accepts the CSS-wide keywords everywhere — so
  // a stored `Bold` or `inherit` is live and compiles while matching no item
  // here, and the select would render empty over a value that is doing
  // something. Offered VERBATIM rather than normalised, in the place of the
  // item it reads the same as, so the stored string needs no rule of its own.
  const offered = menuKeywords(
    control.leaf.cssProperty,
    control.leaf.values,
    current
  );
  return (
    <div className="nx-style-inspector__select">
      <Select value={current} onValueChange={value => onCommit(value)}>
        <SelectTrigger
          id={id}
          aria-describedby={describedBy}
          aria-invalid={describedBy === undefined ? undefined : true}
        >
          <SelectValue placeholder={hint} />
        </SelectTrigger>
        <SelectContent>
          {/* In words, the CSS spelling in the tooltip; see style-keyword-labels. */}
          {offered.map(option => (
            <SelectItem key={option} value={option} title={option}>
              {keywordLabel(control.leaf.cssProperty, option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
/** A folded union's control, and the property it edits. */
interface Fold {
  readonly kind: FoldedControl;
  readonly property: string;
}

/** The folded control the property being drawn takes, if it is folded. */
const FoldedUnion = React.createContext<Fold | undefined>(undefined);

/**
 * One control for a union the author picks without naming its form: a list
 * holding both forms' values, or a field that infers the form from the text.
 */
function FoldedField({
  id,
  fold,
  leaf,
  stored,
  actionName,
  tokens,
  describedBy,
  onCommit,
}: {
  id: string;
  fold: Fold;
  /** The leaf the field's variables are offered for; see `variableLeafOf`. */
  leaf: StyleLeaf;
  stored: StyleValue | undefined;
  actionName: string;
  tokens: SiteTokenSet | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  // The site's variables for this property, at the field's end: a fold has
  // no unit menu to hold them.
  const variables = (
    <VariableChoice
      leaf={leaf}
      tokens={tokens}
      bound={false}
      empty={stored === undefined}
      current={undefined}
      label={actionName}
      onPick={identity => onCommit({ $token: identity })}
    />
  );
  if (fold.kind === "number-or-length") {
    return (
      <div className="nx-style-inspector__numeric">
        <LengthOrNumberField
          id={id}
          leaf={leaf}
          stored={stored}
          tokens={tokens}
          describedBy={describedBy}
          onCommit={onCommit}
        />
        {variables}
      </div>
    );
  }
  return (
    <OptionSelect
      id={id}
      options={fontWeightOptions(stored)}
      stored={stored}
      describedBy={describedBy}
      onCommit={onCommit}
      after={variables}
    />
  );
}

/**
 * An inherited value by the name its option carries — `700` as "Bold 700" —
 * found by the key it would be stored under, so the list and the hint name a
 * weight the same way. As written when no option holds it.
 */
function optionNamed(
  options: readonly FoldedOption[],
  written: string
): string {
  const number = trimCssWhitespace(written) === "" ? NaN : Number(written);
  const key = storedKey(Number.isFinite(number) ? number : written);
  return options.find(option => option.key === key)?.label ?? written;
}

/** A select over named options, each committing its own stored value. */
function OptionSelect({
  id,
  options,
  stored,
  describedBy,
  onCommit,
  after,
}: {
  id: string;
  options: readonly FoldedOption[];
  stored: StyleValue | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  /** What follows the list in its row: the site's variables, where offered. */
  after?: React.ReactNode;
}): React.JSX.Element {
  const current = storedKey(stored) ?? "";
  const inherited = React.useContext(InheritedValue);
  const hint =
    inherited === undefined ? "Not set" : optionNamed(options, inherited);
  return (
    <div className="nx-style-inspector__select">
      <Select
        value={current}
        onValueChange={key => {
          const chosen = options.find(option => option.key === key);
          if (chosen !== undefined) onCommit(chosen.value);
        }}
      >
        <SelectTrigger
          id={id}
          aria-describedby={describedBy}
          aria-invalid={describedBy === undefined ? undefined : true}
        >
          <SelectValue placeholder={hint} />
        </SelectTrigger>
        <SelectContent>
          {options.map(option => (
            <SelectItem key={option.key} value={option.key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {after}
    </div>
  );
}

/**
 * A field taking a number or a length as typed: "1.5" is stored as a number,
 * "24px" or "150%" as written. Committed on blur and on Enter, as every text
 * field in the panel is, so one undo removes one value, not one character.
 */
function LengthOrNumberField({
  id,
  leaf,
  stored,
  tokens,
  describedBy,
  onCommit,
}: {
  id: string;
  /** The leaf the field's variables are offered for, both arms' kinds. */
  leaf: StyleLeaf;
  stored: StyleValue | undefined;
  tokens: SiteTokenSet | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const { draft, setDraft } = useDraft(stored);
  const mode = useCanvasTokenMode();
  const hint = useUnsetHint("1.5, 24px or 150%");
  const commit = () => {
    if (draft === storedText(stored)) return;
    // A variable's name typed here is that variable, asked before the text is
    // read as a number or a length, as every text field asks it.
    const named = tokenForTypedName(leaf, tokens, draft, mode);
    const value =
      named === undefined ? lineHeightFromText(draft) : { $token: named };
    if (onCommit(value) === "unchanged") {
      setDraft(storedText(stored));
    }
  };
  const owning = useLineHeightLabelScrub({ draft, setDraft, stored, onCommit });
  return (
    <Input
      id={id}
      value={draft}
      placeholder={hint}
      aria-describedby={describedBy}
      aria-invalid={describedBy === undefined ? undefined : true}
      onChange={event => setDraft(event.target.value)}
      // Nothing of its own is written while a drag on the label owns it.
      onBlur={() => owning() || commit()}
      onKeyDown={event => {
        if (commitOnEnter(event, commit)) return;
        // An arrow steps the value as its kind steps, a number or a length,
        // through the same rule as every numeric field.
        const delta = arrowStep(event);
        const leaf = delta === null ? undefined : lineHeightLeafFor(draft);
        if (delta === null || leaf === undefined) return;
        const next = steppedValue(
          leaf,
          lineHeightFromText(draft) ?? undefined,
          delta
        );
        if (next === undefined) return;
        event.preventDefault();
        if (onCommit(next) !== "refused") setDraft(String(next));
      }}
    />
  );
}

/**
 * A line height offered to its row's label to drag, as its kind steps: a
 * number or a length. Written once on release, as a typed value is.
 *
 * @returns whether a drag owns the value now, so the field writes nothing of
 *   its own meanwhile
 */
function useLineHeightLabelScrub({
  draft,
  setDraft,
  stored,
  onCommit,
}: {
  draft: string;
  setDraft: (value: string) => void;
  stored: StyleValue | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): () => boolean {
  const inherited = React.useContext(InheritedValue);
  return useLabelScrub({
    origin: lineHeightScrubOrigin(draft, inherited),
    at: (from, delta) => {
      const leaf = lineHeightLeafFor(String(from));
      return leaf === undefined ? undefined : scrubbedValue(leaf, from, delta);
    },
    draft,
    show: setDraft,
    reset: () => setDraft(storedText(stored)),
    commit: value => {
      if (onCommit(value) === "unchanged") setDraft(storedText(stored));
    },
  });
}

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
   * Refused here as well as drawn read-only: the controls are disabled while a
   * lock holds, but a lock set from Layers after the panel drew must stop the
   * next write too, so the live document is asked at the moment of the write.
   */
  if (!designIsWritable(editor.document, nodeId, lockViewOf(editor))) {
    setIssue("This block's design is locked, so it can't be changed here.");
    return "refused";
  }
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

/** A shared style's name by its class name, from the styles the block wears. */
function sharedStyleNamer(
  target: StyleTarget
): (slug: string) => string | undefined {
  return slug => target.worn.find(row => row.slug === slug)?.name;
}

/**
 * The provenance dots for the target: the block's, from the cascade, or none
 * for a shared target, whose values say where they come from in their own line.
 */
function targetProvenance(
  target: StyleTarget,
  block: ProvenanceOf
): ProvenanceOf {
  return target.kind === "shared" ? () => undefined : block;
}

/**
 * Why the target's values can't be changed. The block's own locks for the
 * block; a shared target has its own reasons (locked, or no right to change
 * design), and the block's lock does not hold a site-wide style.
 */
function targetReadOnly(
  target: StyleTarget,
  editor: EditorState,
  nodeId: string
): string | undefined {
  return target.kind === "shared"
    ? target.readOnly
    : designReadOnlyReason(editor.document, nodeId, lockViewOf(editor));
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
 * The cascade the inspection judges which controls show by: the block's, or
 * none for a shared target, whose display is read from the style's own
 * styles, not from the block's cascade, which the block or a later style may
 * override.
 */
function targetCascade<T>(target: StyleTarget, cascade: T): T | undefined {
  return target.kind === "shared" ? undefined : cascade;
}

/** The values a shared target shows, or `undefined` while the block is the target. */
function targetStyles(target: StyleTarget): NodeStyles | undefined {
  return target.kind === "shared" ? target.style.styles : undefined;
}

/** The block's own styles, and the styles a field shows for the target. */
function fieldStyles(
  target: StyleTarget,
  editor: EditorState,
  nodeId: string
): { nodeStyles: NodeStyles | undefined; styles: NodeStyles | undefined } {
  const nodeStyles = findNode(editor.document.nodes, nodeId)?.styles;
  return { nodeStyles, styles: targetStyles(target) ?? nodeStyles };
}

/**
 * What one field edits (the block, or the shared style that is the target),
 * the value it shows, its refusal, and the writes it makes: a value (into the block, or into
 * the shared style), the block's Reset of an override, and Move to.
 */
/** Which target a write was made for: the block, or one shared style. */
function targetKey(target: StyleTarget): string {
  return target.kind === "shared" ? `shared:${target.style.id}` : "block";
}

function useFieldTarget({
  editor,
  nodeId,
  address,
  policy,
}: {
  editor: EditorState;
  nodeId: string;
  address: StyleAddress;
  policy: StylePolicy | undefined;
}): {
  target: StyleTarget;
  nodeStyles: NodeStyles | undefined;
  styles: NodeStyles | undefined;
  stored: StyleValue | undefined;
  issue: string | null;
  setIssue: (message: string | null) => void;
  /** The field's caption hold, spread onto its row. */
  caption: {
    "data-provenance-quiet": string | undefined;
    style: React.CSSProperties | undefined;
    onFocus: () => void;
    onBlur: (event: React.FocusEvent<HTMLElement>) => void;
  };
  commit: (value: StyleValue | null) => CommitOutcome;
  resetBlock: () => void;
  moveTo: (shared: Extract<StyleTarget, { kind: "shared" }>) => void;
} {
  const target = React.useContext(StyleTargetContext);
  // Read ONCE and shared by every lookup the field makes, so the control's
  // own value and its contrast partner cannot come from two different reads
  // of the document. A shared target's values are the style's own.
  const { nodeStyles, styles } = fieldStyles(target, editor, nodeId);
  const stored = readStyleValue(styles, address);
  const [issue, setIssue] = React.useState<string | null>(null);
  /*
   * Whether the provenance caption is held back. It is revealed while the
   * field has focus, and typing a value leaves focus there, so after a commit
   * the caption would linger over the row above; it waits for the field to be
   * focused again.
   */
  const [quiet, setQuiet] = React.useState(false);
  /*
   * Whether focus has left the field since the caption was held back. Only a
   * return after leaving is the author focusing it again: a pick or a clear
   * moves focus into the field by itself, and that must not bring the caption
   * back over the row above.
   */
  const left = React.useRef(false);
  const quieten = (): void => {
    left.current = false;
    setQuiet(true);
  };
  // Held back once the value here changes, however it changed: a pick, a
  // typed name, an undo or an edit from elsewhere, as well as a commit here.
  const opened = React.useRef(true);
  React.useEffect(() => {
    if (opened.current) {
      opened.current = false;
      return;
    }
    left.current = false;
    setQuiet(true);
  }, [stored]);
  // A refusal describes the draft that produced it, so it stops describing
  // anything the moment the document holds a different value here. Clearing on
  // the stored value rather than only on the next commit is what covers an undo
  // or an edit applied from elsewhere: the remount key changes with the
  // SELECTION, and neither of those changes the selection.
  React.useEffect(() => {
    setIssue(null);
  }, [stored]);
  const survive = useSurvivingReport();
  // The target and the editor as they are now, for a write that answers later.
  const current = React.useRef(target);
  current.current = target;
  const liveEditor = React.useRef(editor);
  liveEditor.current = editor;
  /*
   * A refusal of a write that answers later, for the target that made it:
   * said beside the field while the field is on screen AND still edits that
   * target, and through the shell otherwise. The field stays mounted across a
   * switch of target, and a refusal shown there would describe a write the new
   * target never made.
   */
  const reportFor =
    (submitted: StyleTarget) =>
    (reason: string): void =>
      survive(reason, () => {
        if (targetKey(current.current) !== targetKey(submitted)) return false;
        setIssue(reason);
        return true;
      });
  const writeBlock = (value: StyleValue | null): CommitOutcome =>
    writeStyleValue({ editor, nodeId, address, policy, value, setIssue });
  return {
    target,
    nodeStyles,
    styles,
    stored,
    issue,
    setIssue,
    caption: {
      "data-provenance-quiet": quiet ? "" : undefined,
      // Read by the caption's reveal rule, which then draws nothing.
      style: quiet
        ? ({ "--nx-provenance-caption": "none" } as React.CSSProperties)
        : undefined,
      onFocus: () => {
        if (left.current) setQuiet(false);
      },
      onBlur: event => {
        // Leaving for somewhere outside the field, while what had focus is
        // still on the page: an element removed under focus, such as a
        // picked list closing, has not taken the author anywhere.
        const to = event.relatedTarget;
        const inside = isElement(to) && event.currentTarget.contains(to);
        if (!inside && isElement(event.target) && event.target.isConnected) {
          left.current = true;
        }
      },
    },
    commit: value => {
      quieten();
      return writeTarget(value);
    },
    resetBlock: () => {
      writeBlock(null);
    },
    moveTo: shared =>
      moveToSharedStyle({
        editor,
        live: () => liveEditor.current,
        nodeId,
        target: shared,
        address,
        policy,
        setIssue,
        report: reportFor(shared),
      }),
  };
  function writeTarget(value: StyleValue | null): CommitOutcome {
    return target.kind === "shared"
      ? writeSharedStyleValue({
          target,
          address,
          policy,
          value,
          setIssue,
          report: reportFor(target),
        })
      : writeBlock(value);
  }
}

/**
 * One control's value written into the shared style that is the target.
 *
 * Through the block's own write rule (`sharedStyleWrite`), judged under the
 * same policy, so the style may hold what a block may. The style is stored by
 * the host, over the network: the field answers at once and a refusal that
 * comes back later is reported where the author can still read it.
 */
function writeSharedStyleValue({
  target,
  address,
  policy,
  value,
  setIssue,
  report,
}: {
  target: Extract<StyleTarget, { kind: "shared" }>;
  address: StyleAddress;
  policy: StylePolicy | undefined;
  value: StyleValue | null;
  setIssue: (message: string | null) => void;
  report: (reason: string) => void;
}): CommitOutcome {
  // Refused here as well as drawn read-only, for a lock set after the
  // controls drew.
  if (target.readOnly !== undefined) {
    setIssue(target.readOnly);
    return "refused";
  }
  const write = sharedStyleWrite(target.style.styles, address, value, policy);
  if (write.kind === "refused") {
    setIssue(write.reason);
    return "refused";
  }
  setIssue(null);
  /*
   * Queued even when the read in hand already holds the value: an edit still
   * on its way may have changed it since, so whether this one changes
   * anything is the host's to decide against what it has queued. The change,
   * not the styles just computed, so none is lost.
   */
  void target.write(sharedStyleChange(address, value, policy)).then(refused => {
    if (refused !== undefined) report(refused);
  });
  return "applied";
}

/**
 * "Move to Card": the block's value at this control written into the style,
 * then cleared from the block once the style has it, so a refused style
 * leaves the block as it was.
 */
function moveToSharedStyle({
  editor,
  live,
  nodeId,
  target,
  address,
  policy,
  setIssue,
  report,
}: {
  editor: EditorState;
  /** The editor as it stands when the style's write answers. */
  live: () => EditorState;
  nodeId: string;
  target: Extract<StyleTarget, { kind: "shared" }>;
  address: StyleAddress;
  policy: StylePolicy | undefined;
  setIssue: (message: string | null) => void;
  report: (reason: string) => void;
}): void {
  const node = findNode(editor.document.nodes, nodeId);
  if (node === undefined) return;
  if (target.readOnly !== undefined) {
    setIssue(target.readOnly);
    return;
  }
  if (!designIsWritable(editor.document, nodeId, lockViewOf(editor))) {
    setIssue("This block's design is locked, so it can't be changed here.");
    return;
  }
  const plan = planMoveToSharedStyle(node, target.style, address, policy);
  if (!plan.ok) {
    setIssue(plan.reason);
    return;
  }
  setIssue(null);
  void target.write(plan.change).then(refused => {
    if (refused !== undefined) {
      report(refused);
      return;
    }
    /*
     * The block's value cleared at this one address, from the block as it
     * stands NOW: an edit made to it while the style's write was on its way
     * is kept, where a clear built before the write would put it back.
     */
    const now = live();
    const ops = moveToSharedStyleClear(
      findNode(now.document.nodes, nodeId),
      address,
      plan.moved,
      policy
    );
    if (ops.length > 0 && now.applyAll(ops) === null) {
      report(
        `${target.style.name} has the value, but it could not be cleared from this block.`
      );
    }
  });
}

/**
 * Where a value stands between the block and its shared style, in words.
 *
 * Editing the block, a value the block sets over its style reads "Set on this
 * block · overrides Card", with Reset, which shows the style's value again.
 * Editing the style, a value the block sets over it reads "Set on this block
 * · Move to Card", which moves it into the style. Nothing otherwise.
 */
function SharedValueLine({
  target,
  answer,
  nodeStyles,
  address,
  actionName,
  onResetBlock,
  onMoveTo,
}: {
  target: StyleTarget;
  answer: ProvenanceAnswer | undefined;
  nodeStyles: NodeStyles | undefined;
  address: StyleAddress;
  actionName: string;
  onResetBlock: () => void;
  onMoveTo: (target: Extract<StyleTarget, { kind: "shared" }>) => void;
}): React.JSX.Element | null {
  if (readStyleValue(nodeStyles, address) === undefined) return null;
  if (target.kind === "shared") {
    return (
      <div className="nx-style-inspector__shared-line" data-shared-line="move">
        <span data-shared-line-text="">Set on this block</span>
        {/* The action on a line of its own, so no separator can end a line. */}
        <button
          type="button"
          className="nx-style-inspector__breakpoint-action"
          aria-label={`Move ${actionName} to ${target.style.name}`}
          disabled={target.readOnly !== undefined}
          onClick={() => onMoveTo(target)}
        >
          Move to {target.style.name}
        </button>
      </div>
    );
  }
  const under = styleBeneath(target.worn, answer, address);
  if (under === undefined) return null;
  return (
    <div
      className="nx-style-inspector__shared-line"
      data-shared-line="override"
    >
      {/*
       * The separator is held to the words on either side by no-break spaces,
       * so a wrap falls between other words and never leaves it ending a line.
       */}
      <span data-shared-line-text="">
        {`Set on this block\u00a0·\u00a0overrides\u00a0${under.name}`}
      </span>
      <button
        type="button"
        className="nx-style-inspector__breakpoint-action"
        aria-label={`Reset ${actionName} on this block, showing ${under.name}'s value`}
        onClick={onResetBlock}
      >
        Reset
      </button>
    </div>
  );
}

/**
 * The worn style that would show at this control without the block's own
 * value, or `undefined` when none would: the block's own value at a wider
 * tier, or nothing at all.
 *
 * Read from the cascade's answer where the host supplies one, so a value the
 * block sets at a narrow breakpoint or in a state over the style's wider or
 * base-state value is named, and a block value between the two is not. With
 * no cascade, or a declaration the trace cannot tie to one control, the
 * style's own value at this exact address, the last in library order as the
 * cascade applies them: true where it answers, silent elsewhere.
 */
function styleBeneath(
  worn: readonly SharedStyleRow[],
  answer: ProvenanceAnswer | undefined,
  address: StyleAddress
): SharedStyleRow | undefined {
  const beneath = answer?.beneath;
  if (beneath === undefined || beneath.kind === "ambiguous") {
    return [...worn]
      .reverse()
      .find(row => readStyleValue(row.styles, address) !== undefined);
  }
  if (beneath.kind !== "inherited") return undefined;
  const from = beneath.from;
  return from.kind === "class"
    ? worn.find(row => row.id === from.id)
    : undefined;
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
      {described.kind === "inherited" && answer?.jump === undefined ? (
        /*
         * An inherited value's source stays in sight, under the label: the
         * value shown greyed in the control is only half an answer without
         * where it came from. In brief, with the whole sentence on hover for
         * a caption the row cuts short, and in text on focus below. Not where
         * the row offers a jump to its source: the jump names it, and goes
         * there.
         */
        <span
          className="nx-style-inspector__provenance-source"
          title={described.text}
          aria-hidden="true"
        >
          {described.source}
        </span>
      ) : null}
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
):
  | { kind: "authored"; text: string }
  | { kind: "inherited"; text: string; source: string }
  | null {
  if (provenance === undefined) return null;
  if (provenance.kind === "authored") {
    return { kind: "authored", text: "Set here" };
  }
  if (provenance.kind !== "inherited") return null;
  const { from, entry } = provenance;
  // A shared style is named as the source the author chose for the block,
  // "From Card"; every other tier is inherited.
  const lead = from.kind === "class" ? "From" : "Inherited from";
  return {
    kind: "inherited",
    text: `${lead} ${originName(from, entry, editing, controlDescendant)}`,
    source: `From ${originBrief(from, entry, editing, controlDescendant)}`,
  };
}

/**
 * The same place in brief, for the caption drawn beside an inherited value:
 * the tier, then each axis that differs, named as the panel names them.
 *
 * Built from the same reading as {@link originName}: the control a rule came
 * through and the axes that differ are asked of the same helpers, so the
 * caption and the sentence cannot name two different places. Shorter where
 * the sentence spends words on what the author already knows, the block they
 * selected, and on qualifiers a caption of one row has no room for.
 */
function originBrief(
  origin: StyleOrigin,
  entry: StyleTraceEntry,
  editing: EditedAddress,
  controlDescendant: string | undefined
): string {
  const control = sourceControl(entry, controlDescendant);
  const ownBlock = origin.kind === "node" && origin.id === editing.nodeId;
  const parts = [ownBlock ? control : briefSubject(origin, editing)];
  // Defaults are no breakpoint's to edit, so naming one after them would send
  // an author to a tier where the value is not.
  const defaults = origin.kind === "element" || origin.kind === "blockType";
  if (!defaults && entry.breakpoint !== editing.breakpoint) {
    parts.push(editing.labelOf(entry.breakpoint));
  }
  if (entry.state !== editing.state) parts.push(stateLabel(entry.state));
  const named = parts.filter(part => part !== undefined);
  return named.length === 0 ? "this block" : named.join(" · ");
}

/** {@link originSubject}'s tiers, in the words a one-row caption can hold. */
function briefSubject(origin: StyleOrigin, editing: EditedAddress): string {
  switch (origin.kind) {
    case "class":
      return editing.sharedStyleName?.(origin.slug) ?? `.${origin.slug}`;
    case "blockType":
      return origin.type === editing.blockType
        ? "block defaults"
        : "enclosing block defaults";
    case "page":
      return "the page";
    // The tag as the HTML tag control shows it, which is where an author
    // meets it.
    case "element":
      return `${origin.tag.toUpperCase()} defaults`;
    case "node":
      return enclosingName(editing, origin.id);
  }
}

/** An enclosing block as the Layers panel names it, or in general words. */
function enclosingName(editing: EditedAddress, nodeId: string): string {
  return editing.nameOf?.(nodeId) ?? "an enclosing block";
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
      return editing.sharedStyleName?.(origin.slug) ?? `.${origin.slug}`;
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
      if (origin.id !== editing.nodeId)
        return enclosingName(editing, origin.id);
      return control ?? "this block";
  }
}

/**
 * The label of the control a declaration came from, when it was not this one.
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
  return fieldLabel(writers[0] ?? "");
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
  /**
   * A shared style's name by its class name, for saying a value comes from
   * it: "From Card". The class name itself when omitted or unknown.
   */
  readonly sharedStyleName?: (slug: string) => string | undefined;
  /**
   * A block's name as the Layers panel shows it, for saying which enclosing
   * block a value came from. Absent, it is "an enclosing block".
   */
  readonly nameOf?: (nodeId: string) => string | undefined;
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
  const label = sourceControl(entry, controlDescendant);
  const control = label === undefined ? undefined : `the ${label} control`;
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
 * other half of what this control adds: it shows the token's CURRENT name on
 * its own trigger, with its swatch, and lets the author swap it, replace it
 * with a literal, or remove it. Every other field shows a held variable as the
 * chip beside its ◇ instead.
 *
 * **A token is stored by IDENTITY, never by the name shown.** The two differ
 * after a rename, and `SiteVariable` carries both for that reason — the list
 * hands back the variable it was given, so the identity travels with it and
 * the label never reaches the document.
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
  const mode = activeTokenMode(prefersDark);
  const choices = variablesFor(control.leaf, tokens, mode);
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
          tokensRead={tokens !== undefined}
          reference={reference}
          referenceLabel={storedLabel}
          customFirst={writtenAsValue(stored)}
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
          // A variable is one discrete choice rather than a gesture, so it
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
            tokens={tokens}
            describedBy={describes}
            // The REFUSAL alone. `describes` also carries the contrast verdict,
            // which is supplementary text and never a complaint.
            invalid={describedBy !== undefined}
            onCommit={onCommit}
          />
        ) : (
          <TokenClear
            actionName={actionName}
            fieldId={id}
            onClear={() => commitInstead(null)}
          />
        )}
      </div>
      <ContrastNote id={noteId} contrast={contrast} />
      <RawColourNote stored={stored} />
    </>
  );
}

/**
 * The trigger, and the surface it opens onto: the site's colour variables
 * first, and a custom colour behind its own button at the end.
 *
 * The variables lead because a variable carries a light and a dark value and a
 * colour written as a value carries one, which the visitor's dark mode cannot
 * change. So the list an author meets first is the one that keeps a page right
 * in both modes, by the names the Variables tab gives them, each with its pair.
 *
 * Its own component because CHOOSING a colour is a different question from
 * showing one: the row owns the stored value and its text, and this owns the
 * list, the raw picker and what the trigger is painted with.
 *
 * The two callbacks stay separate for the reason `ColorPicker` keeps them
 * separate: only the host knows what a choice MEANS. A variable hands back its
 * identity and never the colour it currently resolves to — storing that would
 * turn a reference into a literal and stop the page following the variable.
 */
function ColourPicker({
  shown,
  choices,
  tokensRead,
  reference,
  referenceLabel,
  customFirst,
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
  choices: readonly SiteVariable[];
  /** Whether the site's variables have arrived; until then the list waits. */
  tokensRead: boolean;
  /** The identity the value refers to, or `null` for a value or none. */
  reference: string | null;
  /** What that reference is called, for the trigger. */
  referenceLabel: string;
  /** Whether the custom colour opens already showing. */
  customFirst: boolean;
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
  const [open, setOpen] = React.useState(false);
  const [custom, setCustom] = React.useState(customFirst);
  // A colour inherited from another tier is painted while none is set here,
  // and marked so the swatch reads as inherited rather than chosen. Through
  // the same projection as a stored colour, so a site variable or
  // `currentcolor`, which resolve against the canvas, leave it unpainted
  // rather than painted with the panel's own colour.
  const inherited = React.useContext(InheritedValue);
  const painted = shown ?? colourHexOf(inherited, undefined);
  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (next) {
          setCustom(customFirst);
          return;
        }
        const own = superseded.current;
        superseded.current = false;
        onClosed(own ? "superseded" : "committed");
      }}
    >
      <PopoverTrigger asChild>
        <ColourTrigger
          shown={painted}
          data-inherited={
            shown === undefined && inherited !== undefined ? "" : undefined
          }
          reference={reference}
          referenceLabel={referenceLabel}
          actionName={actionName}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="nx-style-inspector__picker"
        // The list takes focus itself, on its search or on its entries; with
        // no list, the first control, Custom colour, takes it as usual.
        onOpenAutoFocus={event => {
          if (choices.length > 0) event.preventDefault();
        }}
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
        <ColourVariables
          choices={choices}
          read={tokensRead}
          current={reference}
          onPick={identity => {
            // One discrete choice, committed at once; the close that follows
            // has nothing left to write.
            onToken(identity);
            setOpen(false);
          }}
        />
        <CustomColour
          open={custom}
          onToggle={() => setCustom(was => !was)}
          // What the swatch paints, an inherited colour included, so a small
          // adjustment starts from what the author sees.
          shown={painted}
          unrepresented={unrepresented}
          onColour={onColour}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Whether a stored colour is written as a value rather than as a variable: the
 * picker then opens with the controls that made it showing, under the
 * variables. Nothing stored, or a variable, opens on the variables alone.
 */
function writtenAsValue(stored: StyleValue | undefined): boolean {
  return stored !== undefined && !isTokenRef(stored);
}

/**
 * What opens the picker: for a value or none, the swatch beside the field
 * holding it; for a variable, the variable itself, its swatch and its name, as
 * the control an author opens to choose another.
 *
 * Handed the popover's own trigger props, which it spreads on the button.
 */
function ColourTrigger({
  shown,
  reference,
  referenceLabel,
  actionName,
  ...trigger
}: React.ComponentProps<"button"> & {
  shown: string | undefined;
  reference: string | null;
  referenceLabel: string;
  actionName: string;
}): React.JSX.Element {
  const paint = {
    // Painted through a custom property rather than `background-color`
    // directly, so the chequerboard beneath a translucent colour stays visible
    // through it. `undefined` leaves the class's own "nothing here" appearance
    // rather than a colour this cannot vouch for.
    style:
      shown === undefined
        ? undefined
        : ({ "--nx-swatch": shown } as React.CSSProperties),
    "data-empty": shown === undefined ? "" : undefined,
  };
  if (reference === null) {
    return (
      <button
        {...trigger}
        type="button"
        className="nx-style-inspector__swatch"
        aria-label={`Colour for ${actionName}`}
        {...paint}
      />
    );
  }
  return (
    <button
      {...trigger}
      type="button"
      className="nx-font-pick__trigger nx-style-inspector__colour-pick"
      aria-label={`Colour for ${actionName}: ${referenceLabel}`}
      {...paint}
    >
      <span className="nx-vars__swatch" aria-hidden="true" />
      <span className="nx-font-pick__value">{referenceLabel}</span>
      <ChevronDown aria-hidden="true" size={14} />
    </button>
  );
}

/**
 * Custom colour, at the end of the picker: a button that opens the raw
 * picker in place, for the exception a variable does not cover.
 */
function CustomColour({
  open,
  onToggle,
  shown,
  unrepresented,
  onColour,
}: {
  open: boolean;
  onToggle: () => void;
  /** The resolved colour, or `undefined` when nothing here can resolve one. */
  shown: string | undefined;
  /** Whether the stored value is one the picker cannot show. */
  unrepresented: boolean;
  onColour: (hex: string) => void;
}): React.JSX.Element {
  const regionId = React.useId();
  return (
    <div className="nx-style-inspector__custom">
      <button
        type="button"
        className="nx-style-inspector__custom-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
      >
        <span>Custom colour</span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open ? (
        <div className="nx-style-inspector__custom-body" id={regionId}>
          {unrepresented ? (
            <p className="nx-inspector__note">
              This value cannot be shown on the picker. Choosing here replaces
              it.
            </p>
          ) : null}
          <ColorPicker
            // A fallback only where nothing could be resolved, and it is
            // never WRITTEN by being shown: the picker reports a colour only
            // once the author moves something, so opening it over a value it
            // cannot represent changes nothing.
            color={shown ?? PICKER_FALLBACK}
            showAlpha
            onColorChange={onColour}
          />
        </div>
      ) : null}
    </div>
  );
}

/** One colour variable as the picker lists it. */
interface ColourChoice {
  readonly key: string;
  readonly label: string;
  readonly token: SiteVariable;
}

/**
 * The site's colour variables, by name, each with its swatch and its light
 * and dark pair; or, for a site with none, a line saying so.
 */
function ColourVariables({
  choices,
  read,
  current,
  onPick,
}: {
  choices: readonly SiteVariable[];
  /** Whether the site's variables have arrived. */
  read: boolean;
  /** The identity the value refers to, marked in the list. */
  current: string | null;
  onPick: (identity: string) => void;
}): React.JSX.Element {
  if (!read) {
    // Not yet arrived is not the same as none: saying "no variables" while
    // the site's style is still on its way would be wrong for a moment.
    return (
      <p
        className="nx-vars__note nx-style-inspector__no-variables"
        role="status"
      >
        Reading this site&rsquo;s colour variables&hellip;
      </p>
    );
  }
  if (choices.length === 0) {
    return (
      <p className="nx-vars__note nx-style-inspector__no-variables">
        This site has no colour variables yet.
      </p>
    );
  }
  const listed: ColourChoice[] = choices.map(token => ({
    // The IDENTITY as the key, which is what keeps the list stable across a
    // rename: a key built from the label would remount every renamed
    // variable's row, and would collide between a renamed variable and a new
    // one that took its old name.
    key: token.identity,
    // Qualified with the identity only where another listed variable shares
    // this name: two under one name with equal colours are otherwise
    // indistinguishable, and choosing either stores an identity the author
    // could not have predicted.
    label: variableLabel(token, choices),
    token,
  }));
  return (
    <div className="nx-style-inspector__variables">
      <ChoiceList
        choices={listed}
        currentKey={current ?? undefined}
        onPick={choice => onPick(choice.token.identity)}
        label="Colour variables"
        searchLabel="Search colour variables"
        noMatch="No colour variables match this search."
        choiceClassName="nx-style-inspector__variable"
        renderChoice={choice => (
          <>
            <span
              className="nx-vars__swatch nx-vars__swatch--main"
              aria-hidden="true"
              // The RESOLVED colour in the mode the canvas shows, never the
              // raw value: `var(--brand)` or `currentcolor` painted here would
              // resolve against the inspector rather than the canvas.
              style={swatchStyle(choice.token.swatch)}
            />
            <span className="nx-style-inspector__variable-name">
              {choice.label}
            </span>
            <ColourPair {...choice.token.pair} />
          </>
        )}
      />
    </div>
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
 * Separate from {@link variableLabel} because that one answers about a token
 * in hand, and this one has to find the token first, or account for there being
 * none.
 */
function storedTokenLabel(
  reference: string | null,
  tokens: SiteTokenSet | undefined,
  mode: TokenMode,
  among: readonly SiteVariable[]
): string {
  if (reference === null) return "";
  const token = variableFor(reference, tokens, mode);
  return token === undefined ? reference : variableLabel(token, among);
}

/**
 * The way to remove a stored variable, beside the trigger that names it.
 *
 * The name itself is on the trigger: the variable's current name, qualified
 * with its identity where another listed variable shares it, and the stored
 * identity when the site defines no such variable — an unknown variable is a
 * warning rather than an error, so the value goes on compiling and the author
 * is shown the string their document holds rather than an empty space.
 */
function TokenClear({
  actionName,
  fieldId,
  onClear,
}: {
  actionName: string;
  /** The field whose value this clear writes. See {@link commitsFor}. */
  fieldId: string;
  onClear: () => void;
}): React.JSX.Element {
  return (
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
/**
 * The note beside a colour written as a value rather than through a variable.
 *
 * Such a colour keeps its one value when the visitor's device prefers dark,
 * where a variable carries both. Read from what is stored, so a picker gesture
 * still in progress does not make it flicker.
 */
function RawColourNote({
  stored,
}: {
  stored: StyleValue | undefined;
}): React.JSX.Element | null {
  if (!isRawColour(stored)) return null;
  return (
    <p className="nx-inspector__note">
      Not adapted to dark mode. Choose a variable to follow light and dark.
    </p>
  );
}

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
 * Keywords a menu leaves out, still accepted when typed and still shown when
 * stored: a font size's absolute sizes say no size an author can picture
 * ("x-large"), where the type scale above them does.
 */
const UNOFFERED_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  "font-size": [
    "xx-small",
    "x-small",
    "small",
    "medium",
    "large",
    "x-large",
    "xx-large",
    "xxx-large",
  ],
};

/**
 * Properties whose free CSS has a field of its own, by CSS property: an aspect
 * ratio's menu and text decoration's icons, each with what it can draw.
 */
const OWN_FIELDS: Readonly<
  Record<
    string,
    {
      draws: (stored: StyleValue | undefined) => boolean;
      Field: typeof AspectRatioField;
      /** Whether its tab stop is a button a label's `for` would click. */
      buttons: boolean;
    }
  >
> = {
  "aspect-ratio": {
    draws: drawsAspectRatio,
    Field: AspectRatioField,
    buttons: false,
  },
  "text-decoration": {
    draws: drawsDecoration,
    Field: DecorationField,
    buttons: true,
  },
  // Any position: the nine points, or one written as CSS beside them.
  "object-position": {
    draws: stored => stored === undefined || typeof stored === "string",
    Field: FocalPointField,
    buttons: true,
  },
};

/**
 * Whether a field's label only moves focus: where the control drawn is a
 * group of buttons, whose tab stop a label's `for` would click. Read from the
 * same decision that picks the control, so the two never disagree.
 */
function labelFocusOnly(
  leaf: StyleControl["leaf"],
  stored: StyleValue | undefined
): boolean {
  if (drawsIcons(leaf)) return true;
  const own = OWN_FIELDS[leaf.cssProperty];
  return own !== undefined && own.buttons && own.draws(stored);
}

/** The edited container's flow; CSS's defaults until it is measured or read. */
const AlignmentFlow = React.createContext<Flow>({
  writingMode: "horizontal-tb",
  rtl: false,
  flex: false,
  direction: "row",
});

/**
 * The icon buttons a keyword control draws, when its property is one drawn as
 * icons, in the flow of the container being edited.
 */
function useAlignmentGroup(control: StyleControl) {
  const flow = React.useContext(AlignmentFlow);
  return control.leaf.kind === "keyword"
    ? alignmentGroupFor(control.leaf.cssProperty, control.leaf.values, flow)
    : undefined;
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
  tokens,
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
  /** The site's variables, which a field offers where its property takes one. */
  tokens: SiteTokenSet | undefined;
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
  // Both read before any branch, as hooks must be.
  const fold = React.useContext(FoldedUnion);
  // Alignment and direction as icons that follow the container's flow.
  const alignment = useAlignmentGroup(control);
  if (fold !== undefined) {
    return (
      <FoldedField
        id={id}
        fold={fold}
        leaf={variableLeafOf(control.leaf, fold)}
        stored={stored}
        actionName={actionName}
        tokens={tokens}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  if (alignment !== undefined) {
    return (
      <IconChoiceField
        id={id}
        labelledBy={labelledBy}
        group={alignment}
        stored={stored}
        actionName={actionName}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  // A property with a field of its own, where the stored value is one that
  // field can draw; any other spelling keeps the text field.
  const own = OWN_FIELDS[control.leaf.cssProperty];
  if (own !== undefined && own.draws(stored)) {
    return (
      <own.Field
        id={id}
        labelledBy={labelledBy}
        stored={stored}
        actionName={actionName}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  const toggle = toggleOptionsFor(control.leaf);
  if (toggle !== undefined && toggleShows(toggle, stored)) {
    return (
      <ToggleField
        id={id}
        labelledBy={labelledBy}
        options={toggle}
        cssProperty={control.leaf.cssProperty}
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
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  const scale = PERCENT_SCALES[control.leaf.cssProperty];
  if (scale !== undefined) {
    return (
      <PercentField
        scale={scale}
        id={id}
        control={control}
        stored={stored}
        actionName={actionName}
        tokens={tokens}
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
      tokens={tokens}
      describedBy={describedBy}
      onCommit={onCommit}
    />
  );
}

/**
 * A number written as text, as CSS reads one (`0.5`, `1e-7`), with only the
 * whitespace CSS trims around it: not JavaScript's `\s`, which also takes a
 * no-break space the engine refuses. `undefined` for anything else.
 */
function textNumber(text: string): number | undefined {
  const trimmed = trimCssWhitespace(text);
  return CSS_NUMBER.test(trimmed) ? Number(trimmed) : undefined;
}

/**
 * What describes a number field: its own description, and the words for its
 * unit while what it shows is a number, or nothing at all. What it shows is
 * the draft, or, while that is empty, the inherited value it hints. A keyword
 * such as `inherit` has no unit to be said in.
 */
export function describedWithUnit(
  describedBy: string | undefined,
  unitWords: string | undefined,
  draft: string,
  inherited: string | undefined
): string | undefined {
  const shown = trimCssWhitespace(draft) === "" ? (inherited ?? "") : draft;
  const keyword =
    trimCssWhitespace(shown) !== "" && textNumber(shown) === undefined;
  return unitWords === undefined || keyword
    ? describedBy
    : [describedBy, unitWords].filter(Boolean).join(" ");
}

/**
 * The id of words naming a field's unit for a screen reader, where the unit
 * shows only as a sign beside it (opacity's %). Read by the number field and
 * added to what describes it, never to what marks it invalid.
 */
const UnitWords = React.createContext<string | undefined>(undefined);

/**
 * A fraction as a percent, and back: multiplied or divided by 100 and no
 * more, to twelve significant figures, which drops the binary noise of the
 * division (`12.345 / 100` is `0.12345000000000001`) without rounding a
 * value an author typed.
 */
function percentOf(fraction: number): number {
  return Number((fraction * 100).toPrecision(12));
}

function fractionOf(percent: number): number {
  return Number((percent / 100).toPrecision(12));
}

/**
 * How a value an author reads in percent is stored: opacity as the fraction
 * CSS takes, an overlay's strength as the percent itself; and where the
 * slider rests while nothing is set.
 */
interface PercentScale {
  readonly fraction: boolean;
  readonly unset: number;
}

/** The values drawn in percent, by CSS property. */
const PERCENT_SCALES: Readonly<Record<string, PercentScale>> = {
  opacity: { fraction: true, unset: 100 },
  [OVERLAY_STRENGTH]: { fraction: false, unset: 50 },
};

/** A stored value as the percent the field shows; anything else as stored. */
function toPercent(
  value: StyleValue | undefined,
  scale: PercentScale
): StyleValue | undefined {
  return typeof value === "number" && scale.fraction ? percentOf(value) : value;
}

/**
 * What the percent field commits, as the fraction CSS takes. A number, or a
 * number typed as text, is divided by 100; a CSS-wide keyword is a whole
 * value and passes through unscaled.
 */
function fromPercent(
  value: StyleValue | null,
  scale: PercentScale
): StyleValue | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? textNumber(value)
        : undefined;
  if (number === undefined) return value;
  return scale.fraction ? fractionOf(number) : number;
}

/**
 * Opacity, which an author thinks of in percent: a slider for "more or
 * less" and the number field beside it for an exact value, both 0 to 100.
 *
 * The number field is the ordinary one, handed the value and its range in
 * percent and converting what it commits back, so every behaviour it has (a
 * draft held while its menu opens, a refused value said beside it, a keyword
 * passed through, the variables at its end) is the same here. The inherited
 * value it shows as a hint is converted the same way.
 */
function PercentField({
  scale,
  ...props
}: React.ComponentProps<typeof NumericField> & {
  scale: PercentScale;
}): React.JSX.Element {
  const { control, stored, actionName, describedBy, onCommit } = props;
  const unitId = React.useId();
  const { shown, inheritedShown, resting } = percentReading(
    stored,
    React.useContext(InheritedValue),
    scale
  );
  const leaf = control.leaf;
  const percentControl =
    leaf.kind === "number"
      ? { ...control, leaf: { ...leaf, min: 0, max: 100 } }
      : control;
  return (
    <div className="nx-style-inspector__opacity">
      {resting === undefined ? null : (
        <PercentSlider
          resting={resting}
          actionName={actionName}
          describedBy={describedBy}
          onCommit={next => onCommit(fromPercent(next, scale))}
        />
      )}
      <InheritedValue.Provider value={inheritedShown}>
        <UnitWords.Provider value={unitId}>
          <NumericField
            {...props}
            control={percentControl}
            stored={shown}
            onCommit={value => onCommit(fromPercent(value, scale))}
          />
        </UnitWords.Provider>
      </InheritedValue.Provider>
      <span className="nx-style-inspector__percent" aria-hidden="true">
        %
      </span>
      {/* The sign is not read; these words are, as the field's description. */}
      <span id={unitId} className="sr-only">
        percent
      </span>
    </div>
  );
}

/**
 * An opacity as the field shows it: the stored value in percent, the
 * inherited one in percent as its hint, and where the slider's thumb rests.
 *
 * The thumb rests on the value set here, else the one inherited, else the
 * 100% of an unset opacity. A keyword (`inherit`) is none of these, so it has
 * no resting place and no slider: no position stands for it, and a nudge
 * would replace it with a number built from a position it never had.
 */
function percentReading(
  stored: StyleValue | undefined,
  inherited: string | undefined,
  scale: PercentScale
): {
  shown: StyleValue | undefined;
  inheritedShown: string | undefined;
  resting: number | undefined;
} {
  const shown = toPercent(stored, scale);
  const inheritedNumber =
    inherited === undefined ? undefined : textNumber(inherited);
  const inheritedPercent =
    inheritedNumber === undefined
      ? undefined
      : scale.fraction
        ? percentOf(inheritedNumber)
        : inheritedNumber;
  const unsetResting =
    inheritedPercent ?? (inherited === undefined ? scale.unset : undefined);
  return {
    shown,
    inheritedShown:
      inheritedPercent === undefined ? inherited : String(inheritedPercent),
    resting:
      typeof shown === "number"
        ? shown
        : shown === undefined
          ? unsetResting
          : undefined,
  };
}

/**
 * A percent's slider, 0 to 100: the thumb follows a drag, and the value is
 * written once it settles.
 */
function PercentSlider({
  resting,
  actionName,
  describedBy,
  onCommit,
}: {
  resting: number;
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const [preview, setPreview] = React.useState<number | undefined>(undefined);
  // Held with its section, as the fieldset holds the form controls; a
  // slider's thumb is not one, so it is told.
  const held = React.useContext(SectionHeld);
  const at = preview ?? resting;
  return (
    <Slider
      value={[at]}
      min={0}
      max={100}
      step={1}
      disabled={held}
      onValueChange={([next]) => setPreview(next)}
      onValueCommit={([next]) => {
        setPreview(undefined);
        if (next !== undefined) onCommit(next);
      }}
      thumbs={[
        {
          "aria-label": `${actionName} slider`,
          "aria-valuetext": `${at} percent`,
          // A refusal said for the field is said for the slider too, which
          // may hold the focus when it arrives.
          ...(describedBy === undefined
            ? {}
            : { "aria-describedby": describedBy }),
        },
      ]}
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
  cssProperty,
  stored,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  options: readonly string[];
  /** The property the options are keywords of, for their words. */
  cssProperty: string;
  stored: StyleValue | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  return (
    <div
      // The field's id sits on the GROUP rather than on any one button. The
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
            // which is the only way a group of options can reach unset without
            // spending a button on "neither".
            onClick={() => onCommit(pressed ? null : option)}
            title={option}
          >
            {keywordLabel(cssProperty, option)}
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
  tokens,
  describedBy,
  onCommit,
}: {
  id: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  tokens: SiteTokenSet | undefined;
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
  // Words for a unit shown only as a sign beside the field, for its description.
  const unitWords = React.useContext(UnitWords);
  // The value reaching the field from another tier, which it shows as a hint.
  const inheritedHint = React.useContext(InheritedValue);
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
  // Not in the spacing box, whose sides take the unit as typed.
  const compact = React.useContext(CompactSides);
  const unitMenu = useFieldUnit({
    leaf: control.leaf,
    stored,
    draft,
    setDraft,
    onCommit,
  });
  const { unit, keywords } = unitMenu;
  const showUnits = !compact && unitMenu.acts;
  const hold = useHeldBlur(storedText(stored));
  // Owned here rather than by the field, so the suffix can step aside while
  // the field shows a unit being typed.
  const [typing, setTyping] = React.useState(false);
  const suffix = suffixState(unitMenu, typing, measurement);
  // A stored unit the candidate list does not carry — `ch`, or an uppercase
  // `PX` the validator folds — is live and compiles while matching no item, and
  // a controlled select over it renders an EMPTY trigger above a value that is
  // doing something. Offered verbatim as its own item, which is what the
  // keyword select above already does for a value outside its vocabulary.
  const extraUnit = unlistedUnit(measurement, units);
  const commitText = useNumericLabelScrub({
    control,
    stored,
    draft,
    unit,
    setDraft,
    setTyping,
    onCommit,
  });

  return (
    <div className="nx-style-inspector__numeric">
      <TextField
        id={id}
        control={control}
        stored={stored}
        draft={draft}
        setDraft={setDraft}
        tokens={tokens}
        describedBy={describedWithUnit(
          describedBy,
          unitWords,
          draft,
          inheritedHint
        )}
        invalid={describedBy !== undefined}
        // With no menu drawn there is nothing to hold for: its refs are empty.
        editing={{ holdBlur: hold.holdBlur, typing, setTyping }}
        onCommit={commitText}
        // The unit shown in the suffix is left out of the field.
        {...suffixedText(control, unit, unitMenu.isKeyword, showUnits)}
        onStep={(draft, delta) => {
          const next = steppedValue(
            control.leaf,
            withDefaultUnit(control.leaf, draft, unit) ?? draft,
            delta
          );
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
          value={suffix.value}
          onValueChange={hold.choosing(unitMenu.choose)}
          onOpenChange={hold.onOpenChange}
        >
          <SelectTrigger
            ref={hold.trigger}
            onBlur={hold.onTriggerBlur}
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
            <SelectValue placeholder={suffix.placeholder} />
          </SelectTrigger>
          <SelectContent ref={hold.content}>
            {extraUnit === null ? null : (
              <SelectItem value={extraUnit}>{extraUnit}</SelectItem>
            )}
            {units.map(choice => (
              <SelectItem key={choice} value={choice}>
                {choice}
              </SelectItem>
            ))}
            <KeywordItems
              cssProperty={control.leaf.cssProperty}
              keywords={keywords}
              draft={draft}
            />
          </SelectContent>
        </Select>
      ) : null}
      {/* The site's variables for this field, after its unit; nothing where
          the site has none the property takes. */}
      <VariableChoice
        leaf={control.leaf}
        tokens={tokens}
        bound={false}
        empty={stored === undefined}
        current={undefined}
        label={actionName}
        onPick={identity => onCommit({ $token: identity })}
      />
    </div>
  );
}

/**
 * A unit menu's keywords after a line, in words with the CSS spelling in the
 * tooltip; see style-keyword-labels. Those a menu leaves out are left out
 * unless the field holds one.
 */
function KeywordItems({
  cssProperty,
  keywords,
  draft,
}: {
  cssProperty: string;
  keywords: readonly string[];
  draft: string;
}): React.JSX.Element | null {
  const unoffered = UNOFFERED_KEYWORDS[cssProperty] ?? [];
  const offered = keywords.filter(
    keyword => keyword === draft || !unoffered.includes(keyword)
  );
  if (offered.length === 0) return null;
  return (
    <>
      <SelectSeparator />
      {offered.map(keyword => (
        <SelectItem key={keyword} value={keyword} title={keyword}>
          {keywordLabel(cssProperty, keyword)}
        </SelectItem>
      ))}
    </>
  );
}

/**
 * The unit a measurement carries that the menu does not list, or `null`.
 * Its own function so the field reads as what it draws, not as the test.
 */
function unlistedUnit(
  measurement: ReturnType<typeof measurementOfText>,
  units: readonly string[]
): string | null {
  const unit = unitOf(measurement);
  return unit !== undefined && !units.includes(unit) ? unit : null;
}

/**
 * The number field's value, offered to its row's label to drag: shown in the
 * field while the pointer is down, and written once on release through the
 * same commit as a typed value, so one drag is one undo step.
 *
 * @returns the field's own commit for its text: a bare number given the unit
 *   the field shows ("24" is 24px), and nothing written while a drag owns the
 *   value — a blur mid-drag would write the preview, and the release again.
 */
function useNumericLabelScrub({
  control,
  stored,
  draft,
  unit,
  setDraft,
  setTyping,
  onCommit,
}: {
  control: StyleControl;
  stored: StyleValue | undefined;
  draft: string;
  unit: string;
  setDraft: (value: string) => void;
  setTyping: (typing: boolean) => void;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): (value: StyleValue | null) => CommitOutcome {
  const inherited = React.useContext(InheritedValue);
  const mode = useCanvasTokenMode();
  const commitText = (value: StyleValue | null): CommitOutcome =>
    onCommit(withDefaultUnit(control.leaf, value, unit));
  const owning = useLabelScrub({
    origin: scrubOrigin(control.leaf, draft, unit, inherited),
    at: (from, delta) => scrubbedValue(control.leaf, from, delta),
    draft,
    show: text => {
      // Shown as a value, not as typing, so the unit stays beside it.
      setTyping(false);
      setDraft(text);
    },
    reset: () => {
      setTyping(false);
      setDraft(storedText(stored));
    },
    commit: value =>
      commitDraft({
        draft: String(value),
        stored,
        kind: control.kind,
        leaf: control.leaf,
        // A drag writes a quantity, never a variable's name, so no variable
        // is matched against it.
        tokens: undefined,
        mode,
        onCommit: commitText,
        setDraft,
      }),
  });
  // "refused" keeps the text on screen, which is the drag's live value.
  return value => (owning() ? "refused" : commitText(value));
}

/**
 * A field's hint while it shows its unit: what an unset value IS where the
 * property's initial value is a word ("Auto" for a width, a height or an
 * inset, "None" for a max size), so the hint never reads like a real default;
 * otherwise the leaf's own hint as a number alone ("16", a border's "1").
 * Margin allows `auto` but starts at 0, so it keeps a number.
 */
function bareNumberHint(control: StyleControl): string {
  const { leaf } = control;
  const keywords = leaf.kind === "dimension" ? (leaf.keywords ?? []) : [];
  const css = leaf.cssProperty;
  if (keywords.includes("none") && /^max-/.test(css)) return "None";
  if (keywords.includes("auto") && !/^(margin|padding)/.test(css)) {
    return "Auto";
  }
  return /^-?[\d.]+/.exec(placeholderFor(control))?.[0] ?? "";
}

/**
 * Whether a choice in the unit menu can act: on a measurement, a keyword, or
 * any bare number the commit will give the unit (".5", "1e3" included, by the
 * same grammar). On an empty field only when what shows there is a
 * measurement or nothing: an inherited "auto" or "clamp(…)" beside "px"
 * would read as one value it is not.
 */
function unitActs(
  draft: string,
  measurement: ReturnType<typeof measurementOfText>,
  inherited: string | undefined,
  isKeyword: boolean
): boolean {
  const text = trimCssWhitespace(draft);
  if (text === "") {
    return (
      inherited === undefined || measurementOfText(inherited) !== undefined
    );
  }
  return measurement !== undefined || isKeyword || CSS_NUMBER.test(text);
}

/** The first unit that says one, in order of precedence, else px. */
function shownUnit(candidates: readonly (string | undefined)[]): string {
  return candidates.find(candidate => candidate !== undefined) ?? "px";
}

/**
 * How the field reads beside its unit suffix: the unit left out of the value
 * and the hint ("2" beside "rem"), a keyword shown once, in the suffix, and a
 * hint that says what an unset value is. Nothing when no suffix is shown.
 */
function suffixedText(
  control: StyleControl,
  unit: string,
  isKeyword: boolean,
  shown: boolean
): { display?: (text: string) => string; fallbackHint?: string } {
  if (!shown) return {};
  const fallbackHint = bareNumberHint(control);
  return {
    display: isKeyword
      ? () => ""
      : text => {
          // A length in another unit (an inherited "2px" beside a pending
          // "rem") is not shown beside this one, which would read as one
          // value it is not; the plain hint takes its place.
          const other = unitOf(measurementOfText(text));
          return other !== undefined && other !== unit
            ? fallbackHint
            : withoutUnit(text, unit);
        },
    fallbackHint,
  };
}

/** A measurement's unit, or `undefined` for none or a bare number. */
function unitOf(
  measurement: ReturnType<typeof measurementOfText>
): string | undefined {
  return measurement === undefined || measurement.unit === ""
    ? undefined
    : measurement.unit;
}

/** A length's text without the unit shown beside it: "2rem" beside "rem" reads "2". */
function withoutUnit(text: string, unit: string): string {
  const trimmed = trimCssWhitespace(text);
  const number = trimmed.slice(0, trimmed.length - unit.length);
  return trimmed.toLowerCase().endsWith(unit.toLowerCase()) &&
    CSS_NUMBER.test(number)
    ? number
    : text;
}

/**
 * The unit a length field shows and a bare number takes: the one the draft
 * already carries, else the one the author last chose, else the leaf's first
 * (px). Its keywords, `auto` and the rest, are offered after the units.
 *
 * `acts` says whether a choice in the menu can do anything: an empty field,
 * whose bare number will take the unit shown, one measurement, or one of the
 * keywords. Over anything else — `calc()`, scientific notation — every choice
 * would be a no-op, and a control that silently does nothing is worse than
 * none.
 */
function useFieldUnit({
  leaf,
  stored,
  draft,
  setDraft,
  onCommit,
}: {
  leaf: StyleLeaf;
  stored: StyleValue | undefined;
  draft: string;
  setDraft: (value: string) => void;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): {
  unit: string;
  keywords: readonly string[];
  isKeyword: boolean;
  acts: boolean;
  value: string;
  choose: (choice: string) => void;
} {
  const [chosen, setChosen] = React.useState<string | undefined>(undefined);
  const measurement = measurementOfText(draft);
  const units = unitChoicesFor(leaf);
  const keywords = leaf.kind === "dimension" ? (leaf.keywords ?? []) : [];
  const inherited = React.useContext(InheritedValue);
  // The unit the draft says, else the one just chosen, else the stored
  // value's, else the inherited value's, so a new number keeps the unit the
  // author sees; px only when nothing says another.
  const unit = shownUnit([
    unitOf(measurement),
    chosen,
    unitOf(measurementOf(stored)),
    unitOf(inherited === undefined ? undefined : measurementOfText(inherited)),
    units[0],
  ]);
  const isKeyword = keywords.includes(draft);
  const write = (value: string) => {
    if (onCommit(value) !== "refused") setDraft(value);
  };
  return {
    unit,
    keywords,
    isKeyword,
    acts:
      units.length > 0 && unitActs(draft, measurement, inherited, isKeyword),
    // A unit chosen over a stored keyword shows at once, though nothing is
    // written until a number is typed.
    value: isKeyword && chosen === undefined ? draft : unit,
    choose: choice => {
      // A keyword is a whole value, written as chosen.
      if (keywords.includes(choice)) {
        setChosen(undefined);
        return write(choice);
      }
      setChosen(choice);
      // Composed from the draft, which is what the author is looking at;
      // with no number on screen yet, the unit waits for one.
      const next = withUnit(leaf, draft, choice);
      if (next !== undefined) write(next);
    },
  };
}

/**
 * What the unit suffix shows. While the field shows typed text that carries
 * its own unit or a keyword ("2ch", "auto"), nothing: the text says it once,
 * where the suffix beside it read as "2ch ch".
 */
function suffixState(
  unitMenu: { value: string; isKeyword: boolean },
  typing: boolean,
  measurement: ReturnType<typeof measurementOfText>
): { value: string; placeholder: string } {
  const typedOwn =
    typing && (unitMenu.isKeyword || unitOf(measurement) !== undefined);
  return typedOwn
    ? { value: "", placeholder: "" }
    : { value: unitMenu.value, placeholder: "unit" };
}

/** A blur's commit, held while focus moves within one control. */
interface HoldBlur {
  /** Whether focus moving to `next` stays within the control. */
  readonly within: (next: EventTarget | null) => boolean;
  /** The commit held meanwhile, if any. */
  readonly held: React.RefObject<(() => void) | null>;
}

/**
 * Holds the number field's commit while focus moves to its own unit menu.
 *
 * Committed on that blur, a number typed and then given a unit was written
 * twice — "20px", then "20rem" — so one Undo left a value nobody asked for.
 * Held, the choice writes the number with its unit as one step; closing the
 * menu without a choice, or moving past it, writes the number as typed.
 */
function useHeldBlur(
  /** The stored value as text; a held commit is dropped once it moves. */
  storedKey: string
): {
  holdBlur: HoldBlur;
  trigger: React.RefObject<HTMLButtonElement | null>;
  content: React.RefObject<HTMLDivElement | null>;
  choosing: (choose: (choice: string) => void) => (choice: string) => void;
  onOpenChange: (open: boolean) => void;
  onTriggerBlur: (event: React.FocusEvent) => void;
} {
  const held = React.useRef<(() => void) | null>(null);
  const open = React.useRef(false);
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const content = React.useRef<HTMLDivElement | null>(null);
  // A value that moved under the held commit — an undo while the menu is
  // open — wins: writing the older typed text over it would reverse it.
  React.useEffect(() => {
    held.current = null;
  }, [storedKey]);
  // A field taken away with its menu open, as selecting another block does,
  // gets no close from the menu: the typed number is written as it goes.
  React.useEffect(
    () => () => {
      const commit = held.current;
      held.current = null;
      commit?.();
    },
    []
  );
  const within = (next: EventTarget | null): boolean =>
    isElement(next) &&
    (trigger.current?.contains(next) === true ||
      content.current?.contains(next) === true);
  const flush = () => {
    const commit = held.current;
    held.current = null;
    commit?.();
  };
  return {
    holdBlur: { within, held },
    trigger,
    content,
    // A choice writes the typed number with its unit, so the commit held on
    // the way to the menu is dropped rather than written first.
    choosing: choose => choice => {
      held.current = null;
      choose(choice);
    },
    onOpenChange: next => {
      open.current = next;
      if (!next) flush();
    },
    // Opening moves focus into the menu, which is not leaving the control.
    onTriggerBlur: event => {
      if (!open.current && !within(event.relatedTarget)) flush();
    },
  };
}

/**
 * A side's tooltip: its whole value, for one the narrow cell cannot show, or
 * none where there is nothing to show or the field is not a side.
 */
function sideTitle(compact: boolean, draft: string): string | undefined {
  return compact && draft !== "" ? draft : undefined;
}

/**
 * A text field's commit: the draft written, a variable's typed name matched
 * in the mode the canvas shows, as the field's variables list offers them.
 */
function useDraftCommit({
  draft,
  stored,
  control,
  tokens,
  onCommit,
  setDraft,
  setTyping,
}: {
  draft: string;
  stored: StyleValue | undefined;
  control: StyleControl;
  tokens: SiteTokenSet | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  setDraft: (value: string) => void;
  setTyping: (typing: boolean) => void;
}): () => void {
  const mode = useCanvasTokenMode();
  return () => {
    // Written or not, the text is no longer mid-edit.
    setTyping(false);
    commitDraft({
      draft,
      stored,
      kind: control.kind,
      leaf: control.leaf,
      tokens,
      mode,
      onCommit,
      setDraft,
    });
  };
}

/** Write a text field's draft, when it differs from what is stored. */
function commitDraft({
  draft,
  stored,
  kind,
  leaf,
  tokens,
  mode,
  onCommit,
  setDraft,
}: {
  draft: string;
  stored: StyleValue | undefined;
  kind: StyleControlKind | undefined;
  /** The leaf the field edits, whose variables a typed name may pick. */
  leaf: StyleLeaf;
  /** The site's variables, so a variable's name typed here picks it. */
  tokens: SiteTokenSet | undefined;
  /** The mode the canvas shows, so typing matches what the list offers. */
  mode: TokenMode;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  setDraft: (value: string) => void;
}): void {
  if (draft === storedText(stored)) return;
  // CSS whitespace here too, not JavaScript's. `String.prototype.trim` also
  // strips NBSP and the Unicode spaces, so a draft of nothing but a
  // non-breaking space would read as empty and DELETE the declaration —
  // where the engine treats it as a value and refuses it.
  const emptied = trimCssWhitespace(draft) === "";
  // A variable's name typed in, "Display" or "Text", is that variable, asked
  // BEFORE the text is read as a value: read first, the word is refused as
  // "not a length" or stored as a literal no page can use.
  const named = emptied
    ? undefined
    : tokenForTypedName(leaf, tokens, draft, mode);
  const outcome = onCommit(
    emptied
      ? null
      : named === undefined
        ? committedValue(kind, draft)
        : { $token: named }
  );
  // The document did not move because it already holds this value in another
  // spelling: `01`, `+1` and `1e0` all commit as the `1` that is stored. The
  // effect above cannot cover it — `stored` is identical, so it does not fire
  // — and without this the field goes on showing text the document does not
  // contain until something remounts it. A REFUSAL deliberately keeps the
  // draft: the author has to be able to correct what they typed.
  if (outcome === "unchanged") setDraft(storedText(stored));
}

/**
 * What a number field shares with its text field: the commit it holds while
 * focus moves to its unit menu, and whether text was typed since focus, which
 * its unit suffix reads.
 */
interface FieldEditing {
  readonly holdBlur: HoldBlur;
  readonly typing: boolean;
  readonly setTyping: (typing: boolean) => void;
}

/**
 * The field's text and hint as shown: through `display` (which leaves out a
 * unit shown beside the field), except text typed since focus, shown as
 * typed.
 */
function shownText(
  display: ((text: string) => string) | undefined,
  typing: boolean,
  draft: string,
  hint: string
): { value: string; placeholder: string } {
  if (display === undefined) return { value: draft, placeholder: hint };
  return { value: typing ? draft : display(draft), placeholder: display(hint) };
}

/** Whether text was typed since focus: the caller's, else the field's own. */
function useTyping(
  editing: FieldEditing | undefined
): [boolean, (typing: boolean) => void] {
  const [own, setOwn] = React.useState(false);
  return editing === undefined
    ? [own, setOwn]
    : [editing.typing, editing.setTyping];
}

/**
 * The field's focus and blur: back in the field, a commit held for the unit
 * menu is superseded by the one this field's own blur makes; leaving for the
 * menu holds the commit; leaving elsewhere commits.
 */
function focusHandlers(
  holdBlur: HoldBlur | undefined,
  setTyping: (typing: boolean) => void,
  commit: () => void
): {
  onFocus: () => void;
  onBlur: (event: React.FocusEvent) => void;
} {
  return {
    onFocus: () => {
      if (holdBlur !== undefined) holdBlur.held.current = null;
    },
    onBlur: event => {
      if (holdBlur?.within(event.relatedTarget) === true) {
        setTyping(false);
        holdBlur.held.current = commit;
        return;
      }
      commit();
    },
  };
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
  tokens,
  describedBy,
  invalid,
  onCommit,
  onStep,
  display,
  fallbackHint,
  editing,
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
  /** The site's variables, so a variable's name typed here picks it. */
  tokens: SiteTokenSet | undefined;
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
  /**
   * How the draft and the hint read in the field, where a unit shown beside
   * it is left out of both ("2" beside "rem"). The draft itself, which is
   * what commits and steps, is unchanged.
   */
  display?: (text: string) => string;
  /** The hint while nothing applies, in place of the leaf's own. */
  fallbackHint?: string;
  /** The number field's part in the edit; see {@link FieldEditing}. */
  editing?: FieldEditing | undefined;
}): React.JSX.Element {
  // Typed since focus: the text is then shown as typed, since a unit on its
  // way in ("2c" for "2ch") would read as a unit to leave out and be cut.
  const [typing, setTyping] = useTyping(editing);
  // A side of the spacing box says "–" while unset: a hint would not fit.
  const compact = React.useContext(CompactSides);
  const hint = useUnsetHint(
    compact ? "–" : (fallbackHint ?? placeholderFor(control))
  );
  const commit = useDraftCommit({
    draft,
    stored,
    control,
    tokens,
    onCommit,
    setDraft,
    setTyping,
  });

  return (
    <Input
      id={id}
      {...shownText(display, typing, draft, hint)}
      // A side of the spacing box is narrow: its whole value is in its
      // tooltip, for one the cell cannot show.
      title={sideTitle(compact, draft)}
      aria-describedby={describedBy}
      aria-invalid={invalid ? true : undefined}
      // Committed on blur and on Enter, matching the content tab: an op per
      // keystroke would make one undo remove one character.
      onChange={event => {
        setTyping(true);
        setDraft(event.target.value);
      }}
      {...focusHandlers(editing?.holdBlur, setTyping, commit)}
      onKeyDown={event => {
        if (commitOnEnter(event, commit)) return;
        // The draft follows the value that was written, so the field shows the
        // step immediately rather than waiting for `stored` to come back.
        stepOnKey(event, onStep, draft, next => {
          setDraft(next);
          setTyping(false);
        });
      }}
    />
  );
}

/**
 * An arrow key's step on the draft, where the field steps and the value can
 * be stepped; `written` receives the text that was written.
 */
function stepOnKey(
  event: React.KeyboardEvent,
  onStep: ((draft: string, delta: number) => string | null) | undefined,
  draft: string,
  written: (next: string) => void
): void {
  if (onStep === undefined) return;
  const delta = arrowStep(event);
  if (delta === null) return;
  // Stepped from the DRAFT rather than from what is stored, so the key works
  // while an author is mid-edit — which is most of when they reach for it.
  // Reading `stored` instead would either discard an uncommitted edit or, if
  // it declined to act, leave the arrow doing nothing in a text input that has
  // no numeric fallback: an affordance that appears broken exactly while it is
  // being used.
  const next = onStep(draft, delta);
  if (next === null) return;
  written(next);
  // Only once the step was applied, so an unsteppable value keeps the caret
  // movement the key would otherwise perform.
  event.preventDefault();
}

/**
 * The step one key press asks for, or `null` when it asks for none.
 *
 * Separated from the handler so that WHICH keys are claimed is one readable
 * answer rather than a run of early returns inside an event callback — and so
 * the two rules it encodes sit together, since they are easy to change apart
 * and wrong apart.
 *
 * Arrow steps by one, Shift by ten and Alt by a tenth, which is what Figma,
 * Framer and Webflow all do: an author arrives already knowing it, and a
 * different scale here would cost them for no gain. The sizes are the label
 * drag's own (`fieldStep`), so a modifier means the same on both.
 *
 * Alt+Up and Alt+Down are claimed only here, inside a number field: the
 * editor's block moves on those keys stay out of fields, where they would be
 * caret movement in a text field and are a step in this one.
 *
 * Control and Meta are refused outright. Those chords are platform, browser
 * and assistive-navigation shortcuts, so claiming one would mutate a style
 * and add an undo entry from a keystroke aimed somewhere else entirely.
 */
function arrowStep(event: React.KeyboardEvent): number | null {
  // A keystroke arriving mid-composition belongs to the IME, which uses the
  // arrows to move through conversion candidates. Stepping there would edit the
  // style AND suppress the candidate move, so the author loses both. The
  // shortcut manager states the same rule for the same reason, and this is the
  // second reader of a keyboard event in this repository that has to know it.
  if (event.nativeEvent.isComposing) return null;
  if (event.ctrlKey || event.metaKey) return null;
  const direction =
    event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
  if (direction === 0) return null;
  return direction * fieldStep(scrubModifiersOf(event));
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
  // Short enough to read inside the field beside its swatch at the default
  // panel width, where "Name, hex or rgb()" was cut off mid-word. rgb() and
  // the other forms stay valid to type.
  color: "Name or hex",
  url: "https://…",
};

/**
 * A length's hint, which depends on what the catalog lets this one hold.
 *
 * The form alone, never the keyword list: a field shows about twenty
 * characters, and a hint cut off mid-word ("16px or 50%, or xx-sm…") says
 * less than a short one. The keywords stay valid to type.
 */
function dimensionHint(
  leaf: Extract<StyleLeaf, { kind: "dimension" }>
): string {
  // A line's width as a line is usually drawn: "16px" read as a heavy frame.
  if (/^(border|outline)(-.+)?-width$/.test(leaf.cssProperty)) return "1px";
  return leaf.allowPercentage === true ? "16px or 50%" : "16px";
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
