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
 * property carries whether it has an effect on the block in hand (`applies`,
 * the engine's answer, judged by the block's own arrangement, its parent's and
 * what it renders) and whether it shows without being asked for (`common`):
 * its tier is common and it applies. The rest wait behind the section's
 * "+ More", which is the panel's to draw. A property holding a value here
 * always shows, whether or not it still has an effect.
 *
 * @module style-inspector
 */

import {
  applies,
  asciiLower,
  BASE_BREAKPOINT,
  breakpointContexts,
  decodeIdentifier,
  DISCLOSURE_ICON_PROPERTY,
  getBlock,
  getStyleProperty,
  locateNode,
  statePropagatesToAncestors,
  STYLE_CATALOG,
  stylePropertiesForSupports,
  trimCssWhitespace,
  type AppliesContext,
  type BlockDocument,
  type BlockNode,
  type BreakpointId,
  type BreakpointSet,
  type NodeStyles,
  type StyleState,
  type StyleSubject,
  type StyleTraceEntry,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import type { ParentArrangement } from "./plain-layout";
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
   * embed), which is where the media fit properties have an effect. The canvas
   * knows what a block renders as; the document does not. `false` counts as
   * known only where the canvas has been read (the cascade's subject names the
   * element drawn); before that, every property is treated as applying.
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
   * Whether it has an effect on this block, as the engine answers it: true
   * wherever what the block is could not be read.
   */
  readonly applies: boolean;
  /**
   * Whether it shows without being asked for: its tier holds for this block
   * and it applies, or it holds a value here. False puts it behind its
   * section's "+ More".
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
   * How the block's parent arranges it at the edited device, which decides
   * what "Inside its parent" offers; absent where the parent isn't known.
   */
  readonly parent?: ParentArrangement;
  /**
   * The `object-fit` keyword in force here, lowercased, or `undefined` when
   * nothing sets one: what decides what the focal point says it does.
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
  const objectFit = cascadedKeyword(styles, at, "object-fit", "objectFit");
  const context = appliesContextOf(document, node, styles, at, options);
  const tiers: TierContext = {
    replaced: context.replaced,
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
    const has = applies(property, context);
    return {
      placement,
      row: {
        ...row,
        applies: has,
        common: row.set || (has && tierShows(placement.tier, tiers)),
      },
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

  const parent = laidOutBy(document, node, at, options, {
    position: context.position,
    sized: offered.has("width"),
  });
  return {
    nodeId: node.id,
    state,
    breakpoint,
    sections,
    ...(objectFit === undefined ? {} : { objectFit }),
    ...(parent === undefined ? {} : { parent }),
  };
}

/** Where a property is read: the edited address, and how to read it. */
interface ReadAt {
  readonly state: StyleState;
  readonly breakpoint: BreakpointId;
  readonly breakpoints: BreakpointSet | undefined;
  readonly cascade: StyleInspectionOptions["cascade"];
}

/**
 * What the block is, for the engine's `applies`: its own display, wrap and
 * position, its parent's display, and whether it renders a replaced element.
 *
 * Through the compiled cascade a keyword nothing sets is known: the CSS
 * initial value, since nothing else reaches the box. Without one only what
 * the document stores is known, and a keyword it does not store is left
 * `undefined`, which the engine reads as "applies": a class or the block's
 * defaults may set it, and hiding a property wrongly is the worse mistake.
 */
function appliesContextOf(
  document: BlockDocument,
  node: BlockNode,
  styles: NodeStyles | undefined,
  at: ReadAt,
  options: StyleInspectionOptions | undefined
): AppliesContext {
  const known = at.cascade !== undefined;
  const own = (
    cssProperty: string,
    property: string,
    initial: string,
    path: readonly string[] = []
  ) =>
    cascadedKeyword(styles, at, cssProperty, property, path) ??
    (known ? initial : undefined);
  return {
    display: own("display", "display", IN_FLOW),
    flexWrap: own("flex-wrap", "flexWrap", "nowrap"),
    // A position is stored as an object; its type is the keyword in force.
    position: own("position", "position", "static", ["type"]),
    parentDisplay: parentDisplayOf(document, node, at, options),
    // Known not to be media only once the canvas has said what it draws.
    replaced:
      options?.media === true
        ? true
        : at.cascade?.subject.tag === undefined
          ? undefined
          : false,
  };
}

/**
 * How the block's parent lays it out, for a block with a size of its own to
 * set and in its parent's flow. One that no longer offers a size keeps what
 * it stores as clear-only rows; one its position takes out of the flow isn't
 * laid out by its parent at all.
 */
function laidOutBy(
  document: BlockDocument,
  node: BlockNode,
  at: ReadAt,
  options: StyleInspectionOptions | undefined,
  block: { readonly position: string | undefined; readonly sized: boolean }
): ParentArrangement | undefined {
  if (!block.sized || OUT_OF_FLOW.has(block.position ?? "")) return undefined;
  return parentArrangementOf(document, node, at, options);
}

/** The positions that take a block out of its parent's layout. */
const OUT_OF_FLOW: ReadonlySet<string> = new Set(["absolute", "fixed"]);

/** A display that lays children out in flow, for a box nothing gives one. */
const IN_FLOW = "block";

/** The document kinds whose top-level blocks sit in the page's own flow. */
const PAGE_ROOTED: ReadonlySet<string> = new Set(["page", "template"]);

/**
 * The box that lays this block out: its parent, or past a `display:
 * contents` parent, the nearest ancestor that draws a box; read as the
 * keywords in force on it. `inFlow` says a keyword it doesn't set is known to
 * be the initial one (the cascade reached it), rather than unknown.
 */
interface ParentBox {
  readonly read: (cssProperty: string, property: string) => string | undefined;
  readonly inFlow: boolean;
}

/**
 * The block's parent box, read in the state the canvas puts the parent in:
 * the edited one for a state that reaches ancestors (hover, active), the base
 * state otherwise. A top-level block of a page or a template sits in the page
 * root, laid out as the page's settings say; one of a component or a pattern
 * goes wherever it is placed, so its parent is not known. Nor is it for a
 * shared style or a look, which many blocks wear wherever each one sits.
 */
function parentBoxOf(
  document: BlockDocument,
  node: BlockNode,
  at: ReadAt,
  options: StyleInspectionOptions | undefined
): ParentBox | undefined {
  // The state the canvas forces up the chain while the child is edited in
  // one: hover and active reach every ancestor, the others only the block.
  const base: ReadAt = statePropagatesToAncestors(at.state)
    ? at
    : { ...at, state: "base" };
  // A shared style or a look is worn by many blocks, wherever each one sits:
  // the selected block's parent says nothing about the others.
  if (options?.styles !== undefined) return undefined;
  // The page root lays out its top-level blocks as the page's own settings
  // say, which is in flow unless they give it a display.
  const atRoot: ParentBox | undefined = PAGE_ROOTED.has(document.kind)
    ? {
        read: (cssProperty, property) =>
          cascadedKeyword(
            document.settings?.styles,
            { ...base, cascade: undefined },
            cssProperty,
            property
          ),
        inFlow: true,
      }
    : undefined;
  return at.cascade === undefined
    ? storedParentBox(document.nodes, node.id, base, atRoot)
    : cascadedParentBox(at.cascade, base, atRoot);
}

/** The display of the box that lays this block out, as {@link parentBoxOf}. */
function parentDisplayOf(
  document: BlockDocument,
  node: BlockNode,
  at: ReadAt,
  options: StyleInspectionOptions | undefined
): string | undefined {
  const box = parentBoxOf(document, node, at, options);
  if (box === undefined) return undefined;
  return box.read("display", "display") ?? (box.inFlow ? IN_FLOW : undefined);
}

/**
 * How the block's parent arranges it at the edited device, by the display and
 * direction in force on the parent there: a Row stacked here is a column.
 * `undefined` where the parent isn't known (a shared style, a component's
 * top level) or arranges another way (a table).
 */
function parentArrangementOf(
  document: BlockDocument,
  node: BlockNode,
  at: ReadAt,
  options: StyleInspectionOptions | undefined
): ParentArrangement | undefined {
  const box = parentBoxOf(document, node, at, options);
  if (box === undefined) return undefined;
  return arrangementOf(
    keywordIdentity(box.read("display", "display")) ?? IN_FLOW,
    keywordIdentity(box.read("flex-direction", "flexDirection"))
  );
}

/** The arrangement a display and a direction lay a box's children out in. */
function arrangementOf(
  display: string,
  direction: string | undefined
): ParentArrangement | undefined {
  if (display === "grid" || display === "inline-grid") return "grid";
  if (display === "flex" || display === "inline-flex") {
    return direction?.startsWith("column") === true ? "column" : "row";
  }
  return display === "block" || display === "flow-root" ? "flow" : undefined;
}

/**
 * The parent box through the cascade. The subject already names its
 * ancestors, outermost first; one that does not say is not taken for a
 * top-level block.
 */
function cascadedParentBox(
  cascade: NonNullable<StyleInspectionOptions["cascade"]>,
  base: ReadAt,
  atRoot: ParentBox | undefined
): ParentBox | undefined {
  const ancestors = cascade.subject.ancestors;
  if (ancestors === undefined) return undefined;
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const subject = {
      ...ancestors[index],
      ancestors: ancestors.slice(0, index),
    };
    const at = { ...base, cascade: { trace: cascade.trace, subject } };
    const read = (cssProperty: string, property: string) =>
      cascadedKeyword(undefined, at, cssProperty, property);
    const display = read("display", "display") ?? IN_FLOW;
    if (keywordIdentity(display) !== "contents") return { read, inFlow: true };
  }
  return atRoot;
}

/** The parent box as the document stores it, guarded against a cycle. */
function storedParentBox(
  nodes: BlockDocument["nodes"],
  nodeId: string,
  base: ReadAt,
  atRoot: ParentBox | undefined
): ParentBox | undefined {
  const seen = new Set<string>([nodeId]);
  let parent = locateNode(nodes, nodeId)?.parent;
  while (parent !== undefined && !seen.has(parent.id)) {
    seen.add(parent.id);
    const styles = parent.styles;
    const read = (cssProperty: string, property: string) =>
      cascadedKeyword(styles, base, cssProperty, property);
    if (keywordIdentity(read("display", "display")) !== "contents") {
      return { read, inFlow: false };
    }
    parent = locateNode(nodes, parent.id)?.parent;
  }
  // Out of parents: the page's own flow, unless the walk met a node twice.
  return parent === undefined ? atRoot : undefined;
}

/** A keyword as the engine identifies it: trimmed, unescaped, lowercased. */
function keywordIdentity(value: string | undefined): string | undefined {
  return value === undefined
    ? undefined
    : asciiLower(decodeIdentifier(trimCssWhitespace(value)));
}

/**
 * The keyword a property takes at this address, lowercased: the display, wrap
 * and position that decide what applies, the fit the focal point describes.
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
  styles: NodeStyles | undefined,
  at: ReadAt,
  cssProperty: string,
  property: string,
  path: readonly string[] = []
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
        path,
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
  disclosurePosition: "Icon position",
  // In the Background section, where "Background" already says whose it is;
  // the whole name was cut to "Background gradi…".
  backgroundGradient: "Gradient",
  // What the value says: the size of each column or row ("1fr 2fr"). Not
  // "Columns" alone, which on a Columns block reads as how many there are.
  // Rows is shortened with Columns so the pair reads as one in Layout.
  gridTemplateColumns: "Column sizes",
  gridTemplateRows: "Row sizes",
  // A child's share of a Row or a Grid, in the words of what each one does:
  // "Flex grow" says how CSS spells it, "Grow" what the block does.
  flexGrow: "Grow",
  flexShrink: "Shrink",
  flexBasis: "Starting size",
  // The room between a container's blocks, as an author asks for it; rows
  // and columns apart where a Grid sets them separately.
  gap: "Space between",
  rowGap: "Between rows",
  columnGap: "Between columns",
  // What it is in an author's words: an entrance animation.
  appear: "Animation when it appears",
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
): Omit<InspectedStyleProperty, "common" | "applies"> {
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
