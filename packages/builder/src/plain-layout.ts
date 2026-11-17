/**
 * The plain layout layer: a container's Arrange (Stack, Row or Grid) and its
 * rows, mapped to the catalog values they write and read back from the values
 * in force at the device being edited.
 *
 * Pure. It is handed what is in force at each device, widest first, and
 * answers with a plain state, or with the writes one plain change makes, so
 * the panel draws and writes through the same rules a test asserts.
 *
 * Read back by the display and direction IN FORCE at the edited device, never
 * by a plain choice alone: a Row that stacks on Mobile reads as a Row there,
 * with "Stack on: Mobile", and its Align, Spread and Reverse order go by the
 * column in force there.
 *
 * @module plain-layout
 */

import { applies } from "@nextlyhq/blocks-engine";

/** The catalog properties the layer reads and writes. */
export const LAYOUT_PROPERTIES = [
  "display",
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "alignItems",
  "justifyItems",
  "gap",
  "rowGap",
  "columnGap",
  "gridTemplateColumns",
  "gridTemplateRows",
] as const;

/** Each layout property's CSS name, as a declaration spells it. */
export const LAYOUT_CSS_NAMES: Readonly<Record<string, string>> = {
  display: "display",
  flexDirection: "flex-direction",
  flexWrap: "flex-wrap",
  justifyContent: "justify-content",
  alignItems: "align-items",
  justifyItems: "justify-items",
  gap: "gap",
  rowGap: "row-gap",
  columnGap: "column-gap",
  gridTemplateColumns: "grid-template-columns",
  gridTemplateRows: "grid-template-rows",
};

/** One of {@link LAYOUT_PROPERTIES}. */
export type LayoutProperty = (typeof LAYOUT_PROPERTIES)[number];

/** Layout values, by catalog property, as text. */
export type LayoutValues = Readonly<Partial<Record<LayoutProperty, string>>>;

/** What is in force, and what is stored, at each device. */
export interface LayoutTiers {
  /** The devices along the viewport axis, widest (the base) first. */
  readonly order: readonly string[];
  /** The values in force at a device: its own, else what reaches it. */
  readonly inForce: (device: string) => LayoutValues;
  /** The values the edited target stores at a device itself. */
  readonly own: (device: string) => LayoutValues;
  /**
   * Every tier the page's styles are written for, in their order, where it
   * holds more than {@link order} (two tiers at one width): what survives a
   * clear is read through all of them.
   */
  readonly cascadeOrder?: readonly string[];
  /**
   * What is in force at a device beneath the target's own values there: a
   * shared style it wears, its block's defaults. Absent where nothing but the
   * target is read, as for a shared style edited on its own.
   */
  readonly beneath?: (device: string) => LayoutValues;
  /** Which way the container's lines run, so a point is placed on screen. */
  readonly flow?: PlainFlow;
}

/** A container's writing mode and inline direction. */
export interface PlainFlow {
  readonly writingMode: string;
  readonly rtl: boolean;
}

/**
 * What a target's own values put in force at a device, in the order the
 * page's styles are written: state outside, device inside. Its Normal values
 * cascade widest first, and the edited state's values, cascading the same
 * way, go over all of them, so a Hover value set at any wider device beats a
 * Normal one at this device. A shared style edited on its own is read so.
 */
export function ownCascade(
  order: readonly string[],
  own: (device: string) => LayoutValues,
  normal: (device: string) => LayoutValues
): (device: string) => LayoutValues {
  const upTo = (
    device: string,
    read: (device: string) => LayoutValues
  ): Partial<Record<LayoutProperty, string>> => {
    const merged: Partial<Record<LayoutProperty, string>> = {};
    for (const each of order) {
      Object.assign(merged, read(each));
      if (each === device) break;
    }
    return merged;
  };
  return device => ({ ...upTo(device, normal), ...upTo(device, own) });
}

/**
 * At an interaction state, what is in force beneath the state's own values:
 * the target's Normal values, cascading widest first, which a value cleared
 * at the state leaves in force. Nothing at Normal itself.
 */
export function normalBeneath(
  order: readonly string[],
  normal: (device: string) => LayoutValues
): (device: string) => LayoutValues {
  return ownCascade(order, () => ({}), normal);
}

/** Horizontal lines, left to right: what is assumed where nothing is measured. */
const LTR: PlainFlow = { writingMode: "horizontal-tb", rtl: false };

/** One point of the 3×3 Align. */
export type AlignX = "left" | "center" | "right";
export type AlignY = "top" | "middle" | "bottom";
export interface AlignPoint {
  readonly x: AlignX;
  readonly y: AlignY;
}

/** How a Row spreads its blocks along its main axis. */
export type Spread = "packed" | "between" | "around" | "even";

/** A Grid's columns: a count per device, or as many as fit a width. */
export type GridColumns =
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "fit"; readonly min: string };

/** What a container's Arrange reads as at the edited device. */
export type PlainArrange =
  | {
      readonly mode: "stack";
      /** Whether it is a flex column, written by its own settings. */
      readonly flex: boolean;
      readonly align: AlignPoint | undefined;
      readonly reverse: boolean;
    }
  | {
      readonly mode: "row";
      /** The widest device it stacks at, where it does. */
      readonly stackOn: string | undefined;
      /** Whether it is stacked at the edited device. */
      readonly stacked: boolean;
      readonly align: AlignPoint | undefined;
      readonly spread: Spread;
      readonly wrap: boolean;
      readonly reverse: boolean;
    }
  | {
      readonly mode: "grid";
      readonly columns: GridColumns | undefined;
      readonly rows: number | undefined;
      readonly align: AlignPoint | undefined;
    }
  | { readonly mode: "custom" };

/** One value to write at one device; `null` clears it there. */
export interface LayoutWrite {
  readonly device: string;
  readonly property: LayoutProperty;
  readonly value: string | null;
}

const COLUMN_DIRECTIONS = new Set(["column", "column-reverse"]);

/** The directions a Row or Stack reads: across or down, either way. */
const PLAIN_DIRECTIONS: ReadonlySet<string> = new Set([
  "row",
  "row-reverse",
  "column",
  "column-reverse",
]);

/** The wraps Wrap onto new lines says: on, or off. */
const PLAIN_WRAPS: ReadonlySet<string> = new Set(["wrap", "nowrap"]);
const ROW_DIRECTIONS = new Set(["row", "row-reverse"]);

/** Whether a device's values make the block a flex row. */
function isRow(values: LayoutValues): boolean {
  return (
    values.display === "flex" &&
    ROW_DIRECTIONS.has(values.flexDirection ?? "row")
  );
}

/** Whether a device's values make the block a flex column. */
function isColumn(values: LayoutValues): boolean {
  return (
    values.display === "flex" &&
    COLUMN_DIRECTIONS.has(values.flexDirection ?? "row")
  );
}

/** Each keyword's place on its axis: start, centre or end. */
const AXIS_PLACES: Readonly<Record<string, 0 | 1 | 2>> = {
  start: 0,
  center: 1,
  end: 2,
};

/**
 * The flex-relative keywords, read as the logical edge they name only where
 * the main axis runs its own way: reversed, `flex-start` is the far edge.
 * Physical `left` and `right` name no logical edge at all, so with these
 * anything else reads as Custom rather than as a point it doesn't make.
 */
const FLEX_PLACES: Readonly<Record<string, 0 | 2>> = {
  "flex-start": 0,
  "flex-end": 2,
};

/** A keyword's place on its axis, or `undefined` for one with none. */
function axisPlace(value: string | undefined): 0 | 1 | 2 | undefined {
  return value === undefined ? undefined : AXIS_PLACES[value];
}

const X_POINTS: readonly AlignX[] = ["left", "center", "right"];
const Y_POINTS: readonly AlignY[] = ["top", "middle", "bottom"];
const PLACE_KEYWORDS = ["start", "center", "end"] as const;

/** The properties a point's x and y are written to, by arrangement. */
function alignAxes(kind: "row" | "column" | "grid"): {
  readonly inline: LayoutProperty;
  readonly block: LayoutProperty;
} {
  // A row's main axis runs along the lines, a column's across them.
  if (kind === "row") return { inline: "justifyContent", block: "alignItems" };
  if (kind === "column") {
    return { inline: "alignItems", block: "justifyContent" };
  }
  return { inline: "justifyItems", block: "alignItems" };
}

/** Whether the lines run down the screen rather than across it. */
function vertical(flow: PlainFlow): boolean {
  return (
    flow.writingMode.startsWith("vertical") ||
    flow.writingMode.startsWith("sideways")
  );
}

/** Whether a vertical flow's lines stack from the right. */
function blockFromRight(flow: PlainFlow): boolean {
  return flow.writingMode.endsWith("-rl");
}

/** Whether a flow's inline axis runs up or leftward rather than its default. */
function inlineReversed(flow: PlainFlow): boolean {
  // sideways-lr runs its lines bottom to top; direction rtl flips any.
  return flow.rtl !== (flow.writingMode === "sideways-lr");
}

/** A place 0, 1 or 2, counted from the other end. */
function flipped(place: 0 | 1 | 2, flip: boolean): 0 | 1 | 2 {
  return flip ? ((2 - place) as 0 | 1 | 2) : place;
}

/**
 * A point on screen as places along the inline and block axes, which are
 * what `start`, `center` and `end` are measured on.
 */
function logicalPlaces(
  point: AlignPoint,
  flow: PlainFlow
): { inline: 0 | 1 | 2; block: 0 | 1 | 2 } {
  const x = X_POINTS.indexOf(point.x) as 0 | 1 | 2;
  const y = Y_POINTS.indexOf(point.y) as 0 | 1 | 2;
  if (!vertical(flow)) {
    return { inline: flipped(x, flow.rtl), block: y };
  }
  return {
    inline: flipped(y, inlineReversed(flow)),
    block: flipped(x, blockFromRight(flow)),
  };
}

/** Places along the inline and block axes as the point on screen. */
function physicalPoint(
  inline: 0 | 1 | 2,
  block: 0 | 1 | 2,
  flow: PlainFlow
): AlignPoint {
  if (!vertical(flow)) {
    return {
      x: X_POINTS[flipped(inline, flow.rtl)] ?? "left",
      y: Y_POINTS[block] ?? "top",
    };
  }
  return {
    x: X_POINTS[flipped(block, blockFromRight(flow))] ?? "left",
    y: Y_POINTS[flipped(inline, inlineReversed(flow))] ?? "top",
  };
}

/**
 * The screen axis Spread takes while it is on: the main axis, along the lines
 * for a Row and across them for a stacked one.
 */
export function spreadAxis(stacked: boolean, flow: PlainFlow = LTR): "x" | "y" {
  const alongLines = !stacked;
  return alongLines === vertical(flow) ? "y" : "x";
}

/**
 * One axis of a point read from its value: its place, the start where it
 * holds none, a spread left to Spread (read as the start), or `"custom"`.
 */
function axisRead(
  value: string | undefined,
  spreadHere: boolean,
  flexRelative = false
): 0 | 1 | 2 | "custom" {
  if (value === undefined || value === "normal" || value === "stretch") {
    return 0;
  }
  const place =
    axisPlace(value) ?? (flexRelative ? FLEX_PLACES[value] : undefined);
  if (place !== undefined) return place;
  return spreadHere && SPREADS.has(value) ? 0 : "custom";
}

/**
 * A 3×3 point read from the values in force, or `undefined` for none chosen
 * (the default stretch). A spread, not a place, leaves the main axis unread.
 */
function readAlign(
  values: LayoutValues,
  kind: "row" | "column" | "grid",
  flow: PlainFlow = LTR
): AlignPoint | undefined | "custom" {
  const axes = alignAxes(kind);
  const inlineValue = values[axes.inline];
  const blockValue = values[axes.block];
  // Nothing chosen, or only the reset a narrower device writes: the default
  // stretch.
  if (isDefaultPlace(inlineValue) && isDefaultPlace(blockValue)) {
    return undefined;
  }
  // A spread on the main axis is Spread's, not Align's.
  // Flex-relative keywords read as their edge only while the main axis
  // isn't reversed; a grid has none.
  const forward =
    kind !== "grid" && !(values.flexDirection ?? "").endsWith("-reverse");
  const inline = axisRead(inlineValue, kind === "row", forward);
  const block = axisRead(blockValue, kind === "column", forward);
  if (inline === "custom" || block === "custom") return "custom";
  return physicalPoint(inline, block, flow);
}

/** Whether a value leaves an axis at its default stretch. */
function isDefaultPlace(value: string | undefined): boolean {
  return value === undefined || value === "normal" || value === "stretch";
}

const SPREAD_OF: Readonly<Record<string, Spread>> = {
  "space-between": "between",
  "space-around": "around",
  "space-evenly": "even",
};
const SPREADS: ReadonlySet<string> = new Set(Object.keys(SPREAD_OF));

/** The keyword a Spread writes; Packed writes none. */
const SPREAD_KEYWORDS: Readonly<Record<Spread, string | null>> = {
  packed: null,
  between: "space-between",
  around: "space-around",
  even: "space-evenly",
};

const COUNT_TEMPLATE = /^repeat\((\d+),\s*minmax\(0,\s*1fr\)\)$/;
// The minimum may itself hold commas, as `min(12rem, 100%)` does: the last
// `, 1fr))` closes the template.
const FIT_TEMPLATE = /^repeat\(auto-fill,\s*minmax\((.+),\s*1fr\)\)$/;
const ROWS_TEMPLATE = /^repeat\((\d+),\s*auto\)$/;

/** A Grid's columns read from its template, or `"custom"` for another. */
function readColumns(
  template: string | undefined
): GridColumns | undefined | "custom" {
  if (template === undefined || template === "none") return undefined;
  const count = COUNT_TEMPLATE.exec(template);
  if (count !== null) return { kind: "count", count: Number(count[1]) };
  const fit = FIT_TEMPLATE.exec(template);
  if (fit !== null) return { kind: "fit", min: (fit[1] ?? "").trim() };
  return "custom";
}

/** A Grid's rows read from its template, or `"custom"` for another. */
function readRows(template: string | undefined): number | undefined | "custom" {
  if (template === undefined || template === "none") return undefined;
  const rows = ROWS_TEMPLATE.exec(template);
  return rows === null ? "custom" : Number(rows[1]);
}

/**
 * The widest device at or below `from` (by index) that sets the column of a
 * Row: one where the block is a flex column while a wider one is a Row.
 */
function stackDevice(tiers: LayoutTiers): string | undefined {
  let rowSeen = false;
  for (const device of tiers.order) {
    const values = tiers.inForce(device);
    if (isRow(values)) rowSeen = true;
    else if (rowSeen && isColumn(values)) return device;
  }
  return undefined;
}

/** Whether a column at a device is a Row stacked there, not a Stack. */
function stackedRowAt(tiers: LayoutTiers, device: string): boolean {
  const stackOn = stackDevice(tiers);
  return (
    stackOn !== undefined &&
    tiers.order.indexOf(device) >= tiers.order.indexOf(stackOn)
  );
}

/**
 * Whether a flex container's direction and wrap have plain words: a
 * direction such as `inherit`, or wrapping in reverse, is the raw rows'.
 */
function plainFlex(values: LayoutValues): boolean {
  return (
    PLAIN_DIRECTIONS.has(values.flexDirection ?? "row") &&
    PLAIN_WRAPS.has(values.flexWrap ?? "nowrap")
  );
}

/** What a container's Arrange reads as at the edited device. */
export function readArrange(tiers: LayoutTiers, editing: string): PlainArrange {
  const values = tiers.inForce(editing);
  const display = values.display;
  if (display === undefined || display === "block") {
    return { mode: "stack", flex: false, align: undefined, reverse: false };
  }
  if (display === "grid") return readGrid(values, tiers.flow);
  if (display !== "flex") return { mode: "custom" };
  const stackOn = stackDevice(tiers);
  const column = isColumn(values);
  const index = tiers.order.indexOf(editing);
  const stackIndex = stackOn === undefined ? -1 : tiers.order.indexOf(stackOn);
  // A column below a Row is that Row stacked; any other column is a Stack.
  const stacked = column && stackIndex !== -1 && index >= stackIndex;
  if (column && !stacked) return readStack(values, tiers.flow);
  if (!plainFlex(values)) return { mode: "custom" };
  const align = readAlign(values, column ? "column" : "row", tiers.flow);
  if (align === "custom") return { mode: "custom" };
  const main = values.justifyContent;
  return {
    mode: "row",
    stackOn,
    stacked,
    align,
    spread: SPREAD_OF[main ?? ""] ?? "packed",
    wrap: values.flexWrap === "wrap",
    reverse:
      values.flexDirection === "row-reverse" ||
      values.flexDirection === "column-reverse",
  };
}

/** A flex column that is a Stack, with its own settings. */
function readStack(values: LayoutValues, flow?: PlainFlow): PlainArrange {
  // A Stack has no Spread: a distribution on its main axis is Custom's.
  if (SPREADS.has(values.justifyContent ?? "")) return { mode: "custom" };
  const align = readAlign(values, "column", flow);
  if (align === "custom") return { mode: "custom" };
  return {
    mode: "stack",
    flex: true,
    align,
    reverse: values.flexDirection === "column-reverse",
  };
}

/** A Grid, with its columns, rows and Align. */
function readGrid(values: LayoutValues, flow?: PlainFlow): PlainArrange {
  const columns = readColumns(values.gridTemplateColumns);
  const rows = readRows(values.gridTemplateRows);
  const align = readAlign(values, "grid", flow);
  if (columns === "custom" || rows === "custom" || align === "custom") {
    return { mode: "custom" };
  }
  return { mode: "grid", columns, rows, align };
}

/** The template a Grid's columns write. */
function columnsTemplate(columns: GridColumns): string {
  return columns.kind === "count"
    ? `repeat(${String(columns.count)}, minmax(0, 1fr))`
    : `repeat(auto-fill, minmax(${columns.min}, 1fr))`;
}

/** The template a Grid's rows write, or `null` for Auto. */
function rowsTemplate(rows: number | undefined): string | null {
  return rows === undefined ? null : `repeat(${String(rows)}, auto)`;
}

/**
 * The value to write at the edited device so a property reads `value` there:
 * nothing stored where nothing else would be in force (no wider device's
 * value, nothing beneath the target's own) and the value is the default, else
 * the value itself or the default spelled out, so what lies beneath cannot
 * stay in force under the one shown.
 */
function settled(
  tiers: LayoutTiers,
  device: string,
  property: LayoutProperty,
  value: string | null
): LayoutWrite {
  if (value !== null) return { device, property, value };
  const reaching = surviving(tiers, device)[property];
  return {
    device,
    property,
    // Nothing left in force but the default: the clear is enough.
    value:
      reaching === undefined || reaching === RESET[property]
        ? null
        : RESET[property],
  };
}

/**
 * What stays in force at a device once the target's own value there is gone:
 * what lies beneath the target (a shared style it wears, its Normal values at
 * an interaction state), with the target's own values at wider devices, at
 * the edited state, over it, as the page applies them.
 */
function surviving(tiers: LayoutTiers, device: string): LayoutValues {
  const merged: Partial<Record<LayoutProperty, string>> = {
    ...(tiers.beneath?.(device) ?? {}),
  };
  for (const each of tiers.cascadeOrder ?? tiers.order) {
    if (each === device) break;
    Object.assign(merged, tiers.own(each));
  }
  return merged;
}

/** The value that undoes a property reaching from a wider device. */
const RESET: Readonly<Record<LayoutProperty, string>> = {
  display: "block",
  flexDirection: "row",
  flexWrap: "nowrap",
  justifyContent: "normal",
  alignItems: "normal",
  justifyItems: "normal",
  gap: "normal",
  rowGap: "normal",
  columnGap: "normal",
  gridTemplateColumns: "none",
  gridTemplateRows: "none",
};

/** The writes choosing an Arrange mode makes at the edited device. */
export function planArrange(
  tiers: LayoutTiers,
  editing: string,
  mode: "stack" | "row" | "grid"
): LayoutWrite[] {
  const current = readArrange(tiers, editing);
  if (mode === "stack") {
    // Below a Row, Stack is that Row stacked here: the same writes.
    if (current.mode === "row" && tiers.order.indexOf(editing) > 0) {
      const wider = tiers.order[tiers.order.indexOf(editing) - 1];
      if (wider !== undefined && isRow(tiers.inForce(wider))) {
        return planStackOn(tiers, editing);
      }
    }
    return [
      settled(tiers, editing, "display", null),
      settled(tiers, editing, "flexDirection", null),
    ];
  }
  if (mode === "row") {
    return [
      { device: editing, property: "display", value: "flex" },
      settled(tiers, editing, "flexDirection", null),
    ];
  }
  return [{ device: editing, property: "display", value: "grid" }];
}

/** The writes a Row's "Stack on" makes: its column at that device. */
export function planStackOn(
  tiers: LayoutTiers,
  device: string | null
): LayoutWrite[] {
  const current = stackDevice(tiers);
  const writes: LayoutWrite[] = [];
  // The old stack device gives up its column, undone there where a shared
  // style or a wider device would keep it.
  if (current !== undefined && current !== device) {
    // Moved to a wider device, whose column reaches the old one: only the old
    // one's own column goes. Otherwise it is undone there.
    const wider =
      device !== null &&
      tiers.order.indexOf(device) < tiers.order.indexOf(current);
    writes.push(
      wider
        ? { device: current, property: "flexDirection", value: null }
        : settled(tiers, current, "flexDirection", null)
    );
  }
  if (device === null) writes.push(...narrowerColumns(tiers, current));
  if (device !== null) writes.push(...narrowerRows(tiers, device));
  if (device !== null) {
    const reversed =
      tiers.inForce(device).flexDirection === "row-reverse" ||
      tiers.own(device).flexDirection === "column-reverse";
    writes.push({
      device,
      property: "flexDirection",
      value: reversed ? "column-reverse" : "column",
    });
  }
  return writes;
}

/**
 * Stack on a device also stacks the narrower ones that hold a row of their
 * own (a Reverse order turned off there), keeping each one's order: a row
 * becomes a column, a reversed row a reversed column.
 */
function narrowerRows(tiers: LayoutTiers, from: string): LayoutWrite[] {
  return tiers.order
    .slice(tiers.order.indexOf(from) + 1)
    .flatMap((device): LayoutWrite[] => {
      const own = tiers.own(device).flexDirection;
      if (own === "row") {
        return [{ device, property: "flexDirection", value: "column" }];
      }
      if (own === "row-reverse") {
        return [{ device, property: "flexDirection", value: "column-reverse" }];
      }
      return [];
    });
}

/**
 * Stack on: Never also takes back the columns written below the stack device
 * (a Reverse order set at a narrower one), keeping a reversed one reversed as
 * a row, so no device is left stacked.
 */
function narrowerColumns(
  tiers: LayoutTiers,
  from: string | undefined
): LayoutWrite[] {
  if (from === undefined) return [];
  return tiers.order
    .slice(tiers.order.indexOf(from) + 1)
    .flatMap((device): LayoutWrite[] => {
      const own = tiers.own(device).flexDirection;
      if (own === "column") {
        return [{ device, property: "flexDirection", value: null }];
      }
      if (own === "column-reverse") {
        return [{ device, property: "flexDirection", value: "row-reverse" }];
      }
      return [];
    });
}

/**
 * The writes a 3×3 point makes, by the direction in force at the edited
 * device; `null` clears both axes back to the default stretch.
 */
export function planAlign(
  tiers: LayoutTiers,
  editing: string,
  point: AlignPoint | null
): LayoutWrite[] {
  const current = readArrange(tiers, editing);
  const kind =
    current.mode === "grid"
      ? "grid"
      : current.mode === "row" && !current.stacked
        ? "row"
        : "column";
  const axes = alignAxes(kind);
  const places =
    point === null ? undefined : logicalPlaces(point, tiers.flow ?? LTR);
  const writes: LayoutWrite[] = [];
  // A Stack in block flow becomes a flex column to align.
  if (current.mode === "stack" && !current.flex && point !== null) {
    writes.push(
      { device: editing, property: "display", value: "flex" },
      { device: editing, property: "flexDirection", value: "column" }
    );
  }
  // While a Row spreads its blocks, the axis Spread holds is its: a point
  // places them on the other axis alone.
  const spreading = current.mode === "row" && current.spread !== "packed";
  const write = (property: LayoutProperty, place: 0 | 1 | 2 | undefined) =>
    spreading && property === "justifyContent"
      ? []
      : [
          settled(
            tiers,
            editing,
            property,
            place === undefined ? null : (PLACE_KEYWORDS[place] ?? "start")
          ),
        ];
  writes.push(
    ...write(axes.inline, places?.inline),
    ...write(axes.block, places?.block)
  );
  return writes;
}

/** The writes a Row's Spread makes on the main axis in force. */
export function planSpread(
  tiers: LayoutTiers,
  editing: string,
  spread: Spread
): LayoutWrite[] {
  return [settled(tiers, editing, "justifyContent", SPREAD_KEYWORDS[spread])];
}

/** The writes Reverse order makes, by the direction in force. */
export function planReverse(
  tiers: LayoutTiers,
  editing: string,
  reverse: boolean
): LayoutWrite[] {
  const column = isColumn(tiers.inForce(editing));
  const current = readArrange(tiers, editing);
  if (current.mode === "stack") {
    return [
      { device: editing, property: "display", value: "flex" },
      {
        device: editing,
        property: "flexDirection",
        value: reverse ? "column-reverse" : "column",
      },
    ];
  }
  const writes: LayoutWrite[] = [
    column
      ? {
          device: editing,
          property: "flexDirection",
          value: reverse ? "column-reverse" : "column",
        }
      : // Off, a reverse reaching from a wider device is undone here.
        settled(
          tiers,
          editing,
          "flexDirection",
          reverse ? "row-reverse" : null
        ),
  ];
  // Turned on at a wider device, it holds at the stacked one too.
  const stackOn = current.mode === "row" ? current.stackOn : undefined;
  if (
    !column &&
    stackOn !== undefined &&
    tiers.order.indexOf(stackOn) > tiers.order.indexOf(editing)
  ) {
    writes.push({
      device: stackOn,
      property: "flexDirection",
      value: reverse ? "column-reverse" : "column",
    });
  }
  return writes;
}

/** The writes Wrap onto new lines makes. */
export function planWrap(
  tiers: LayoutTiers,
  editing: string,
  wrap: boolean
): LayoutWrite[] {
  return [settled(tiers, editing, "flexWrap", wrap ? "wrap" : null)];
}

/** The writes a Grid's columns make at the edited device. */
export function planColumns(
  tiers: LayoutTiers,
  editing: string,
  columns: GridColumns | undefined
): LayoutWrite[] {
  // None given is Auto: cleared, or undone where a wider device sets one.
  return [
    settled(
      tiers,
      editing,
      "gridTemplateColumns",
      columns === undefined ? null : columnsTemplate(columns)
    ),
  ];
}

/** The writes a Grid's rows make at the edited device. */
export function planRows(
  tiers: LayoutTiers,
  editing: string,
  rows: number | undefined
): LayoutWrite[] {
  return [settled(tiers, editing, "gridTemplateRows", rowsTemplate(rows))];
}

/**
 * The values stored at the edited device that do nothing there: kept, but not
 * to be listed as if they applied. Judged by the engine's `applies`, against
 * the display and wrap in force, so this line and every other reader agree.
 * A wrap on a Row stacked here still applies to a flex container, so it is
 * not listed; the Row's own controls just don't show it there.
 */
export function unusedSettings(
  tiers: LayoutTiers,
  editing: string
): LayoutProperty[] {
  const values = tiers.inForce(editing);
  const context = {
    display: values.display ?? "block",
    flexWrap: values.flexWrap ?? "nowrap",
  };
  const own = tiers.own(editing);
  return LAYOUT_PROPERTIES.filter(
    property => own[property] !== undefined && !applies(property, context)
  );
}

/** A container's Space between: one gap, or rows and columns set apart. */
export interface PlainSpace {
  readonly gap?: string;
  readonly rowGap?: string;
  readonly columnGap?: string;
}

/** The Space between in force at the edited device. */
export function readSpace(tiers: LayoutTiers, editing: string): PlainSpace {
  const values = tiers.inForce(editing);
  return {
    ...(values.gap === undefined ? {} : { gap: values.gap }),
    ...(values.rowGap === undefined ? {} : { rowGap: values.rowGap }),
    ...(values.columnGap === undefined ? {} : { columnGap: values.columnGap }),
  };
}

/** The display a Custom arrangement's plain rewrite keeps. */
const PLAIN_DISPLAY: Readonly<Record<string, "flex" | "grid">> = {
  flex: "flex",
  "inline-flex": "flex",
  grid: "grid",
  "inline-grid": "grid",
};

/** The alignment values a plain rewrite clears: those with no 3×3 point. */
function unplainAlign(
  values: LayoutValues,
  kind: "row" | "column" | "grid",
  spreads: boolean
): LayoutProperty[] {
  const axes = alignAxes(kind);
  const forward =
    kind !== "grid" && !(values.flexDirection ?? "").endsWith("-reverse");
  return [axes.inline, axes.block].filter(property => {
    const spreadHere =
      spreads && property === "justifyContent" && kind !== "grid";
    return axisRead(values[property], spreadHere, forward) === "custom";
  });
}

/** The Grid templates a plain rewrite clears: those with no plain form. */
function unplainTemplates(values: LayoutValues): LayoutProperty[] {
  const cleared: LayoutProperty[] = [];
  if (readColumns(values.gridTemplateColumns) === "custom") {
    cleared.push("gridTemplateColumns");
  }
  if (readRows(values.gridTemplateRows) === "custom") {
    cleared.push("gridTemplateRows");
  }
  return cleared;
}

/** The arrangement a plain rewrite's alignment is read by. */
function plainKind(
  display: "flex" | "grid" | undefined,
  values: LayoutValues
): "row" | "column" | "grid" {
  if (display === "grid") return "grid";
  return display === "flex" && isColumn({ ...values, display: "flex" })
    ? "column"
    : "row";
}

/**
 * "Use plain controls": the writes that turn a Custom arrangement into the
 * nearest plain one at the edited device, as one step. An inline flex or grid
 * becomes its block form; any other display becomes a Stack; each value the
 * plain controls can't say (an alignment keyword with no 3×3 point, a
 * template with no plain form) is cleared, and every other value is kept.
 */
export function planPlain(tiers: LayoutTiers, editing: string): LayoutWrite[] {
  if (readArrange(tiers, editing).mode !== "custom") return [];
  const values = tiers.inForce(editing);
  const display = PLAIN_DISPLAY[values.display ?? ""];
  const kind = plainKind(display, values);
  // Only a Row stacked here offers Spread; a Stack's distribution goes.
  const spreads = kind !== "column" || stackedRowAt(tiers, editing);
  const cleared: LayoutProperty[] = [
    ...(display === undefined ? (["flexDirection"] as const) : []),
    ...unplainAlign(values, kind, spreads),
    ...(display === "grid" ? unplainTemplates(values) : []),
    ...(PLAIN_WRAPS.has(values.flexWrap ?? "nowrap")
      ? []
      : (["flexWrap"] as const)),
    ...(display !== undefined &&
    !PLAIN_DIRECTIONS.has(values.flexDirection ?? "row")
      ? (["flexDirection"] as const)
      : []),
  ];
  return [
    settled(tiers, editing, "display", display ?? null),
    ...cleared.map(property => settled(tiers, editing, property, null)),
  ];
}
