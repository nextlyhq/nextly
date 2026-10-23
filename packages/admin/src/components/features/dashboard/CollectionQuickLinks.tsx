"use client";

import { Card, CardContent, Skeleton } from "@nextlyhq/ui";
import { Database, FileCheck, Layout, Puzzle } from "lucide-react";
import { MAX_WIDGET_LIMIT } from "nextly/config";
import type { WidgetComponentProps, WidgetSlot } from "nextly/widget-result";
import type React from "react";
import { useMemo } from "react";

import { MoreExist } from "@admin/components/features/widgets/archetypes/more-exist";
import * as Icons from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { NAV_COLLECTIONS_PARAMS, useCollections } from "@admin/hooks/queries";
import { cn } from "@admin/lib/utils";
import type { CollectionCount } from "@admin/types/dashboard/stats";
import type { ApiCollection } from "@admin/types/entities";

import { CardFigure } from "../widgets/frame/figure";
import { CardSkeleton, CardSlotFailure } from "../widgets/frame/states";

import { keptOffDashboard } from "./kept-off-dashboard";

/**
 * One tile: a collection and its count, or `null` while the counts are on their way. The tile is
 * drawn either way, so the counts landing fill tiles already in place rather than inserting them.
 */
type CollectionTile = Omit<CollectionCount, "count"> & {
  count: number | null;
  /** How many of its entries are drafts, once counted; absent until then. */
  draft?: number;
};

/**
 * The most tiles the card draws: one fewer than it asks for, so the one more says more exist, the
 * rule core's lists follow. The card asks the most any widget query returns, so this is reached
 * only by an install with that many collections.
 */
const TILES_DRAWN = MAX_WIDGET_LIMIT - 1;

/** One collection as `system:content` answers it: its entries, and how many are drafts. */
type ContentRow = CollectionCount & { draft: number };

/**
 * The rows of a `system:content` answer, or `undefined` while there is none. A row this build
 * cannot read is left out rather than drawn from guesses.
 */
function contentRowsOf(slot: WidgetSlot | undefined): ContentRow[] | undefined {
  if (!slot?.ok || slot.result.op !== "list") return undefined;
  return slot.result.items.flatMap(row => {
    const { slug, label, group, count, draft } = row;
    if (typeof slug !== "string" || typeof label !== "string") return [];
    if (typeof count !== "number") return [];
    return [
      {
        slug,
        label,
        group: typeof group === "string" ? group : null,
        count,
        draft: typeof draft === "number" ? draft : 0,
      },
    ];
  });
}

interface CollectionGroup {
  name: string | null;
  collections: CollectionTile[];
}

function getGroupDefaultIcon(group: string | null) {
  switch (group) {
    case "Forms":
      return FileCheck;
    case "Content":
      return Layout;
    case "Custom":
      return Puzzle;
    default:
      return Database;
  }
}

/**
 * The tiles to draw, in the collections list's order.
 *
 * - **Both known:** the collections that have a count, each with its count. The list holds
 *   every collection this reader may see, and core counts those it may read and keeps on the
 *   dashboard, so a count names a listed collection and never one the list lacks.
 * - **The list only:** every listed collection, its count still on its way. Once the counts
 *   land, a tile with no count goes, so the card can only close up, never grow.
 * - **The list still on its way:** nothing yet, whatever the counts say. Drawn from the counts
 *   alone, the tiles would take the counts' order and then re-sort, and regroup, when the list
 *   arrived, moving tiles already on screen.
 * - **No list to be had** (the request failed, or it lists nothing): the counts, in their own
 *   order, as the card drew before the list.
 *
 * One order in every case where the list is known, so tiles do not move as the counts land.
 */
function collectionTiles(
  list: readonly ApiCollection[] | undefined,
  listPending: boolean,
  counts: readonly ContentRow[] | undefined
): CollectionTile[] | undefined {
  if (list === undefined && listPending) return undefined;
  if (list === undefined || list.length === 0) return counts?.slice();
  const counted = new Map(counts?.map(count => [count.slug, count]));
  // Kept off the dashboard by the admin's one rule for it, as the counts already are: drawn
  // first, a hidden collection's tile would show until the counts took it away again.
  return list
    .filter(collection => !keptOffDashboard(collection))
    .flatMap(collection => {
      const count = counted.get(collection.name);
      if (counts !== undefined && count === undefined) return [];
      return [tileOf(collection, count)];
    });
}

/**
 * A collection's tile: core's row for it once counted, which names and groups it as the count
 * does, and until then the collection as the list describes it, its count still to come.
 */
function tileOf(
  collection: ApiCollection,
  count: ContentRow | undefined
): CollectionTile {
  if (count !== undefined) return count;
  return {
    slug: collection.name,
    // The plural, as the count names it and the sidebar does, so the tile's text does not change
    // (and rewrap) when its count lands.
    label: collection.labels?.plural ?? collection.label,
    group: collection.admin?.group ?? null,
    count: null,
  };
}

function groupCollections(counts: CollectionTile[]): CollectionGroup[] {
  const grouped = new Map<string | null, CollectionTile[]>();

  for (const item of counts) {
    // Everything except "Forms" is treated as "Collections" (null)
    const effectiveGroup = item.group === "Forms" ? "Forms" : null;
    if (!grouped.has(effectiveGroup)) {
      grouped.set(effectiveGroup, []);
    }
    grouped.get(effectiveGroup)!.push(item);
  }

  // Priorities: null (Collections) -> Forms
  const getPriority = (name: string | null) => {
    if (name === null) return 0;
    if (name === "Forms") return 1;
    return 2;
  };

  return Array.from(grouped.entries())
    .map(([name, collections]) => ({ name, collections }))
    .sort((a, b) => getPriority(a.name) - getPriority(b.name));
}

function CollectionCard({
  item,
  collectionConfig,
}: {
  item: CollectionTile;
  collectionConfig?: ApiCollection;
}) {
  // Resolve Icon:
  // 1. From collection metadata (admin.icon)
  // 2. From group default
  const Icon = useMemo(() => {
    // 1. From collection metadata (admin.icon)
    if (collectionConfig?.admin?.icon) {
      const ConfiguredIcon = (Icons as Record<string, React.ElementType>)[
        collectionConfig.admin.icon
      ];
      if (ConfiguredIcon) return ConfiguredIcon;
    }

    // 2. Specific item overrides for "Forms" group
    if (item.group === "Forms") {
      if (item.slug.toLowerCase().includes("submission")) return Icons.Inbox;
      return Icons.Clipboard;
    }

    // 3. From group default
    return getGroupDefaultIcon(item.group);
  }, [collectionConfig?.admin?.icon, item.group, item.slug]);

  return (
    <Link
      href={buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: item.slug })}
      className="block group h-full rounded-lg overflow-hidden  border border-border bg-card transition-colors duration-200 hover-subtle-row hover:border-primary"
    >
      <Card
        variant="interactive"
        className={cn(
          "h-full border-0! bg-transparent! transition-colors duration-200 rounded-lg overflow-hidden relative"
        )}
      >
        <CardContent className="p-5 relative z-10">
          <div className="flex items-start justify-between gap-4">
            {/* `min-w-0` so a long name can wrap: a flex item is otherwise as wide as its
                longest word, and a long collection name would push past the tile. */}
            <div className="min-w-0 space-y-1">
              {/* The card type ramp's big number, through the one card formatter. */}
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground leading-none transition-colors">
                {item.count === null ? (
                  // The count's own line, unfilled: as tall as the number that replaces it.
                  <Skeleton className="inline-block h-[1em] w-10 align-top" />
                ) : (
                  <CardFigure value={item.count} />
                )}
              </span>
              {/* A label, not a heading, and wrapped rather than clipped: the frame's title is
                  the card's one heading, and a collection's name is read in full. */}
              <span className="block break-words font-medium text-xs tracking-tight transition-colors leading-tight text-muted-foreground group-hover:text-foreground pt-1">
                {item.label}
              </span>
              {/* Drafts beside the total, through the same formatter, only when there are any:
                  "0 drafts" on every tile would be noise, and a collection without the
                  Draft/Published lifecycle has none to report. */}
              {item.draft !== undefined && item.draft > 0 && (
                <span className="block text-xs tabular-nums text-muted-foreground">
                  <CardFigure value={item.draft} />{" "}
                  {item.draft === 1 ? "draft" : "drafts"}
                </span>
              )}
            </div>
            <div className="text-muted-foreground group-hover:text-foreground transition-colors pt-1">
              <Icon className="h-5 w-5 shrink-0" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * The dashboard's collections card, answered by `system:content` in the dashboard's batch: each
 * collection's entries and drafts, counted as the reader, in the order and with the icons the
 * collections list gives them.
 */
export const CollectionQuickLinks: React.FC<WidgetComponentProps> = ({
  slot,
  isFetching,
  query,
  onRetry,
}) => {
  const { data: collectionsData, isLoading: collectionsLoading } =
    // The sidebar's own request, so the shell has usually filled it before this card is drawn.
    useCollections(NAV_COLLECTIONS_PARAMS);
  const counts = useMemo(() => contentRowsOf(slot), [slot]);

  const tiles = useMemo(
    () => collectionTiles(collectionsData?.items, collectionsLoading, counts),
    [counts, collectionsData?.items, collectionsLoading]
  );
  const groups = useMemo(
    () => groupCollections((tiles ?? []).slice(0, TILES_DRAWN)),
    [tiles]
  );
  // The one row more the card asked for is what says more collections exist than it draws.
  const moreExist = (counts?.length ?? 0) > TILES_DRAWN;

  const collectionsMap = useMemo(() => {
    const map = new Map<string, ApiCollection>();
    collectionsData?.items?.forEach(col => {
      map.set(col.name, col);
    });
    return map;
  }, [collectionsData?.items]);

  // The card's frame draws its title, so this is only its body: the collections, grouped, or the
  // frame's own skeleton and error while they are not there. The skeleton only while neither the
  // list nor the counts are known, since either one says which tiles there are.
  if (slot && !slot.ok) {
    return (
      <CardSlotFailure slot={slot} title="Collections" onRetry={onRetry} />
    );
  }
  if (tiles === undefined) {
    return isFetching || collectionsLoading ? (
      <CardSkeleton shape="rows" rows={4} />
    ) : null;
  }
  // One group needs no heading of its own: the card's title already names it. Several are
  // told apart by an h3, one level under the card's title.
  const headed = groups.length > 1;
  return (
    <div className="space-y-8">
      {groups.map(group => (
        <div key={group.name ?? "__ungrouped"} className="space-y-4">
          {headed && (
            <h3 className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
              {group.name || "Collections"}
              <span className="tabular-nums">
                <CardFigure value={group.collections.length} />
              </span>
            </h3>
          )}
          {/* As many columns as the CARD's width fits, never the window's: a tile is at least
              11rem, so a small card is one column and a wide one several. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
            {group.collections.map(item => (
              <CollectionCard
                key={item.slug}
                item={item}
                collectionConfig={collectionsMap.get(item.slug)}
              />
            ))}
          </div>
        </div>
      ))}
      {moreExist && <MoreExist query={query} />}
    </div>
  );
};
