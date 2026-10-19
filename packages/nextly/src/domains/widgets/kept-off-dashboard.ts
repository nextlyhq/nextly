/**
 * Which collections and Singles the dashboard leaves out entirely.
 *
 * One rule for every dashboard surface that lists, offers or counts content: the widget sources
 * (so a card cannot query one, and a query naming one is refused as an unknown source), the
 * cards generated from those sources, the conditions that decide whether a content card is
 * offered, the Content card's counts, and the pending-edit counts. Asked here, so those surfaces
 * cannot come to disagree about which entities they leave out.
 *
 * The rule is "hidden from the admin's navigation", read from `admin.hidden` on the registry
 * record. `internal: true` sets that flag when a collection or Single is defined, and is not
 * stored itself, so an internal entity and one its author hid from the navigation are both
 * caught by the one flag, for every caller including a super-admin. A plugin that hides its
 * content from the navigation because it has its own screens for it -- the page builder's
 * patterns, components and layouts -- is left out too: the dashboard shows what the navigation
 * shows.
 *
 * Dashboard-only on purpose. The registry's candidate lists also feed access decisions outside
 * the dashboard, and hiding an entity from the navigation is not a statement about who may read
 * it, so nothing here narrows them.
 *
 * ## Recorded by the source refresh, read by everything else
 *
 * The flag lives on the full registry record, and only the content-source refresh reads full
 * records: the other surfaces work from slug lists. Reading the registry again for each of them
 * would deserialize every record's fields on every dashboard render to learn one boolean. So the
 * refresh records the slugs it leaves out, and the rest ask {@link isKeptOffDashboard}. Every
 * dashboard path refreshes before it lists or counts anything (the dashboard endpoint, the
 * widget query endpoint, and the audience pass that offers cards), so the record is the one the
 * request's own refresh just wrote.
 *
 * Replaced per kind on each refresh, like the deferred set, so an entity un-hidden later is
 * shown again without anything having to clear it. A refresh that cannot reach the registry
 * leaves the last record standing, as it leaves the last sources standing. Pinned to
 * `globalThis` like every other widget store, so it survives the module re-evaluation Next.js
 * and Turbopack perform.
 *
 * @module domains/widgets/kept-off-dashboard
 */

/** The two kinds of content the dashboard lists. */
export type DashboardContentKind = "collection" | "single";

const globalForKeptOff = globalThis as unknown as {
  __nextly_widgetKeptOffDashboard?: Map<DashboardContentKind, Set<string>>;
};

function store(): Map<DashboardContentKind, Set<string>> {
  globalForKeptOff.__nextly_widgetKeptOffDashboard ??= new Map();
  return globalForKeptOff.__nextly_widgetKeptOffDashboard;
}

/**
 * Record, from one registry read, which entities of one kind are kept off the dashboard.
 *
 * Called by the source refresh with every record it read, so the set and the sources it
 * publishes come from the same read and cannot disagree.
 */
export function recordKeptOffDashboard(
  kind: DashboardContentKind,
  records: ReadonlyArray<{ slug?: unknown; admin?: unknown }>
): void {
  const slugs = new Set<string>();
  for (const record of records) {
    if (typeof record.slug === "string" && keptOffDashboard(record)) {
      slugs.add(record.slug);
    }
  }
  store().set(kind, slugs);
}

/** Whether the last refresh found this entity kept off the dashboard. */
export function isKeptOffDashboard(
  kind: DashboardContentKind,
  slug: string
): boolean {
  return store().get(kind)?.has(slug) ?? false;
}

/**
 * Whether a registry record of a collection or Single is kept off the dashboard.
 *
 * Takes the record's stored `admin` as `unknown` and checks it at the point of use, because the
 * registry row is stored JSON and its shape is not something to assume.
 */
export function keptOffDashboard(record: { admin?: unknown }): boolean {
  const admin = record.admin;
  if (typeof admin !== "object" || admin === null) return false;
  return (admin as { hidden?: unknown }).hidden === true;
}
