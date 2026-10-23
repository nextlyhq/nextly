/**
 * What the activity feed needs to know about the content it reports on, read
 * from the registries: the Singles' labels, and which Singles and collections
 * are kept off the dashboard.
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
  const [singles, keptOffCollections] = await Promise.all([
    readSingles(),
    readKeptOffCollections(),
  ]);
  return { singles, keptOffCollections };
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

/** The collections kept off the dashboard, by the one rule every dashboard surface asks. */
async function readKeptOffCollections(): Promise<ActivityKeptOffCollections> {
  try {
    const registry = container.get<{
      getAllCollections: () => Promise<
        Array<{ slug: string; admin?: unknown }>
      >;
    }>("collectionRegistryService");
    const slugs = new Set<string>();
    for (const collection of await registry.getAllCollections()) {
      if (keptOffDashboard(collection)) slugs.add(collection.slug);
    }
    return { slugs, complete: true };
  } catch {
    return { slugs: new Set(), complete: false };
  }
}
