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
  isPlainRecord,
  selectNodes,
  STYLE_STATES,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldIssue,
  PluginFieldValidateArgs,
} from "@nextlyhq/plugin-sdk";

import { readStoredJson } from "../stored-json";

// An update with a write behind it is exactly what the Layers lock is asked
// about too: the one case with a stored document to compare with.
import { addedUndefinedIds } from "./added-undefined-ids";
import { isTopLevel, judgesLayersLocks } from "./layers-lock-judgement";

/** The code a write bringing an undefined breakpoint is refused with. */
const REMOVED_BREAKPOINT = "removed-breakpoint";

/** What an author holding a stale editor is told. */
const REMOVED_BREAKPOINT_MESSAGE =
  "That breakpoint was removed from the site. Reload to keep editing.";

/**
 * The breakpoint ids a style envelope (states × breakpoints) stores under, in
 * the states the compiler writes: one it does not know is reported as such and
 * never written, whatever breakpoint it names.
 */
function addEnvelopeIds(styles: unknown, into: Set<string>): void {
  if (!isPlainRecord(styles)) return;
  for (const state of STYLE_STATES) {
    const byBreakpoint = styles[state];
    if (!isPlainRecord(byBreakpoint)) continue;
    for (const id of Object.keys(byBreakpoint)) into.add(id);
  }
}

/**
 * Every breakpoint id a stored blocks value keeps a style or a per-device
 * hide under: each read node's styles and `visibility.devices`, and the
 * document's own page styles. The base is left out, being every site's.
 *
 * The nodes are the ones the compiler reads, selected by the engine's own
 * walk within `limits`, so a node past the bounds is one nothing renders
 * from either. An unreadable value uses none.
 */
function breakpointIdsUsed(
  stored: unknown,
  limits: DocumentLimits = DEFAULT_LIMITS
): Set<string> {
  const ids = new Set<string>();
  const document = readStoredJson(stored);
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) return ids;
  for (const { node } of selectNodes(document, limits).nodes) {
    const read = node as { styles?: unknown; visibility?: unknown };
    addEnvelopeIds(read.styles, ids);
    const devices = isPlainRecord(read.visibility)
      ? read.visibility.devices
      : undefined;
    if (isPlainRecord(devices)) {
      for (const id of Object.keys(devices)) ids.add(id);
    }
  }
  const settings = document.settings;
  if (isPlainRecord(settings)) addEnvelopeIds(settings.styles, ids);
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
  }
): Promise<PluginFieldIssue[]> {
  if (!judgesLayersLocks(args) || !isTopLevel(args.path)) return [];
  const limits = site.limits ?? DEFAULT_LIMITS;
  const added = await addedUndefinedIds(
    args,
    [...breakpointIdsUsed(value, limits)],
    site.breakpointIds,
    form => breakpointIdsUsed(form, limits)
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
