"use client";

import { Card, CardContent, Skeleton } from "@revnixhq/ui";
import {
  AlertCircle,
  ChevronRight,
  Database,
  FileCheck,
  Layers,
  Layout,
  Puzzle,
} from "lucide-react";
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
      className="block group h-full rounded-none overflow-hidden border border-border bg-card transition-colors duration-200 hover-subtle-row hover:border-primary/20"
    >
      <Card
        variant="interactive"
        className={cn(
          "h-full !border-0 !bg-transparent transition-colors duration-200 rounded-none overflow-hidden relative"
        )}
      >
        <CardContent className="p-5 relative z-10">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-2xl font-bold tabular-nums tracking-tight text-primary/50 leading-none group-hover:text-primary transition-colors">
                {item.count}
              </span>
              <h5 className="font-semibold text-xs tracking-tight transition-colors leading-tight text-primary/50 group-hover:text-primary pt-1">
                {item.label}
              </h5>
            </div>
            <div className="text-primary/50 group-hover:text-primary transition-colors pt-1">
              <Icon className="h-6 w-6 shrink-0" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton
          key={i}
          className="h-32 rounded-none bg-primary/5 border border-border"
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
    const allowed = new Set((collectionsData?.items ?? []).map(col => col.name));
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
    <div className="space-y-12 pb-16">
      {isLoading ? (
        <LoadingSkeleton />
      ) : statsError ? (
        <div className="flex items-center gap-2 py-8 text-xs font-bold uppercase tracking-widest text-destructive/60 justify-center bg-destructive/5 rounded-none border border-destructive/10">
          <AlertCircle className="h-4 w-4" />
          <span>Connection Error</span>
        </div>
      ) : counts.length === 0 ? (
        <div className="py-12 flex flex-col items-center gap-6 bg-primary/5 rounded-none border border-dashed border-border">
          <div className="p-6 rounded-none bg-primary/5 border border-border/10">
            <Layers className="h-8 w-8 text-muted-foreground/10" />
          </div>
          <div className="space-y-2 text-center">
            <p className="text-lg font-bold text-foreground tracking-tight">
              No Collections
            </p>
            <Link
              href={ROUTES.COLLECTIONS_CREATE}
              className="text-[10px] font-bold uppercase tracking-widest text-primary hover-unified flex items-center justify-center gap-2 transition-all"
            >
              Create Collection <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-12">
          {groups.map(group => (
            <div key={group.name ?? "__ungrouped"} className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  <h4 className="text-[11px] font-bold text-foreground uppercase tracking-wider whitespace-nowrap">
                    {group.name || "Collections"}
                  </h4>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <span className="ml-4 text-[9px] font-bold tabular-nums text-muted-foreground/30 uppercase tracking-widest bg-primary/5 px-2 py-0.5 rounded-none border border-border">
                  {group.collections.length}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
