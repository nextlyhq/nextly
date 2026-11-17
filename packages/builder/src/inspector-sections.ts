/**
 * Where each style property sits on the Style tab: which section, in what
 * order, and whether it shows at once or waits behind "+ More".
 *
 * **The builder's own arrangement, over the engine's vocabulary.** The engine's
 * groups (`STYLE_GROUP_DEFS`) are also the `supports` keys block and plugin
 * authors declare, so they stay exactly as they are. What an author SEES is
 * arranged here: one order for every block, so a section is always in the
 * same place — Block style, Layout, Inside its parent, Spacing, Size,
 * Position, Text, Background, Border, Effects, Icon, CSS properties — with
 * the colour and list properties inside Text, shadow inside
 * Effects, and the container-query and box-sizing properties behind Layout's
 * and Size's "+ More". There is no "Advanced" style section: that name belongs
 * to Content alone, so an author never has to guess which one is meant.
 *
 * **Every catalog property is placed exactly once**, and the test says so. A
 * property the engine adds later, before anyone places it, still appears: it
 * falls back to the section its engine group maps to, behind "+ More", so a
 * new capability is reachable on the day it ships rather than invisible until
 * this table catches up.
 *
 * **Common first, the rest behind "+ More".** Each property's tier says
 * whether it is one an author reaches for first. A common property shows
 * without being asked for where it also has an effect on the block, which is
 * the engine's answer (`applies`), not this table's: the flex controls on a
 * flex container, the grid ones on a grid, a child's sizing inside a Row or a
 * Grid, an image's fit on a replaced element. Three tiers are the builder's
 * own, because they are about editing rather than CSS: the transition once a
 * state other than Normal is being edited, the outline while Focus is, and an
 * icon's position while an icon is drawn. A property holding a value always
 * shows, whatever its tier: a set value is never hidden.
 *
 * @module inspector-sections
 */

import type { StyleGroup, StyleState } from "@nextlyhq/blocks-engine";

/** The Style tab's sections, by key. */
export type InspectorSectionKey =
  | "block-style"
  | "layout"
  | "inside-parent"
  | "spacing"
  | "size"
  | "position"
  | "typography"
  | "background"
  | "border"
  | "effects"
  | "icon"
  | "css-properties";

/**
 * When a property shows without being asked for.
 *
 * - `common`: wherever it has an effect.
 * - `more`: only from "+ More", or once it holds a value.
 * - `common-on-media`: common where the block draws a replaced element (an
 *   image, a video, an embed), `more` on every other block. A choice about
 *   what an author reaches for first, not about whether the property works:
 *   an aspect ratio sizes any box, but it is what an image is set by.
 * - `icon-drawn`: while a disclosure draws an icon of its own (not the
 *   browser's marker, and not none), which is what a position moves.
 * - `state`: while a state other than Normal is being edited.
 * - `focus-state`: while the Focus state is being edited, `more` in every
 *   other state. An outline is mostly a focus ring, so that is where an
 *   author looks for it.
 */
export type PropertyTier =
  | "common"
  | "more"
  | "common-on-media"
  | "icon-drawn"
  | "state"
  | "focus-state";

export interface InspectorSectionDef {
  readonly key: InspectorSectionKey;
  readonly label: string;
  /** Catalog keys in the order the section lists them, each with its tier. */
  readonly properties: readonly (readonly [
    property: string,
    tier: PropertyTier,
  ])[];
}

/**
 * The sections, in order, and the properties each holds, in order.
 *
 * Inside a section the property that changes the most comes first and the
 * cosmetic ones last: display, then direction, then alignment; font, then
 * weight, then size.
 */
export const INSPECTOR_SECTIONS: readonly InspectorSectionDef[] = [
  // Each block's style tiles. Their controls are drawn above the sections
  // today, so the section holds no property yet; it is in the order so
  // every block lists its sections the same way.
  { key: "block-style", label: "Block style", properties: [] },
  {
    key: "layout",
    label: "Layout",
    properties: [
      ["display", "common"],
      ["flexDirection", "common"],
      ["justifyContent", "common"],
      ["alignItems", "common"],
      ["gap", "common"],
      ["flexWrap", "common"],
      ["gridTemplateColumns", "common"],
      ["gridTemplateRows", "common"],
      ["alignContent", "more"],
      ["gridAutoFlow", "more"],
      ["justifyItems", "more"],
      ["rowGap", "more"],
      ["columnGap", "more"],
      ["containerType", "more"],
    ],
  },
  // How a block takes its place in its parent: Fill, Fit or Fixed drawn on
  // top, and below it the CSS rows that apply in this parent. Those the
  // choices draw leave while a choice reads them (plain-parent-controls).
  {
    key: "inside-parent",
    label: "Inside its parent",
    properties: [
      ["flexGrow", "common"],
      ["flexShrink", "common"],
      ["flexBasis", "common"],
      ["alignSelf", "common"],
      ["justifySelf", "common"],
      ["order", "common"],
    ],
  },
  {
    key: "spacing",
    label: "Spacing",
    properties: [
      ["padding", "common"],
      ["margin", "common"],
    ],
  },
  {
    key: "size",
    label: "Size",
    // An image's fit and focal point first: how it fills its box is what an
    // author changes first on one. Both have an effect only on a replaced
    // element, so a box never shows them. A child's share of a Row or a Grid
    // is in "Inside its parent".
    properties: [
      ["objectFit", "common"],
      ["objectPosition", "common"],
      ["width", "common"],
      ["height", "common"],
      ["minWidth", "common"],
      ["maxWidth", "common"],
      ["aspectRatio", "common-on-media"],
      ["minHeight", "more"],
      ["maxHeight", "more"],
      ["overflow", "more"],
      ["boxSizing", "more"],
    ],
  },
  {
    key: "position",
    label: "Position",
    properties: [["position", "common"]],
  },
  {
    key: "typography",
    label: "Text",
    properties: [
      ["fontFamily", "common"],
      ["fontWeight", "common"],
      ["fontSize", "common"],
      ["lineHeight", "common"],
      ["color", "common"],
      ["textAlign", "common"],
      ["listStyleType", "common"],
      ["letterSpacing", "more"],
      ["textTransform", "more"],
      ["fontStyle", "more"],
      ["textDecoration", "more"],
      ["linkColor", "more"],
      ["linkColorHover", "more"],
      ["textShadow", "more"],
      ["wordSpacing", "more"],
    ],
  },
  {
    key: "background",
    label: "Background",
    properties: [
      ["backgroundColor", "common"],
      ["background", "common"],
      ["backgroundGradient", "common"],
    ],
  },
  {
    key: "border",
    label: "Border",
    properties: [
      ["border", "common"],
      ["borderRadius", "common"],
      ["outline", "focus-state"],
    ],
  },
  {
    key: "effects",
    label: "Effects",
    properties: [
      ["boxShadow", "common"],
      ["opacity", "common"],
      ["appear", "common"],
      ["transition", "state"],
      ["transform", "more"],
      ["filter", "more"],
      ["mixBlendMode", "more"],
    ],
  },
  // Only a block offering it (an Accordion) shows the section.
  {
    key: "icon",
    label: "Icon",
    properties: [
      ["disclosureIcon", "common"],
      ["disclosurePosition", "icon-drawn"],
    ],
  },
  // Any CSS property the sections above do not offer. In the order so every
  // block lists its sections the same way; it draws once it holds them.
  { key: "css-properties", label: "CSS properties", properties: [] },
];

/**
 * Where a property the table does not place falls, by its engine group.
 *
 * A total record, so a group the engine adds fails to compile here rather
 * than leaving its properties nowhere.
 */
const SECTION_OF_GROUP: Readonly<Record<StyleGroup, InspectorSectionKey>> = {
  spacing: "spacing",
  layout: "layout",
  dimensions: "size",
  typography: "typography",
  color: "typography",
  background: "background",
  border: "border",
  shadow: "effects",
  effects: "effects",
  position: "position",
  container: "layout",
  list: "typography",
  disclosure: "icon",
};

/** Where one property is placed. */
export interface PropertyPlacement {
  readonly section: InspectorSectionKey;
  readonly tier: PropertyTier;
  /** Its position in the whole table, for ordering within a section. */
  readonly order: number;
}

const PLACEMENT: ReadonlyMap<string, PropertyPlacement> = new Map(
  INSPECTOR_SECTIONS.flatMap((section, s) =>
    section.properties.map(
      ([property, tier], p) =>
        [property, { section: section.key, tier, order: s * 100 + p }] as const
    )
  )
);

/**
 * Where a catalog property is placed: the table's answer, or behind "+ More"
 * in its engine group's section when the table does not name it.
 */
export function placementOf(
  property: string,
  group: StyleGroup
): PropertyPlacement {
  const placed = PLACEMENT.get(property);
  if (placed !== undefined) return placed;
  const section = SECTION_OF_GROUP[group];
  const index = INSPECTOR_SECTIONS.findIndex(entry => entry.key === section);
  // After every placed property of its section.
  return { section, tier: "more", order: index * 100 + 99 };
}

/**
 * What a tier needs to know about the editing, beyond what the block is: the
 * engine's `applies` judges that.
 */
export interface TierContext {
  /**
   * Whether the block draws a replaced element, `undefined` until the canvas
   * has said what it draws.
   */
  readonly replaced?: boolean | undefined;
  /** The disclosure icon the block draws here, if it is given one. */
  readonly disclosureIcon?: string | undefined;
  /** The state being edited. */
  readonly state: StyleState;
}

/**
 * The disclosure icons that draw nothing a position could move: the browser's
 * own marker, which stays where the browser puts it, and none.
 */
const UNDRAWN_ICONS: ReadonlySet<string> = new Set(["browser", "none"]);

/**
 * Whether a property of this tier shows without being asked for, where it
 * has an effect at all. That second half is the caller's to ask of the engine.
 */
export function tierShows(tier: PropertyTier, context: TierContext): boolean {
  switch (tier) {
    case "common":
      return true;
    case "more":
      return false;
    // Shown where it is not yet known too, as `applies` treats what it
    // cannot read.
    case "common-on-media":
      return context.replaced !== false;
    // Shown where the icon in force is unknown too: the block's default
    // draws one.
    case "icon-drawn":
      return !UNDRAWN_ICONS.has(context.disclosureIcon ?? "");
    case "state":
      return context.state !== "base";
    case "focus-state":
      return context.state === "focus";
  }
}
