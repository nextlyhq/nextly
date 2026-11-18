/**
 * What Design's "Body font" and "Headings font" read and write.
 *
 * Each is a font variable and the Site text rows pointing at it: Body is
 * `font.body` and the Body row, Headings is `font.heading` and the six
 * heading rows. Picking a font writes the variable's value and points the
 * rows' font at the variable, in one new token set, so the pick saves,
 * merges and undoes as one edit, and a host's own CSS can read the font
 * through the variable's custom property. Until a row points at a font the
 * rows write none: Body is then the site's own font, and headings take the
 * body text's.
 *
 * @module site-font-roles-model
 */
import {
  compileStyleValues,
  DEFAULT_SITE_TEXT,
  isTokenRef,
  readFamilyList,
  resolveSiteText,
  resolveSiteTokens,
  resolveTokenPrefix,
  tokenCustomProperty,
  tokenIdentity,
  tokenRef,
  type FontFaceDef,
  type SiteTextEntry,
  type SiteTextMap,
  type SiteTextRole,
  type SiteTokenSet,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import { declarationsText } from "./code-hints";
import { drawsBold, roleStack, siteFamilies } from "./font-library";

/** The two site-wide fonts. */
export type FontRole = "body" | "heading";

/** The variable each role's font is held in, by identity. */
const FONT_ROLE_TOKEN: Readonly<Record<FontRole, string>> = {
  body: "font.body",
  heading: "font.heading",
};

/** The heading rows, which the Headings font points together. */
const HEADING_ROWS: readonly SiteTextRole[] = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

/** The Site text rows a role's font is written on. */
function rowsOf(role: FontRole): readonly SiteTextRole[] {
  return role === "body" ? ["body"] : HEADING_ROWS;
}

/**
 * What a role is set to:
 *
 * - `unset`: no row holds a font, so Body is the site's own font and
 *   headings take the body text's;
 * - `set`: every row draws one font, the variable's value where the rows
 *   point at a variable, else the value they hold;
 * - `mixed`: the heading rows hold different fonts (set through the API).
 */
export type FontRoleSetting =
  | { readonly kind: "unset" }
  | { readonly kind: "set"; readonly stack: string }
  | { readonly kind: "mixed" };

/** A variable's light value, a built-in's included. */
function variableValue(
  tokens: SiteTokenSet,
  identity: string
): string | undefined {
  return resolveSiteTokens(tokens).tokens.find(
    token => tokenIdentity(token) === identity
  )?.values.light;
}

/** The font a row's value draws, as a stack. */
function drawnStack(
  tokens: SiteTokenSet,
  value: StyleValue
): string | undefined {
  if (isTokenRef(value)) return variableValue(tokens, value.$token);
  return typeof value === "string" ? value : undefined;
}

/** What a role is set to, read from the rows it is written on. */
export function fontRoleSetting(
  tokens: SiteTokenSet,
  role: FontRole
): FontRoleSetting {
  const rows = resolveSiteText(tokens.siteText);
  const fonts = rowsOf(role).map(row => rows[row]?.fontFamily);
  if (fonts.every(font => font === undefined)) {
    return { kind: "unset" };
  }
  // Compared by the font each row draws, so a row holding the font as written
  // and one pointing at a variable of that font read as one setting.
  const stacks = fonts.map(font =>
    font === undefined ? undefined : drawnStack(tokens, font)
  );
  const [stack] = stacks;
  return stack !== undefined && stacks.every(each => each === stack)
    ? { kind: "set", stack }
    : { kind: "mixed" };
}

/** Two rows holding the same values, whatever order they hold them in. */
function sameRow(a: SiteTextEntry, b: SiteTextEntry | undefined): boolean {
  const left = Object.entries(a);
  const right = Object.entries(b ?? {});
  return (
    left.length === right.length &&
    left.every(
      ([key, value]) =>
        JSON.stringify(value) ===
        JSON.stringify((b as Record<string, unknown> | undefined)?.[key])
    )
  );
}

/** The set with a role's variable holding a font. */
function withRoleVariable(
  tokens: SiteTokenSet,
  identity: string,
  stack: string
): SiteTokenSet {
  const at = tokens.tokens.findIndex(
    token => tokenIdentity(token) === identity
  );
  if (at === -1) {
    return {
      ...tokens,
      tokens: [
        ...tokens.tokens,
        { name: identity, kind: "fontFamily", values: { light: stack } },
      ],
    };
  }
  return {
    ...tokens,
    // The light value alone: a font picked for the role is the font in
    // either mode.
    tokens: tokens.tokens.map((token, index) =>
      index === at ? { ...token, values: { light: stack } } : token
    ),
  };
}

/**
 * The set with a role set to a font, or, given `undefined`, with its rows'
 * font taken away: Body back to the site's own font, Headings back to the
 * body text's. One set, the variable and the rows together.
 *
 * A row left holding just its built-in values is left out again, so it
 * reads as the built-in row it is, unless the site's code supplies that row,
 * whose font would otherwise come back.
 *
 * @param supplied - the rows the site's code supplies
 */
export function withFontRole(
  tokens: SiteTokenSet,
  role: FontRole,
  stack: string | undefined,
  supplied?: SiteTextMap
): SiteTokenSet {
  const identity = FONT_ROLE_TOKEN[role];
  const rows = resolveSiteText(tokens.siteText);
  const stated: Partial<Record<SiteTextRole, SiteTextEntry>> = {
    ...tokens.siteText,
  };
  for (const row of rowsOf(role)) {
    const { fontFamily: _font, ...rest } = rows[row] ?? {};
    const next: SiteTextEntry =
      stack === undefined ? rest : { ...rest, fontFamily: tokenRef(identity) };
    const builtIn =
      stack === undefined &&
      sameRow(next, DEFAULT_SITE_TEXT[row] ?? {}) &&
      (supplied === undefined || !Object.hasOwn(supplied, row));
    if (builtIn) delete stated[row];
    else stated[row] = next;
  }
  const withRows: SiteTokenSet = { ...tokens, siteText: stated };
  return stack === undefined
    ? withRows
    : withRoleVariable(withRows, identity, stack);
}

/** The element a role's font is written on, as a developer names it. */
const ROLE_SELECTOR: Readonly<Record<FontRole, string>> = {
  body: ".nx-pb-page",
  heading: "h1, h2, h3, h4, h5, h6",
};

/** A font as the compiler writes it: a variable's `var()`, else as given. */
function writtenFont(value: StyleValue, prefix: string): string {
  const { declarations } = compileStyleValues(
    { fontFamily: value },
    "",
    prefix
  );
  return declarationsText(declarations);
}

/**
 * The variable a row's font reads and its value, as a declaration, or
 * nothing for a font the row holds as written.
 */
function variableDeclared(
  tokens: SiteTokenSet,
  value: StyleValue,
  prefix: string
): string {
  if (!isTokenRef(value)) return "";
  const property = tokenCustomProperty(value.$token, prefix);
  return `${property}: ${variableValue(tokens, value.$token) ?? ""}; `;
}

/**
 * The CSS a role writes, for its hover text, read from the rows themselves:
 * the variable a row points at with its value, and the rule the row writes,
 * or "Nothing" while it is unset. Heading rows holding different fonts are
 * said one by one.
 */
export function fontRoleWrites(tokens: SiteTokenSet, role: FontRole): string {
  const { prefix } = resolveTokenPrefix(tokens.prefix);
  const rows = resolveSiteText(tokens.siteText);
  const held = rowsOf(role).flatMap(row => {
    const font = rows[row]?.fontFamily;
    return font === undefined ? [] : [[row, font] as const];
  });
  const [first] = held;
  if (first === undefined) return "Nothing";
  // One rule for every row only where each row holds the font the same way.
  const uniform =
    held.length === rowsOf(role).length &&
    held.every(([, font]) => JSON.stringify(font) === JSON.stringify(first[1]));
  if (uniform) {
    return `${variableDeclared(tokens, first[1], prefix)}${ROLE_SELECTOR[role]} { ${writtenFont(first[1], prefix)} }`;
  }
  return held
    .map(
      ([row, font]) =>
        `${variableDeclared(tokens, font, prefix)}${row} { ${writtenFont(font, prefix)} }`
    )
    .join(" ");
}

/** One family the site loads, as a role's picker offers it. */
export interface RoleFamily {
  /** The family as first written. */
  readonly family: string;
  /** What picking it stores: the family and the generic of its kind. */
  readonly stack: string;
  readonly faces: readonly FontFaceDef[];
}

/** The families the site loads, each with the stack a role stores for it. */
export function roleFamilies(
  faces: readonly FontFaceDef[],
  fromCode: readonly FontFaceDef[]
): RoleFamily[] {
  return siteFamilies(faces, fromCode).map(family => ({
    family: family.family,
    stack: roleStack(family.family, family.category),
    faces: family.faces,
  }));
}

/** The first family a stack names, lower-cased as CSS matches it. */
export function firstFamily(stack: string): string | undefined {
  const reading = readFamilyList(stack);
  if (reading.kind !== "families" && reading.kind !== "dynamic") {
    return undefined;
  }
  return reading.parts[0]?.part.name.toLowerCase();
}

/** The cut a heading is missing, and how to add it where it can be. */
export interface MissingBold {
  /** The family, as first written. */
  readonly family: string;
  /**
   * What to ask the catalogue for, for a family the site got from it; absent
   * for an uploaded one, which only a new file can give a bold.
   */
  readonly add?: {
    readonly id: string;
    readonly weights: readonly number[];
    readonly styles: readonly ("normal" | "italic")[];
    readonly subsets: readonly string[];
  };
}

/** The catalogue request that adds a family's bold, where it came from one. */
function boldRequest(faces: readonly FontFaceDef[]): MissingBold["add"] {
  const id = faces.find(face => face.source?.kind === "google")?.source?.id;
  if (id === undefined) return undefined;
  const subsets = [
    ...new Set(
      faces.flatMap(face =>
        face.source?.subset === undefined ? [] : [face.source.subset]
      )
    ),
  ];
  return {
    id,
    weights: [700],
    styles: ["normal"],
    subsets: subsets.length === 0 ? ["latin"] : subsets,
  };
}

/**
 * The family headings are drawn in with no face at 600 or heavier, so a
 * browser thickens a lighter one for every bold heading; `undefined` when
 * they have a bold, or are not drawn in one of the site's families.
 *
 * Headings drawn in the Body font ("Same as body") are judged by it.
 */
export function missingBold(
  tokens: SiteTokenSet,
  families: readonly RoleFamily[]
): MissingBold | undefined {
  const heading = fontRoleSetting(tokens, "heading");
  const drawn =
    heading.kind === "unset" ? fontRoleSetting(tokens, "body") : heading;
  if (drawn.kind !== "set") return undefined;
  const key = firstFamily(drawn.stack);
  const family = families.find(each => each.family.toLowerCase() === key);
  if (family === undefined || drawsBold(family.faces)) return undefined;
  const add = boldRequest(family.faces);
  return { family: family.family, ...(add === undefined ? {} : { add }) };
}
