/**
 * Alignment and direction values as icons that follow the way content flows.
 *
 * The inspector sets `justify-content`, `align-items`, `align-content`,
 * `flex-direction`, `flex-wrap` and `text-align` with icon buttons rather than
 * a list of CSS words. An icon is a claim about direction, so it is chosen
 * from the container's flow: the main-axis icons stand upright in a column,
 * start and end change places along a reversed main axis, and a horizontal
 * start sits on the right of a right-to-left element.
 *
 * Only a property's primary values get an icon. The rest of what the
 * catalogue accepts (`safe center`, `flex-start`, `first baseline`, `normal`)
 * is returned as `rest`, for a list beside the icons, so every value stays
 * reachable and a stored rare one still shows.
 *
 * Pure, and it names icons by their lucide export rather than importing
 * them, so the mapping is asserted without a DOM.
 *
 * @module style-alignment-icons
 */

import {
  BASE_BREAKPOINT,
  type NodeStyles,
  type StyleLeaf,
  type StyleState,
} from "@nextlyhq/blocks-engine";

import type { SideOrientation } from "./side-orientation";
import { readStyleValue } from "./style-values";

/** How the edited container lays its content out. */
export interface Flow {
  /** The element's `writing-mode`: which way its lines run. */
  readonly writingMode: string;
  /** Whether its inline direction is right to left. */
  readonly rtl: boolean;
  /** Whether it is a flex container, so `flex-direction` and `flex-wrap` apply. */
  readonly flex: boolean;
  /** Its `flex-direction`, `row` when unset. */
  readonly direction: string;
}

/** One icon button: the value it stores, its name, and the icon drawn. */
export interface AlignmentOption {
  readonly value: string;
  readonly label: string;
  /** A lucide icon's export name. */
  readonly icon: string;
  /**
   * A 2×2 matrix, `[a, b, c, d]` as CSS `matrix(a, b, c, d, 0, 0)` takes it,
   * that maps the icon's own directions onto the container's. Absent when
   * they already agree.
   */
  readonly matrix?: readonly [number, number, number, number];
  /** Turned a quarter, for text that runs down the page. */
  readonly rotated?: true;
}

/** A property's icon buttons, and the values it accepts that have none. */
export interface AlignmentGroup {
  readonly options: readonly AlignmentOption[];
  readonly rest: readonly string[];
}

type Edge = "left" | "right" | "top" | "bottom";

/** An axis on the screen: which way it runs, and the edge it starts from. */
interface Axis {
  readonly horizontal: boolean;
  readonly start: Edge;
}

const OPPOSITE: Readonly<Record<Edge, Edge>> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};

/** The axis lines run along: across in horizontal writing, down otherwise. */
function inlineAxis(flow: Flow): Axis {
  if (flow.writingMode.startsWith("horizontal")) {
    return { horizontal: true, start: flow.rtl ? "right" : "left" };
  }
  const upward = flow.writingMode === "sideways-lr";
  return {
    horizontal: false,
    start: upward !== flow.rtl ? "bottom" : "top",
  };
}

/** The axis lines stack along: down the page, or across in vertical writing. */
function blockAxis(flow: Flow): Axis {
  if (flow.writingMode.startsWith("horizontal")) {
    return { horizontal: false, start: "top" };
  }
  return {
    horizontal: true,
    start: flow.writingMode.endsWith("-lr") ? "left" : "right",
  };
}

/**
 * The main and cross axes. A flex container's main axis is its inline axis in
 * a row and its block axis in a column; anything else aligns along its inline
 * and block axes, whatever flex values it still stores.
 *
 * Never reversed. CSS Box Alignment ties `start` and `end` to the writing
 * mode's edges, whatever the flex direction or wrap; only `flex-start` and
 * `flex-end` follow a reversed flow, and those are listed, not drawn.
 */
function axesOf(flow: Flow): { main: Axis; cross: Axis; inline: Axis } {
  const inline = inlineAxis(flow);
  const block = blockAxis(flow);
  if (!flow.flex || !flow.direction.startsWith("column")) {
    return { main: inline, cross: block, inline };
  }
  return { main: block, cross: inline, inline };
}

/** Whether an axis starts at the end its icons draw as start: left or top. */
function natural(axis: Axis): boolean {
  return axis.start === "left" || axis.start === "top";
}

const ARROWS: Readonly<Record<Edge, string>> = {
  right: "ArrowRight",
  left: "ArrowLeft",
  bottom: "ArrowDown",
  top: "ArrowUp",
};

/** The icons whose start and end swap, both ways round. */
const MIRRORED: Readonly<Record<string, string>> = Object.fromEntries(
  [
    ["AlignHorizontalJustifyStart", "AlignHorizontalJustifyEnd"],
    ["AlignVerticalJustifyStart", "AlignVerticalJustifyEnd"],
    ["AlignStartHorizontal", "AlignEndHorizontal"],
    ["AlignStartVertical", "AlignEndVertical"],
    ["AlignLeft", "AlignRight"],
  ].flatMap(([a, b]) => [
    [a, b],
    [b, a],
  ])
);

interface Entry {
  readonly value: string;
  readonly label: string;
  /** The icon along a horizontal axis, and along a vertical one. */
  readonly horizontal: string;
  readonly vertical: string;
}

function entry(
  value: string,
  label: string,
  horizontal: string,
  vertical: string
): Entry {
  return { value, label, horizontal, vertical };
}

/** Which axis a property's values point along. */
type Along = "main" | "cross" | "inline";

const GROUPS: Readonly<
  Record<string, { along: Along; entries: readonly Entry[] }>
> = {
  "justify-content": {
    along: "main",
    entries: [
      entry(
        "start",
        "Start",
        "AlignHorizontalJustifyStart",
        "AlignVerticalJustifyStart"
      ),
      entry(
        "center",
        "Center",
        "AlignHorizontalJustifyCenter",
        "AlignVerticalJustifyCenter"
      ),
      entry(
        "end",
        "End",
        "AlignHorizontalJustifyEnd",
        "AlignVerticalJustifyEnd"
      ),
      entry(
        "space-between",
        "Space between",
        "AlignHorizontalSpaceBetween",
        "AlignVerticalSpaceBetween"
      ),
    ],
  },
  // Items line up against an edge of the cross axis: along a vertical cross
  // axis that edge is a horizontal line (top, middle, bottom).
  "align-items": {
    along: "cross",
    entries: [
      entry("start", "Start", "AlignStartVertical", "AlignStartHorizontal"),
      entry("center", "Center", "AlignCenterVertical", "AlignCenterHorizontal"),
      entry("end", "End", "AlignEndVertical", "AlignEndHorizontal"),
      entry("stretch", "Stretch", "StretchHorizontal", "StretchVertical"),
      entry("baseline", "Baseline", "Baseline", "Baseline"),
    ],
  },
  "align-content": {
    along: "cross",
    entries: [
      entry(
        "start",
        "Start",
        "AlignHorizontalJustifyStart",
        "AlignVerticalJustifyStart"
      ),
      entry(
        "center",
        "Center",
        "AlignHorizontalJustifyCenter",
        "AlignVerticalJustifyCenter"
      ),
      entry(
        "end",
        "End",
        "AlignHorizontalJustifyEnd",
        "AlignVerticalJustifyEnd"
      ),
      entry(
        "space-between",
        "Space between",
        "AlignHorizontalSpaceBetween",
        "AlignVerticalSpaceBetween"
      ),
      entry("stretch", "Stretch", "StretchHorizontal", "StretchVertical"),
    ],
  },
  "text-align": {
    along: "inline",
    entries: [
      entry("start", "Start", "AlignLeft", "AlignLeft"),
      entry("center", "Center", "AlignCenter", "AlignCenter"),
      entry("end", "End", "AlignRight", "AlignRight"),
      entry("justify", "Justify", "AlignJustify", "AlignJustify"),
    ],
  },
};

/** The four directions, each an arrow the way it runs on the screen. */
function directionOptions(
  values: readonly string[],
  flow: Flow
): AlignmentOption[] {
  const inline = inlineAxis(flow);
  const block = blockAxis(flow);
  const options: AlignmentOption[] = [
    { value: "row", label: "Row", icon: ARROWS[OPPOSITE[inline.start]] },
    {
      value: "row-reverse",
      label: "Row, reversed",
      icon: ARROWS[inline.start],
    },
    { value: "column", label: "Column", icon: ARROWS[OPPOSITE[block.start]] },
    {
      value: "column-reverse",
      label: "Column, reversed",
      icon: ARROWS[block.start],
    },
  ];
  return options.filter(option => values.includes(option.value));
}

/** A unit vector on the screen, x to the right and y down, toward an edge. */
const TOWARD: Readonly<Record<Edge, readonly [number, number]>> = {
  right: [1, 0],
  left: [-1, 0],
  bottom: [0, 1],
  top: [0, -1],
};

/**
 * The wrap icons. Their lines run right and wrap downward, so each carries
 * the matrix mapping those two directions onto the container's: its main
 * direction, reversed by a reversed flex direction, and the way its lines
 * advance, the cross axis's start to end, or the other way for wrap-reverse.
 */
function wrapOptions(values: readonly string[], flow: Flow): AlignmentOption[] {
  const { main, cross } = axesOf(flow);
  // Reversed only where the flex direction chose the axes: a block or grid
  // keeps a stored direction it no longer lays out by.
  const mainStart =
    flow.flex && flow.direction.endsWith("-reverse")
      ? OPPOSITE[main.start]
      : main.start;
  const runs = TOWARD[OPPOSITE[mainStart]];
  const matrixFor = (advanceToward: Edge) => {
    const advances = TOWARD[advanceToward];
    const matrix = [runs[0], runs[1], advances[0], advances[1]] as const;
    return matrix.join(",") === "1,0,0,1" ? {} : { matrix };
  };
  const forward = matrixFor(OPPOSITE[cross.start]);
  const options: AlignmentOption[] = [
    { value: "nowrap", label: "No wrap", icon: "ArrowRightToLine", ...forward },
    { value: "wrap", label: "Wrap", icon: "WrapText", ...forward },
    {
      value: "wrap-reverse",
      label: "Wrap, reversed",
      icon: "WrapText",
      ...matrixFor(cross.start),
    },
  ];
  return options.filter(option => values.includes(option.value));
}

/** The icon buttons for one aligned property, in this flow. */
function alignedOptions(
  group: { along: Along; entries: readonly Entry[] },
  values: readonly string[],
  flow: Flow
): AlignmentOption[] {
  const axis = axesOf(flow)[group.along];
  const swap = !natural(axis);
  // Text running down the page draws the horizontal icons turned a quarter.
  const rotated = group.along === "inline" && !axis.horizontal;
  return group.entries
    .filter(candidate => values.includes(candidate.value))
    .map(candidate => {
      const drawn =
        axis.horizontal || rotated ? candidate.horizontal : candidate.vertical;
      return {
        value: candidate.value,
        label: candidate.label,
        icon: swap ? (MIRRORED[drawn] ?? drawn) : drawn,
        ...(rotated ? { rotated: true as const } : {}),
      };
    });
}

/**
 * The icon buttons for a CSS property's values, in the inspector's order,
 * with the accepted values that have no icon; `undefined` for a property not
 * drawn as icons.
 */
export function alignmentGroupFor(
  cssProperty: string,
  values: readonly string[],
  flow: Flow
): AlignmentGroup | undefined {
  let options: AlignmentOption[];
  if (cssProperty === "flex-direction") {
    options = directionOptions(values, flow);
  } else if (cssProperty === "flex-wrap") {
    options = wrapOptions(values, flow);
  } else if (Object.hasOwn(GROUPS, cssProperty)) {
    const group = GROUPS[cssProperty];
    if (group === undefined) return undefined;
    options = alignedOptions(group, values, flow);
  } else {
    return undefined;
  }
  const iconed = new Set(options.map(option => option.value));
  return { options, rest: values.filter(value => !iconed.has(value)) };
}

/**
 * The flow of the container being edited.
 *
 * As the canvas lays it out, when the element was measured: that answers for
 * a class, an intermediate breakpoint and a grid alike, which storage alone
 * cannot. Otherwise from what the node stores where the author is editing
 * (this state, this breakpoint), else the nearest wider place, else CSS's
 * defaults: a row, in no flex container, written left to right.
 *
 * @param styles - the node's stored styles, the fallback
 * @param state - the edited state
 * @param breakpoint - the edited breakpoint
 * @param measured - the element's computed axes and layout, when known
 */
export function flowOf(
  styles: NodeStyles | undefined,
  state: StyleState,
  breakpoint: string,
  measured: SideOrientation | undefined
): Flow {
  const at = (property: string) => {
    const read = (where: StyleState, tier: string) =>
      readStyleValue(styles, {
        state: where,
        breakpoint: tier,
        property,
        path: [],
      });
    const value =
      read(state, breakpoint) ??
      read("base", breakpoint) ??
      read(state, BASE_BREAKPOINT) ??
      read("base", BASE_BREAKPOINT);
    return typeof value === "string" ? value : undefined;
  };
  const display = measured?.display ?? at("display") ?? "";
  return {
    writingMode: measured?.writingMode ?? "horizontal-tb",
    rtl: measured?.direction === "rtl",
    flex: display === "flex" || display === "inline-flex",
    direction: measured?.flexDirection ?? at("flexDirection") ?? "row",
  };
}

/**
 * Whether a leaf is drawn as icons in any flow: a keyword of one of the
 * properties above. What a label asks to decide how to point at its control.
 */
export function drawsIcons(leaf: StyleLeaf): boolean {
  if (leaf.kind !== "keyword") return false;
  const property = leaf.cssProperty;
  return (
    property === "flex-direction" ||
    property === "flex-wrap" ||
    Object.hasOwn(GROUPS, property)
  );
}
