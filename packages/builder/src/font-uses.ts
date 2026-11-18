/**
 * Where one of the site's fonts is used, as the Fonts screen says it, and
 * what the screen says when removing or using one.
 *
 * A font is used by the site's Body or Headings font, read from the rows
 * they are written on (`fontRoleSetting`), and by the font variables whose
 * first family it is, in either mode: blocks, text styles and shared styles
 * reach a font through those variables, and the variables' own usage says
 * how widely. A font a block names as plain text is not a use the site can
 * count, and never breaks a page: the text falls back.
 *
 * @module font-uses
 */
import {
  isTokenRef,
  readFamilyList,
  resolveSiteText,
  resolveSiteTokens,
  tokenDisplayLabel,
  tokenIdentity,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

import { FONT_ROLE_WORDS } from "./editor-words";
import {
  firstFamily,
  fontRoleSetting,
  type FontRole,
} from "./site-font-roles-model";

/** A font variable whose first family is the font. */
export interface FontVariableUse {
  /** The variable's identity, as usage and the Variables tab name it. */
  readonly identity: string;
  /** Its plain name, as Variables shows it. */
  readonly label: string;
  /** What its text is drawn in once the font is gone. */
  readonly fallback: string;
}

/** Where a font is used. */
export interface FamilyUses {
  /** The site-wide fonts it is: Body, Headings, both or neither. */
  readonly roles: readonly FontRole[];
  /** The font variables naming it first, other than the roles' own. */
  readonly variables: readonly FontVariableUse[];
}

/** The fallback of a stack once its first family is gone. */
function fallbackOf(stack: string): string | undefined {
  const reading = readFamilyList(stack);
  if (reading.kind !== "families" && reading.kind !== "dynamic") {
    return undefined;
  }
  const rest = reading.parts.slice(1).map(entry => entry.part.raw.trim());
  return rest.length === 0 ? undefined : rest.join(", ");
}

/** What a stack with nothing after the font falls back to, in words. */
const BROWSER_FONT = "the browser’s own font";

/** The variable a role's rows point at, when they point at one. */
function roleVariable(
  tokens: SiteTokenSet,
  role: FontRole
): string | undefined {
  const rows = resolveSiteText(tokens.siteText);
  const font = (role === "body" ? rows.body : rows.h1)?.fontFamily;
  return font !== undefined && isTokenRef(font) ? font.$token : undefined;
}

/**
 * Where the font a family key names (lower-cased, as CSS matches it) is
 * used in a token set.
 *
 * @param key - The family, lower-cased
 * @param tokens - The site's variables and Site text, or `undefined` unread
 * @returns The roles it is, and the other font variables naming it first
 */
export function familyUses(
  key: string,
  tokens: SiteTokenSet | undefined
): FamilyUses {
  if (tokens === undefined) return { roles: [], variables: [] };
  const roles = (["body", "heading"] as const).filter(role => {
    const setting = fontRoleSetting(tokens, role);
    return setting.kind === "set" && firstFamily(setting.stack) === key;
  });
  // A role's own variable is said as the role, not a second time.
  const held = new Set(
    roles
      .map(role => roleVariable(tokens, role))
      .filter((identity): identity is string => identity !== undefined)
  );
  const variables = resolveSiteTokens(tokens)
    .tokens.filter(token => token.kind === "fontFamily")
    .flatMap((token): FontVariableUse[] => {
      const identity = tokenIdentity(token);
      if (held.has(identity)) return [];
      const naming = [token.values.light, token.values.dark].find(
        stack => stack !== undefined && firstFamily(stack) === key
      );
      if (naming === undefined) return [];
      return [
        {
          identity,
          label: tokenDisplayLabel(token),
          fallback: fallbackOf(naming) ?? BROWSER_FONT,
        },
      ];
    });
  return { roles, variables };
}

/** "body", "headings" or "body and headings", as a sentence names roles. */
function rolesWords(roles: readonly FontRole[]): string {
  return roles
    .map(role => (role === "body" ? "body" : "headings"))
    .join(" and ");
}

/**
 * Why a font cannot be removed while it is the Body or Headings font, and
 * what to do first; `undefined` for a font that is neither.
 *
 * @param family - The font, as first written
 * @param roles - The roles it is
 * @returns The refusal, or `undefined`
 */
export function roleRefusal(
  family: string,
  roles: readonly FontRole[]
): string | undefined {
  if (roles.length === 0) return undefined;
  const which = rolesWords(roles);
  const another =
    roles.length === 1
      ? `another ${which} font`
      : `other ${which} fonts`;
  return `${family} is your ${which} font. Choose ${another} first.`;
}

/**
 * What a toast says once a font is used for the roles chosen: "Inter is now
 * your headings font".
 *
 * @param family - The font, as first written
 * @param roles - The roles it now is
 * @returns The sentence
 */
export function nowYourFontWords(
  family: string,
  roles: readonly FontRole[]
): string {
  return `${family} is now your ${rolesWords(roles)} font`;
}

/** The role's own name, as Design's Type tab labels it ("Body font"). */
export function roleLabel(role: FontRole): string {
  return FONT_ROLE_WORDS[role];
}
