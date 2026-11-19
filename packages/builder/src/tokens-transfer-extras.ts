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
  breakpointContexts,
  forEachStyleValues,
  isTextStyle,
  usableNamedClasses,
  type BreakpointSet,
  sameJsonValue,
  SITE_TEXT_LABELS,
  SITE_TEXT_ROLES,
  remapTokenReferences,
  type DtcgSiteData,
  type FontFaceDef,
  type ModesRead,
  type NamedClass,
  type SiteToken,
  type SiteTokenSet,
  type TokenRemap,
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
  /**
   * The site's classes, whose text styles a file's are matched with.
   * Absent: nothing here can store text styles, so a file's are not
   * imported, and the preview says so.
   */
  readonly textStyles?: readonly NamedClass[];
  /**
   * The faces the site loads. Absent: not known, so no font is listed as
   * missing.
   */
  readonly faces?: readonly FontFaceDef[];
  /**
   * The site's breakpoints. A text style's values for one the site doesn't
   * define would never be drawn, so they are left out, and the preview says
   * which. Absent: not known, so every value is kept.
   */
  readonly breakpoints?: BreakpointSet;
}

/**
 * The file's tokens that merge into a site variable under its id rather
 * than their own (a variable renamed here to the code name the file uses):
 * each one's identity in the file to the id it takes, and the site's
 * prefix, which a `var()` naming one is written with. The engine's
 * {@link TokenRemap}, which a page or component transfer reads through too.
 */
export type Adoption = TokenRemap;

/**
 * What an import carries beyond the variables, planned against the site:
 * its site data, its text styles and the fonts it names that the site
 * lacks. Text styles are stored by the host's class writer; where there is
 * none (`context.textStyles` absent) the file's are not imported, and that
 * is said in `refused` rather than counted as imported and dropped. What
 * they and the Site text rows name follows the variables they merge into
 * (`adoption`), and a row following a text style that isn't imported keeps
 * the site's own.
 */
export function importExtras(
  read: Pick<ModesRead, "tokens" | "textStyles" | "site">,
  context: ImportContext,
  refused: string[],
  adoption?: Adoption
): ImportExtras {
  // Their values only: a name is the author's words, whatever it reads.
  const fileStyles = (read.textStyles ?? []).map(style => ({
    ...style,
    styles: followingAdoption(style.styles, adoption),
  }));
  const fileSite = siteFollowingAdoption(read.site, adoption);
  if (context.textStyles === undefined && fileStyles.length > 0) {
    refused.push(
      fileStyles.length === 1
        ? "The file's text style wasn't imported: text styles can only be imported from the editor's Design panel."
        : `The file's ${String(fileStyles.length)} text styles weren't imported: text styles can only be imported from the editor's Design panel.`
    );
  }
  const textStyles = planTextStyles(
    context.textStyles === undefined ? undefined : fileStyles,
    context.textStyles ?? [],
    refused,
    context.breakpoints
  );
  const site = withRowsItCanFollow(fileSite, fileStyles, {
    library: context.textStyles,
    plan: textStyles,
    refused,
  });
  return {
    ...(site === undefined ? {} : { site }),
    textStyles,
    missingFonts:
      context.faces === undefined
        ? []
        : missingFonts(read.tokens, fileStyles, fileSite, context.faces),
  };
}

/**
 * The file's site data with what it names following the variables they
 * merge into: its rows as {@link followingAdoption} reads them, and each
 * colour in its order, which names a variable by identity.
 */
function siteFollowingAdoption(
  site: DtcgSiteData | undefined,
  adoption: Adoption | undefined
): DtcgSiteData | undefined {
  if (site === undefined) return undefined;
  const read = followingAdoption(site, adoption);
  return read.order === undefined || adoption === undefined
    ? read
    : { ...read, order: read.order.map(id => adoption.ids.get(id) ?? id) };
}

/**
 * A file's text style or site data with each variable it names by an
 * adopted identity, by `$token` or through `var()` of its custom property,
 * pointed at the id that variable takes here: the engine's one remap, built
 * once per import.
 */
export function followingAdoption<T>(
  value: T,
  adoption: Adoption | undefined
): T {
  return adoption === undefined
    ? value
    : remapTokenReferences(value, adoption);
}

/**
 * The file's site data without the Site text rows that would follow a text
 * style the site won't have: one of the file's the import doesn't store,
 * or, where the site's styles are known, any the site doesn't hold. Such a
 * row would follow nothing, so the site's own row is kept, and `refused`
 * names it.
 */
function withRowsItCanFollow(
  site: DtcgSiteData | undefined,
  fileStyles: readonly NamedClass[],
  against: {
    /** The site's classes, or `undefined` where they aren't known. */
    library: readonly NamedClass[] | undefined;
    plan: TextStylesPlan;
    refused: string[];
  }
): DtcgSiteData | undefined {
  if (site?.siteText === undefined) return site;
  const { plan, library } = against;
  const held = new Set(
    [
      ...(library ?? []).filter(isTextStyle),
      ...plan.added,
      ...plan.updated,
      ...plan.unchanged,
    ].map(style => style.id)
  );
  const named = new Map(
    fileStyles.map(style => [style.id, sharedStyleName(style)])
  );
  // Where the site's styles aren't known, only the file's own can be judged.
  const judged = (id: string): boolean =>
    !held.has(id) && (library !== undefined || named.has(id));
  const rows: Record<string, unknown> = { ...site.siteText };
  for (const role of SITE_TEXT_ROLES) {
    const followed = site.siteText[role]?.textStyle;
    if (followed === undefined || !judged(followed)) continue;
    delete rows[role];
    const name = named.get(followed);
    against.refused.push(
      name === undefined
        ? `Site text: ${SITE_TEXT_LABELS[role]} kept this site's own settings, because the text style it follows isn't on this site.`
        : `Site text: ${SITE_TEXT_LABELS[role]} kept this site's own settings, because the text style it follows in the file, “${name}”, wasn't imported.`
    );
  }
  const { siteText: _all, ...rest } = site;
  return Object.keys(rows).length === 0 ? rest : { ...rest, siteText: rows };
}

/** A file's text styles sorted against the site's, with what is refused. */
function planTextStyles(
  incoming: readonly NamedClass[] | undefined,
  library: readonly NamedClass[],
  refused: string[],
  breakpoints?: BreakpointSet
): TextStylesPlan {
  const plan: Record<keyof TextStylesPlan, NamedClass[]> = {
    added: [],
    updated: [],
    unchanged: [],
  };
  const site: SiteStyles = {
    library,
    byId: new Map(library.map(entry => [entry.id, entry])),
    known:
      breakpoints === undefined
        ? undefined
        : new Set(breakpointContexts(breakpoints).map(entry => entry.id)),
    // Which of the site's classes are drawn now: an import that would stop
    // one being drawn is refused, as the site's own save would refuse it.
    drawn: usableNamedClasses(library).map(entry => entry.id),
  };
  for (const file of incoming ?? []) {
    const verdict = textStyleVerdict(file, site, plan);
    if (verdict.kind === "refused") {
      refused.push(verdict.why);
      continue;
    }
    plan[verdict.kind].push(verdict.style);
    refused.push(...verdict.notes);
  }
  return plan;
}

/** What a file's text style is planned against: the site's own styles. */
interface SiteStyles {
  readonly library: readonly NamedClass[];
  readonly byId: ReadonlyMap<string, NamedClass>;
  /** The site's breakpoint ids, or `undefined` where they aren't known. */
  readonly known: ReadonlySet<string> | undefined;
  /** The ids of the site's classes drawn now. */
  readonly drawn: readonly string[];
}

/** Where one of a file's text styles goes, or why it doesn't. */
type TextStyleVerdict =
  | { readonly kind: "refused"; readonly why: string }
  | {
      readonly kind: keyof TextStylesPlan;
      readonly style: NamedClass;
      /** What was left out of it, said in the preview. */
      readonly notes: readonly string[];
    };

/**
 * One of a file's text styles judged against the site: refused where the
 * site would refuse to store it (an id another kind of style holds, a lock
 * set here, a name or code name taken), else added, updated or unchanged,
 * with the lock this site gives it and without values for breakpoints the
 * site lacks.
 */
function textStyleVerdict(
  file: NamedClass,
  site: SiteStyles,
  planned: { added: readonly NamedClass[]; updated: readonly NamedClass[] }
): TextStyleVerdict {
  const name = sharedStyleName(file);
  const held = site.byId.get(file.id);
  if (held !== undefined && !isTextStyle(held)) {
    return {
      kind: "refused",
      why: `“${name}” was not imported: a style on this site that isn't a text style has the same id.`,
    };
  }
  const notes: string[] = [];
  // One the site has keeps its place among the site's styles.
  const placed =
    held === undefined ? file : { ...file, orderIndex: held.orderIndex };
  const style = withSiteLock(
    withinBreakpoints(placed, site.known, name, notes),
    held
  );
  if (held !== undefined && sameJsonValue(held, style)) {
    return { kind: "unchanged", style, notes };
  }
  const why = refusalOf(style, name, held, site, planned);
  if (why !== undefined) return { kind: "refused", why };
  return { kind: held === undefined ? "added" : "updated", style, notes };
}

/** Why the site would refuse to store a changed text style, if it would. */
function refusalOf(
  style: NamedClass,
  name: string,
  held: NamedClass | undefined,
  site: SiteStyles,
  planned: { added: readonly NamedClass[]; updated: readonly NamedClass[] }
): string | undefined {
  // A lock holds on the site that set it: a style locked here is left as
  // it is until someone unlocks it, as every other write leaves it.
  if (held?.locked === true) {
    return `“${name}” is locked on this site, so the file's version was not imported. Unlock it first.`;
  }
  const clash = site.library.find(
    entry =>
      entry.id !== style.id &&
      isTextStyle(entry) &&
      (sharedStyleName(entry).toLowerCase() === name.toLowerCase() ||
        entry.slug === style.slug)
  );
  if (clash !== undefined) {
    return `There is already a text style named “${sharedStyleName(clash)}” on this site, so “${name}” was not imported.`;
  }
  if (drawnTogether(site, planned, style, held === undefined)) {
    return undefined;
  }
  const owner = site.library.find(
    entry => entry.id !== style.id && entry.slug === style.slug
  );
  return owner === undefined
    ? `“${name}” was not imported: this site couldn't draw it beside its own styles.`
    : `“${name}” was not imported: a style on this site already uses its code name, “${style.slug}”.`;
}

/**
 * Whether the site's classes with `style` taken as well are all still
 * drawn, `style` among them: read by the compiler's own claim rules
 * (`usableNamedClasses`), so a code name another style holds, of any kind,
 * is caught as the site's save would catch it.
 */
function drawnTogether(
  site: SiteStyles,
  planned: { added: readonly NamedClass[]; updated: readonly NamedClass[] },
  style: NamedClass,
  isNew: boolean
): boolean {
  const trial = textStylesEdit({
    added: isNew ? [...planned.added, style] : planned.added,
    updated: isNew ? planned.updated : [...planned.updated, style],
    unchanged: [],
  })(site.library);
  if (!("classes" in trial)) return false;
  const now = new Set(usableNamedClasses(trial.classes).map(entry => entry.id));
  return [
    ...site.drawn,
    ...planned.added.map(entry => entry.id),
    style.id,
  ].every(id => now.has(id));
}

/**
 * A text style with the lock this site gives it: a new one arrives unlocked
 * (a lock is set on each site, through its own route), and one the site has
 * keeps the site's lock as it is.
 */
function withSiteLock(
  style: NamedClass,
  held: NamedClass | undefined
): NamedClass {
  const rest: NamedClass = { ...style };
  delete rest.locked;
  return held?.locked === true ? { ...rest, locked: true } : rest;
}

/**
 * A text style without its values for breakpoints the site doesn't define,
 * nor the fluid sizes they were made from, each one left out said in
 * `notes`. Unchanged where the site's breakpoints aren't known.
 */
function withinBreakpoints(
  style: NamedClass,
  known: ReadonlySet<string> | undefined,
  name: string,
  notes: string[]
): NamedClass {
  if (known === undefined) return style;
  const left = new Set<string>();
  const styles: Record<string, unknown> = {};
  for (const [state, byBreakpoint] of Object.entries(style.styles)) {
    if (byBreakpoint === null || typeof byBreakpoint !== "object") {
      styles[state] = byBreakpoint;
      continue;
    }
    const kept: Record<string, unknown> = {};
    for (const [breakpoint, values] of Object.entries(byBreakpoint)) {
      if (known.has(breakpoint)) kept[breakpoint] = values;
      else left.add(breakpoint);
    }
    styles[state] = kept;
  }
  if (left.size === 0) return style;
  for (const breakpoint of left) {
    notes.push(
      `“${name}”'s values for the “${breakpoint}” breakpoint were left out: this site has no such breakpoint.`
    );
  }
  return withoutFluidSizesAt({ ...style, styles }, left);
}

/**
 * A text style without the fluid sizes of the breakpoints `left`, whose
 * values were left out: sizes beside no size would be taken for the ones a
 * size typed there later was made from.
 */
function withoutFluidSizesAt(
  style: NamedClass,
  left: ReadonlySet<string>
): NamedClass {
  const { fluidSizes, ...rest } = style;
  const sizes = Object.entries(fluidSizes ?? {}).filter(
    ([breakpoint]) => !left.has(breakpoint)
  );
  return sizes.length === 0
    ? rest
    : { ...rest, fluidSizes: Object.fromEntries(sizes) };
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
    // An update whose style was removed meanwhile is stored as new, so what
    // the import says it stored is stored.
    for (const style of [...plan.added, ...plan.updated]) {
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
function missingFonts(
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
