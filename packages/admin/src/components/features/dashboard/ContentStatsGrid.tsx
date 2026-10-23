/**
 * ContentStatsGrid Component
 *
 * Displays four content-centric stat cards: Total Entries, Media Assets,
 * Content Types, and Recent Changes (24h). Uses real data from the
 * dashboard stats API via useDashboardStats() hook, and nothing else: no
 * trend, sparkline or "this week" line, since nothing records the history
 * one could be drawn from, and an invented one beside a real number reads
 * as a fact.
 *
 * @module components/features/dashboard/ContentStatsGrid
 */

"use client";

import { Alert, AlertDescription, Spinner } from "@nextlyhq/ui";
import type React from "react";

import { StatsCard } from "@admin/components/features/dashboard/StatsCard";
import { cardNumber } from "@admin/components/features/widgets/frame/format";
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
      />
      {/* Left out, not drawn as 0, when the reader may not read media. */}
      {stats.content.totalMedia !== undefined && (
        <StatsCard
          title="Media Assets"
          value={stats.content.totalMedia}
          icon={<Image className="h-5 w-5" />}
        />
      )}
      <StatsCard
        title="Content Types"
        value={stats.content.contentTypes}
        icon={<Layers className="h-5 w-5" />}
      />
      <StatsCard
        title="Changes (24h)"
        // A floor when the server stopped counting at its bound, written as every bounded count
        // on the dashboard is: `1,000+`.
        value={
          stats.content.recentChanges24hAtLeast
            ? cardNumber(stats.content.recentChanges24h, { floor: true }).text
            : stats.content.recentChanges24h
        }
        icon={<Clock className="h-5 w-5" />}
      />
    </div>
  );
};
