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

import type { HostStep, StoredForm } from "../host-rewrite/contract";
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
 *
 * With `defined`, the breakpoint ids the site defines now, an id defined again
 * since the run removed it is left out: its values are under a breakpoint the
 * site emits again, so they are the site's own, and the run strips only the
 * ids still removed.
 */
export function removalOf(
  run: Pick<BreakpointRun, "removedIds" | "before" | "beforeEmitted">,
  defaults: SiteStyleData | undefined,
  defined?: ReadonlySet<string>
): Removal {
  // The set as the run recorded it when it began: the configured defaults
  // may have changed since, and a hide is carried under the cascade that was
  // in force then. Resolved now only for a run that recorded none.
  const emitted = checkStoredBreakpoints(run.beforeEmitted).value;
  return {
    ids: new Set(
      run.removedIds.filter(id => defined === undefined || !defined.has(id))
    ),
    before: emitted ?? emittedBreakpoints(run.before, defaults),
  };
}

/**
 * The breakpoints the stylesheet is emitted under for a stored set: the stored
 * set over the configured defaults, which a stored `null` gives back.
 */
export function emittedBreakpoints(
  stored: unknown,
  defaults: SiteStyleData | undefined
): BreakpointSet | undefined {
  const set = checkStoredBreakpoints(stored).value;
  return siteBreakpoints(
    resolveSiteStyle(defaults, { breakpoints: set ?? undefined })
  );
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
 * What a strip took out of one style envelope: per state the engine knows,
 * each removed breakpoint's value as it was stored.
 */
export type RemovedStyles = Record<string, Record<string, unknown>>;

/**
 * A style envelope split at the removed breakpoints, in every state the
 * compiler writes: what stays (the same value when it holds none of them, so
 * an untouched envelope is the same object; a state left with nothing is
 * dropped) and what was taken out, `undefined` when nothing was.
 */
function splitEnvelope(
  styles: unknown,
  ids: ReadonlySet<string>
): { kept: unknown; removed: RemovedStyles | undefined } {
  if (!isPlainRecord(styles)) return { kept: styles, removed: undefined };
  let next: Record<string, unknown> | undefined;
  let removed: RemovedStyles | undefined;
  for (const state of STYLE_STATES) {
    const byBreakpoint = styles[state];
    if (!isPlainRecord(byBreakpoint)) continue;
    const held = [...ids].filter(id => Object.hasOwn(byBreakpoint, id));
    if (held.length === 0) continue;
    const kept: Record<string, unknown> = { ...byBreakpoint };
    removed ??= {};
    // Without a prototype, so an id of `__proto__` is an own key.
    removed[state] = Object.create(null) as Record<string, unknown>;
    for (const id of held) {
      removed[state][id] = byBreakpoint[id];
      delete kept[id];
    }
    next ??= { ...styles };
    if (Object.keys(kept).length === 0) delete next[state];
    else next[state] = kept;
  }
  return { kept: next ?? styles, removed };
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

/**
 * What a strip took out of one block: its style values under the removed
 * breakpoints, and, when its hides were carried, its visibility before and
 * after, so an undo can tell whether it still stands as the strip left it.
 */
export interface NodeFragment {
  readonly styles?: RemovedStyles;
  readonly visibility?: { readonly before: unknown; readonly after: unknown };
}

/**
 * What a strip took out of one stored document: each block's, by its id, and
 * the page's own settings' style values. What an undo puts back.
 */
export interface DocumentFragment {
  readonly nodes: Readonly<Record<string, NodeFragment>>;
  readonly settingsStyles?: RemovedStyles;
}

/**
 * One block split at the removed breakpoints: the block without what it
 * keeps under them, and what that was; the same block, and no fragment, when
 * it keeps nothing there.
 */
function splitNode(
  node: BlockNode,
  removal: Removal,
  kept: BreakpointSet | undefined
): { node: BlockNode; fragment: NodeFragment | undefined } {
  const styles = splitEnvelope(node.styles, removal.ids);
  const hides = hidesUnder(node.visibility, removal.ids);
  if (styles.removed === undefined && !hides) {
    return { node, fragment: undefined };
  }
  const next: Record<string, unknown> = { ...node };
  let fragment: NodeFragment = {};
  if (styles.removed !== undefined) {
    fragment = { styles: styles.removed };
    if (isPlainRecord(styles.kept) && Object.keys(styles.kept).length === 0) {
      delete next.styles;
    } else {
      next.styles = styles.kept;
    }
  }
  if (hides) {
    const visibility = carriedVisibility(node.visibility, removal, kept);
    fragment = {
      ...fragment,
      visibility: { before: node.visibility, after: visibility },
    };
    if (visibility === undefined) delete next.visibility;
    else next.visibility = visibility;
  }
  return { node: next as unknown as BlockNode, fragment };
}

/**
 * A document split at the removed breakpoints: the document without what it
 * keeps under them (every block's styles and own hides, slots included, and
 * its own settings' styles; the same document when it keeps nothing there),
 * and what was taken out, `undefined` when nothing was.
 */
export function splitDocument(
  document: BlockDocument,
  removal: Removal
): { document: BlockDocument; fragment: DocumentFragment | undefined } {
  if (removal.ids.size === 0) return { document, fragment: undefined };
  const kept = keptOf(removal);
  // Without a prototype, so a block whose id is `__proto__` is an own key.
  const nodeFragments = Object.create(null) as Record<string, NodeFragment>;
  let changed = false;
  const nodes = mapForest(document.nodes, node => {
    const split = splitNode(node, removal, kept);
    if (split.fragment !== undefined) {
      changed = true;
      nodeFragments[node.id] = split.fragment;
    }
    return split.node;
  });
  const settings: unknown = document.settings;
  let nextSettings = settings;
  let settingsStyles: RemovedStyles | undefined;
  if (isPlainRecord(settings)) {
    const split = splitEnvelope(settings.styles, removal.ids);
    if (split.removed !== undefined) {
      settingsStyles = split.removed;
      nextSettings = { ...settings, styles: split.kept };
    }
  }
  if (!changed && settingsStyles === undefined) {
    return { document, fragment: undefined };
  }
  return {
    document: {
      ...document,
      nodes: changed ? nodes : document.nodes,
      ...(nextSettings === settings
        ? {}
        : { settings: nextSettings as BlockDocument["settings"] }),
    },
    fragment: {
      nodes: nodeFragments,
      ...(settingsStyles === undefined ? {} : { settingsStyles }),
    },
  };
}

/** A document without what it keeps under the removed breakpoints (`splitDocument`). */
export function stripDocument(
  document: BlockDocument,
  removal: Removal
): BlockDocument {
  return splitDocument(document, removal).document;
}

/**
 * One stored shared style without its values under the removed breakpoints;
 * the same entry when it holds none. Its `styles` stays, possibly empty, as
 * every shared style has one.
 */
export function stripClass(entry: unknown, ids: ReadonlySet<string>): unknown {
  return splitClass(entry, ids).entry;
}

/**
 * One stored shared style split at the removed breakpoints: the entry without
 * its values under them (the same entry when it holds none), and those values.
 */
export function splitClass(
  entry: unknown,
  ids: ReadonlySet<string>
): { entry: unknown; removed: RemovedStyles | undefined } {
  if (!isPlainRecord(entry)) return { entry, removed: undefined };
  const split = splitEnvelope(entry.styles, ids);
  return split.removed === undefined
    ? { entry, removed: undefined }
    : { entry: { ...entry, styles: split.kept }, removed: split.removed };
}

/** Whether a stored value is a document: a record holding a list of nodes. */
export function isDocument(value: unknown): value is BlockDocument {
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
export function stripBreakpointsStep(
  removal: Removal,
  /** Told what each value it rewrites loses, so that can be kept. */
  remember?: (form: StoredForm, fragment: DocumentFragment) => void
): HostStep {
  return (doc, form) => {
    const document = readStoredJson(doc);
    if (!isDocument(document)) return { kind: "unchanged" };
    if (removedIdsIn(document, removal.ids).size === 0) {
      return { kind: "unchanged" };
    }
    if (documentRefusal(document) !== undefined) {
      return { kind: "refuse", reason: UNREADABLE_VALUE };
    }
    const split = splitDocument(document, removal);
    if (split.fragment === undefined) return { kind: "unchanged" };
    remember?.(form, split.fragment);
    return { kind: "rewritten", value: split.document };
  };
}
