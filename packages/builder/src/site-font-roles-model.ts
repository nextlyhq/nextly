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
  customPropertiesReferenced,
  DEFAULT_SITE_TEXT,
  isTokenRef,
  readFamilyList,
  resolveSiteText,
  resolveSiteTokens,
  resolveTokenPrefix,
  siteTextStyles,
  tokenCustomProperty,
  tokenIdentity,
  tokenRef,
  type FontFaceDef,
  type NamedClass,
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
export function fontRoleRows(role: FontRole): readonly SiteTextRole[] {
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

/** The colour mode a variable's value is read in. */
type FontMode = "light" | "dark";

/**
 * A variable's value in a mode, a built-in's included. A variable with no
 * dark value draws its light one in dark mode too.
 */
function variableValue(
  tokens: SiteTokenSet,
  identity: string,
  mode: FontMode
): string | undefined {
  const values = resolveSiteTokens(tokens).tokens.find(
    token => tokenIdentity(token) === identity
  )?.values;
  return mode === "dark" ? (values?.dark ?? values?.light) : values?.light;
}

/** The site variable a custom property is, by identity, or none. */
function siteVariableNamed(
  tokens: SiteTokenSet,
  property: string
): string | undefined {
  const { prefix } = resolveTokenPrefix(tokens.prefix);
  const read = resolveSiteTokens(tokens).tokens.find(
    token => tokenCustomProperty(tokenIdentity(token), prefix) === property
  );
  return read === undefined ? undefined : tokenIdentity(read);
}

/**
 * The fallback a family that is one whole `var()` gives, as written, read as
 * a family list is: `Lora` from `var(--unset, Lora)`. None where the family
 * is more than one call, or the fallback is empty or not a family list.
 */
function varFallback(raw: string): string | undefined {
  const call = /^var\(([\s\S]*)\)$/i.exec(raw);
  if (call === null) return undefined;
  // The call's custom property, then its fallback, split as a stack is.
  const [, ...fallback] = readFamilyList(call[1] ?? "").parts;
  const text = fallback.map(each => each.part.raw).join(", ");
  const { kind } = readFamilyList(text);
  return kind === "families" || kind === "dynamic" ? text : undefined;
}

/**
 * What a stack's first family reads when it is a `var()`: the site variable
 * it names, or, where it names none, the stack drawn with its fallback in its
 * place, as `var(--unset, Lora), serif` draws `Lora, serif`. Nothing for a
 * first family that is no `var()`, or one naming no site variable and giving
 * no fallback, which a browser drops the whole value for.
 */
function firstVarRead(
  tokens: SiteTokenSet,
  stack: string
): { readonly identity: string } | { readonly stack: string } | undefined {
  const [first, ...rest] = readFamilyList(stack).parts;
  if (first?.kind !== "dynamic") return undefined;
  const [property] = customPropertiesReferenced(first.part.raw) ?? [];
  if (property === undefined) return undefined;
  const identity = siteVariableNamed(tokens, property);
  if (identity !== undefined) return { identity };
  const fallback = varFallback(first.part.raw);
  if (fallback === undefined) return undefined;
  return { stack: [fallback, ...rest.map(each => each.part.raw)].join(", ") };
}

/**
 * A row's font as the browser takes its first step: the site variable it
 * reads, a `$token` or a first family that is a `var()` of one, as
 * `var(--site-font-display), serif` reads `font.display`; else the stack it
 * draws as written. A leading `var()` naming no site variable is read as its
 * fallback, each in turn; a `var()` later in the stack is only a fallback.
 */
function firstStep(
  tokens: SiteTokenSet,
  value: StyleValue
): { readonly identity: string } | { readonly stack: string } | undefined {
  if (isTokenRef(value)) return { identity: value.$token };
  if (typeof value !== "string") return undefined;
  let stack = value;
  // Each fallback lies inside the first family before it, so the first
  // family shrinks at every step and the reading ends.
  for (
    let read = firstVarRead(tokens, stack);
    read !== undefined;
    read = firstVarRead(tokens, stack)
  ) {
    if ("identity" in read) return read;
    stack = read.stack;
  }
  return { stack };
}

/** The site variable a row's font reads, by identity ({@link firstStep}). */
function variableRead(
  tokens: SiteTokenSet,
  value: StyleValue
): string | undefined {
  const step = firstStep(tokens, value);
  return step !== undefined && "identity" in step ? step.identity : undefined;
}

/**
 * Whether a font value reads a role's variable, directly or through the
 * variables it reads in turn ({@link firstStep}): such a font changes when
 * the role's font is chosen. A loop reads no role.
 */
export function fontReadsRole(
  tokens: SiteTokenSet,
  value: StyleValue,
  role: FontRole
): boolean {
  const seen = new Set<string>();
  let step = firstStep(tokens, value);
  while (step !== undefined && "identity" in step) {
    if (step.identity === FONT_ROLE_TOKEN[role]) return true;
    if (seen.has(step.identity)) return false;
    seen.add(step.identity);
    const next = variableValue(tokens, step.identity, "light");
    if (next === undefined) return false;
    step = firstStep(tokens, next);
  }
  return false;
}

/**
 * The font a row's value draws in a mode, as a stack. A variable it reads is
 * followed, and so is one that variable reads through `var()` in turn, past
 * fallbacks as {@link firstStep} reads them. A loop of variables draws no
 * font, as a browser draws none.
 */
function drawnStack(
  tokens: SiteTokenSet,
  value: StyleValue,
  mode: FontMode
): string | undefined {
  const seen = new Set<string>();
  let step = firstStep(tokens, value);
  while (step !== undefined && "identity" in step) {
    if (seen.has(step.identity)) return undefined;
    seen.add(step.identity);
    const next = variableValue(tokens, step.identity, mode);
    if (next === undefined) return undefined;
    step = firstStep(tokens, next);
  }
  return step?.stack;
}

/**
 * The fonts a site variable draws, in light and dark mode, as stacks: what
 * it holds, or what a variable it reads through `var()` holds.
 */
export function variableStacks(
  tokens: SiteTokenSet,
  identity: string
): readonly string[] {
  return (["light", "dark"] as const).flatMap(mode => {
    const stack = drawnStack(tokens, tokenRef(identity), mode);
    return stack === undefined ? [] : [stack];
  });
}

/**
 * What a role is set to, read from the rows it is written on, in light mode
 * as the picker shows it.
 */
export function fontRoleSetting(
  tokens: SiteTokenSet,
  role: FontRole
): FontRoleSetting {
  const rows = resolveSiteText(tokens.siteText);
  const fonts = fontRoleRows(role).map(row => rows[row]?.fontFamily);
  if (fonts.every(font => font === undefined)) {
    return { kind: "unset" };
  }
  // Compared by the font each row draws, so a row holding the font as written
  // and one pointing at a variable of that font read as one setting.
  const stacks = fonts.map(font =>
    font === undefined ? undefined : drawnStack(tokens, font, "light")
  );
  const [stack] = stacks;
  return stack !== undefined && stacks.every(each => each === stack)
    ? { kind: "set", stack }
    : { kind: "mixed" };
}

/**
 * The fonts a row draws, as the engine writes it: a row following a text
 * style draws the style's, at every state and size, and its own otherwise.
 */
function rowFonts(
  row: SiteTextRole,
  entry: SiteTextEntry | undefined,
  classes: readonly NamedClass[] | undefined
): StyleValue[] {
  const styles = siteTextStyles(row, entry, classes) ?? {};
  return Object.values(styles).flatMap(sizes =>
    Object.values(sizes ?? {}).flatMap(values =>
      values?.fontFamily === undefined ? [] : [values.fontFamily]
    )
  );
}

/** Every font a role's rows draw, each row on its own, as the engine reads it. */
function roleFonts(
  tokens: SiteTokenSet,
  role: FontRole,
  classes: readonly NamedClass[] | undefined
): StyleValue[] {
  const rows = resolveSiteText(tokens.siteText);
  return fontRoleRows(role).flatMap(row => rowFonts(row, rows[row], classes));
}

/**
 * Every font a role's rows draw, each row on its own and in both modes, as
 * stacks: what removing a font takes from the role, whether its rows agree
 * or not. A row with no font of its own adds none, and a row following a
 * text style adds the style's.
 *
 * @param classes - the site's classes, where its text styles are
 */
export function fontRoleStacks(
  tokens: SiteTokenSet,
  role: FontRole,
  classes?: readonly NamedClass[]
): readonly string[] {
  const stacks = new Set<string>();
  for (const font of roleFonts(tokens, role, classes)) {
    for (const mode of ["light", "dark"] as const) {
      const stack = drawnStack(tokens, font, mode);
      if (stack !== undefined) stacks.add(stack);
    }
  }
  return [...stacks];
}

/**
 * The variables a role's rows point at, by identity, a followed text
 * style's included.
 *
 * @param classes - the site's classes, where its text styles are
 */
export function fontRoleVariables(
  tokens: SiteTokenSet,
  role: FontRole,
  classes?: readonly NamedClass[]
): readonly string[] {
  const identities = roleFonts(tokens, role, classes).flatMap(font => {
    const identity = variableRead(tokens, font);
    return identity === undefined ? [] : [identity];
  });
  return [...new Set(identities)];
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
  for (const row of fontRoleRows(role)) {
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

/** One of the site's variables, as a token set stores it. */
type StoredToken = SiteTokenSet["tokens"][number];

/**
 * A role as a set holds it, to put back later exactly: its variable as
 * stored, both modes included, and each of its rows as stated.
 */
export interface RoleSnapshot {
  readonly role: FontRole;
  /** The role's variable as stored; `undefined` where the set holds none. */
  readonly variable: StoredToken | undefined;
  /** Each of the role's rows as stated; a row the set states not, absent. */
  readonly rows: Readonly<Partial<Record<SiteTextRole, SiteTextEntry>>>;
}

/** The role as `tokens` holds it, for {@link withRoleSnapshot}. */
export function roleSnapshot(
  tokens: SiteTokenSet,
  role: FontRole
): RoleSnapshot {
  const identity = FONT_ROLE_TOKEN[role];
  const rows: Partial<Record<SiteTextRole, SiteTextEntry>> = {};
  for (const row of fontRoleRows(role)) {
    const stated = tokens.siteText?.[row];
    if (stated !== undefined) rows[row] = stated;
  }
  return {
    role,
    variable: tokens.tokens.find(token => tokenIdentity(token) === identity),
    rows,
  };
}

/**
 * A role's row put back as a snapshot stated it, onto the row as it is now:
 * only its font, so another change to the row since is kept. A row the
 * snapshot did not state, left with its built-in values, is left out again,
 * unless the site's code supplies it.
 */
function restoredRow(
  row: SiteTextRole,
  was: SiteTextEntry | undefined,
  now: SiteTextEntry | undefined,
  supplied: SiteTextMap | undefined
): SiteTextEntry | undefined {
  const base = now ?? was;
  if (was !== undefined && Object.hasOwn(was, "fontFamily")) {
    return { ...base, fontFamily: was.fontFamily };
  }
  if (base === undefined) return undefined;
  const { fontFamily: _font, ...rest } = base;
  const builtIn =
    was === undefined &&
    sameRow(rest, DEFAULT_SITE_TEXT[row] ?? {}) &&
    (supplied === undefined || !Object.hasOwn(supplied, row));
  return builtIn ? undefined : rest;
}

/**
 * The set with a role put back as a snapshot held it, onto the set as it is
 * now: the role's variable exactly as it was (or taken away where there was
 * none) and its rows' fonts, leaving every other variable and row, the other
 * role's included, as they are.
 *
 * @param supplied - the rows the site's code supplies
 */
export function withRoleSnapshot(
  tokens: SiteTokenSet,
  snapshot: RoleSnapshot,
  supplied?: SiteTextMap
): SiteTokenSet {
  const identity = FONT_ROLE_TOKEN[snapshot.role];
  const stated: Partial<Record<SiteTextRole, SiteTextEntry>> = {
    ...tokens.siteText,
  };
  for (const row of fontRoleRows(snapshot.role)) {
    const next = restoredRow(row, snapshot.rows[row], stated[row], supplied);
    if (next === undefined) delete stated[row];
    else stated[row] = next;
  }
  const others = tokens.tokens.filter(
    token => tokenIdentity(token) !== identity
  );
  const at = tokens.tokens.findIndex(
    token => tokenIdentity(token) === identity
  );
  const { variable } = snapshot;
  let variables: StoredToken[] = others;
  if (variable !== undefined) {
    variables =
      at === -1
        ? [...tokens.tokens, variable]
        : tokens.tokens.map((token, index) =>
            index === at ? variable : token
          );
  }
  return { ...tokens, tokens: variables, siteText: stated };
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
  return `${property}: ${variableValue(tokens, value.$token, "light") ?? ""}; `;
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
  const held = fontRoleRows(role).flatMap(row => {
    const font = rows[row]?.fontFamily;
    return font === undefined ? [] : [[row, font] as const];
  });
  const [first] = held;
  if (first === undefined) return "Nothing";
  // One rule for every row only where each row holds the font the same way.
  const uniform =
    held.length === fontRoleRows(role).length &&
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
