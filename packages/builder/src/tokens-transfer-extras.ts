/**
 * What the design-token export and import carry beyond the variables: the
 * site's text styles, its Site text rows, colour order, fluid range and
 * built-in colours setting, and which fonts a file uses that the site lacks.
 *
 * The engine writes and reads all of it (`tokensToDtcg`, `dtcgToTokens`);
 * this is the policy around it, as `tokens-transfer` is for the variables:
 * an import MERGES, so a Site text row the file doesn't state keeps the
 * site's, and a text style the site has is changed by its id rather than
 * added beside it; and nothing is applied that the site would refuse to
 * store, said in the author's words instead.
 *
 * @module tokens-transfer-extras
 */
import {
  forEachStyleValues,
  isTextStyle,
  sameJsonValue,
  SITE_TEXT_LABELS,
  SITE_TEXT_ROLES,
  type DtcgSiteData,
  type FontFaceDef,
  type NamedClass,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

import type { ClassListEdit } from "./block-style-actions";
import { nextOrderIndex } from "./block-style-plans";
import { readStack } from "./font-library";
import { sharedStyleName } from "./shared-style-library";

/** What a file's text styles would do to the site's. */
export interface TextStylesPlan {
  /** Text styles the site doesn't have. */
  readonly added: readonly NamedClass[];
  /** Text styles the site has, by id, that the file changes. */
  readonly updated: readonly NamedClass[];
  /** Text styles the site has exactly as the file does. */
  readonly unchanged: readonly NamedClass[];
}

/** What an import carries beyond the variables, as planned. */
export interface ImportExtras {
  /** The site's own design data the file keeps, if any. */
  readonly site?: DtcgSiteData;
  readonly textStyles: TextStylesPlan;
  /**
   * The font families the file's variables, text styles and Site text
   * name first that the site has no font file for, in the order met.
   */
  readonly missingFonts: readonly string[];
}

/** What the site holds that an import is planned against. */
export interface ImportContext {
  /** The site's classes, whose text styles a file's are matched with. */
  readonly textStyles?: readonly NamedClass[];
  /**
   * The faces the site loads. Absent: not known, so no font is listed as
   * missing.
   */
  readonly faces?: readonly FontFaceDef[];
}

/** A file's text styles sorted against the site's, with what is refused. */
export function planTextStyles(
  incoming: readonly NamedClass[] | undefined,
  library: readonly NamedClass[],
  refused: string[]
): TextStylesPlan {
  const added: NamedClass[] = [];
  const updated: NamedClass[] = [];
  const unchanged: NamedClass[] = [];
  const byId = new Map(library.map(entry => [entry.id, entry]));
  for (const style of incoming ?? []) {
    const name = sharedStyleName(style);
    const held = byId.get(style.id);
    if (held !== undefined && !isTextStyle(held)) {
      refused.push(
        `“${name}” was not imported: a style on this site that isn't a text style has the same id.`
      );
      continue;
    }
    const clash = library.find(
      entry =>
        entry.id !== style.id &&
        isTextStyle(entry) &&
        (sharedStyleName(entry).toLowerCase() === name.toLowerCase() ||
          entry.slug === style.slug)
    );
    if (clash !== undefined) {
      refused.push(
        `There is already a text style named “${sharedStyleName(clash)}” on this site, so “${name}” was not imported.`
      );
      continue;
    }
    if (held === undefined) added.push(style);
    else if (sameJsonValue(held, style)) unchanged.push(style);
    else updated.push(style);
  }
  return { added, updated, unchanged };
}

/**
 * The class edit that stores a planned import's text styles, composed
 * against the site's classes at the moment it is stored: one it has, by id,
 * is replaced where it stands, and a new one is added after every class.
 */
export function textStylesEdit(plan: TextStylesPlan): ClassListEdit {
  return existing => {
    const replaced = new Map(plan.updated.map(style => [style.id, style]));
    const classes = existing.map(entry =>
      isTextStyle(entry) ? (replaced.get(entry.id) ?? entry) : entry
    );
    const held = new Set(classes.map(entry => entry.id));
    let next = nextOrderIndex(classes);
    for (const style of plan.added) {
      if (held.has(style.id)) continue;
      classes.push({ ...style, orderIndex: next });
      next += 1;
    }
    return { classes };
  };
}

/** How many text styles a planned import stores. */
export function textStylesTaken(plan: TextStylesPlan): number {
  return plan.added.length + plan.updated.length;
}

/**
 * The site's set with a file's own design data laid over it: each Site text
 * row the file states replaces the site's, and the rest stay; the order, the
 * fluid range and the built-in colours setting are the file's where it
 * states them.
 */
export function withSiteData(
  into: SiteTokenSet,
  site: DtcgSiteData | undefined
): SiteTokenSet {
  if (site === undefined) return into;
  return {
    ...into,
    ...(site.siteText === undefined
      ? {}
      : { siteText: { ...into.siteText, ...site.siteText } }),
    ...(site.order === undefined ? {} : { order: site.order }),
    ...(site.fluidRange === undefined ? {} : { fluidRange: site.fluidRange }),
    ...(site.builtInColoursShown === undefined
      ? {}
      : { builtInColoursShown: site.builtInColoursShown }),
  };
}

/** Whether laying a file's design data over the site's changes anything. */
export function siteDataChanges(
  into: SiteTokenSet,
  site: DtcgSiteData | undefined
): boolean {
  if (site === undefined) return false;
  const after = withSiteData(into, site);
  return (
    !sameJsonValue(after.siteText ?? null, into.siteText ?? null) ||
    !sameJsonValue(after.order ?? null, into.order ?? null) ||
    !sameJsonValue(after.fluidRange ?? null, into.fluidRange ?? null) ||
    after.builtInColoursShown !== into.builtInColoursShown
  );
}

/**
 * What a file's design data is, line by line, for the import's preview:
 * "Site text: Body, Heading 2", "Colour order", "Fluid range: 320–1440px".
 */
export function siteDataLines(site: DtcgSiteData | undefined): string[] {
  if (site === undefined) return [];
  const lines: string[] = [];
  if (site.siteText !== undefined) {
    const rows = SITE_TEXT_ROLES.filter(role =>
      Object.hasOwn(site.siteText ?? {}, role)
    ).map(role => SITE_TEXT_LABELS[role]);
    if (rows.length > 0) lines.push(`Site text: ${rows.join(", ")}`);
  }
  if (site.order !== undefined) lines.push("The order of your colours");
  if (site.fluidRange !== undefined) {
    lines.push(
      `Fluid sizes grow from ${String(site.fluidRange.min)}px to ${String(site.fluidRange.max)}px wide`
    );
  }
  if (site.builtInColoursShown !== undefined) {
    lines.push(
      site.builtInColoursShown
        ? "Built-in colours are shown"
        : "Built-in colours are hidden"
    );
  }
  return lines;
}

/**
 * The families a file's fonts name first that none of the site's faces
 * provides: from its font variables (light and dark), its text styles and
 * its Site text rows. A generic family (`serif`) and a font through
 * `var()` are never missing.
 */
export function missingFonts(
  tokens: readonly SiteToken[],
  textStyles: readonly NamedClass[],
  site: DtcgSiteData | undefined,
  faces: readonly FontFaceDef[]
): string[] {
  const values: string[] = [];
  for (const token of tokens) {
    if (token.kind !== "fontFamily") continue;
    values.push(token.values.light);
    if (token.values.dark !== undefined) values.push(token.values.dark);
  }
  for (const style of textStyles) {
    forEachStyleValues(style.styles, (_breakpoint, styleValues) => {
      const family = (styleValues as { fontFamily?: unknown } | undefined)
        ?.fontFamily;
      if (typeof family === "string") values.push(family);
    });
  }
  for (const row of Object.values(site?.siteText ?? {})) {
    if (typeof row?.fontFamily === "string") values.push(row.fontFamily);
  }
  const missing = new Map<string, string>();
  for (const value of values) {
    const first = readStack(value, faces).firstChoice;
    if (first?.source !== "not-provided") continue;
    const key = first.family.toLowerCase();
    if (!missing.has(key)) missing.set(key, first.family);
  }
  return [...missing.values()];
}
