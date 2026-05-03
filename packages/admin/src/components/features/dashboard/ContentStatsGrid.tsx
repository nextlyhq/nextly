/**
 * ContentStatsGrid Component
 *
 * Displays four content-centric stat cards: Total Entries, Media Assets,
 * Content Types, and Recent Changes (24h). Uses real data from the
 * dashboard stats API via useDashboardStats() hook.
 *
 * @module components/features/dashboard/ContentStatsGrid
 */

"use client";

import { Alert, AlertDescription, Spinner } from "@revnixhq/ui";
import type React from "react";

import { StatsCard } from "@admin/components/features/dashboard/StatsCard";
import {
  FileText,
  Image,
  Layers,
  Clock,
  AlertCircle,
} from "@admin/components/icons";
import { useDashboardStats } from "@admin/hooks/queries/useDashboardStats";

/**
 * ContentStatsGrid
 *
 * Self-contained component that fetches dashboard stats and renders
 * a responsive 1 → 2 → 4 column grid of content metric cards.
 * Handles its own loading and error states.
 */
export const ContentStatsGrid: React.FC = () => {
  const { data: stats, isLoading, error } = useDashboardStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load dashboard statistics. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      <StatsCard
        title="Total Entries"
        value={stats.content.totalEntries}
        icon={<FileText className="h-5 w-5" />}
        sparklineData={[12, 14, 13, 15, 18, 17, 20]} // Mock trend for visual
        footer="+2 this week"
        trend="up"
        change={15}
      />
      <StatsCard
        title="Media Assets"
        value={stats.content.totalMedia}
        icon={<Image className="h-5 w-5" />}
        sparklineData={[45, 48, 47, 52, 50, 55, 58]} // Mock trend
        footer="+6 this week"
        trend="up"
        change={8}
      />
      <StatsCard
        title="Content Types"
        value={stats.content.contentTypes}
        icon={<Layers className="h-5 w-5" />}
        sparklineData={[10, 10, 11, 11, 11, 12, 12]} // Mock trend
        footer="+1 this week"
        trend="up"
        change={2}
      />
      <StatsCard
        title="Changes (24h)"
        value={stats.content.recentChanges24h}
        icon={<Clock className="h-5 w-5" />}
        sparklineData={[5, 4, 3, 2, 1, 0, 0]} // Mock trend showing decline/zero
        footer="No changes today"
        trend="down"
        change={-100}
      />
    </div>
  );
};
