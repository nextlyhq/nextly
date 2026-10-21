/**
 * The Singles the activity feed needs to know about, read from the registry.
 *
 * @module services/dashboard/activity-singles
 */

import { container } from "../../di/container";
import { keptOffDashboard } from "../../domains/widgets/kept-off-dashboard";

import type { ActivitySingles } from "./activity-log-service";

/**
 * The Singles as the registry holds them now: each one's label, which heads its
 * rows in the feed, and which are kept off the dashboard, whose rows the feed
 * leaves out.
 *
 * Read from the registry on each request rather than from the record the
 * widget-source refresh keeps, because the activity endpoint runs no refresh and that
 * record could be any age. A read that fails answers `complete: false`, and the
 * feed then shows no Single's row rather than a hidden one.
 */
export async function readActivitySingles(): Promise<ActivitySingles> {
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
