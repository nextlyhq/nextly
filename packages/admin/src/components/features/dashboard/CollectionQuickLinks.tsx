"use client";

import { Card, CardContent, Skeleton } from "@nextlyhq/ui";
import { AlertCircle, Database, FileCheck, Layout, Puzzle } from "lucide-react";
import type React from "react";
import { useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useCollections, useDashboardStats } from "@admin/hooks/queries";
import { cn } from "@admin/lib/utils";
import type { CollectionCount } from "@admin/types/dashboard/stats";
import type { ApiCollection } from "@admin/types/entities";

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
    const effectiveGroup = item.group === "Forms" ? "Forms" : null;
    if (!grouped.has(effectiveGroup)) {
      grouped.set(effectiveGroup, []);
    }
    grouped.get(effectiveGroup)!.push(item);
  }

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
  const Icon = useMemo(() => {
    if (collectionConfig?.admin?.icon) {
      const ConfiguredIcon = (Icons as Record<string, React.ElementType>)[
        collectionConfig.admin.icon
      ];
      if (ConfiguredIcon) return ConfiguredIcon;
    }

    if (item.group === "Forms") {
      if (item.slug.toLowerCase().includes("submission")) return Icons.Inbox;
      return Icons.Clipboard;
    }

    return getGroupDefaultIcon(item.group);
  }, [collectionConfig?.admin?.icon, item.group, item.slug]);

  return (
    <Link
      href={buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: item.slug })}
      className="block group h-full rounded-lg overflow-hidden border border-border bg-card transition-colors duration-200 hover-subtle-row hover:border-primary"
    >
      <Card
        variant="interactive"
        className={cn(
          "h-full border-0! bg-transparent! transition-colors duration-200 rounded-lg overflow-hidden relative"
        )}
      >
        <CardContent className="p-4 relative z-10">
          <div className="flex flex-col gap-2">
            {/* Count — owns the top row */}
            <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground leading-none transition-colors">
              {item.count}
            </span>

            {/* Icon + label — label wraps fully, never truncates */}
            <div className="flex items-start gap-1.5">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
              <h5 className="min-w-0 flex-1 wrap-break-words font-semibold text-xs tracking-tight transition-colors leading-tight text-muted-foreground group-hover:text-foreground">
                {item.label}
              </h5>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton
          key={i}
          className="h-24 rounded-lg bg-muted/30 border border-border"
        />
      ))}
    </div>
  );
}

export const CollectionQuickLinks: React.FC = () => {
  const {
    data: statsData,
    isLoading: statsLoading,
    error: statsError,
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

  return (
    <div className="space-y-12">
      {isLoading ? (
        <LoadingSkeleton />
      ) : statsError ? (
        <div className="flex items-center gap-2 py-8 text-xs font-bold uppercase tracking-widest text-destructive justify-center bg-destructive/5 rounded-md border border-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>Connection Error</span>
        </div>
      ) : (
        <div className="space-y-12">
          {groups.map(group => (
            <div key={group.name ?? "__ungrouped"} className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  <h4 className="text-sm font-semibold tracking-tight text-foreground whitespace-nowrap">
                    {group.name || "Collections"}
                  </h4>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <span className="ml-4 text-xs font-medium tabular-nums text-muted-foreground">
                  {group.collections.length}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
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
      )}
    </div>
  );
};
