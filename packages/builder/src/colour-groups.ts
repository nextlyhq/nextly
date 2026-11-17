/**
 * The site's colours in named groups and in the order its authors put them:
 * what the Design panel's Colours tab lists, what every colour picker lists,
 * and the moves that change them.
 *
 * Display only. A colour's group is a label, as its name is, and the order is
 * a list of identities on the set. Neither reaches the site's CSS or changes a
 * code name, so a colour moved anywhere is the same variable it was.
 *
 * Pure, so the order the panel and the pickers show is one answer, tested
 * apart from either.
 *
 * @module colour-groups
 */
import {
  tokenIdentity,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

/** What a group is called where no colour before it names one. */
const DEFAULT_COLOUR_GROUP = "Colours";

/** One named group and its colours, by identity, in order. */
export interface ColourGroup {
  readonly name: string;
  readonly identities: readonly string[];
}

function isColour(token: SiteToken): boolean {
  return token.kind === "color";
}

/**
 * The site's colours, by identity, in the order they are listed: those the
 * site's order names first, in that order, then the rest in the set's own
 * order. An identity the order names that the site no longer has is skipped.
 */
export function colourOrder(tokens: SiteTokenSet | undefined): string[] {
  const colours = (tokens?.tokens ?? []).filter(isColour).map(tokenIdentity);
  const present = new Set(colours);
  const named = (tokens?.order ?? []).filter(identity => present.has(identity));
  const first = new Set(named);
  return [...new Set([...named, ...colours.filter(id => !first.has(id))])];
}

/**
 * The colours in their groups, in order. A colour's group is its own, else
 * the group of the colour before it, so a colour added with none joins the
 * group it is listed in. Groups are listed in the order their colours are.
 */
export function colourGroups(tokens: SiteTokenSet | undefined): ColourGroup[] {
  const byIdentity = new Map(
    (tokens?.tokens ?? []).map(token => [tokenIdentity(token), token])
  );
  const groups: { name: string; identities: string[] }[] = [];
  let current = DEFAULT_COLOUR_GROUP;
  for (const identity of colourOrder(tokens)) {
    const own = byIdentity.get(identity)?.group;
    current = own ?? current;
    const group =
      groups.find(candidate => candidate.name === current) ??
      pushed(groups, { name: current, identities: [] });
    group.identities.push(identity);
  }
  return groups;
}

function pushed<T>(list: T[], item: T): T {
  list.push(item);
  return item;
}

/**
 * The set laid out as the groups say: each colour carries the group it is
 * listed in, written only where it differs, and the order is every colour in
 * turn. Nothing but those display fields changes.
 */
function laidOut(
  tokens: SiteTokenSet,
  groups: readonly ColourGroup[]
): SiteTokenSet {
  const groupOf = new Map<string, string>();
  for (const group of groups) {
    for (const identity of group.identities) groupOf.set(identity, group.name);
  }
  return {
    ...tokens,
    tokens: tokens.tokens.map(token => {
      const group = isColour(token)
        ? groupOf.get(tokenIdentity(token))
        : undefined;
      return group === undefined || token.group === group
        ? token
        : { ...token, group };
    }),
    order: groups.flatMap(group => group.identities),
  };
}

/** Where a colour is listed: its group's place and its own within it. */
function placeOf(
  groups: readonly ColourGroup[],
  identity: string
): { group: number; at: number } | undefined {
  for (const [group, candidate] of groups.entries()) {
    const at = candidate.identities.indexOf(identity);
    if (at !== -1) return { group, at };
  }
  return undefined;
}

/** The groups with one colour taken out. */
function without(
  groups: readonly ColourGroup[],
  identity: string
): ColourGroup[] {
  return groups.map(group => ({
    ...group,
    identities: group.identities.filter(id => id !== identity),
  }));
}

/** The groups with a colour put into one of them at a place. */
function inserted(
  groups: readonly ColourGroup[],
  identity: string,
  group: number,
  at: number
): ColourGroup[] {
  return groups.map((candidate, index) =>
    index === group
      ? {
          ...candidate,
          identities: [
            ...candidate.identities.slice(0, at),
            identity,
            ...candidate.identities.slice(at),
          ],
        }
      : candidate
  );
}

/**
 * The set with a colour moved one place up (-1) or down (1). Past the top
 * of its group it joins the end of the group above, and past the end the
 * start of the group below; at the very top or end the set is returned as
 * it was.
 */
export function moveColour(
  tokens: SiteTokenSet,
  identity: string,
  by: -1 | 1
): SiteTokenSet {
  const groups = colourGroups(tokens);
  const place = placeOf(groups, identity);
  if (place === undefined) return tokens;
  const size = groups[place.group]?.identities.length ?? 0;
  const at = place.at + by;
  const rest = without(groups, identity);
  if (at >= 0 && at < size) {
    return laidOut(tokens, inserted(rest, identity, place.group, at));
  }
  const next = place.group + by;
  const target = rest[next];
  if (target === undefined) return tokens;
  return laidOut(
    tokens,
    inserted(rest, identity, next, by === -1 ? target.identities.length : 0)
  );
}

/** The set with a colour moved to the end of a group. */
export function moveColourToGroup(
  tokens: SiteTokenSet,
  identity: string,
  group: string
): SiteTokenSet {
  return placeColour(tokens, identity, group, undefined);
}

/**
 * The set with a colour put into a group: before another colour in it, as a
 * drag drops it on that colour's row, or at its end where `before` is
 * absent. A group no colour is in yet is made with this one in it.
 */
export function placeColour(
  tokens: SiteTokenSet,
  identity: string,
  group: string,
  before: string | undefined
): SiteTokenSet {
  const groups = colourGroups(tokens);
  if (before === identity || placeOf(groups, identity) === undefined) {
    return tokens;
  }
  const rest = without(groups, identity);
  const index = rest.findIndex(candidate => candidate.name === group);
  const target =
    index === -1 ? [...rest, { name: group, identities: [] }] : rest;
  const at = index === -1 ? target.length - 1 : index;
  const members = target[at]?.identities ?? [];
  const position = before === undefined ? -1 : members.indexOf(before);
  return laidOut(
    tokens,
    inserted(target, identity, at, position === -1 ? members.length : position)
  );
}

/** The set with a group renamed on every colour listed in it. */
export function renameColourGroup(
  tokens: SiteTokenSet,
  from: string,
  to: string
): SiteTokenSet {
  const groups = colourGroups(tokens);
  if (!groups.some(group => group.name === from)) return tokens;
  return laidOut(
    tokens,
    groups.map(group => (group.name === from ? { ...group, name: to } : group))
  );
}

/**
 * The set with a group gone, its colours joining the end of the group above,
 * or the start of the group below where it is the first. The only group is
 * left in place, since a colour is always listed in one.
 */
export function removeColourGroup(
  tokens: SiteTokenSet,
  name: string
): SiteTokenSet {
  const groups = colourGroups(tokens);
  const index = groups.findIndex(group => group.name === name);
  const removed = groups[index];
  if (removed === undefined || groups.length < 2) return tokens;
  const into = index === 0 ? 1 : index - 1;
  const merged = groups.map((group, at) => {
    if (at !== into) return group;
    return {
      ...group,
      identities:
        index === 0
          ? [...removed.identities, ...group.identities]
          : [...group.identities, ...removed.identities],
    };
  });
  return laidOut(
    tokens,
    merged.filter((_, at) => at !== index)
  );
}
