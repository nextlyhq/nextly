"use client";

/**
 * ProjectStatsGrid Component
 *
 * Displays a compact 2x4 grid of project-wide statistics including
 * Entries, Media, Content Types, Components, Singles, Users, API Keys,
 * and Locales. Each card links to the relevant admin page.
 *
 * @module components/features/dashboard/ProjectStatsGrid
 */

"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@revnixhq/ui";
import {
  AlertCircle,
  FileText,
  Globe,
  Image,
  Key,
  Languages,
  Layers,
  Puzzle,
  Users,
  ChevronRight,
} from "lucide-react";
import type React from "react";
import { useMemo } from "react";

import { StatsCard } from "@admin/components/features/dashboard/StatsCard";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useDashboardStats } from "@admin/hooks/queries/useDashboardStats";
import type { StatsCardProps } from "@admin/types/dashboard/stats";

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4" aria-busy="true">
      <span className="sr-only">Loading metrics...</span>
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-20 rounded-2xl" />
      ))}
    </div>
  );
}

export const ProjectStatsGrid: React.FC = () => {
  const { data, isLoading, error } = useDashboardStats();

  const stats: Pick<StatsCardProps, "title" | "value" | "icon" | "href">[] =
    useMemo(() => {
      if (!data) return [];
      return [
        {
          title: "Entries",
          value: data.content.totalEntries,
          icon: <FileText className="h-3.5 w-3.5" />,
          href: ROUTES.COLLECTIONS,
        },
        {
          title: "Media",
          value: data.content.totalMedia,
          icon: <Image className="h-3.5 w-3.5" />,
          href: ROUTES.MEDIA,
        },
        {
          title: "Models",
          value: data.content.contentTypes,
          icon: <Layers className="h-3.5 w-3.5" />,
          href: ROUTES.COLLECTIONS,
        },
        {
          title: "Plugins",
          value: data.components,
          icon: <Puzzle className="h-3.5 w-3.5" />,
          href: ROUTES.COMPONENTS,
        },
        {
          title: "Singles",
          value: data.singles,
          icon: <Globe className="h-3.5 w-3.5" />,
          href: ROUTES.SINGLES,
        },
        {
          title: "Users",
          value: data.users,
          icon: <Users className="h-3.5 w-3.5" />,
          href: ROUTES.USERS,
        },
        {
          title: "Security",
          value: data.apiKeys,
          icon: <Key className="h-3.5 w-3.5" />,
          href: ROUTES.SETTINGS_API_KEYS,
        },
        {
          title: "Locales",
          value: 1,
          icon: <Languages className="h-3.5 w-3.5" />,
        },
      ];
    }, [data]);

  return (
    <Card className="border-border/60 bg-card/40 backdrop-blur-md rounded-[2.5rem] overflow-hidden transition-all duration-500 hover:border-primary/20">
      <CardHeader
        noBorder
        className="flex flex-row items-center justify-between space-y-0 px-8 pt-8 pb-4"
      >
        <div className="space-y-1">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground/40">
            Resource Inventory
          </CardTitle>
          <div className="h-1 w-6 bg-primary/30 rounded-full" />
        </div>
        <Link
          href={ROUTES.SETTINGS}
          className="text-[10px] font-black uppercase tracking-[0.2em] text-primary hover-unified transition-all flex items-center gap-2 px-4 py-2 rounded-full bg-primary/5 hover-unified"
        >
          Infrastructure <ChevronRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="px-6 pb-8">
        {isLoading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="flex items-center gap-3 py-10 text-[11px] font-bold uppercase tracking-widest text-destructive/60 justify-center bg-destructive/5 rounded-[2rem]">
            <AlertCircle className="h-4 w-4" />
            <span>Resource index synchronization failed</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {stats.map(stat => (
              <StatsCard
                key={stat.title}
                variant="compact"
                title={stat.title}
                value={stat.value}
                icon={stat.icon}
                href={stat.href}
                className="rounded-2xl bg-muted/10 border-border/10"
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
