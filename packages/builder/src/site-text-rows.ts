/**
 * What Design's Site text rows read and write.
 *
 * The rows are the engine's (`SITE_TEXT_ROLES`), their built-in values the
 * engine's (`resolveSiteText`), and the CSS a row writes the compiler's: this
 * module says each in the words the panel shows, and makes the token set an
 * edit produces. A row is held on the site's token set (`siteText`), beside
 * the type sizes it points at, so an edit saves and undoes as a variable
 * edit does.
 *
 * @module site-text-rows
 */
import {
  compileStyleValues,
  isTokenRef,
  resolveSiteText,
  resolveTokenPrefix,
  SITE_TEXT_LABELS,
  SITE_TEXT_ROLES,
  siteTextStyles,
  siteTextUses,
  tokenCustomProperty,
  tokenRef,
  type SiteTextEntry,
  type SiteTextMap,
  type SiteTextRole,
  type SiteTokenSet,
  type StyleValue,
  type TokenMode,
} from "@nextlyhq/blocks-engine";

import { declarationsText } from "./code-hints";
import { fluidRange, lengthInPx } from "./fluid-size";
import { variableGroups } from "./tokens-studio";

/** What a row says while it writes nothing. */
export const SITE_OWN_WORDS = "Your site's own";

/** One type size a row can point at: a size and the line height it pairs with. */
export interface TypeSizeChoice {
  /** The size variable's identity, to store as `{ $token }`. */
  readonly size: string;
  /** Its line height's identity, where it has one. */
  readonly lineHeight: string | undefined;
  /** Its name, as the Type tab lists it: "H2". */
  readonly name: string;
  /** Its size and line height, as {@link pairWords} says them. */
  readonly pair: string;
}

/** One row as the panel draws it. */
export interface SiteTextRowView {
  readonly role: SiteTextRole;
  /** "Body", "Heading 2", "Links". */
  readonly label: string;
  /** The row's values, built-in where the site states none. */
  readonly entry: SiteTextEntry | undefined;
  /** "28 / 1.2", or "Your site's own" for a row that writes nothing. */
  readonly pair: string;
  /** The type size the row points at, where it points at one. */
  readonly typeSize: TypeSizeChoice | undefined;
  /** The size the row's text is drawn at, in px, where it reads as one. */
  readonly px: number | undefined;
  /** Whether the site states this row (it is not the built-in one). */
  readonly stated: boolean;
}

/** A number as a designer writes a size: no trailing zeros, two places at most. */
function number(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * A size and a line height in the words a designer writes a type scale: the
 * size in px at a 16px root, then the line height ("28 / 1.2"). A size made
 * with Fluid… reads by its two ends ("Fluid 16–24 / 1.3"); one that reads as
 * neither is shown as written.
 */
export function pairWords(
  size: string | undefined,
  line: string | undefined
): string {
  const range = size === undefined ? undefined : fluidRange(size);
  const px = size === undefined ? undefined : lengthInPx(size);
  const sized =
    range !== undefined
      ? `Fluid ${number(range.minPx)}–${number(range.maxPx)}`
      : px !== undefined
        ? number(px)
        : (size ?? "");
  if (line === undefined || line === "") return sized;
  return sized === "" ? line : `${sized} / ${line}`;
}

/**
 * The site's type sizes, each with its line height, by name and pair, in the
 * order the Type tab lists them. Read through the Type tab's own grouping,
 * which pairs a size and a line height by name.
 */
export function typeSizeChoices(
  tokens: SiteTokenSet,
  mode: TokenMode
): TypeSizeChoice[] {
  const type = variableGroups(tokens, mode).find(
    group => group.group === "type"
  );
  return (type?.entries ?? [])
    .filter(entry => entry.row.name.startsWith("font-size."))
    .map(entry => ({
      size: entry.row.identity,
      lineHeight: entry.lineHeight?.identity,
      name: entry.label,
      pair: pairWords(entry.row.value, entry.lineHeight?.value),
    }));
}

/**
 * A row's value as text: a variable's value in this mode, or the value.
 * Shared with the text styles, whose parts are read the same way.
 */
export function valueText(
  value: StyleValue | undefined,
  tokens: SiteTokenSet,
  mode: TokenMode
): string | undefined {
  if (value === undefined) return undefined;
  if (isTokenRef(value)) {
    const token = tokens.tokens.find(
      each => (each.id ?? each.name) === value.$token
    );
    return token === undefined
      ? undefined
      : (token.values[mode] ?? token.values.light);
  }
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

/** Every row, as the panel draws it. */
export function siteTextRowViews(
  tokens: SiteTokenSet,
  mode: TokenMode
): SiteTextRowView[] {
  const rows = resolveSiteText(tokens.siteText);
  const choices = typeSizeChoices(tokens, mode);
  return SITE_TEXT_ROLES.map(role => {
    const entry = rows[role];
    const size = valueText(entry?.fontSize, tokens, mode);
    const pointed = entry?.fontSize;
    return {
      role,
      label: SITE_TEXT_LABELS[role],
      entry,
      pair: rowPair(
        role,
        entry,
        size,
        valueText(entry?.lineHeight, tokens, mode)
      ),
      typeSize: isTokenRef(pointed)
        ? choices.find(choice => choice.size === pointed.$token)
        : undefined,
      px: size === undefined ? undefined : lengthInPx(size),
      stated:
        tokens.siteText !== undefined && Object.hasOwn(tokens.siteText, role),
    };
  });
}

/**
 * What a row says of its values: "Your site's own" while it writes nothing,
 * "Set" for a link's look (the panel words it from the row), else its pair.
 */
function rowPair(
  role: SiteTextRole,
  entry: SiteTextEntry | undefined,
  size: string | undefined,
  line: string | undefined
): string {
  if (siteTextStyles(role, entry) === undefined) return SITE_OWN_WORDS;
  if (role === "link") return "Set";
  // A row holding only the Body or Headings font says nothing of its size.
  return size === undefined && line === undefined
    ? SITE_OWN_WORDS
    : pairWords(size, line);
}

/**
 * The set with one row as given, or, given `undefined`, with the site's own
 * row left out, so the built-in one stands again.
 *
 * The row keeps its font: the font is the Body and Headings fonts' to set
 * (`site-font-roles-model`), so a change of a row's size, or a Reset, leaves
 * it where it was.
 */
export function withSiteTextRow(
  tokens: SiteTokenSet,
  role: SiteTextRole,
  entry: SiteTextEntry | undefined
): SiteTokenSet {
  const font = resolveSiteText(tokens.siteText)[role]?.fontFamily;
  const rest: Partial<Record<SiteTextRole, SiteTextEntry>> = {
    ...tokens.siteText,
  };
  delete rest[role];
  // The row's size as given, with the font it holds now, never the given one.
  const { fontFamily: _given, ...sized } =
    entry ?? resolveSiteText(undefined)[role] ?? {};
  const next =
    font !== undefined
      ? { ...sized, fontFamily: font }
      : entry === undefined
        ? undefined
        : sized;
  const siteText: SiteTextMap =
    next === undefined ? rest : { ...rest, [role]: next };
  return { ...tokens, siteText };
}

/**
 * The set with a row pointed at a type size: its size and, where the type
 * size has one, its line height, together, as one edit.
 */
export function withTypeSize(
  tokens: SiteTokenSet,
  role: SiteTextRole,
  size: string
): SiteTokenSet {
  const choice = typeSizeChoices(tokens, "light").find(
    each => each.size === size
  );
  return withSiteTextRow(tokens, role, {
    fontSize: tokenRef(size),
    ...(choice?.lineHeight === undefined
      ? {}
      : { lineHeight: tokenRef(choice.lineHeight) }),
  });
}

/** The element a row's CSS is written on, as a developer names it. */
const ROW_SELECTOR: Readonly<Record<SiteTextRole, string>> = {
  body: ".nx-pb-page",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  link: "a",
  button: ".nx-bt-core--button",
  caption: "figcaption",
};

/**
 * The CSS a row writes, as the compiler writes it: the element and its
 * declarations, a link's hover rule after its own, or "Nothing" for a row
 * that writes none.
 */
export function siteTextWrites(
  tokens: SiteTokenSet,
  role: SiteTextRole,
  entry: SiteTextEntry | undefined
): string {
  const styles = siteTextStyles(role, entry);
  if (styles === undefined) return "Nothing";
  const { prefix } = resolveTokenPrefix(tokens.prefix);
  const selector = ROW_SELECTOR[role];
  const rules: string[] = [];
  for (const [state, pseudo] of [
    ["base", ""],
    ["hover", ":hover"],
  ] as const) {
    const values = styles[state]?.base;
    if (values === undefined) continue;
    const { declarations } = compileStyleValues(values, "", prefix);
    rules.push(`${selector}${pseudo} { ${declarationsText(declarations)} }`);
  }
  return rules.join(" ");
}

/**
 * The Site text rows using any of these variables, as a refusal names them
 * ("Site text: Heading 1"), or `undefined` when none does. The panel's own
 * reading of the rule the server refuses a removal by.
 */
export function siteTextUseWords(
  tokens: SiteTokenSet,
  identities: readonly string[]
): string | undefined {
  const uses = siteTextUses(tokens.siteText);
  const { prefix } = resolveTokenPrefix(tokens.prefix);
  // Pointed at by its identity, or read through `var()` of its property.
  const usedBy = (identity: string, role: SiteTextRole): boolean =>
    uses.get(identity)?.includes(role) === true ||
    uses.get(tokenCustomProperty(identity, prefix))?.includes(role) === true;
  const roles = SITE_TEXT_ROLES.filter(role =>
    identities.some(identity => usedBy(identity, role))
  );
  if (roles.length === 0) return undefined;
  return `Site text: ${roles.map(role => SITE_TEXT_LABELS[role]).join(", ")}`;
}

/** The type size a value points at, where it points at one. */
export function pickedTypeSize(
  tokens: SiteTokenSet | undefined,
  value: StyleValue | undefined,
  /** The mode its pair is read in: the one the canvas draws. */
  mode: TokenMode = "light"
): TypeSizeChoice | undefined {
  if (tokens === undefined || !isTokenRef(value)) return undefined;
  return typeSizeChoices(tokens, mode).find(
    choice => choice.size === value.$token
  );
}
