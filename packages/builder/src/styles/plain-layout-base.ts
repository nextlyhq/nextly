/**
 * What every part of the plain layout layer shares: the catalog properties it
 * reads and writes, where each is stored, the tiers it reads them through,
 * and the one way a value is settled at a device so what lies beneath can't
 * stay in force under it.
 *
 * Apart from `plain-layout.ts`, which re-exports what is public here, so the
 * container's Arrange and a block's place inside its parent
 * (`plain-layout-child.ts`) build on one set of rules without importing each
 * other.
 *
 * @module plain-layout-base
 */

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
  // How the block sits in its parent: "Inside its parent".
  "width",
  "height",
  "minWidth",
  "minHeight",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "alignSelf",
  "justifySelf",
  // Where a block sits in a Stack's flow: Align's inline auto margins. Sides
  // of the catalog's `margin`, addressed through `layoutAddress`.
  "marginInlineStart",
  "marginInlineEnd",
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
  width: "width",
  height: "height",
  minWidth: "min-width",
  minHeight: "min-height",
  flexGrow: "flex-grow",
  flexShrink: "flex-shrink",
  flexBasis: "flex-basis",
  alignSelf: "align-self",
  justifySelf: "justify-self",
  marginInlineStart: "margin-inline-start",
  marginInlineEnd: "margin-inline-end",
};

/**
 * Where a layout property is stored, where it is not a catalog property of
 * its own: a margin side is one side of `margin`. Every reader and writer of
 * stored values asks here, so the two can't address a side differently.
 */
const LAYOUT_ADDRESSES: Readonly<
  Partial<
    Record<
      string,
      { readonly property: string; readonly path: readonly string[] }
    >
  >
> = {
  marginInlineStart: { property: "margin", path: ["inlineStart"] },
  marginInlineEnd: { property: "margin", path: ["inlineEnd"] },
};

/** The catalog property and path a layout property is stored at. */
export function layoutAddress(property: LayoutProperty): {
  property: string;
  path: string[];
} {
  const stored = LAYOUT_ADDRESSES[property];
  // A fresh path each time: an address handed on is the caller's to keep.
  return stored === undefined
    ? { property, path: [] }
    : { property: stored.property, path: [...stored.path] };
}

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

/** Horizontal lines, left to right: what is assumed where nothing is measured. */
export const LTR: PlainFlow = { writingMode: "horizontal-tb", rtl: false };

/** One value to write at one device; `null` clears it there. */
export interface LayoutWrite {
  readonly device: string;
  readonly property: LayoutProperty;
  readonly value: string | null;
}

/** Whether the lines run down the screen rather than across it. */
export function vertical(flow: PlainFlow): boolean {
  return (
    flow.writingMode.startsWith("vertical") ||
    flow.writingMode.startsWith("sideways")
  );
}

/**
 * The value to write at the edited device so a property reads `value` there:
 * nothing stored where nothing else would be in force (no wider device's
 * value, nothing beneath the target's own) and the value is the default, else
 * the value itself or the default spelled out, so what lies beneath cannot
 * stay in force under the one shown.
 */
export function settled(
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
export const RESET: Readonly<Record<LayoutProperty, string>> = {
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
  width: "auto",
  height: "auto",
  minWidth: "auto",
  minHeight: "auto",
  flexGrow: "0",
  flexShrink: "1",
  flexBasis: "auto",
  alignSelf: "auto",
  justifySelf: "auto",
  marginInlineStart: "0",
  marginInlineEnd: "0",
};
