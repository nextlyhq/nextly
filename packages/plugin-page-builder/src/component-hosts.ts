/**
 * Who places a component, read from the component usage index.
 *
 * A component save is judged inside the documents that use it, and the index
 * is how those are found. It is a hint rather than a boundary: it is maintained
 * after commit, a backfill may not have walked every document yet, and some
 * content — a single, a nested blocks field — it cannot index at all. So the
 * answer says whether it is the whole list, from the same health reading the
 * usage counts use, and a caller treats a partial list as partial.
 *
 * @module component-hosts
 */
import type { ClassUsageDirectApi } from "./class-usage-runtime";
import type { HostFinder, HostRef } from "./fields/blocks-composition";
import type { UsageIndexHealth } from "./usage-index-health";
import { indexIsWhole } from "./usage-index-health";

/** How many index rows one page of the read returns. */
const ROWS_PER_PAGE = 200;

/**
 * How many index rows one component's lookup reads before calling the list a
 * floor. A row is a (document, field, locale, form), so this is a few thousand
 * documents at most — far past what one save judges.
 */
const MOST_ROWS = 5000;

/**
 * A finder over the component usage index.
 *
 * Reads as the SYSTEM: the index denies every access rule it declares, so an
 * untrusted read answers an empty list — which is indistinguishable from a
 * component nothing uses, the answer that lets a breaking change through.
 */
export function indexHostFinder(args: {
  nextly: () => Promise<ClassUsageDirectApi>;
  /** The index collection's RESOLVED slug; an integrator may rename it. */
  indexCollection: string;
  /** Whether the index covers every document, read per lookup. */
  health: () => Promise<UsageIndexHealth>;
}): HostFinder {
  return async componentId => {
    const nextly = await args.nextly();
    const hosts = new Map<string, HostRef>();
    let complete = indexIsWhole(await args.health());
    let read = 0;
    for (let page = 1; ; page += 1) {
      const answer = await nextly.find({
        collection: args.indexCollection,
        where: {
          componentId: { equals: componentId },
          kind: { equals: "reference" },
        },
        limit: ROWS_PER_PAGE,
        page,
        sort: "id",
        depth: 0,
        overrideAccess: true,
      });
      for (const row of answer.items) {
        const host = hostOf(row);
        // A row this cannot address names a document that cannot be judged,
        // so the list is no longer the whole of it.
        if (host === null) {
          complete = false;
          continue;
        }
        hosts.set(
          `${host.slug}\u0000${host.id}\u0000${host.field}`,
          merged(hosts, host)
        );
      }
      read += answer.items.length;
      if (!answer.meta.hasNext) break;
      if (read >= MOST_ROWS) {
        complete = false;
        break;
      }
    }
    return { hosts: [...hosts.values()], complete };
  };
}

/** One index row as a host, or `null` for a row that names no collection entry. */
function hostOf(row: unknown): HostRef | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as Record<string, unknown>;
  if (value.scope !== "collection") return null;
  const [slug, id, field] = [value.entity, value.entityKey, value.field];
  if (!isName(slug) || !isName(id) || typeof field !== "string") return null;
  return { slug, id, field, localized: isName(value.locale) };
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
  const seen = hosts.get(`${host.slug}\u0000${host.id}\u0000${host.field}`);
  return seen === undefined || !seen.localized ? host : seen;
}
