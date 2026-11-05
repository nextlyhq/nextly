/**
 * What removing breakpoints does to a stored value: every style and own
 * per-device hide stored under a removed breakpoint goes, and nothing else
 * changes.
 *
 * Stripped exactly where `usage` counts (each block's `styles` per state and
 * its own `visibility.devices`, slot content included, and the page's own
 * `settings.styles`), so what a removal's confirmation counts is what it
 * drops. A hide is carried rather than deleted: the devices narrower than a
 * removed breakpoint keep what they showed, by the engine's own carry
 * (`carryDeviceVisibility`), so removing a breakpoint changes no device the
 * site still has. A breakpoint added later under the same id then starts
 * empty, which is the point of stripping rather than leaving values the
 * compiler merely skips.
 *
 * The step a removal's walk rewrites each host with, and the form a Layers
 * or `contentOnly` lock, or a locked shared style, accepts while the removal
 * is open (`lock-acceptance`): both are this module, so they cannot disagree
 * about what the strip of a stored value is.
 *
 * @module breakpoint-removal/strip
 * @experimental
 */
import {
  carryDeviceVisibility,
  documentRefusal,
  isPlainRecord,
  mapForest,
  STYLE_STATES,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";

import type { HostStep } from "../host-rewrite/contract";
import {
  resolveSiteStyle,
  siteBreakpoints,
  type SiteStyleData,
} from "../site-style";
import { checkStoredBreakpoints } from "../site-style-record";
import { readStoredJson } from "../stored-json";

import type { BreakpointRun } from "./run-store";

/** One removal, as stripping needs it. */
export interface Removal {
  /** The breakpoint ids removed. */
  readonly ids: ReadonlySet<string>;
  /**
   * The site's breakpoints before the removal, as the stylesheet was emitted
   * under them: what a hide is carried from.
   */
  readonly before: BreakpointSet | undefined;
}

/**
 * A run's removal: its ids, and the set it removed them from, resolved as the
 * site resolved it then (the stored set over the configured defaults, which
 * a stored `null` gives back).
 */
export function removalOf(
  run: Pick<BreakpointRun, "removedIds" | "before">,
  defaults: SiteStyleData | undefined
): Removal {
  const stored = checkStoredBreakpoints(run.before).value;
  return {
    ids: new Set(run.removedIds),
    before: siteBreakpoints(
      resolveSiteStyle(defaults, { breakpoints: stored ?? undefined })
    ),
  };
}

/** The set `before` with the removed breakpoints left out. */
function keptOf(removal: Removal): BreakpointSet | undefined {
  const { before, ids } = removal;
  if (before === undefined) return undefined;
  return {
    viewport: before.viewport.filter(def => !ids.has(def.id)),
    container: before.container.filter(def => !ids.has(def.id)),
  };
}

/**
 * A style envelope without the removed breakpoints, in every state the
 * compiler writes: the same value when it holds none of them, so an untouched
 * envelope is the same object. A state left with nothing is dropped.
 */
function strippedEnvelope(styles: unknown, ids: ReadonlySet<string>): unknown {
  if (!isPlainRecord(styles)) return styles;
  let next: Record<string, unknown> | undefined;
  for (const state of STYLE_STATES) {
    const byBreakpoint = styles[state];
    if (!isPlainRecord(byBreakpoint)) continue;
    const held = [...ids].filter(id => Object.hasOwn(byBreakpoint, id));
    if (held.length === 0) continue;
    const kept: Record<string, unknown> = { ...byBreakpoint };
    for (const id of held) delete kept[id];
    next ??= { ...styles };
    if (Object.keys(kept).length === 0) delete next[state];
    else next[state] = kept;
  }
  return next ?? styles;
}

/** Whether a stored visibility keeps a per-device value under a removed id. */
function hidesUnder(visibility: unknown, ids: ReadonlySet<string>): boolean {
  if (!isPlainRecord(visibility)) return false;
  const devices = visibility.devices;
  return (
    isPlainRecord(devices) && [...ids].some(id => Object.hasOwn(devices, id))
  );
}

/**
 * A block's visibility carried past the removal: each remaining device shows
 * what it showed, and nothing is left under a removed id, whatever was stored
 * there (a value the carry would keep as foreign included).
 */
function carriedVisibility(
  visibility: unknown,
  removal: Removal,
  kept: BreakpointSet | undefined
): unknown {
  const carried = carryDeviceVisibility(visibility, removal.before, kept);
  if (!isPlainRecord(carried) || !isPlainRecord(carried.devices)) {
    return carried;
  }
  const devices: Record<string, unknown> = { ...carried.devices };
  for (const id of removal.ids) delete devices[id];
  return { ...carried, devices };
}

/** One block without what it keeps under the removed breakpoints. */
function strippedNode(
  node: BlockNode,
  removal: Removal,
  kept: BreakpointSet | undefined
): BlockNode {
  const styles = strippedEnvelope(node.styles, removal.ids);
  const hides = hidesUnder(node.visibility, removal.ids);
  if (styles === node.styles && !hides) return node;
  const next: Record<string, unknown> = { ...node };
  if (styles !== node.styles) {
    if (isPlainRecord(styles) && Object.keys(styles).length === 0) {
      delete next.styles;
    } else {
      next.styles = styles;
    }
  }
  if (hides) {
    const visibility = carriedVisibility(node.visibility, removal, kept);
    if (visibility === undefined) delete next.visibility;
    else next.visibility = visibility;
  }
  return next as unknown as BlockNode;
}

/**
 * A document without what it keeps under the removed breakpoints: every
 * block's styles and own hides, slots included, and its own settings'
 * styles. The same document when it keeps nothing there.
 */
export function stripDocument(
  document: BlockDocument,
  removal: Removal
): BlockDocument {
  if (removal.ids.size === 0) return document;
  const kept = keptOf(removal);
  let changed = false;
  const nodes = mapForest(document.nodes, node => {
    const next = strippedNode(node, removal, kept);
    if (next !== node) changed = true;
    return next;
  });
  const settings: unknown = document.settings;
  let nextSettings = settings;
  if (isPlainRecord(settings)) {
    const styles = strippedEnvelope(settings.styles, removal.ids);
    if (styles !== settings.styles) nextSettings = { ...settings, styles };
  }
  if (!changed && nextSettings === settings) return document;
  return {
    ...document,
    nodes: changed ? nodes : document.nodes,
    ...(nextSettings === settings
      ? {}
      : { settings: nextSettings as BlockDocument["settings"] }),
  };
}

/**
 * One stored shared style without its values under the removed breakpoints;
 * the same entry when it holds none. Its `styles` stays, possibly empty, as
 * every shared style has one.
 */
export function stripClass(entry: unknown, ids: ReadonlySet<string>): unknown {
  if (!isPlainRecord(entry)) return entry;
  const styles = strippedEnvelope(entry.styles, ids);
  return styles === entry.styles ? entry : { ...entry, styles };
}

/**
 * The stored shared styles without their values under the removed
 * breakpoints; the same list when none holds any.
 */
export function stripClasses(
  classes: readonly unknown[],
  ids: ReadonlySet<string>
): readonly unknown[] {
  const next = classes.map(entry => stripClass(entry, ids));
  return next.some((entry, index) => entry !== classes[index]) ? next : classes;
}

/** Whether a stored value is a document: a record holding a list of nodes. */
function isDocument(value: unknown): value is BlockDocument {
  return isPlainRecord(value) && Array.isArray(value.nodes);
}

/**
 * The removed ids a stored value keeps anything under, read structurally: any
 * own key equal to one, under a block's styles in a state the engine knows,
 * its `visibility.devices`, or the page's own `settings.styles`, whatever the
 * value there and wherever the block sits. Not the removal's count, which
 * counts only what the compiler would write: a value it skips is still one a
 * breakpoint defined again would find, so it is stripped too.
 */
export function removedIdsIn(
  stored: unknown,
  ids: ReadonlySet<string>
): ReadonlySet<string> {
  const found = new Set<string>();
  const document = readStoredJson(stored);
  if (ids.size === 0 || !isDocument(document)) return found;
  const envelope = (styles: unknown) => {
    if (!isPlainRecord(styles)) return;
    for (const state of STYLE_STATES) {
      const byBreakpoint = styles[state];
      if (!isPlainRecord(byBreakpoint)) continue;
      for (const id of ids) if (Object.hasOwn(byBreakpoint, id)) found.add(id);
    }
  };
  // The tree as the strip rebuilds it, so the two read the same blocks.
  mapForest(document.nodes, node => {
    envelope(node.styles);
    const visibility: unknown = node.visibility;
    if (isPlainRecord(visibility) && isPlainRecord(visibility.devices)) {
      const devices = visibility.devices;
      for (const id of ids) if (Object.hasOwn(devices, id)) found.add(id);
    }
    return node;
  });
  const settings: unknown = document.settings;
  if (isPlainRecord(settings)) envelope(settings.styles);
  return found;
}

/** Why a value this version cannot interpret is left as it is. */
const UNREADABLE_VALUE =
  "This content was saved by a different version of the page builder, so the styles under the removed breakpoints were left in it. Open it in the editor and save it again.";

/**
 * The step a removal's walk rewrites every host with: the stored value
 * stripped, `unchanged` when it keeps nothing under the removed breakpoints,
 * which makes it idempotent. Decided structurally, every block and every value
 * under a removed id included, so nothing is left under one. A value this
 * version cannot interpret (an unknown format or kind, a broken envelope) is
 * refused and left when it keeps anything there, never stripped in part.
 */
export function stripBreakpointsStep(removal: Removal): HostStep {
  return doc => {
    const document = readStoredJson(doc);
    if (!isDocument(document)) return { kind: "unchanged" };
    if (removedIdsIn(document, removal.ids).size === 0) {
      return { kind: "unchanged" };
    }
    if (documentRefusal(document) !== undefined) {
      return { kind: "refuse", reason: UNREADABLE_VALUE };
    }
    const stripped = stripDocument(document, removal);
    return stripped === document
      ? { kind: "unchanged" }
      : { kind: "rewritten", value: stripped };
  };
}
