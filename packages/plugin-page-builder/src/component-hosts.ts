/**
 * Who places a component, read from the component usage index.
 *
 * A component save is judged inside the documents that use it, and the index
 * is how those are found. It is a hint rather than a boundary: it is maintained
 * after commit, a backfill may not have walked every document yet, and some
 * content — a nested blocks field — it cannot index at all. So the
 * answer says whether it is the whole list, from the same health reading the
 * usage counts use, and a caller treats a partial list as partial.
 *
 * @module component-hosts
 */
import { componentUsageIndex } from "./component-usage";
import type { HostFinder, HostRef } from "./fields/blocks-composition";
import { chunked } from "./id-batches";
import { lastIdOf } from "./paged-walk";
import type { UsageRowReader } from "./usage-count";
import type { UsageIndexHealth } from "./usage-index-health";
import { indexIsWhole } from "./usage-index-health";

/**
 * How many index rows one component's lookup reads before calling the list a
 * floor. A row is a (document, field, locale, form), so this is a few thousand
 * documents at most — far past what one save judges.
 */
const MOST_ROWS = 5000;

/** A finder over the component usage index. */
export function indexHostFinder(args: {
  /** The component index's rows, read as they are stored. */
  rows: () => UsageRowReader;
  /** Whether the index covers every document. */
  health: () => Promise<UsageIndexHealth>;
}): HostFinder {
  return {
    whole: async () => indexIsWhole(await args.health()),
    placing: async componentIds => {
      const rows = args.rows();
      const listing = { hosts: new Map<string, HostRef>(), complete: true };
      let read = 0;
      // A whole frontier per query rather than a query per component: a host
      // walk can reach many components at once, and asking for each in turn
      // is a round trip per id.
      for (const ids of chunked(componentIds, IDS_PER_QUERY)) {
        read += await readRows(rows, ids, listing, MOST_ROWS - read);
        if (read >= MOST_ROWS) {
          listing.complete = false;
          break;
        }
      }
      return { hosts: [...listing.hosts.values()], complete: listing.complete };
    },
  };
}

/** How many component ids one index query names. */
const IDS_PER_QUERY = 100;

/** Read the index rows referencing any of `ids` into the listing; how many were read. */
async function readRows(
  rows: UsageRowReader,
  ids: readonly string[],
  listing: { hosts: Map<string, HostRef>; complete: boolean },
  budget: number
): Promise<number> {
  let read = 0;
  let after: string | undefined;
  for (let page = 1; read < budget; page += 1) {
    const answer = await rows({
      where: componentUsageIndex.whereReferencingAny(ids),
      page,
      ...(after === undefined ? {} : { after }),
    });
    after = lastIdOf(answer.items) ?? after;
    for (const row of answer.items) {
      const host = hostOf(row);
      // A row this cannot address names a document that cannot be judged, so
      // the list is no longer the whole of it.
      if (host === null) {
        listing.complete = false;
        continue;
      }
      const key = hostKeyOf(host);
      listing.hosts.set(key, merged(listing.hosts, host));
    }
    read += answer.items.length;
    if (!answer.hasNext) return read;
  }
  return read;
}

/** One host's identity: a Single by its slug, an entry by its collection and id. */
function hostKeyOf(host: HostRef): string {
  return `${host.single === true ? "single" : "collection"}\u0000${host.slug}\u0000${host.id}\u0000${host.field}`;
}

/** One index row as a host, or `null` for a row that names no document. */
function hostOf(row: unknown): HostRef | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as Record<string, unknown>;
  const [slug, id, field] = [value.entity, value.entityKey, value.field];
  if (!isName(slug) || typeof field !== "string") return null;
  const localized = isName(value.locale);
  // A Single has one document, filed under its slug with no id.
  if (value.scope === "single") {
    return id === "" ? { slug, id: "", field, localized, single: true } : null;
  }
  if (value.scope !== "collection" || !isName(id)) return null;
  return { slug, id, field, localized };
}

/** A non-empty string: the index stores an absent key as the empty one. */
function isName(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * One host per document and field, whichever rows recorded it.
 *
 * The index holds a row per locale and per stored form; a document whose field
 * is localized in any of them is one this cannot read, so that wins.
 */
function merged(hosts: ReadonlyMap<string, HostRef>, host: HostRef): HostRef {
  const seen = hosts.get(hostKeyOf(host));
  return seen === undefined || !seen.localized ? host : seen;
}
