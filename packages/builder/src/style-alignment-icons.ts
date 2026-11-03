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
  type StyleState,
} from "@nextlyhq/blocks-engine";

import { readStyleValue } from "./style-values";

/** How the edited container lays its content out. */
export interface Flow {
  /** The main axis: `row` runs inline, `column` runs block. */
  readonly axis: "row" | "column";
  /** Whether the main axis runs backwards (`row-reverse`, `column-reverse`). */
  readonly reversed: boolean;
  /** Whether the element's inline direction is right to left. */
  readonly rtl: boolean;
}

/** One icon button: the value it stores, its name, and the icon drawn. */
export interface AlignmentOption {
  readonly value: string;
  readonly label: string;
  /** A lucide icon's export name. */
  readonly icon: string;
  /** Drawn upside down, for a value whose icon has no reversed twin. */
  readonly flipped?: true;
}

/** A property's icon buttons, and the values it accepts that have none. */
export interface AlignmentGroup {
  readonly options: readonly AlignmentOption[];
  readonly rest: readonly string[];
}

/** Which way a value's start and end point, when they point at all. */
type Axis = "main" | "cross" | "inline" | "none";

interface Entry {
  readonly value: string;
  readonly label: string;
  /** The icon in a row, and in a column. */
  readonly row: string;
  readonly column: string;
  readonly flipped?: true;
}

/** The icons whose start and end swap, both ways round. */
const MIRRORED: Readonly<Record<string, string>> = Object.fromEntries(
  [
    ["AlignHorizontalJustifyStart", "AlignHorizontalJustifyEnd"],
    ["AlignVerticalJustifyStart", "AlignVerticalJustifyEnd"],
    ["AlignStartHorizontal", "AlignEndHorizontal"],
    ["AlignStartVertical", "AlignEndVertical"],
    ["AlignLeft", "AlignRight"],
    ["ArrowRight", "ArrowLeft"],
  ].flatMap(([a, b]) => [
    [a, b],
    [b, a],
  ])
);

const GROUPS: Readonly<
  Record<string, { axis: Axis; entries: readonly Entry[] }>
> = {
  "justify-content": {
    axis: "main",
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
      entry(
        "space-around",
        "Space around",
        "AlignHorizontalSpaceAround",
        "AlignVerticalSpaceAround"
      ),
      entry(
        "space-evenly",
        "Space evenly",
        "AlignHorizontalDistributeCenter",
        "AlignVerticalDistributeCenter"
      ),
    ],
  },
  "align-items": {
    axis: "cross",
    entries: [
      entry("start", "Start", "AlignStartHorizontal", "AlignStartVertical"),
      entry("center", "Center", "AlignCenterHorizontal", "AlignCenterVertical"),
      entry("end", "End", "AlignEndHorizontal", "AlignEndVertical"),
      entry("stretch", "Stretch", "StretchVertical", "StretchHorizontal"),
      entry("baseline", "Baseline", "Baseline", "Baseline"),
    ],
  },
  "align-content": {
    axis: "cross",
    entries: [
      entry(
        "start",
        "Start",
        "AlignVerticalJustifyStart",
        "AlignHorizontalJustifyStart"
      ),
      entry(
        "center",
        "Center",
        "AlignVerticalJustifyCenter",
        "AlignHorizontalJustifyCenter"
      ),
      entry(
        "end",
        "End",
        "AlignVerticalJustifyEnd",
        "AlignHorizontalJustifyEnd"
      ),
      entry(
        "space-between",
        "Space between",
        "AlignVerticalSpaceBetween",
        "AlignHorizontalSpaceBetween"
      ),
      entry(
        "space-around",
        "Space around",
        "AlignVerticalSpaceAround",
        "AlignHorizontalSpaceAround"
      ),
      entry("stretch", "Stretch", "StretchVertical", "StretchHorizontal"),
    ],
  },
  "text-align": {
    axis: "inline",
    entries: [
      entry("start", "Start", "AlignLeft", "AlignLeft"),
      entry("center", "Center", "AlignCenter", "AlignCenter"),
      entry("end", "End", "AlignRight", "AlignRight"),
      entry("justify", "Justify", "AlignJustify", "AlignJustify"),
    ],
  },
  "flex-direction": {
    axis: "inline",
    entries: [
      entry("row", "Row", "ArrowRight", "ArrowRight"),
      entry("row-reverse", "Row, reversed", "ArrowLeft", "ArrowLeft"),
      entry("column", "Column", "ArrowDown", "ArrowDown"),
      entry("column-reverse", "Column, reversed", "ArrowUp", "ArrowUp"),
    ],
  },
  "flex-wrap": {
    axis: "none",
    entries: [
      entry("nowrap", "No wrap", "ArrowRightToLine", "ArrowRightToLine"),
      entry("wrap", "Wrap", "WrapText", "WrapText"),
      {
        ...entry("wrap-reverse", "Wrap, reversed", "WrapText", "WrapText"),
        flipped: true,
      },
    ],
  },
};

function entry(
  value: string,
  label: string,
  row: string,
  column: string
): Entry {
  return { value, label, row, column };
}

/**
 * Whether start and end trade places for this axis in this flow: along the
 * main axis when it is reversed, and along a horizontal one in a
 * right-to-left element. Both at once cancel out.
 */
function swaps(axis: Axis, flow: Flow): boolean {
  const horizontal =
    axis === "inline" ||
    (axis === "main" && flow.axis === "row") ||
    (axis === "cross" && flow.axis === "column");
  const reversed = axis === "main" && flow.reversed;
  return (flow.rtl && horizontal) !== reversed;
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
  const group = Object.hasOwn(GROUPS, cssProperty)
    ? GROUPS[cssProperty]
    : undefined;
  if (group === undefined) return undefined;
  const swap = swaps(group.axis, flow);
  const options = group.entries
    .filter(candidate => values.includes(candidate.value))
    .map(candidate => {
      const drawn = flow.axis === "row" ? candidate.row : candidate.column;
      const icon = swap ? (MIRRORED[drawn] ?? drawn) : drawn;
      return {
        value: candidate.value,
        label: candidate.label,
        icon,
        ...(candidate.flipped === undefined ? {} : { flipped: true as const }),
      };
    });
  const iconed = new Set(options.map(option => option.value));
  return { options, rest: values.filter(value => !iconed.has(value)) };
}

/**
 * The flow of the container being edited: its own `flex-direction` where the
 * author is editing (this state, this breakpoint), else the nearest wider
 * place it is set (the unstyled state, then the base breakpoint), else a row,
 * which is what CSS lays out when nothing says otherwise.
 *
 * @param styles - the node's stored styles
 * @param state - the edited state
 * @param breakpoint - the edited breakpoint
 * @param rtl - whether the element's inline direction is right to left
 */
export function flowOf(
  styles: NodeStyles | undefined,
  state: StyleState,
  breakpoint: string,
  rtl: boolean
): Flow {
  const at = (where: StyleState, tier: string) =>
    readStyleValue(styles, {
      state: where,
      breakpoint: tier,
      property: "flexDirection",
      path: [],
    });
  const stored =
    at(state, breakpoint) ??
    at("base", breakpoint) ??
    at(state, BASE_BREAKPOINT) ??
    at("base", BASE_BREAKPOINT);
  const direction = typeof stored === "string" ? stored : "row";
  return {
    axis: direction.startsWith("column") ? "column" : "row",
    reversed: direction.endsWith("-reverse"),
    rtl,
  };
}
