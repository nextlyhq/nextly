/**
 * Where each style property sits on the Style tab: which section, in what
 * order, and whether it shows at once or waits behind "+ More".
 *
 * **The builder's own arrangement, over the engine's vocabulary.** The engine's
 * groups (`STYLE_GROUP_DEFS`) are also the `supports` keys block and plugin
 * authors declare, so they stay exactly as they are. What an author SEES is
 * arranged here: eight sections in the order Webflow and Elementor V4 share —
 * Layout, Spacing, Size, Position, Typography, Background, Border, Effects —
 * with the colour and list properties inside Typography, shadow inside
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
 * **Common first, the rest behind "+ More".** Each property's tier says when
 * it shows without being asked for. Some depend on the block: the flex
 * controls once the block is a flex container, the media fit controls on a
 * replaced element such as an image, the transition once a state other than
 * Normal is being edited. A property holding a value always shows, whatever
 * its tier: a set value is never hidden.
 *
 * @module inspector-sections
 */

import type { StyleGroup, StyleState } from "@nextlyhq/blocks-engine";

/** The Style tab's sections, by key. */
export type InspectorSectionKey =
  | "icon"
  | "layout"
  | "spacing"
  | "size"
  | "position"
  | "typography"
  | "background"
  | "border"
  | "effects";

/**
 * When a property shows without being asked for.
 *
 * - `common`: always.
 * - `more`: only from "+ More", or once it holds a value.
 * - `flex`, `grid`, `flex-or-grid`: while the block is that kind of container.
 * - `media`: on a replaced element (an image, a video, an embed).
 * - `framed-media`: on a replaced element whose fit leaves a choice of where
 *   it sits: Cover (which part stays in view), Contain, None or Scale down
 *   (where it sits in its box). Fill stretches it to the box, so there is
 *   nothing to place.
 * - `icon-drawn`: while a disclosure draws an icon of its own (not the
 *   browser's marker, and not none), which is what a position moves.
 * - `state`: while a state other than Normal is being edited.
 */
export type PropertyTier =
  | "common"
  | "more"
  | "flex"
  | "grid"
  | "flex-or-grid"
  | "media"
  | "framed-media"
  | "icon-drawn"
  | "state";

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
  // First, where a block has it: an Accordion's icon is the look an author
  // sets on one before any other. Only a block offering it shows the section.
  {
    key: "icon",
    label: "Icon",
    properties: [
      ["disclosureIcon", "common"],
      ["disclosurePosition", "icon-drawn"],
    ],
  },
  {
    key: "layout",
    label: "Layout",
    properties: [
      ["display", "common"],
      ["flexDirection", "flex"],
      ["justifyContent", "flex-or-grid"],
      ["alignItems", "flex-or-grid"],
      ["gap", "flex-or-grid"],
      ["flexWrap", "flex"],
      ["gridTemplateColumns", "grid"],
      ["gridTemplateRows", "grid"],
      ["alignContent", "more"],
      ["gridAutoFlow", "more"],
      ["rowGap", "more"],
      ["columnGap", "more"],
      ["containerType", "more"],
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
    // An image's fit and ratio first: how it fills its box is what an author
    // changes first on one. Both show only on a replaced element.
    properties: [
      ["objectFit", "media"],
      ["objectPosition", "framed-media"],
      ["aspectRatio", "media"],
      ["width", "common"],
      ["height", "common"],
      ["minWidth", "common"],
      ["maxWidth", "common"],
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
    label: "Typography",
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
    ],
  },
  {
    key: "effects",
    label: "Effects",
    properties: [
      ["boxShadow", "common"],
      ["opacity", "common"],
      ["transition", "state"],
      ["transform", "more"],
      ["filter", "more"],
      ["mixBlendMode", "more"],
    ],
  },
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

/** The fits that leave a choice of where the content sits. */
const FRAMED_FITS: ReadonlySet<string> = new Set([
  "cover",
  "contain",
  "none",
  // None or Contain, whichever is smaller: either way it sits in its box.
  "scale-down",
]);

/** What the block is, as far as a tier needs to know. */
export interface TierContext {
  /** The display the block is given here, if it is given one. */
  readonly display: string | undefined;
  /** Whether the block renders a replaced element: an image, a video, an embed. */
  readonly media: boolean;
  /** The fit the block is given here, if it is given one. */
  readonly objectFit?: string | undefined;
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

/** Whether a property of this tier shows without being asked for. */
export function tierShows(tier: PropertyTier, context: TierContext): boolean {
  const display = context.display ?? "";
  const flex = /(^|\s)(inline-)?flex(\s|$)/.test(display);
  const grid = /(^|\s)(inline-)?grid(\s|$)/.test(display);
  switch (tier) {
    case "common":
      return true;
    case "more":
      return false;
    case "flex":
      return flex;
    case "grid":
      return grid;
    case "flex-or-grid":
      return flex || grid;
    case "media":
      return context.media;
    case "framed-media":
      return context.media && FRAMED_FITS.has(context.objectFit ?? "");
    // Shown where the icon in force is unknown too: the block's default
    // draws one.
    case "icon-drawn":
      return !UNDRAWN_ICONS.has(context.disclosureIcon ?? "");
    case "state":
      return context.state !== "base";
  }
}
