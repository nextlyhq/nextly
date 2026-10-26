/**
 * What the activity feed needs to know about the content it reports on, read
 * from the registries: the Singles' labels, which Singles and collections are
 * kept off the dashboard, and which collections have a draft and published
 * lifecycle.
 *
 * @module services/dashboard/activity-subjects
 */

import { container } from "../../di/container";
import { keptOffDashboard } from "../../domains/widgets/kept-off-dashboard";

import type {
  ActivityKeptOffCollections,
  ActivitySingles,
} from "./activity-log-service";

/** The registries' answer for one feed request, in the shape the feed's options take. */
export interface ActivitySubjects {
  singles: ActivitySingles;
  keptOffCollections: ActivityKeptOffCollections;
}

/** What Recently edited also needs: which collections' documents have a status. */
export interface RecentEditSubjects extends ActivitySubjects {
  /**
   * The collections whose documents have a status, from the same read as the
   * kept-off ones; empty when that read did not complete, so no status is
   * asked of a collection that may not have one.
   */
  collectionsWithStatus: ReadonlySet<string>;
}

/**
 * The Singles and collections as the registries hold them now.
 *
 * Read on each request rather than from the record the widget-source refresh
 * keeps (`isKeptOffDashboard`), because the activity endpoint runs no refresh
 * and that record could be any age. The two registries are read together, so
 * a request pays for one round of reads, not two in turn; and both doors onto
 * the feed hand on this one answer, so they leave out the same rows.
 *
 * Each kind answers for itself: a read that fails answers `complete: false`
 * for that kind only, and the feed degrades as `ActivityLogQueryOptions`
 * describes for each.
 */
export async function readActivitySubjects(): Promise<ActivitySubjects> {
  const { singles, keptOffCollections } = await readRecentEditSubjects();
  return { singles, keptOffCollections };
}

/**
 * The same answer as {@link readActivitySubjects}, from the same reads, with
 * the collections that have a status beside it.
 */
export async function readRecentEditSubjects(): Promise<RecentEditSubjects> {
  const [singles, collections] = await Promise.all([
    readSingles(),
    readCollections(),
  ]);
  return { singles, ...collections };
}

/** Each Single's label, which heads its rows in the feed, and which are kept off the dashboard. */
async function readSingles(): Promise<ActivitySingles> {
  try {
    const registry = container.get<{
      getAllSingles: () => Promise<
        Array<{ slug: string; label?: unknown; admin?: unknown }>
      >;
    }>("singleRegistryService");
    const labels = new Map<string, string>();
    const keptOff = new Set<string>();
    for (const single of await registry.getAllSingles()) {
      if (typeof single.label === "string" && single.label !== "") {
        labels.set(single.slug, single.label);
      }
      if (keptOffDashboard(single)) keptOff.add(single.slug);
    }
    return { labels, keptOff, complete: true };
  } catch {
    return { labels: new Map(), keptOff: new Set(), complete: false };
  }
}

/**
 * The collections kept off the dashboard, by the one rule every dashboard
 * surface asks, and the ones with a status, from one read of the registry.
 */
async function readCollections(): Promise<
  Pick<RecentEditSubjects, "keptOffCollections" | "collectionsWithStatus">
> {
  try {
    const registry = container.get<{
      getAllCollections: () => Promise<
        Array<{ slug: string; admin?: unknown; status?: unknown }>
      >;
    }>("collectionRegistryService");
    const slugs = new Set<string>();
    const withStatus = new Set<string>();
    for (const collection of await registry.getAllCollections()) {
      if (keptOffDashboard(collection)) slugs.add(collection.slug);
      if (collection.status === true) withStatus.add(collection.slug);
    }
    return {
      keptOffCollections: { slugs, complete: true },
      collectionsWithStatus: withStatus,
    };
  } catch {
    return {
      keptOffCollections: { slugs: new Set(), complete: false },
      collectionsWithStatus: new Set(),
    };
  }
}
