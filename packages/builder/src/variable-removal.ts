/**
 * What Remove and Reset act on for one variable's row: the stored variables
 * behind it (a type size and its line height are one row), which of them the
 * site's code supplies, and what Remove may do under the usage read. Shared
 * by the variable's editor and its row's ⋯ menu, so both offer the same
 * actions on the same parts.
 *
 * @module variable-removal
 */
import {
  sameSiteToken,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

import { VARIABLE_LOSS_WORDS } from "./editor-words";
import { removeToken, type VariableEntry } from "./tokens-studio";
import {
  variableRemoval,
  type VariableReach,
  type VariableRemoval,
} from "./variable-usage";
import type { VariableUsageHere } from "./variable-usage-view";

/** What Reset and Remove act on, and what Remove may do. */
export interface RemovalPlan {
  /** The halves the site's code supplies that the author changed. */
  readonly changed: readonly Part[];
  /** The halves the site added, which Remove takes away. */
  readonly removable: readonly Part[];
  /** What the confirm names: the variable, or the half that goes. */
  readonly what: string;
  /**
   * What the refusal names: the variable, or the half that goes, as its
   * heading says it ("Body's line height").
   */
  readonly named: string;
  /** What the places would lose, by what goes: "colour", "line height". */
  readonly loss: string;
  /** Remove's own words: "Remove", or "Remove line height". */
  readonly label: string;
  /** The usage that gates Remove, where the host reads it. */
  readonly gate: VariableUsageHere | undefined;
  /**
   * How widely what Remove takes away is used, together: a type size and
   * its line height when both go, so either one in use refuses.
   */
  readonly reach: VariableReach | undefined;
  readonly removal: VariableRemoval;
}

/** The plan for an entry's halves, under the usage the host read. */
export function removalPlan(
  entry: VariableEntry,
  parts: readonly Part[],
  usage: VariableUsageHere | undefined
): RemovalPlan {
  const changed = parts.filter(
    part =>
      part.from !== undefined &&
      (part.held === undefined || !sameSiteToken(part.held, part.from))
  );
  const removable = parts.filter(part => part.from === undefined);
  const gate = removable.length === 0 ? undefined : usage;
  const reach =
    gate === undefined
      ? undefined
      : gate.reachTogether(removable.map(part => part.identity));
  // The whole variable when every half is the site's own; otherwise only the
  // half that is, named, since the other stays.
  const halves = removable.map(part => part.name).join(" and ");
  const whole = removable.length === parts.length;
  const [alone] = removable;
  return {
    changed,
    removable,
    what: whole ? entry.label : `${halves} of ${entry.label}`,
    named: whole ? entry.label : `${entry.label}'s ${halves}`,
    // A half going on its own loses what that half is; the whole, what the
    // variable's kind is.
    loss:
      !whole && removable.length === 1 && alone !== undefined
        ? alone.loss
        : VARIABLE_LOSS_WORDS[entry.row.kind],
    label: whole ? "Remove" : `Remove ${halves}`,
    gate,
    reach,
    removal: variableRemoval(reach),
  };
}

/** The set with each changed half put back to what the site's code supplies. */
export function resetParts(
  tokens: SiteTokenSet,
  changed: readonly Part[]
): SiteTokenSet {
  const next = [...tokens.tokens];
  for (const part of changed) {
    if (part.from !== undefined) next[part.at] = part.from;
  }
  return { ...tokens, tokens: next };
}

/** One stored variable behind an entry, with what the site's code supplies. */
export interface Part {
  name: string;
  /** The variable's identity, which its usage is read by. */
  identity: string;
  /** What a place would lose with this part alone. */
  loss: string;
  at: number;
  held: SiteToken | undefined;
  from: SiteToken | undefined;
}

/**
 * The variables behind an entry: the row and, for a type size, its line
 * height, which has no row of its own and is acted on from here or nowhere.
 */
export function partsOf(
  entry: VariableEntry,
  token: SiteToken,
  tokens: SiteTokenSet,
  suppliedOf: (identity: string) => SiteToken | undefined
): Part[] {
  const own: Part = {
    name: "size",
    identity: entry.row.identity,
    loss: VARIABLE_LOSS_WORDS[entry.row.kind],
    at: entry.row.at,
    held: token,
    from: suppliedOf(entry.row.identity),
  };
  if (entry.lineHeight === undefined) return [own];
  return [
    own,
    {
      name: "line height",
      identity: entry.lineHeight.identity,
      loss: VARIABLE_LOSS_WORDS.lineHeight,
      at: entry.lineHeight.at,
      held: tokens.tokens[entry.lineHeight.at],
      from: suppliedOf(entry.lineHeight.identity),
    },
  ];
}

/** The set without these variables, the later positions first. */
export function withoutParts(
  tokens: SiteTokenSet,
  parts: readonly Part[]
): SiteTokenSet {
  return parts
    .map(part => part.at)
    .sort((a, b) => b - a)
    .reduce(removeToken, tokens);
}
