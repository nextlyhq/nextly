/**
 * A shared style's usage with the document open in the editor accounted for
 * apart: the route names what that document contributes as saved, so the
 * editor can count it from its live copy instead, and an unsaved edit is
 * counted at once without being counted twice.
 *
 * @module shared-style-usage-here
 */
import {
  SHARED_STYLE_HERE_PARAM,
  type SharedStyleUsage,
  type SharedStyleUsageHere,
  type SharedStyleUsageKind,
} from "./library-contract";
import { blockCountOf, documentCountOf, type DocumentsUsing } from "./usage-count";

/**
 * The open document a usage read names, from `here=<collection>/<id>` or
 * `here=single:<slug>`, or `undefined` when none is named or the value names
 * no document. Split at the first `/`, since a collection slug holds none.
 */
export function usageHereOf(url: string): SharedStyleUsageHere | undefined {
  const value = new URL(url).searchParams.get(SHARED_STYLE_HERE_PARAM);
  if (value === null) return undefined;
  if (value.startsWith(SINGLE_PREFIX)) {
    const single = value.slice(SINGLE_PREFIX.length);
    return single === "" ? undefined : { single };
  }
  const at = value.indexOf("/");
  if (at <= 0 || at === value.length - 1) return undefined;
  return { collection: value.slice(0, at), id: value.slice(at + 1) };
}

/**
 * One listing as a usage: its documents, the same by kind, and the blocks on
 * them. A floor when the listing is, or when any document's blocks are not
 * counted yet.
 */
export function usageOf(
  found: DocumentsUsing,
  kindOf: (collection: string) => SharedStyleUsageKind,
  here?: SharedStyleUsageHere
): SharedStyleUsage {
  const byKind: Record<SharedStyleUsageKind, number> = {
    pages: 0,
    components: 0,
    patterns: 0,
    layouts: 0,
  };
  for (const entry of found.collections) {
    byKind[kindOf(entry.collection)] += entry.documents.length;
  }
  const blocks = blockCountOf(found);
  return {
    documents: documentCountOf(found),
    byKind,
    ...(blocks === undefined ? {} : { blocks: blocks.blocks }),
    ...(here === undefined || blocks === undefined
      ? {}
      : { here: hereShare(found, kindOf, here) }),
    complete: found.complete && (blocks?.complete ?? true),
  };
}

/** How a Single is named in the parameter, before its slug. */
const SINGLE_PREFIX = "single:";

/** What the open document contributes as saved: 0 blocks when it holds none. */
function hereShare(
  found: DocumentsUsing,
  kindOf: (collection: string) => SharedStyleUsageKind,
  here: SharedStyleUsageHere
): NonNullable<SharedStyleUsage["here"]> {
  const single = "single" in here;
  const collection = single ? here.single : here.collection;
  const kind = kindOf(collection);
  for (const entry of found.collections) {
    if (entry.collection !== collection) continue;
    if ((entry.single === true) !== single) continue;
    // A Single's one document is listed with no id.
    const at = single ? 0 : entry.documents.indexOf(here.id);
    if (at < 0 || at >= entry.documents.length) continue;
    return { blocks: entry.blocks?.[at] ?? 0, kind };
  }
  return { blocks: 0, kind };
}
