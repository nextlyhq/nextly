/**
 * A blocks field's write, judged against the breakpoints the site defines.
 *
 * A style or a per-device hide is stored under a breakpoint id, and the
 * compiler emits only the ids the site defines: anything stored under another
 * is reported and left unwritten. A page cannot be refused for holding such
 * values, because a breakpoint removed from the site leaves every page that
 * styled at it holding them, and refusing those pages would make them
 * unsavable for a change nobody made to them. The write path can tell a value
 * the page already held from one this write brings, by comparing with the
 * stored forms, so a write that brings an id the site does not define, and
 * that neither stored form holds, is refused.
 *
 * That is the case of an editor opened before the breakpoint was removed: it
 * still offers the device, and what it saves there would never reach the page.
 * The author is told to reload, which shows them the site's breakpoints as
 * they are now.
 *
 * Judged by id, as shared styles are: a page already holding values under a
 * removed id may still be edited and saved, its blocks duplicated with them,
 * without each of those values being weighed on its own.
 *
 * @module fields/breakpoint-reference-judgement
 */
import {
  BASE_BREAKPOINT,
  DEFAULT_LIMITS,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldIssue,
  PluginFieldValidateArgs,
} from "@nextlyhq/plugin-sdk";

import { breakpointUsesIn } from "../breakpoint-removal/usage";

import { addedUndefinedIds, type StoredForms } from "./added-undefined-ids";
// An update with a write behind it is exactly what the Layers lock is asked
// about too: the one case with a stored document to compare with.
import { isTopLevel, judgesLayersLocks } from "./layers-lock-judgement";

/** The code a write bringing an undefined breakpoint is refused with. */
const REMOVED_BREAKPOINT = "removed-breakpoint";

/** What an author holding a stale editor is told. */
const REMOVED_BREAKPOINT_MESSAGE =
  "That breakpoint was removed from the site. Reload to keep editing.";

/**
 * Every breakpoint id a stored blocks value keeps a style or a per-device
 * hide under, read by the one reader every count of a site's breakpoints
 * shares (`breakpoint-removal/usage`), so this check and a removal's count
 * agree on what a page uses. The base is left out, being every site's.
 */
function breakpointIdsUsed(
  stored: unknown,
  limits: DocumentLimits = DEFAULT_LIMITS
): Set<string> {
  const ids = new Set(breakpointUsesIn(stored, "every", limits).uses.keys());
  ids.delete(BASE_BREAKPOINT);
  return ids;
}

/**
 * The issue a write bringing a breakpoint the site does not define is refused
 * with; empty when it brings none, or when it cannot be judged.
 *
 * The site's breakpoints are read only when the value uses one, and the
 * stored forms only when one of those is undefined, so an ordinary save pays
 * nothing more. A value with no entry write behind it, and a field whose
 * stored value cannot be read (inside a group or repeater, or a language not
 * ready), are not judged: nothing tells a new value from an old one.
 *
 * Nor is a write made inside a transaction, for the reason given where it
 * returns; an editor's own save is never one.
 *
 * Nor is a create. It has no stored form to compare with, so every value it
 * holds would read as brought by it: a copy of a page holding values under a
 * breakpoint long removed would be refused for what the original holds. An
 * editor opened before a removal saves an entry that exists, as an update.
 */
export async function newBreakpointIssues(
  value: unknown,
  args: PluginFieldValidateArgs,
  label: string,
  site: {
    /** The ids the site's stylesheet is emitted under, the base included. */
    readonly breakpointIds: () => Promise<ReadonlySet<string>>;
    readonly limits?: DocumentLimits;
    /** The page's stored forms, shared by every check of one write. */
    readonly storedForms?: () => Promise<StoredForms>;
  }
): Promise<PluginFieldIssue[]> {
  if (!judgesLayersLocks(args) || !isTopLevel(args.path)) return [];
  // The site's breakpoints are read through the pool, which inside a
  // transaction is another connection: it can wait behind the one the
  // transaction holds, and nothing a validation is handed reads the site's
  // Single on the transaction's own. So a write in a transaction (an action
  // route, a batch, an import) is not judged here; an editor's save is not
  // made in one.
  if (args.write?.inTransaction === true) return [];
  const limits = site.limits ?? DEFAULT_LIMITS;
  const added = await addedUndefinedIds(
    args,
    [...breakpointIdsUsed(value, limits)],
    site.breakpointIds,
    form => breakpointIdsUsed(form, limits),
    site.storedForms
  );
  if (added.length === 0) return [];
  return [
    {
      path: args.path,
      code: REMOVED_BREAKPOINT,
      message: `${label}: ${REMOVED_BREAKPOINT_MESSAGE}`,
    },
  ];
}
