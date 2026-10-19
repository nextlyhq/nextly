"use client";

import { Card, CardContent } from "@nextlyhq/ui";
import { Database, FileCheck, Layout, Puzzle } from "lucide-react";
import type React from "react";
import { useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useCollections, useDashboardStats } from "@admin/hooks/queries";
import { cn } from "@admin/lib/utils";
import type { CollectionCount } from "@admin/types/dashboard/stats";
import type { ApiCollection } from "@admin/types/entities";

import { CardFigure } from "../widgets/frame/figure";
import { CardError, CardSkeleton } from "../widgets/frame/states";

interface CollectionGroup {
  name: string | null;
  collections: CollectionCount[];
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

function groupCollections(counts: CollectionCount[]): CollectionGroup[] {
  const grouped = new Map<string | null, CollectionCount[]>();

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
  item: CollectionCount;
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
                <CardFigure value={item.count} />
              </span>
              {/* A label, not a heading, and wrapped rather than clipped: the frame's title is
                  the card's one heading, and a collection's name is read in full. */}
              <span className="block break-words font-medium text-xs tracking-tight transition-colors leading-tight text-muted-foreground group-hover:text-foreground pt-1">
                {item.label}
              </span>
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

export const CollectionQuickLinks: React.FC = () => {
  const {
    data: statsData,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useDashboardStats();
  const { data: collectionsData, isLoading: collectionsLoading } =
    useCollections({
      pagination: { page: 0, pageSize: 100 },
    });

  const counts = useMemo(() => {
    const raw = statsData?.collectionCounts ?? [];
    const allowed = new Set(
      (collectionsData?.items ?? []).map(col => col.name)
    );
    if (allowed.size === 0) return raw;
    return raw.filter(item => allowed.has(item.slug));
  }, [statsData?.collectionCounts, collectionsData?.items]);
  const groups = useMemo(() => groupCollections(counts), [counts]);

  const collectionsMap = useMemo(() => {
    const map = new Map<string, ApiCollection>();
    collectionsData?.items?.forEach(col => {
      map.set(col.name, col);
    });
    return map;
  }, [collectionsData?.items]);

  const isLoading = statsLoading || collectionsLoading;

  // The card's frame draws its title, so this is only its body: the collections, grouped,
  // or the frame's own skeleton and error while they are not there.
  if (isLoading) return <CardSkeleton shape="rows" rows={4} />;
  if (statsError) {
    return (
      <CardError
        title="Collections"
        message="The collection counts couldn't be loaded."
        onRetry={() => void refetchStats()}
      />
    );
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
    </div>
  );
};
