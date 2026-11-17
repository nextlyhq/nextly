/**
 * The Style tab's "CSS properties": which of a block's properties its sections
 * draw unasked, which the author has added (or that hold a value) and so sit
 * in "CSS properties" with a Remove each, and which "Add CSS property" offers.
 *
 * Pure, and read by the panel and the settings index alike, so the rows an
 * author sees, the picker's list and what "Find a setting" offers to add are
 * one answer. Built from the inspection (`inspectStyle`), never from a list of
 * its own: the catalog decides what exists, the engine's `applies` what has
 * an effect, and the placement table (`inspector-sections`) what shows
 * unasked.
 *
 * - **Shown unasked** stays in its section: a property whose tier shows it
 *   here, as before.
 * - **Added or holding a value**, for one whose tier doesn't show it, is a row
 *   of "CSS properties". A set value is never hidden, and is removed from the
 *   same row it is shown in.
 * - **Addable** is the rest that applies to the block now and the block
 *   offers: only catalog properties, so the list is never a free CSS box.
 *
 * @module css-properties
 */
import { SECTION_BLOCK } from "./block-shortcuts";
import { OWN_ROW_FIELDS, type InspectorSectionKey } from "./inspector-sections";
import { arrangesLayout, SPACE_PROPERTIES } from "./plain-layout-controls";
import type { InspectedStyleProperty, StyleSection } from "./style-inspector";

/** The section's key and words. */
export const CSS_PROPERTIES_SECTION: {
  readonly key: InspectorSectionKey;
  readonly label: string;
} = { key: "css-properties", label: "CSS properties" };

/** One property "CSS properties" can hold, or "Add CSS property" offer. */
export interface CssPropertyRow {
  /** The catalog key, or `key.field` for a field drawn on its own. */
  readonly id: string;
  /**
   * What its fields draw: the property, or the one field of it, labelled with
   * its CSS name, which is the label a developer searches for here.
   */
  readonly row: InspectedStyleProperty;
  /** Where in the property's value it is stored: the root, or the field. */
  readonly path: readonly string[];
  /** Its CSS name: "z-index", "mix-blend-mode". */
  readonly cssName: string;
  /** Its plain name: "Layer order", "Mix blend mode". */
  readonly plainName: string;
  /** The section it belongs to, which the picker names beside it. */
  readonly section: { readonly key: string; readonly label: string };
}

/** A block's Style sections as the tab draws them, and its own CSS rows. */
export interface ArrangedStyle {
  /** The sections, holding only what their tier shows unasked. */
  readonly sections: readonly StyleSection[];
  /** Every property whose tier doesn't show it, in the sections' order. */
  readonly extras: readonly CssPropertyRow[];
}

/** The CSS properties a property's controls write, each once, in order. */
export function writtenCss(property: InspectedStyleProperty): string[] {
  const names = new Set<string>();
  for (const control of property.controls) {
    if ("cssProperty" in control.leaf) names.add(control.leaf.cssProperty);
  }
  return [...names];
}

/**
 * The one CSS name a property is known by: what all its fields write, or the
 * name they share ("outline" for its width, style, colour and offset). A
 * property whose fields share none is named by its key, hyphenated.
 */
function cssNameOf(property: InspectedStyleProperty): string {
  const names = writtenCss(property);
  const [first] = names;
  if (first === undefined) return hyphenated(property.property);
  if (names.length === 1) return first;
  let shared = first.split("-");
  for (const name of names.slice(1)) {
    const words = name.split("-");
    let same = 0;
    while (same < shared.length && shared[same] === words[same]) same += 1;
    shared = shared.slice(0, same);
  }
  return shared.length === 0 ? hyphenated(property.property) : shared.join("-");
}

/** A catalog key as CSS spells such names: `mixBlendMode` to `mix-blend-mode`. */
function hyphenated(key: string): string {
  return key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

/** Whether a value is an object of fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value stores any field of its object other than these. */
function storesOtherThan(value: unknown, fields: ReadonlySet<string>): boolean {
  if (!isRecord(value)) return value !== undefined;
  return Object.keys(value).some(field => !fields.has(field));
}

/** A property's controls and form choices at, or away from, some fields. */
function narrowed(
  property: InspectedStyleProperty,
  keep: (field: string) => boolean
): Pick<InspectedStyleProperty, "controls" | "variants"> {
  return {
    controls: property.controls.filter(control => keep(control.path[0] ?? "")),
    variants: property.variants.filter(variant => keep(variant.path[0] ?? "")),
  };
}

/** One field of a property, drawn as a property of its own. */
interface FieldRow {
  readonly field: string;
  readonly row: InspectedStyleProperty;
}

/**
 * A property split into the part its section draws and the fields "CSS
 * properties" draws on their own (`position` and its z-index).
 */
function splitFields(property: InspectedStyleProperty): {
  readonly home: InspectedStyleProperty;
  readonly fields: readonly FieldRow[];
} {
  const own = OWN_ROW_FIELDS.filter(
    entry => entry.property === property.property
  );
  if (own.length === 0) return { home: property, fields: [] };
  const apart = new Set(own.map(entry => entry.field));
  const set = storesOtherThan(property.value, apart);
  const home: InspectedStyleProperty = {
    ...property,
    ...narrowed(property, field => !apart.has(field)),
    set,
    common: set || (property.applies && property.tierShows),
  };
  const fields = own.map(({ field, label }): FieldRow => {
    const stored =
      isRecord(property.value) && Object.hasOwn(property.value, field);
    return {
      field,
      row: {
        ...property,
        ...narrowed(property, each => each === field),
        label,
        set: stored,
        applies: property.fieldApplies?.[field] ?? property.applies,
        tierShows: false,
        common: stored,
      },
    };
  });
  return { home, fields };
}

/** A property as a row of "CSS properties", named by its CSS name. */
function cssRow(
  id: string,
  property: InspectedStyleProperty,
  path: readonly string[],
  section: StyleSection
): CssPropertyRow {
  const cssName = cssNameOf(property);
  return {
    id,
    // Labelled by its CSS name, with the plain name leading its tooltip.
    row: {
      ...property,
      label: cssName,
      summary: `${property.label}: ${property.summary}`,
    },
    path,
    cssName,
    plainName: property.label,
    section: { key: section.key, label: section.label },
  };
}

/**
 * Whether a Layout section draws Arrange: where the block offers a display,
 * not only keeps a stored one (a block that no longer has layout keeps it
 * clear-only, as a raw row).
 */
export function offersArrange(section: StyleSection): boolean {
  return (
    section.key === "layout" &&
    section.properties.some(
      property => property.property === "display" && property.offered
    )
  );
}

/** What the block's plain controls draw, which decides what stays home. */
export interface PlainControls {
  /**
   * The block's type where the block itself is edited, `undefined` for a
   * shared style: a Section's Height presets are the block's own.
   */
  readonly blockType: string | undefined;
  /**
   * Whether Arrange draws the Layout and reads it in plain words (not
   * Custom), so its Space between draws the space properties. Where the
   * reading isn't known (the Style tab isn't drawn), taken from whether the
   * block's Layout is Arrange's at all.
   */
  readonly arranges?: boolean | undefined;
}

/**
 * The properties a section's own plain controls draw, which stay in it
 * whatever their tier: Arrange's space between (rows and columns set apart
 * included) while Arrange reads the Layout in plain words, and the min height
 * a Section's Height presets stand over. Under Arrange: Custom the raw rows
 * hold the layout and its space rows are added like any other.
 */
function drawnByPlainControls(
  section: StyleSection,
  plain: PlainControls
): ReadonlySet<string> {
  if (offersArrange(section)) {
    const arranges = plain.arranges ?? arrangesLayout(plain.blockType);
    return arranges ? SPACE_PROPERTIES : NONE;
  }
  if (section.key === "size" && plain.blockType === SECTION_BLOCK) {
    return MIN_HEIGHT;
  }
  return NONE;
}

const MIN_HEIGHT: ReadonlySet<string> = new Set(["minHeight"]);
const NONE: ReadonlySet<string> = new Set();

/**
 * A block's sections as the Style tab draws them: each keeps what its tier
 * shows unasked and what its plain controls draw, and every other property
 * becomes a row "CSS properties" can hold. A section left with nothing is not
 * drawn.
 */
export function arrangeCssProperties(
  sections: readonly StyleSection[],
  plain: PlainControls
): ArrangedStyle {
  const drawn: StyleSection[] = [];
  const extras: CssPropertyRow[] = [];
  for (const section of sections) {
    const kept: InspectedStyleProperty[] = [];
    const drawnHere = drawnByPlainControls(section, plain);
    for (const property of section.properties) {
      const { home, fields } = splitFields(property);
      if (home.tierShows || drawnHere.has(home.property)) kept.push(home);
      else extras.push(cssRow(home.property, home, [], section));
      for (const { field, row } of fields) {
        extras.push(cssRow(`${row.property}.${field}`, row, [field], section));
      }
    }
    if (kept.length > 0) drawn.push({ ...section, properties: kept });
  }
  return { sections: drawn, extras };
}

/** The rows "CSS properties" draws: those holding a value, and those added. */
export function cssPropertyRows(
  extras: readonly CssPropertyRow[],
  added: ReadonlySet<string>
): CssPropertyRow[] {
  return extras.filter(each => each.row.set || added.has(each.id));
}

/**
 * What "Add CSS property" offers: each row not drawn yet that the block
 * offers and that has an effect on it now.
 */
export function addableRows(
  extras: readonly CssPropertyRow[],
  added: ReadonlySet<string>
): CssPropertyRow[] {
  return extras.filter(
    each =>
      !each.row.set &&
      !added.has(each.id) &&
      each.row.offered &&
      each.row.applies
  );
}
