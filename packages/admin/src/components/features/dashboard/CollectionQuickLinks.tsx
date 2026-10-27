"use client";

import { Card, CardContent, Skeleton } from "@nextlyhq/ui";
import { Database, FileCheck, Layout, Puzzle } from "lucide-react";
import { MAX_WIDGET_LIMIT } from "nextly/config";
import type { WidgetComponentProps, WidgetSlot } from "nextly/widget-result";
import type React from "react";
import { useMemo } from "react";

import {
  ListFooter,
  listFooter,
} from "@admin/components/features/widgets/frame/list-card";
import { listViewHref } from "@admin/components/features/widgets/frame/list-view-href";
import * as Icons from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import {
  NAV_COLLECTIONS_PARAMS,
  useCollections,
  useSingles,
} from "@admin/hooks/queries";
import { cn } from "@admin/lib/utils";
import type { CollectionCount } from "@admin/types/dashboard/stats";
import type { ApiCollection } from "@admin/types/entities";

import { FrameState, readSlot } from "../widgets/frame/card-state";
import { CardFigure } from "../widgets/frame/figure";

import { ContentSingleTile } from "./ContentSingleTile";
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

/** The sidebar's own Singles request, so the card shares its answer for icons and descriptions. */
const SINGLES_PARAMS = {
  pagination: { page: 0, pageSize: 100 },
  sorting: [],
  filters: {},
};

/** One collection as `system:content` answers it: its entries, and how many are drafts. */
type ContentRow = CollectionCount & { draft: number };

/** One Single as `system:content` answers it: what it is called. */
interface ContentSingleRow {
  slug: string;
  label: string;
}

/** The rows of a `system:content` answer, or `undefined` while there is none. */
function answeredRows(
  slot: WidgetSlot | undefined
): Record<string, unknown>[] | undefined {
  if (!slot?.ok || slot.result.op !== "list") return undefined;
  return slot.result.items;
}

/**
 * The Singles of a `system:content` answer, after its collections. A row this build cannot read
 * is left out rather than drawn from guesses.
 */
function singleRowsOf(
  rows: Record<string, unknown>[] | undefined
): ContentSingleRow[] {
  return (rows ?? []).flatMap(({ kind, slug, label }) =>
    kind === "single" && typeof slug === "string" && typeof label === "string"
      ? [{ slug, label }]
      : []
  );
}

/**
 * The collections of a `system:content` answer, or `undefined` while there is none. A row with
 * no `kind` is a collection, as every row was before Singles joined the answer. A row this build
 * cannot read is left out rather than drawn from guesses.
 */
function contentRowsOf(
  rows: Record<string, unknown>[] | undefined
): ContentRow[] | undefined {
  if (rows === undefined) return undefined;
  return rows.flatMap(row => {
    const { kind, slug, label, group, count, draft } = row;
    if (kind !== undefined && kind !== "collection") return [];
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
 * - **Both known:** every counted collection, each with its count: first those the list holds, in
 *   its order, then any it lacks, in the counts' order. The two are different pages past the
 *   list's first hundred and the counts' first fifty, so a count is never dropped for missing
 *   from the list; on an install small enough for both to be whole, the list holds them all.
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
  // Kept off the dashboard by the admin's one rule for it, as the counts already are: drawn
  // first, a hidden collection's tile would show until the counts took it away again.
  const listed = list.filter(collection => !keptOffDashboard(collection));
  if (counts === undefined) {
    return listed.map(collection => tileOf(collection, undefined));
  }
  const counted = new Map(counts.map(count => [count.slug, count]));
  const inList = new Set(listed.map(collection => collection.name));
  return [
    ...listed.flatMap(collection => {
      const count = counted.get(collection.name);
      return count === undefined ? [] : [tileOf(collection, count)];
    }),
    ...counts.filter(count => !inList.has(count.slug)),
  ];
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
 * What the Content card draws from its answer and the two lists: the collection groups and the
 * Singles after them, each with what the lists say of it, and whether more exist than it draws.
 */
function useContentTiles(slot: WidgetSlot | undefined) {
  const { data: collectionsData, isLoading: collectionsLoading } =
    // The sidebar's own request, so the shell has usually filled it before this card is drawn.
    useCollections(NAV_COLLECTIONS_PARAMS);
  // The Singles list's own request, as the sidebar makes it, for each Single's icon and description.
  const { data: singlesData } = useSingles(SINGLES_PARAMS);
  const rows = useMemo(() => answeredRows(slot), [slot]);
  const tiles = useMemo(
    () =>
      collectionTiles(
        collectionsData?.items,
        collectionsLoading,
        contentRowsOf(rows)
      ),
    [rows, collectionsData?.items, collectionsLoading]
  );
  const groups = useMemo(
    () => groupCollections((tiles ?? []).slice(0, TILES_DRAWN)),
    [tiles]
  );
  // The Singles follow the collections, in the room the collections leave.
  const singles = useMemo(
    () =>
      singleRowsOf(rows).slice(
        0,
        Math.max(0, TILES_DRAWN - Math.min(tiles?.length ?? 0, TILES_DRAWN))
      ),
    [rows, tiles]
  );
  const collectionsByName = useMemo(
    () =>
      new Map(
        (collectionsData?.items ?? []).map(collection => [
          collection.name,
          collection,
        ])
      ),
    [collectionsData?.items]
  );
  const singlesBySlug = useMemo(
    () =>
      new Map((singlesData?.items ?? []).map(single => [single.slug, single])),
    [singlesData?.items]
  );
  return {
    tiles,
    groups,
    singles,
    // The one row more the card asked for is what says more exist than it draws.
    // The list's one footer, from the extra tile the card asked for: a floor, since the content
    // source counts no total.
    footer: listFooter(rows?.length ?? 0, TILES_DRAWN, undefined),
    collectionsByName,
    singlesBySlug,
    collectionsLoading,
  };
}

/**
 * One group of tiles: an h3 naming it and its size when the card holds several groups (one level
 * under the frame's title), then as many columns as the CARD's width fits, never the window's: a
 * tile is at least 11rem, so a small card is one column and a wide one several.
 */
function ContentGroup({
  heading,
  size,
  children,
}: {
  /** The group's name, or `undefined` when it is the card's only group. */
  heading: string | undefined;
  size: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {heading !== undefined && (
        <h3 className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
          {heading}
          <span className="tabular-nums">
            <CardFigure value={size} />
          </span>
        </h3>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
        {children}
      </div>
    </div>
  );
}

/**
 * The dashboard's Content card, answered by `system:content` in the dashboard's batch: each
 * collection's entries and drafts, counted as the reader, in the order and with the icons the
 * collections list gives them, then each Single.
 */
export const CollectionQuickLinks: React.FC<WidgetComponentProps> = ({
  slot,
  isFetching,
  query,
  onRetry,
}) => {
  const content = useContentTiles(slot);
  const { tiles, groups, singles } = content;

  // The card's frame draws its title and every state, so this is only its body: the tiles,
  // grouped. A failed answer, or no tiles yet, is reported for the frame to draw; loading only
  // while neither the list nor the counts are known, since either one says which tiles there are.
  if (slot !== undefined && !slot.ok) {
    const read = readSlot(slot, { isFetching, skeleton: {}, onRetry });
    if ("state" in read) return <FrameState state={read.state} />;
  }
  if (tiles === undefined) {
    return (
      <FrameState
        state={
          isFetching || content.collectionsLoading
            ? { kind: "loading", skeleton: { shape: "rows", rows: 4 } }
            : { kind: "no-access" }
        }
      />
    );
  }
  // One group needs no heading of its own: the card's title already names it.
  const headed = groups.length + (singles.length > 0 ? 1 : 0) > 1;
  return (
    <div className="space-y-8">
      {groups.map(group => (
        <ContentGroup
          key={group.name ?? "__ungrouped"}
          heading={headed ? group.name || "Collections" : undefined}
          size={group.collections.length}
        >
          {group.collections.map(item => (
            <CollectionCard
              key={item.slug}
              item={item}
              collectionConfig={content.collectionsByName.get(item.slug)}
            />
          ))}
        </ContentGroup>
      ))}
      {singles.length > 0 && (
        <ContentGroup
          heading={headed ? "Singles" : undefined}
          size={singles.length}
        >
          {singles.map(single => (
            <ContentSingleTile
              key={single.slug}
              slug={single.slug}
              label={single.label}
              single={content.singlesBySlug.get(single.slug)}
            />
          ))}
        </ContentGroup>
      )}
      {content.footer !== undefined && (
        <ListFooter footer={content.footer} href={listViewHref(query)} />
      )}
    </div>
  );
};
