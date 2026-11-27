/**
 * "Inside its parent": how a block takes its place in its parent's
 * arrangement at the edited device. Its Width and Height (Fill, Fit or
 * Fixed) by the role each size plays there, and where a Fit or Fixed block
 * sits across the screen: the parent's place for its blocks, or its own
 * Align. Written and read back by the same tables, so the panel and a test
 * go by one set of rules.
 *
 * Re-exported by `plain-layout.ts`, the layer's entry.
 *
 * @module plain-layout-child
 */
import {
  LTR,
  RESET,
  settled,
  vertical,
  type LayoutProperty,
  type LayoutTiers,
  type LayoutValues,
  type LayoutWrite,
  type PlainFlow,
} from "./plain-layout-base";

// --- Inside its parent: Fill, Fit or Fixed

/** How a block's parent lays it out at the edited device. */
export type ParentArrangement = "flow" | "column" | "row" | "grid";

/** A child's size choice: fill what it's given, fit its content, or set. */
export type ChildFit = "fill" | "fit" | "fixed";

/** A child's size as read back: a choice (Fixed with its size), or Custom. */
export type ChildSize =
  | { readonly choice: "fill" | "fit" }
  | { readonly choice: "fixed"; readonly size: string }
  | { readonly choice: "custom" };

/** One of a block's two sizes on screen. */
export type ChildAxis = "width" | "height";

/**
 * What a size is to the parent's layout: a flex container's main or cross
 * axis, a Grid's inline or block axis, or a width in flow. Lines running down
 * the screen turn a Row's main axis into the height, a Grid's inline axis
 * too, as Align's points turn with them.
 */
type AxisRole = "flow" | "main" | "cross" | "inline" | "block";

/** The role each size plays in each arrangement, lines across or down. */
const ROLES: Readonly<
  Record<
    ParentArrangement,
    Readonly<
      Record<"across" | "down", Readonly<Record<ChildAxis, AxisRole | null>>>
    >
  >
> = {
  flow: {
    across: { width: "flow", height: null },
    down: { width: "flow", height: null },
  },
  column: {
    across: { width: "cross", height: null },
    down: { width: "main", height: null },
  },
  row: {
    across: { width: "main", height: "block" },
    down: { width: "block", height: "main" },
  },
  grid: {
    across: { width: "inline", height: "block" },
    down: { width: "block", height: "inline" },
  },
};

/**
 * What a size is to the parent at the edited device; `null` where the
 * parent offers no choice for it (a height under a Stack, set in Size).
 */
function roleOf(
  parent: ParentArrangement,
  axis: ChildAxis,
  flow: PlainFlow = LTR
): AxisRole | null {
  return ROLES[parent][vertical(flow) ? "down" : "across"][axis];
}

/** Whether the parent offers a choice for a size at the edited device. */
export function offersChildAxis(
  parent: ParentArrangement,
  axis: ChildAxis,
  flow?: PlainFlow
): boolean {
  return roleOf(parent, axis, flow) !== null;
}

/** The size a Fixed choice writes, filled in when it is planned. */
const SIZE = "\u0000size";

/** What a choice writes, by property; `null` leaves it at its default. */
type ChoiceWrites = Readonly<Partial<Record<LayoutProperty, string | null>>>;

/** A size's own property, and its minimum. */
const SIZE_OF: Readonly<
  Record<
    ChildAxis,
    { readonly size: LayoutProperty; readonly min: LayoutProperty }
  >
> = {
  width: { size: "width", min: "minWidth" },
  height: { size: "height", min: "minHeight" },
};

/**
 * What each choice writes, by the role a size plays. Each choice of a role
 * says every property the others write, so switching from one to another
 * leaves nothing of the last behind.
 */
function roleWrites(
  role: AxisRole,
  axis: ChildAxis
): Readonly<Record<ChildFit, ChoiceWrites>> {
  const { size, min } = SIZE_OF[axis];
  switch (role) {
    case "flow":
      return {
        fill: { [size]: null },
        fit: { [size]: "fit-content" },
        fixed: { [size]: SIZE },
      };
    case "main":
      return {
        fill: {
          flexGrow: "1",
          flexShrink: "1",
          flexBasis: "0",
          [min]: "0",
          [size]: null,
        },
        fit: {
          flexGrow: null,
          flexShrink: null,
          flexBasis: null,
          [min]: null,
          [size]: null,
        },
        fixed: {
          [size]: SIZE,
          flexShrink: "0",
          flexGrow: null,
          flexBasis: null,
          [min]: null,
        },
      };
    // A flex column's cross axis: an automatic size is what stretching
    // sizes, so Fit is its content's by its own width, under a parent that
    // stretches too. Fit and Fixed leave the block's place to the parent, or
    // to Align (`placeWrites`), never pinning it to the start.
    case "cross":
      return {
        fill: { [size]: null, alignSelf: "stretch" },
        fit: { [size]: "fit-content" },
        fixed: { [size]: SIZE },
      };
    // Stretched itself, so the Grid's own Align can't keep it to its content.
    case "inline":
      return {
        fill: { justifySelf: "stretch", [size]: null },
        fit: { [size]: "fit-content" },
        fixed: { [size]: SIZE },
      };
    case "block":
      return {
        fill: { alignSelf: "stretch", [size]: null },
        fit: { alignSelf: "start", [size]: null },
        fixed: { [size]: SIZE, alignSelf: null },
      };
  }
}

/** The properties a size's choices write, beside its own size. */
export function childAxisRows(
  parent: ParentArrangement,
  axis: ChildAxis,
  flow?: PlainFlow
): LayoutProperty[] {
  const role = roleOf(parent, axis, flow);
  if (role === null) return [];
  const { size } = SIZE_OF[axis];
  const written = new Set<LayoutProperty>();
  for (const writes of Object.values(roleWrites(role, axis))) {
    for (const property of Object.keys(writes) as LayoutProperty[]) {
      if (property !== size) written.add(property);
    }
  }
  return [...written];
}

/** A choice's writes at the edited device, its size filled in. */
function childWrites(
  tiers: LayoutTiers,
  editing: string,
  writes: ChoiceWrites,
  size: string | undefined
): LayoutWrite[] {
  return (Object.keys(writes) as LayoutProperty[]).map(property => {
    const value = writes[property] ?? null;
    return settled(
      tiers,
      editing,
      property,
      value === SIZE ? (size ?? null) : value
    );
  });
}

/** Whether the block lays out inline: its display in force is inline-level. */
function inlineLevel(tiers: LayoutTiers, editing: string): boolean {
  return tiers.inForce(editing).display?.startsWith("inline") === true;
}

/**
 * Whether a flowing block's automatic width is its content's: an inline-level
 * box's is, and so is any block's where lines run down the screen, the width
 * being its block size there.
 */
function contentSized(tiers: LayoutTiers, editing: string): boolean {
  return inlineLevel(tiers, editing) || vertical(tiers.flow ?? LTR);
}

/**
 * The writes a size's choice makes at the edited device, by the role it
 * plays in the parent's arrangement there. Defaults are written only where a
 * wider device's value would stay in force under the one chosen.
 */
export function planChildSize(
  tiers: LayoutTiers,
  editing: string,
  parent: ParentArrangement,
  axis: ChildAxis,
  choice: ChildFit,
  size?: string
): LayoutWrite[] {
  const role = roleOf(parent, axis, tiers.flow);
  if (role === null) return [];
  // In flow an inline-level block (a Button) is as wide as its content at
  // an automatic width: Fill gives it the line's.
  const writes =
    role === "flow" && choice === "fill" && contentSized(tiers, editing)
      ? { [SIZE_OF[axis].size]: "100%" }
      : roleWrites(role, axis)[choice];
  if (axis !== "width" || !placedHere(tiers, editing, role)) {
    return childWrites(tiers, editing, writes, size);
  }
  // Fit and Fixed keep the place a Fit or Fixed block had (a block coming
  // from Fill starts at the parent's); Fill has no place, and takes Align's.
  const place =
    choice === "fill"
      ? "parent"
      : (readChildPlace(tiers, editing, parent) ?? "parent");
  return childWrites(
    tiers,
    editing,
    {
      ...placeWrites(role, place, tiers.inForce(editing), tiers.flow),
      ...writes,
    },
    size
  );
}

/**
 * Where a Fit or Fixed block sits across its parent: the parent's own place
 * for its blocks, or the block's own Left, Center or Right. Named for the
 * screen, so Left is left whichever way the line runs.
 */
export type ChildPlace = "parent" | "left" | "center" | "right";

/** A place along the line, as the logical alignment keywords spell it. */
type LineSide = "start" | "center" | "end";

/**
 * Whether a size's role puts the block somewhere across the screen, which
 * Align chooses: a Stack's flow, a flex column's cross axis, a Grid's inline
 * axis, with lines running across. A Row's blocks are placed along it, by
 * its Spread.
 */
function placeable(role: AxisRole | null, flow: PlainFlow = LTR): boolean {
  return (
    (role === "flow" || role === "cross" || role === "inline") &&
    !vertical(flow)
  );
}

/**
 * Whether Align places this block at the edited device: its parent offers
 * it, and in a Stack's flow the block is block-level, since auto margins
 * don't move an inline-level box (a Button) along its line.
 */
function placedHere(
  tiers: LayoutTiers,
  editing: string,
  role: AxisRole | null
): boolean {
  if (!placeable(role, tiers.flow)) return false;
  return role !== "flow" || !inlineLevel(tiers, editing);
}

/** Whether the parent offers Align for a Fit or Fixed width. */
export function offersChildPlace(
  parent: ParentArrangement,
  flow?: PlainFlow
): boolean {
  return placeable(roleOf(parent, "width", flow), flow);
}

/** A place on screen as a side of the line, which runs right to left in RTL. */
function sideOfPlace(
  place: Exclude<ChildPlace, "parent">,
  flow: PlainFlow
): LineSide {
  if (place === "center") return "center";
  return (place === "left") !== flow.rtl ? "start" : "end";
}

/** What each side of the line is, by the property that places the block. */
const SELF_KEYWORDS: Readonly<
  Record<"alignSelf" | "justifySelf", Record<LineSide, string>>
> = {
  alignSelf: { start: "flex-start", center: "center", end: "flex-end" },
  justifySelf: { start: "start", center: "center", end: "end" },
};

/**
 * What a place writes, by the role the width plays: the block's own
 * self-alignment, or in a Stack's flow its inline auto margins. The parent's
 * place writes none. A margin that isn't auto is the author's spacing, set
 * in Spacing, and is left alone unless a side is now auto.
 */
function placeWrites(
  role: AxisRole,
  place: ChildPlace,
  values: LayoutValues,
  flow: PlainFlow = LTR
): ChoiceWrites {
  const side = place === "parent" ? undefined : sideOfPlace(place, flow);
  if (role === "flow") {
    const writes: Partial<Record<LayoutProperty, string | null>> = {};
    const auto = {
      marginInlineStart: side === "end" || side === "center",
      marginInlineEnd: side === "start" || side === "center",
    };
    for (const property of ["marginInlineStart", "marginInlineEnd"] as const) {
      if (auto[property]) writes[property] = "auto";
      else if (values[property] === "auto") writes[property] = null;
    }
    return writes;
  }
  const property = role === "inline" ? "justifySelf" : "alignSelf";
  return {
    [property]: side === undefined ? null : SELF_KEYWORDS[property][side],
  };
}

/** The side of the line a self-alignment puts a block, if it says one. */
function selfSide(
  value: string | undefined
): LineSide | "left" | "right" | undefined {
  if (value === undefined) return undefined;
  if (atStart(value) || value === "stretch") return "start";
  if (value === "center") return "center";
  if (value === "end" || value === "flex-end" || value === "self-end") {
    return "end";
  }
  return value === "left" || value === "right" ? value : undefined;
}

/** The side of the line a flowing block's inline auto margins put it. */
function marginSide(values: LayoutValues): LineSide | undefined {
  const start = values.marginInlineStart === "auto";
  const end = values.marginInlineEnd === "auto";
  if (start && end) return "center";
  if (end) return "start";
  return start ? "end" : undefined;
}

/**
 * The place a Fit or Fixed block reads as at the edited device, or
 * `undefined` where Align isn't offered: under a Row, while the width is
 * Fill or Custom. A block stored with the left pin Fit and Fixed used to
 * write (`align-self: flex-start`, `justify-self: start`) reads as Left,
 * which is where it is still drawn.
 */
export function readChildPlace(
  tiers: LayoutTiers,
  editing: string,
  parent: ParentArrangement,
  items?: ParentItems
): ChildPlace | undefined {
  const role = roleOf(parent, "width", tiers.flow);
  if (!placedHere(tiers, editing, role)) return undefined;
  const width = readChildSize(tiers, editing, parent, "width", items);
  if (width.choice !== "fit" && width.choice !== "fixed") return undefined;
  const values = tiers.inForce(editing);
  const side =
    role === "flow"
      ? marginSide(values)
      : selfSide(role === "inline" ? values.justifySelf : values.alignSelf);
  if (side === undefined) return "parent";
  if (side === "left" || side === "right" || side === "center") return side;
  return (side === "start") !== (tiers.flow ?? LTR).rtl ? "left" : "right";
}

/**
 * What an Align choice writes, for its hover hint: every property it places
 * by, a cleared one at its default, so the parent's choice reads as the
 * clear it is rather than as nothing. Derived from the writes themselves.
 */
export function childPlaceHint(
  parent: ParentArrangement,
  place: ChildPlace,
  flow?: PlainFlow
): LayoutWrite[] {
  const role = roleOf(parent, "width", flow);
  if (role === null || !placeable(role, flow)) return [];
  // Margins taken as auto, so a side the choice leaves at 0 says so.
  const writes = placeWrites(
    role,
    place,
    { marginInlineStart: "auto", marginInlineEnd: "auto" },
    flow
  );
  return (Object.keys(writes) as LayoutProperty[]).map(property => ({
    device: "",
    property,
    value: writes[property] ?? RESET[property],
  }));
}

/** The writes an Align choice makes at the edited device. */
export function planChildPlace(
  tiers: LayoutTiers,
  editing: string,
  parent: ParentArrangement,
  place: ChildPlace
): LayoutWrite[] {
  const role = roleOf(parent, "width", tiers.flow);
  if (role === null || !placedHere(tiers, editing, role)) return [];
  return childWrites(
    tiers,
    editing,
    placeWrites(role, place, tiers.inForce(editing), tiers.flow),
    undefined
  );
}

/** Whether a length is the automatic one, which no choice sets. */
function automatic(value: string | undefined): boolean {
  return value === undefined || value === "auto";
}

/** Whether a self-alignment leaves the block stretched, as by default. */
function stretched(value: string | undefined): boolean {
  return (
    value === undefined ||
    value === "auto" ||
    value === "normal" ||
    value === "stretch"
  );
}

/** Whether a self-alignment puts the block at its start. */
function atStart(value: string | undefined): boolean {
  return value === "start" || value === "flex-start" || value === "self-start";
}

/**
 * A size across the parent's axis: set, at the start, or stretched. An
 * automatic self-alignment takes the parent's for its items: under one that
 * doesn't stretch (centred, at the end) an automatic size is neither filled
 * nor at its start, so it reads as Custom. A size of its own is Fixed there
 * still: Fixed leaves the alignment to the parent.
 */
function crossSize(
  size: string | undefined,
  ownSelf: string | undefined,
  items?: string,
  placed = false
): ChildSize {
  // Fit's own width, which keeps it to its content under a parent that
  // stretches; Align says where it sits.
  if (placed && size === "fit-content") return { choice: "fit" };
  const deferred = automaticSelf(ownSelf);
  const self = deferred ? itemsSelf(items) : ownSelf;
  // Where Align is offered, a block centred or at the end (its own or the
  // parent's) is as wide as its content there, or its own width: a place
  // Align reads back, not a size no choice writes.
  const chosen =
    atStart(self) ||
    stretched(self) ||
    (placed && selfSide(self) !== undefined);
  if (!automatic(size) && (chosen || deferred)) {
    return { choice: "fixed", size: size ?? "" };
  }
  // A self-alignment no choice writes (centred, at the end) is Custom, so
  // its row stays drawn to say it.
  if (!chosen) return { choice: "custom" };
  return stretched(self) ? { choice: "fill" } : { choice: "fit" };
}

/** Whether a self-alignment defers to the parent's for its items. */
function automaticSelf(value: string | undefined): boolean {
  return value === undefined || value === "auto";
}

/** The parent's alignment for its items, as a self-alignment reads it. */
function itemsSelf(items: string | undefined): string | undefined {
  return items === undefined || items === "normal" || items === "legacy"
    ? undefined
    : items;
}

/** A basis of nothing, as Fill writes it and as it may be spelled. */
const ZERO_BASES: ReadonlySet<string> = new Set(["0", "0%", "0px"]);

/**
 * A size along a flex container's main axis: grown from nothing, its
 * content's, or set. Anything a choice doesn't write (a basis of its own, a
 * grow of 2) is Custom, so its rows stay drawn to say it.
 */
function mainSize(size: string | undefined, values: LayoutValues): ChildSize {
  const grow = values.flexGrow ?? "0";
  const basis = values.flexBasis ?? "auto";
  const natural = grow === "0" && basis === "auto";
  if (grow === "1" && ZERO_BASES.has(basis) && automatic(size)) {
    return { choice: "fill" };
  }
  if (!natural) return { choice: "custom" };
  return automatic(size)
    ? { choice: "fit" }
    : { choice: "fixed", size: size ?? "" };
}

/**
 * A flowing block's width: an automatic one fills the line for a block-level
 * box and fits the content of an inline-level one; 100% fills either.
 */
function flowSize(size: string | undefined, inline: boolean): ChildSize {
  if (size === "100%") return { choice: "fill" };
  if (automatic(size)) return { choice: inline ? "fit" : "fill" };
  return size === "fit-content"
    ? { choice: "fit" }
    : { choice: "fixed", size: size ?? "" };
}

/**
 * The choice a size reads as at the edited device, by the role it plays in
 * the parent's arrangement there. Under a Row stacked here, values a wider
 * device's Row choice wrote on the main axis (grow, shrink, a minimum) act
 * on the column's height and change nothing shown.
 */
export function readChildSize(
  tiers: LayoutTiers,
  editing: string,
  parent: ParentArrangement,
  axis: ChildAxis,
  items?: ParentItems
): ChildSize {
  const role = roleOf(parent, axis, tiers.flow);
  const values = tiers.inForce(editing);
  const size = values[SIZE_OF[axis].size];
  switch (role) {
    case null:
      return { choice: "custom" };
    case "flow":
      return flowSize(size, contentSized(tiers, editing));
    case "main":
      return mainSize(size, values);
    case "cross":
    case "block":
      return crossSize(
        size,
        values.alignSelf,
        items?.alignItems,
        axis === "width" && placeable(role, tiers.flow)
      );
    case "inline":
      return crossSize(
        size,
        values.justifySelf,
        items?.justifyItems,
        placeable(role, tiers.flow)
      );
  }
}

/** The alignment a parent gives its items, which its children defer to. */
export interface ParentItems {
  readonly alignItems?: string | undefined;
  readonly justifyItems?: string | undefined;
}

/** The writes a Width choice makes: {@link planChildSize} for the width. */
export function planChildWidth(
  tiers: LayoutTiers,
  editing: string,
  parent: ParentArrangement,
  choice: ChildFit,
  size?: string
): LayoutWrite[] {
  return planChildSize(tiers, editing, parent, "width", choice, size);
}

/** The writes a Height choice makes, under a Row or a Grid. */
export function planChildHeight(
  tiers: LayoutTiers,
  editing: string,
  choice: ChildFit,
  size?: string,
  parent: ParentArrangement = "row"
): LayoutWrite[] {
  return planChildSize(tiers, editing, parent, "height", choice, size);
}

/** The Width choice the block's values read as at the edited device. */
export function readChildWidth(
  tiers: LayoutTiers,
  editing: string,
  parent: ParentArrangement
): ChildSize {
  return readChildSize(tiers, editing, parent, "width");
}

/** The Height choice the block's values read as, under a Row or a Grid. */
export function readChildHeight(
  tiers: LayoutTiers,
  editing: string,
  parent: ParentArrangement = "row"
): ChildSize {
  return readChildSize(tiers, editing, parent, "height");
}
