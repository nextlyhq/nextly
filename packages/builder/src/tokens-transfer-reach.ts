/**
 * What of an import's text styles and Site text can land, judged against
 * the variables the merge actually takes. A file's variable can be refused
 * (a name another variable here holds under another id); a text style or
 * a row using it would then read nothing, and the site's guard refuses a
 * text style naming a variable it doesn't hold, which would refuse the
 * whole class save. So each is left out instead, the site's own row kept,
 * and named; the rest still land. So is a text style naming, by `$token`, a
 * variable neither the file nor the site holds, which the same guard
 * refuses.
 *
 * @module tokens-transfer-reach
 */
import {
  resolveSiteTokens,
  resolveTokenPrefix,
  SITE_TEXT_LABELS,
  SITE_TEXT_ROLES,
  siteTextUses,
  tokenCustomProperty,
  tokenIdentity,
  type DtcgSiteData,
  type NamedClass,
  type SiteTextMap,
  type SiteTextRole,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

import { sharedStyleName } from "./shared-style-library";
import type { ImportExtras } from "./tokens-transfer-extras";

/**
 * The import's extras without the text styles and Site text rows that use
 * one of the file's variables `merged` doesn't hold, nor the rows following
 * a text style left out; each named in `refused`.
 */
export function reachingVariables(
  extras: ImportExtras,
  incoming: readonly SiteToken[],
  merged: SiteTokenSet,
  refused: string[]
): ImportExtras {
  const prefix = resolveTokenPrefix(merged.prefix).prefix;
  const keys = (token: SiteToken): string[] => [
    tokenIdentity(token),
    tokenCustomProperty(tokenIdentity(token), prefix),
  ];
  // By identity: a property another variable here also writes doesn't
  // make the file's variable land.
  const landed = new Set(merged.tokens.map(tokenIdentity));
  const owners = new Map(
    incoming.flatMap(token => keys(token).map(key => [key, token] as const))
  );
  // The name of a variable of the file's that didn't land, for a key.
  const missing = (key: string): string | undefined => {
    const owner = owners.get(key);
    return owner === undefined || landed.has(tokenIdentity(owner))
      ? undefined
      : owner.name;
  };
  // Every variable the site will hold, its built-in ones included, as the
  // site's guard judges a text style's `$token` against them.
  const held = new Set(resolveSiteTokens(merged).tokens.map(tokenIdentity));
  // A `$token` naming no variable of the file's or the site's. A `var()`
  // property is CSS the site draws or not, and no guard judges it.
  const unknown = (key: string): boolean =>
    !key.startsWith("--") && !owners.has(key) && !held.has(key);
  const left = new Map<string, string>();
  const keep = (style: NamedClass): boolean => {
    const keys = keysUsed(style.styles);
    const name = keys.map(missing).find(found => found !== undefined);
    const nowhere = name === undefined ? keys.find(unknown) : undefined;
    if (name === undefined && nowhere === undefined) return true;
    left.set(style.id, sharedStyleName(style));
    refused.push(
      name === undefined
        ? `“${sharedStyleName(style)}” was not imported: a variable it uses, “${nowhere ?? ""}”, isn't on this site or in the file.`
        : `“${sharedStyleName(style)}” was not imported: a variable it uses, “${name}”, wasn't imported.`
    );
    return false;
  };
  const { textStyles } = extras;
  const kept = {
    added: textStyles.added.filter(keep),
    updated: textStyles.updated.filter(keep),
    unchanged: textStyles.unchanged,
  };
  const { site: before, ...rest } = extras;
  const site = rowsThatReach(before, missing, left, refused);
  return { ...rest, textStyles: kept, ...(site === undefined ? {} : { site }) };
}

/**
 * The site data without the rows that follow a text style left out
 * (`left`, by id) or use a variable that didn't land, each named.
 */
function rowsThatReach(
  site: DtcgSiteData | undefined,
  missing: (key: string) => string | undefined,
  left: ReadonlyMap<string, string>,
  refused: string[]
): DtcgSiteData | undefined {
  if (site?.siteText === undefined) return site;
  const why = reasonsByRow(site.siteText, missing, left);
  if (why.size === 0) return site;
  const rows: Record<string, unknown> = { ...site.siteText };
  for (const [role, reason] of why) {
    delete rows[role];
    refused.push(
      `Site text: ${SITE_TEXT_LABELS[role]} kept this site's own settings, because ${reason}.`
    );
  }
  const { siteText: _all, ...rest } = site;
  return Object.keys(rows).length === 0 ? rest : { ...rest, siteText: rows };
}

/** Why each row that can't land can't: the text style or the variable. */
function reasonsByRow(
  rows: SiteTextMap,
  missing: (key: string) => string | undefined,
  left: ReadonlyMap<string, string>
): Map<SiteTextRole, string> {
  const why = new Map<SiteTextRole, string>();
  for (const role of SITE_TEXT_ROLES) {
    const style = left.get(rows[role]?.textStyle ?? "");
    if (style === undefined) continue;
    why.set(
      role,
      `the text style it follows in the file, “${style}”, wasn't imported`
    );
  }
  for (const [key, roles] of siteTextUses(rows)) {
    const name = missing(key);
    if (name === undefined) continue;
    for (const role of roles.filter(entry => !why.has(entry))) {
      why.set(role, `a variable it uses, “${name}”, wasn't imported`);
    }
  }
  return why;
}

/** The variables a text style's values name: `$token` ids and `var()` properties. */
function keysUsed(value: unknown): string[] {
  if (typeof value === "string") {
    return [...value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map(
      match => match[1] ?? ""
    );
  }
  if (Array.isArray(value)) return value.flatMap(keysUsed);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key === "$token" && typeof entry === "string" ? [entry] : keysUsed(entry)
  );
}
