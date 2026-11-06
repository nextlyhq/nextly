/**
 * What the selected block offers on the Style tab.
 *
 * Pure, for the reason `inspector.ts` is: which sections a block offers, which
 * properties sit in each, and which control each property draws is derivation —
 * and a component test in jsdom cannot separate a correct answer from a
 * plausible wrong one, because both render a column of inputs.
 *
 * **Nothing here holds a list of properties, groups or capabilities.** A
 * block's `supports` decides which properties it may set and the engine answers
 * that; the catalog decides which group each property belongs to and the order
 * the groups appear in; a property's shape decides which controls it draws.
 * Adding a property or a group to the engine gives every block that supports it
 * an editor with no edit here — which is the property worth protecting, because
 * a list written here would be a second answer to a question the engine already
 * holds and the two would agree only on the day they were written.
 *
 * **The sections are the builder's, not the engine's.** The engine's groups
 * are the `supports` vocabulary block authors declare, so they decide WHICH
 * properties a block has; `inspector-sections.ts` decides where an author
 * finds each one — eight sections, Layout to Effects, every property placed
 * once. A property the table has not met yet still appears, behind "+ More"
 * in its group's section.
 *
 * **Every supported property is offered; the common ones show at once.** Each
 * property carries whether it shows without being asked for (`common`), from
 * its tier and the block in hand. The rest wait behind the section's "+ More",
 * which is the panel's to draw. A property holding a value here always shows.
 *
 * @module style-inspector
 */

import {
  asciiLower,
  BASE_BREAKPOINT,
  breakpointContexts,
  decodeIdentifier,
  DISCLOSURE_ICON_PROPERTY,
  getBlock,
  getStyleProperty,
  STYLE_CATALOG,
  stylePropertiesForSupports,
  trimCssWhitespace,
  type BlockDocument,
  type BreakpointId,
  type BreakpointSet,
  type NodeStyles,
  type StyleState,
  type StyleSubject,
  type StyleTraceEntry,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import { liveBreakpointsFor } from "./breakpoints";
import { fieldLabel, selectedNode } from "./inspector";
import {
  INSPECTOR_SECTIONS,
  placementOf,
  tierShows,
  type InspectorSectionKey,
  type TierContext,
} from "./inspector-sections";
import {
  styleControlsFor,
  type StyleControl,
  type StyleControlOptions,
  type StyleControlVariants,
} from "./style-controls";
import { styleProvenance } from "./style-provenance";
import { readStyleValue } from "./style-values";

/** Which state × breakpoint the panel reads and writes, and what the site is. */
export interface StyleInspectionOptions extends StyleControlOptions {
  /**
   * The form an author picked for one union position, if any.
   *
   * Addressed by property AND path, because a union can sit below the property
   * root — `position.zIndex` is a number or `auto`. Consulted only where
   * nothing is stored: a stored value decides its own arm, and the engine
   * decides that.
   */
  readonly variantAt?: (
    property: string,
    path: readonly string[]
  ) => number | undefined;
  /**
   * The interaction state being edited.
   *
   * `base` unless a caller says otherwise. The switcher that changes it does
   * not exist yet, and defaulting to anything else would write hover styles
   * from a panel with no way to say so.
   */
  readonly state?: StyleState;
  /**
   * The breakpoint being edited.
   *
   * The engine's unconditional context unless a caller says otherwise, for the
   * same reason: a panel with no breakpoint switcher must write the rules that
   * apply at every width, not a narrow band an author never chose.
   */
  readonly breakpoint?: BreakpointId;
  /**
   * Whether the block renders a replaced element (an image, a video, an
   * embed), which is where the media fit properties show without being asked
   * for. The canvas knows what a block renders as; the document does not.
   */
  readonly media?: boolean;
  /**
   * The styles the controls read, when they are not the node's own: a shared
   * style the block wears, chosen as the target. The node's own otherwise.
   */
  readonly styles?: NodeStyles;
  /**
   * The site's breakpoints, so the display a tier is judged by can be read
   * through the wider tiers that also apply at this one. Without them only
   * this tier and the unconditional one are read.
   */
  readonly breakpoints?: BreakpointSet;
  /**
   * The page's compiled cascade and the node in it, so the display a tier is
   * judged by includes what a class or the block's own defaults set, not just
   * the node's stored styles. Without it only the node's own values are read.
   */
  readonly cascade?: {
    readonly trace: readonly StyleTraceEntry[];
    readonly subject: StyleSubject;
  };
}

/** One catalog property as the Style tab offers it. */
export interface InspectedStyleProperty {
  /** The catalog key, as stored in a `StyleValues` record. */
  readonly property: string;
  /** The property's name as a human reads it. */
  readonly label: string;
  /** The catalog's own one-line description, for a tooltip or a hint. */
  readonly summary: string;
  /** One descriptor per editable position inside the property's value. */
  readonly controls: readonly StyleControl[];
  /** Every choice of form the property's shape offers, empty when it holds no union. */
  readonly variants: readonly StyleControlVariants[];
  /** What this node stores for the property at this address, if anything. */
  readonly value: StyleValue | undefined;
  /**
   * Whether this node sets the property HERE.
   *
   * At this state and breakpoint only, and deliberately: a value inherited from
   * the base breakpoint is not one this panel would clear, so reporting it as
   * set would put a reset affordance on a control that has nothing to reset.
   * Where the value visibly comes from is `styleProvenance`'s question, and it
   * needs the compiler's trace rather than the document.
   */
  readonly set: boolean;
  /**
   * Whether the block's `supports` still declares this property.
   *
   * False only for a property this node STORES and the block no longer offers —
   * a capability removed by a block update, or a value written through the API,
   * which never consults `supports` at all. Carried rather than dropped so the
   * panel can say why a control is there: the value is live on the page, and an
   * author looking at styling they cannot explain needs the control that clears
   * it more than they need it hidden.
   */
  readonly offered: boolean;
  /**
   * Whether it shows without being asked for: its tier holds for this block,
   * or it holds a value here. False puts it behind its section's "+ More".
   */
  readonly common: boolean;
}

/** One section of the Style tab, and the properties this block has in it. */
export interface StyleSection {
  readonly key: InspectorSectionKey;
  readonly label: string;
  /**
   * In the placement table's order. Never empty — a section this block has
   * nothing in is not drawn.
   */
  readonly properties: readonly InspectedStyleProperty[];
}

/** The selected block, as something to style. */
export interface StyleInspection {
  readonly nodeId: string;
  readonly state: StyleState;
  readonly breakpoint: BreakpointId;
  /**
   * Sections in the builder's order, Layout to Effects, each holding at least
   * one property.
   *
   * Empty for a block that opts into no style groups at all, which is a real
   * answer rather than a failure: the panel says the block offers none, exactly
   * as the content tab says when a block declares no props.
   */
  readonly sections: readonly StyleSection[];
  /**
   * The `object-fit` keyword in force here, lowercased, or `undefined` when
   * nothing sets one: what decides whether the focal point shows, and what it
   * says it does.
   */
  readonly objectFit?: string | undefined;
}

/**
 * Describe the selected block's style surface, or `null` when there is none.
 *
 * `null` for no selection and for an id the document no longer holds — but NOT
 * for a block the registry does not know, which is where this parts company
 * with the content tab. A node whose plugin was disabled, or whose type was
 * renamed, still has its styles emitted: `compile-page.ts` walks every node and
 * hands `node.styles` to `envelopeRules` without asking the registry anything.
 * So the panel that could clear them is the one surface that must not go away
 * when the definition does. With no definition nothing is OFFERED, every stored
 * property is retained, and the whole section set is clear-only.
 */
export function inspectStyle(
  document: BlockDocument,
  selectedId: string | null,
  options?: StyleInspectionOptions
): StyleInspection | null {
  const node = selectedNode(document, selectedId);
  if (node === null) return null;
  const definition = getBlock(node.type);
  // The envelope every control below reads: the target's, which is the
  // node's own unless a shared style is being edited.
  const styles = options?.styles ?? node.styles;

  const state = options?.state ?? "base";
  const breakpoint = options?.breakpoint ?? BASE_BREAKPOINT;
  // ASKED of the engine. `supports` is a capability declaration whose meaning —
  // `true` for a whole group, an object naming sub-flags — is the registry's,
  // and a second reading of it here would withhold a property the block really
  // has, or offer one it does not.
  //
  // Empty where the registry has no definition, which is not the same as a
  // block that supports nothing: the retaining pass below still finds every
  // stored property, so the panel offers exactly the properties that ARE on the
  // page and offers each of them clear-only.
  const offered = new Set(
    definition === undefined
      ? []
      : stylePropertiesForSupports(definition.supports).map(
          entry => entry.property
        )
  );
  // Plus anything this node ALREADY stores here, whether the block still
  // supports it or not. Measured: neither `validation.ts` nor `compile-page.ts`
  // consults `supports`, so a value written before a block update removed the
  // capability — or written by the API, which never had one — stays valid and
  // is still emitted on the page. Filtering on `supports` alone would show the
  // author styling that is visibly active with no control able to clear it.
  const allowed = new Set(offered);
  for (const entry of STYLE_CATALOG) {
    if (allowed.has(entry.property)) continue;
    const stored = readStyleValue(styles, {
      state,
      breakpoint,
      property: entry.property,
      path: [],
    });
    if (stored !== undefined) allowed.add(entry.property);
  }

  const at = {
    state,
    breakpoint,
    breakpoints: options?.breakpoints,
    cascade: options?.cascade,
  };
  const tiers: TierContext = {
    display: cascadedKeyword(styles, at, "display", "display"),
    media: options?.media === true,
    objectFit: cascadedKeyword(styles, at, "object-fit", "objectFit"),
    // Read as the engine reads the keyword, escapes and all, so the icon a
    // page draws is the one the tier judges.
    disclosureIcon: keywordIdentity(
      cascadedKeyword(styles, at, DISCLOSURE_ICON_PROPERTY, "disclosureIcon")
    ),
    state,
  };
  const inspected = [...allowed].map(property => {
    const entry = getStyleProperty(property);
    const placement = placementOf(property, entry?.group ?? "effects");
    const row = inspectProperty(property, styles, offered.has(property), {
      ...options,
      state,
      breakpoint,
    });
    return {
      placement,
      row: { ...row, common: row.set || tierShows(placement.tier, tiers) },
    };
  });
  const sections: StyleSection[] = [];
  for (const section of INSPECTOR_SECTIONS) {
    const properties = inspected
      .filter(each => each.placement.section === section.key)
      .sort((a, b) => a.placement.order - b.placement.order)
      .map(each => each.row);
    // A section the block has nothing in is not drawn. Rendering an empty one
    // would offer an author somewhere to click that opens onto nothing.
    if (properties.length > 0) {
      sections.push({ key: section.key, label: section.label, properties });
    }
  }

  return {
    nodeId: node.id,
    state,
    breakpoint,
    sections,
    ...(tiers.objectFit === undefined ? {} : { objectFit: tiers.objectFit }),
  };
}

/** A keyword as the engine identifies it: trimmed, unescaped, lowercased. */
function keywordIdentity(value: string | undefined): string | undefined {
  return value === undefined
    ? undefined
    : asciiLower(decodeIdentifier(trimCssWhitespace(value)));
}

/**
 * The keyword a property takes at this address, lowercased: the display that
 * decides the flex and grid tiers, the fit that decides the focal point's.
 *
 * Asked of the compiled cascade when there is one, through the same ranking
 * the provenance dots use: a class or the block's defaults can make a block a
 * flex container, or give an image its fit, without the node storing it. The live tiers are
 * the ones that apply at the edited tier, and the live state is the edited one
 * (base always matches as well).
 *
 * Without a cascade it reads what the node stores, the way the cascade would:
 * this state at this tier, then at each wider tier, then the base state the
 * same way. A state rule outranks a breakpoint rule (its pseudo-class is more
 * specific), so the whole state comes first.
 */
function cascadedKeyword(
  styles: Parameters<typeof readStyleValue>[0],
  at: {
    state: StyleState;
    breakpoint: BreakpointId;
    breakpoints: BreakpointSet | undefined;
    cascade: StyleInspectionOptions["cascade"];
  },
  cssProperty: string,
  property: string
): string | undefined {
  const tiers = tiersFrom(at.breakpoint, at.breakpoints);
  if (at.cascade !== undefined) {
    const shown = styleProvenance({
      trace: at.cascade.trace,
      subject: at.cascade.subject,
      cssProperty,
      state: at.state,
      breakpoint: at.breakpoint,
      liveBreakpoints: tiers,
      liveStates: [at.state],
    });
    return shown.kind === "unset"
      ? undefined
      : shown.entry.value.trim().toLowerCase();
  }
  const states: StyleState[] =
    at.state === "base" ? ["base"] : [at.state, "base"];
  for (const atState of states) {
    for (const atBreakpoint of tiers) {
      const value = readStyleValue(styles, {
        state: atState,
        breakpoint: atBreakpoint,
        property,
        path: [],
      });
      if (typeof value === "string") return value.trim().toLowerCase();
    }
  }
  return undefined;
}

/**
 * The tiers whose rules apply at the edited one, the one that wins first.
 *
 * WHICH tiers is the shared resolver's answer (`liveBreakpointsFor`), the one
 * the provenance dots use, so an axis's unbounded container tier is included
 * exactly where the compiler applies it. The ORDER is the compiler's own
 * emission order, reversed: `breakpointContexts` lists the contexts in cascade
 * order, where a later rule wins over an earlier one of the same specificity,
 * so the walk over a node's own values meets the winner first. Two tiers with
 * no upper bound (the unconditional one and a container axis's unbounded one)
 * are then ordered as the stylesheet orders them, not as equals.
 */
function tiersFrom(
  breakpoint: BreakpointId,
  breakpoints: BreakpointSet | undefined
): BreakpointId[] {
  const emitted = new Map(
    breakpointContexts(breakpoints).map((context, index) => [context.id, index])
  );
  // An id the compiler does not emit sorts last: nothing it holds applies.
  const positionOf = (id: BreakpointId) => emitted.get(id) ?? -1;
  return liveBreakpointsFor(breakpoints, breakpoint).sort(
    (a, b) => positionOf(b) - positionOf(a)
  );
}

/**
 * Labels other than the property's name: shorter, where the name is cut short
 * in the Style tab's 7rem label column ("Justify content" read "Justify
 * cont…"), Webflow's and Figma's words for the same two controls; or plainer,
 * where the name says how CSS does it rather than what it is.
 */
const SHORT_LABELS: Readonly<Record<string, string>> = {
  justifyContent: "Justify",
  alignItems: "Align",
  textTransform: "Letter case",
  objectFit: "Fit",
  // Which part of the picture stays in view: what an author is choosing.
  objectPosition: "Focal point",
  // In an Accordion's own Icon section, where "Disclosure" says nothing an
  // author does not already see.
  disclosureIcon: "Icon",
  disclosurePosition: "Position",
};

/**
 * What a property's label says on hover, where the inspector edits it on
 * another scale than the catalog describes: opacity is a percent here.
 */
const SUMMARIES: Readonly<Record<string, string>> = {
  opacity: "How solid the element is, from 0 (clear) to 100 percent.",
};

/** One property's controls and the value they are showing. */
function inspectProperty(
  property: string,
  styles: Parameters<typeof readStyleValue>[0],
  offered: boolean,
  options: StyleInspectionOptions & {
    state: StyleState;
    breakpoint: BreakpointId;
  }
): Omit<InspectedStyleProperty, "common"> {
  // Present by construction: the name came out of `stylePropertiesForSupports`,
  // which reads the same catalog. Asked again rather than threaded through so
  // this function takes a name, which is what makes it callable from a test
  // without assembling a catalog row.
  const entry = getStyleProperty(property);
  if (entry === undefined) {
    throw new Error(`${property} is not a style property`);
  }
  const value = readStyleValue(styles, {
    state: options.state,
    breakpoint: options.breakpoint,
    property,
    path: [],
  });
  const set = styleControlsFor(entry, value, {
    ...options,
    // Bound to THIS property before it reaches the walk, which speaks only in
    // paths: two properties can both hold a union at the root, and a resolver
    // told only the path would answer for whichever asked first.
    variantAt: path => options.variantAt?.(property, path),
  });
  const short = SHORT_LABELS[property];
  return {
    property,
    label: short ?? fieldLabel(property),
    // A shortened label keeps the property's CSS name in its tooltip.
    summary:
      short === undefined
        ? (SUMMARIES[property] ?? entry.summary)
        : `${fieldLabel(property)}: ${SUMMARIES[property] ?? entry.summary}`,
    controls: set.controls,
    variants: set.variants,
    value,
    set: value !== undefined,
    offered,
  };
}
