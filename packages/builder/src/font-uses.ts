/**
 * Where one of the site's fonts is used, as the Fonts screen says it, and
 * what the screen says when removing or using one.
 *
 * A font is used by the site's Body or Headings font, read from each row
 * they are written on in either mode (`fontRoleStacks`), and by the font
 * variables whose first family it is, in either mode: blocks, text styles and shared styles
 * reach a font through those variables, and the variables' own usage says
 * how widely. A font a block names as plain text is not a use the site can
 * count, and never breaks a page: the text falls back.
 *
 * @module font-uses
 */
import {
  readFamilyList,
  resolveSiteTokens,
  tokenDisplayLabel,
  tokenIdentity,
  type NamedClass,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

import { FONT_ROLE_WORDS } from "./editor-words";
import { listedWords } from "./shared-style-library";
import {
  firstFamily,
  fontReadsRole,
  fontRoleRows,
  fontRoleStacks,
  fontRoleVariables,
  variableStacks,
  type FontRole,
} from "./site-font-roles-model";
import { siteTextRowViews } from "./site-text-rows";

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
  /**
   * Every font variable naming it first, the roles' own included, by
   * identity: the variables whose places say how widely it is used.
   */
  readonly counted: readonly string[];
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

/**
 * Where the font a family key names (lower-cased, as CSS matches it) is
 * used in a token set.
 *
 * @param key - The family, lower-cased
 * @param tokens - The site's variables and Site text, or `undefined` unread
 * @param classes - The site's classes, where the text styles rows follow are
 * @returns The roles it is, the other font variables naming it first, and
 *   every variable whose places count towards it
 */
export function familyUses(
  key: string,
  tokens: SiteTokenSet | undefined,
  classes?: readonly NamedClass[]
): FamilyUses {
  if (tokens === undefined) return { roles: [], variables: [], counted: [] };
  // Row by row and in both modes: a heading row the others disagree with,
  // or a variable's dark value, still loses the font when it goes.
  const roles = (["body", "heading"] as const).filter(role =>
    fontRoleStacks(tokens, role, classes).some(
      stack => firstFamily(stack) === key
    )
  );
  const naming = resolveSiteTokens(tokens)
    .tokens.filter(token => token.kind === "fontFamily")
    .flatMap((token): FontVariableUse[] => {
      // In either mode, and through a variable it reads, as it is drawn.
      const stack = variableStacks(tokens, tokenIdentity(token)).find(
        each => firstFamily(each) === key
      );
      if (stack === undefined) return [];
      return [
        {
          identity: tokenIdentity(token),
          label: tokenDisplayLabel(token),
          fallback: fallbackOf(stack) ?? BROWSER_FONT,
        },
      ];
    });
  // A role's own variable is said as the role, not a second time, and its
  // places still count: blocks may name it too.
  const held = new Set(
    roles.flatMap(role => fontRoleVariables(tokens, role, classes))
  );
  return {
    roles,
    variables: naming.filter(each => !held.has(each.identity)),
    counted: naming.map(each => each.identity),
  };
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
    roles.length === 1 ? `another ${which} font` : `other ${which} fonts`;
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

/**
 * What a font chosen for some roles leaves as it is, in words: the rows
 * following a text style keep drawing that style's font, as the Type tab
 * draws them. One sentence for each text style a role's rows follow,
 * "Heading 1 and Heading 2 follow the text style “Display”, so a headings
 * font doesn’t change them."; none where no row follows one.
 *
 * @param tokens - The site's variables and Site text
 * @param roles - The roles a font is, or would be, chosen for
 * @param classes - The site's classes, where the text styles rows follow are
 * @returns The sentences, role by role
 */
export function followedStyleWords(
  tokens: SiteTokenSet,
  roles: readonly FontRole[],
  classes: readonly NamedClass[] | undefined
): string[] {
  // The Type tab's own reading of which rows follow which style.
  const views = siteTextRowViews(tokens, "light", classes);
  const styles = new Map((classes ?? []).map(each => [each.id, each]));
  return roles.flatMap(role => {
    const rows = new Set<string>(fontRoleRows(role));
    const byStyle = new Map<string, string[]>();
    for (const view of views) {
      if (view.follows === undefined || !rows.has(view.role)) continue;
      if (!keepsItsFont(tokens, styles.get(view.follows.id), role)) continue;
      const labels = byStyle.get(view.follows.name) ?? [];
      byStyle.set(view.follows.name, [...labels, view.label]);
    }
    return [...byStyle].map(([style, labels]) => {
      const one = labels.length === 1;
      return `${listedWords(labels)} ${one ? "follows" : "follow"} the text style “${style}”, so a ${rolesWords([role])} font doesn’t change ${one ? "it" : "them"}.`;
    });
  });
}

/**
 * Whether a text style keeps its own font when `role`'s font is chosen: it
 * names one, and not one that reads the role's variable. A style naming no
 * font leaves the row's font to what it inherits, so nothing is promised.
 */
function keepsItsFont(
  tokens: SiteTokenSet,
  style: NamedClass | undefined,
  role: FontRole
): boolean {
  const font = style?.styles.base?.base?.fontFamily;
  return font !== undefined && !fontReadsRole(tokens, font, role);
}

/** The role's own name, as Design's Type tab labels it ("Body font"). */
export function roleLabel(role: FontRole): string {
  return FONT_ROLE_WORDS[role];
}
