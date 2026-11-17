/**
 * Site text: the size and line height a site gives its body text, its six
 * heading levels, its links, its buttons and its captions, set once for
 * every page.
 *
 * ## One map, read by every compile
 *
 * A site states its rows on its token set (`SiteTokenSet.siteText`), beside
 * the variables they point at, so a row is saved, merged and undone with the
 * type sizes it uses. This module is the one reading of that map: which rows
 * there are, what a row the site never set holds, and what CSS each row
 * becomes. The block library turns it into the compiler's element tier, so
 * the canvas, a published page, a stored sheet and the style trace all
 * compile the same rules from the same rows.
 *
 * ## What a fresh site writes
 *
 * The heading rows point at the built-in type sizes `font-size.h1` to
 * `font-size.h6`, whose values are the heading sizes the block library drew
 * before this map existed, so a site that never opens Site text renders as it
 * did at a 16px root. Body, Links, Buttons and Captions hold nothing until an
 * author sets them, and an empty row writes no CSS: a host's own typography
 * keeps working inside builder content until someone chooses otherwise.
 *
 * ## No row moves a block
 *
 * The space between two blocks is the gap of the container holding them. So
 * the elements a block renders text as carry no outer margin of their own,
 * and a row holds typography only: nothing here can write a margin.
 *
 * @module style/site-text
 */
import { STYLE_STATES } from "../document";
import type { NodeStyles, StyleValue, TokenRef } from "../document-styles";
import { isTokenRef, tokenRef } from "../document-styles";
import { isPlainRecord } from "../plain-record";
import type { ValidationIssue } from "../validation";

import type { TypographicElement } from "./compile-page-states";
import type { FluidSizes } from "./fluid-value";
import { validateStyleValues } from "./validate-style-value";

/** The rows of Site text, in the order an author meets them. */
export const SITE_TEXT_ROLES = [
  "body",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "link",
  "button",
  "caption",
] as const;

/** One row of Site text. */
export type SiteTextRole = (typeof SITE_TEXT_ROLES)[number];

/**
 * What each row is called where an author meets it: the Design panel's rows,
 * the style trace's "From Site text: Heading 2", and a refused removal that
 * names the row still using a type size. One table, so the three never name
 * a row two ways.
 */
export const SITE_TEXT_LABELS: Readonly<Record<SiteTextRole, string>> = {
  body: "Body",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  h5: "Heading 5",
  h6: "Heading 6",
  link: "Links",
  button: "Buttons",
  caption: "Captions",
};

/** When a link is underlined. */
export type SiteTextUnderline = "always" | "hover" | "never";

/** The ways a link may be underlined, in the order the row offers them. */
export const SITE_TEXT_UNDERLINES: readonly SiteTextUnderline[] = [
  "always",
  "hover",
  "never",
];

/**
 * One row's values. Each is a variable reference or a plain value, and each
 * is optional: a row says only what the author set.
 */
export interface SiteTextEntry {
  /** The text size: a type size (`{ $token: "font-size.h2" }`) or a size. */
  readonly fontSize?: string | TokenRef;
  /** The line height: a type size's partner, or a number or length. */
  readonly lineHeight?: string | number | TokenRef;
  /**
   * The two sizes in px a plain size was made from with "Fluid…", so the
   * row reopens with them and a change of the site's fluid range remakes
   * the size.
   */
  readonly fluid?: FluidSizes;
  /** A link's colour. Links only. */
  readonly color?: string | TokenRef;
  /** A link's colour while the pointer is over it. Links only. */
  readonly hoverColor?: string | TokenRef;
  /** When a link is underlined. Links only. */
  readonly underline?: SiteTextUnderline;
}

/** A site's rows by role. A role it leaves out keeps its built-in row. */
export type SiteTextMap = Readonly<
  Partial<Record<SiteTextRole, SiteTextEntry>>
>;

/** The heading rows, which are also the elements they style. */
const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/**
 * What a site that states nothing holds: each heading row pointing at the
 * built-in type size of its level, and no other row.
 */
export const DEFAULT_SITE_TEXT: SiteTextMap = Object.freeze(
  Object.fromEntries(
    HEADINGS.map(level => [
      level,
      Object.freeze({
        fontSize: tokenRef(`font-size.${level}`),
        lineHeight: tokenRef(`line-height.${level}`),
      }),
    ])
  )
);

/**
 * Every row the site's text has: the built-in rows, with each row a site
 * states in place of the built-in one. A stated row replaces the whole
 * built-in row rather than one value of it, so a heading pointed at another
 * type size never keeps the built-in line height beside it, and an empty
 * stated row leaves that level to the site's own CSS.
 */
export function resolveSiteText(stated?: SiteTextMap): SiteTextMap {
  if (stated === undefined) return DEFAULT_SITE_TEXT;
  const out: Partial<Record<SiteTextRole, SiteTextEntry>> = {};
  for (const role of SITE_TEXT_ROLES) {
    // Own rows only: a map reached through a polluted prototype must not
    // turn an inherited value into a rule on every page.
    const entry = Object.hasOwn(stated, role)
      ? stated[role]
      : DEFAULT_SITE_TEXT[role];
    if (entry !== undefined) out[role] = entry;
  }
  return out;
}

/** No outer margin on the block axis, as objects of its own. */
function flushMargin(): { blockStart: string; blockEnd: string } {
  return { blockStart: "0", blockEnd: "0" };
}

/** An element whose default is only {@link flushMargin}. */
function flush(): NodeStyles {
  return { base: { base: { margin: flushMargin() } } };
}

/** A heading level's own default: bold, and no outer margin. */
function heading(): NodeStyles {
  return { base: { base: { fontWeight: 700, margin: flushMargin() } } };
}

/**
 * What the elements a block renders text as carry before any row: no outer
 * margin on the block axis, and bold headings.
 *
 * The space between two blocks is the gap of the container holding them,
 * and the space between the paragraphs of rich text is that block's own gap,
 * inside it. A margin on the element would leak out of the block instead, and
 * collapse through any parent with no padding of its own; zeroing it also
 * takes away a browser's defaults where a host has no reset.
 *
 * A paragraph carries no line height. Line height inherits and this tier
 * writes a rule on the `p` itself, so a value here would beat whatever an
 * author set on a block holding the paragraph. Body text takes its size and
 * line height from the Body row, written on the page root and inherited.
 *
 * Built per call: the record is handed to compiles as data, and an entry one
 * caller adjusted in place must not move every other compile.
 */
function elementDefaults(): Partial<Record<ElementBaseKey, NodeStyles>> {
  return {
    h1: heading(),
    h2: heading(),
    h3: heading(),
    h4: heading(),
    h5: heading(),
    h6: heading(),
    p: flush(),
    // Rendered by List, Quote, Image and rich text, each with a browser
    // margin a host without a reset keeps.
    blockquote: flush(),
    // Flush on every side: a browser also indents a figure inline, and an
    // image with no caption is a bare `img` with no such inset.
    figure: {
      base: {
        base: {
          margin: { ...flushMargin(), inlineStart: "0", inlineEnd: "0" },
        },
      },
    },
    hr: flush(),
    ol: flush(),
    ul: flush(),
    // A code block in rich text, with the browser's block margins otherwise.
    pre: flush(),
  };
}

/**
 * The element tier's key for the page root every block of a document sits
 * under, a header's and a footer's included. Body text is written there
 * rather than on `p`, so it is inherited, and a block's own text size still
 * reaches the text inside it.
 */
export const SITE_TEXT_ROOT = "root";

/** A key of the element tier: an element, or the page root. */
export type ElementBaseKey = TypographicElement | typeof SITE_TEXT_ROOT;

/**
 * Where each row is written in the element tier. Buttons are absent: a
 * button has no element of its own to key on (the Button block draws an
 * `a` or a `button`), so the block library lays that row over the blocks
 * that draw one.
 */
const ROW_ELEMENT: Readonly<Partial<Record<SiteTextRole, ElementBaseKey>>> = {
  body: SITE_TEXT_ROOT,
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  link: "a",
  caption: "figcaption",
};

/** The row an element of the tier is written from, by its key. */
const ELEMENT_ROW: ReadonlyMap<string, SiteTextRole> = new Map(
  SITE_TEXT_ROLES.flatMap(role => {
    const key = ROW_ELEMENT[role];
    return key === undefined ? [] : [[key, role] as const];
  })
);

/**
 * The CSS properties a row writes: a link's colours and underline, every
 * other row's size and line height. The tier's own defaults write the rest
 * (a margin, a heading's weight).
 */
const LINK_PROPERTIES: ReadonlySet<string> = new Set([
  "color",
  "text-decoration",
]);
const TEXT_PROPERTIES: ReadonlySet<string> = new Set([
  "font-size",
  "line-height",
]);

/**
 * The row an element-tier declaration came from, or `undefined` for one the
 * tier writes itself (a margin, a heading's weight): for a style trace that
 * says "From Site text: Heading 2" rather than naming an element.
 *
 * @param key - the element tier's key the declaration was written under
 * @param cssProperty - the property, as the trace records it
 */
export function siteTextRoleOf(
  key: string,
  cssProperty: string
): SiteTextRole | undefined {
  const role = ELEMENT_ROW.get(key);
  if (role === undefined) return undefined;
  const written = role === "link" ? LINK_PROPERTIES : TEXT_PROPERTIES;
  return written.has(cssProperty) ? role : undefined;
}

/**
 * The styles one row writes, or `undefined` for a row that writes nothing.
 *
 * Typography only: a size and a line height, and for links a colour, a
 * colour on hover and the underline. A link writes no size, so it takes the
 * size of the text around it, in a paragraph or a heading alike.
 */
export function siteTextStyles(
  role: SiteTextRole,
  entry: SiteTextEntry | undefined
): NodeStyles | undefined {
  if (entry === undefined) return undefined;
  const { base, hover } =
    role === "link"
      ? linkValues(entry)
      : { base: textValues(entry), hover: {} };
  const styles: NodeStyles = {
    ...(Object.keys(base).length === 0 ? {} : { base: { base } }),
    ...(Object.keys(hover).length === 0 ? {} : { hover: { base: hover } }),
  };
  return Object.keys(styles).length === 0 ? undefined : styles;
}

/** A text row's size and line height, where it states them. */
function textValues(entry: SiteTextEntry): Record<string, StyleValue> {
  return {
    ...(entry.fontSize === undefined ? {} : { fontSize: entry.fontSize }),
    ...(entry.lineHeight === undefined ? {} : { lineHeight: entry.lineHeight }),
  };
}

/** What the Links row writes on a link, and on a link under the pointer. */
function linkValues(entry: SiteTextEntry): {
  base: Record<string, StyleValue>;
  hover: Record<string, StyleValue>;
} {
  const { underline } = entry;
  return {
    base: {
      ...(entry.color === undefined ? {} : { color: entry.color }),
      ...(underline === undefined
        ? {}
        : { textDecoration: underline === "always" ? "underline" : "none" }),
    },
    hover: {
      ...(entry.hoverColor === undefined ? {} : { color: entry.hoverColor }),
      ...(underline === "hover" ? { textDecoration: "underline" } : {}),
    },
  };
}

/**
 * An element's own defaults with a row laid over them. Rows are written at
 * the widest breakpoint only, as the defaults are, so the merge is two
 * levels deep and no more.
 */
function laidOver(
  under: NodeStyles | undefined,
  over: NodeStyles | undefined
): NodeStyles | undefined {
  if (over === undefined) return under;
  if (under === undefined) return over;
  const out: NodeStyles = {};
  for (const state of STYLE_STATES) {
    const below = under[state]?.base;
    const above = over[state]?.base;
    if (below === undefined && above === undefined) continue;
    out[state] = { base: { ...below, ...above } };
  }
  return out;
}

/**
 * The compiler's element tier for a site's text: each element's own
 * defaults, each row written over the element it styles, and Body on the
 * page root.
 *
 * @param stated - the rows the site states; the built-in rows stand for the rest
 */
export function siteTextElementBases(
  stated?: SiteTextMap
): Readonly<Partial<Record<ElementBaseKey, NodeStyles>>> {
  const rows = resolveSiteText(stated);
  const out = elementDefaults();
  for (const role of SITE_TEXT_ROLES) {
    const key = ROW_ELEMENT[role];
    if (key === undefined) continue;
    const styles = laidOver(out[key], siteTextStyles(role, rows[role]));
    if (styles !== undefined) out[key] = styles;
  }
  return out;
}

/** The keys a link row may hold, and the keys every other row may. */
const LINK_KEYS: ReadonlySet<string> = new Set([
  "color",
  "hoverColor",
  "underline",
]);
const TEXT_KEYS: ReadonlySet<string> = new Set([
  "fontSize",
  "lineHeight",
  "fluid",
]);

/** The style key each value of a row is judged as. */
const JUDGED_AS: readonly (readonly [string, string])[] = [
  ["fontSize", "fontSize"],
  ["lineHeight", "lineHeight"],
  ["color", "color"],
  // A colour on hover is a colour.
  ["hoverColor", "color"],
];

/** Whether a value is two sizes in px, as "Fluid…" stores them. */
function isFluidSizes(value: unknown): value is FluidSizes {
  return (
    isPlainRecord(value) &&
    Object.keys(value).every(key => key === "small" || key === "large") &&
    typeof value.small === "number" &&
    typeof value.large === "number" &&
    Number.isFinite(value.small) &&
    Number.isFinite(value.large) &&
    value.small > 0 &&
    value.large > 0
  );
}

/** A refusal at one place in the map. */
function refusal(path: string, message: string): ValidationIssue {
  return { path, code: "invalid-style-value", severity: "error", message };
}

/**
 * The issues with a stated site text map, each at its row: an unknown row,
 * a key no such row holds, a fluid size held beside a variable, an underline
 * that is none of the three, or a value the style compiler refuses. Empty for
 * a usable map.
 *
 * For the plugin's record reader and for any surface that writes rows, so a
 * row is judged by one rule wherever it is written.
 */
export function siteTextIssues(
  value: unknown,
  path = "siteText"
): ValidationIssue[] {
  if (!isPlainRecord(value)) {
    return [refusal(path, "Site text is a set of rows, one per kind of text.")];
  }
  const issues: ValidationIssue[] = [];
  for (const role of Object.keys(value)) {
    const at = `${path}/${role}`;
    if (!(SITE_TEXT_ROLES as readonly string[]).includes(role)) {
      issues.push(
        refusal(at, `"${role.slice(0, 40)}" is not a row of Site text.`)
      );
      continue;
    }
    issues.push(...entryIssues(role as SiteTextRole, value[role], at));
  }
  return issues;
}

/** The issues with one row. */
function entryIssues(
  role: SiteTextRole,
  entry: unknown,
  at: string
): ValidationIssue[] {
  const label = SITE_TEXT_LABELS[role];
  if (!isPlainRecord(entry)) {
    return [refusal(at, `${label} is not a row of values.`)];
  }
  const held = role === "link" ? LINK_KEYS : TEXT_KEYS;
  return [
    ...Object.keys(entry)
      .filter(key => !held.has(key))
      .map(key =>
        refusal(`${at}/${key}`, `${label} has no "${key.slice(0, 40)}".`)
      ),
    ...fluidIssues(entry, label, at),
    ...underlineIssues(entry, label, at),
    ...JUDGED_AS.filter(
      ([key]) => entry[key] !== undefined && held.has(key)
    ).flatMap(([key, judged]) =>
      valueIssues(
        entry[key],
        judged,
        `${at}/${key}`,
        `${label}'s ${VALUE_WORDS[key] ?? key}`
      )
    ),
  ];
}

/** Why a row's fluid sizes cannot be kept, if they cannot. */
function fluidIssues(
  entry: Record<string, unknown>,
  label: string,
  at: string
): ValidationIssue[] {
  if (entry.fluid === undefined) return [];
  if (!isFluidSizes(entry.fluid)) {
    return [
      refusal(`${at}/fluid`, `${label}'s fluid size needs two sizes in px.`),
    ];
  }
  // The sizes describe a value the row holds itself, never a variable's.
  return typeof entry.fontSize === "string"
    ? []
    : [
        refusal(
          `${at}/fluid`,
          `${label}'s fluid sizes are kept only with a size of its own.`
        ),
      ];
}

/** Why a row's underline cannot be used, if it cannot. */
function underlineIssues(
  entry: Record<string, unknown>,
  label: string,
  at: string
): ValidationIssue[] {
  if (
    entry.underline === undefined ||
    (SITE_TEXT_UNDERLINES as readonly unknown[]).includes(entry.underline)
  ) {
    return [];
  }
  return [
    refusal(
      `${at}/underline`,
      `${label} are underlined always, on hover or never.`
    ),
  ];
}

/** What each value of a row is called, for a refusal naming it. */
const VALUE_WORDS: Readonly<Record<string, string>> = {
  fontSize: "size",
  lineHeight: "line height",
  color: "colour",
  hoverColor: "colour on hover",
};

/**
 * The style compiler's refusals of one value, judged as `judged`, each
 * saying which row's value it is (`Heading 1's size: …`).
 */
function valueIssues(
  value: unknown,
  judged: string,
  at: string,
  named: string
): ValidationIssue[] {
  return validateStyleValues({ [judged]: value }, at, "strict")
    .filter(issue => issue.severity === "error")
    .map(issue => ({
      ...issue,
      path: at,
      message: `${named}: ${issue.message}`,
    }));
}

/**
 * The rows using each variable, by the variable's identity: for a removal
 * that refuses a type size a row still points at, naming the row.
 */
export function siteTextUses(
  stated: SiteTextMap | undefined
): ReadonlyMap<string, readonly SiteTextRole[]> {
  const uses = new Map<string, SiteTextRole[]>();
  if (stated === undefined) return uses;
  for (const role of SITE_TEXT_ROLES) {
    if (!Object.hasOwn(stated, role)) continue;
    // Read whether or not anything validated it: a stored map is site data.
    const entry: unknown = stated[role];
    if (!isPlainRecord(entry)) continue;
    const values = [
      entry.fontSize,
      entry.lineHeight,
      entry.color,
      entry.hoverColor,
    ];
    for (const value of values) {
      if (!isTokenRef(value)) continue;
      const roles = uses.get(value.$token) ?? [];
      if (!roles.includes(role)) roles.push(role);
      uses.set(value.$token, roles);
    }
  }
  return uses;
}
