/**
 * Dashboard Page
 *
 * Content-editor-centric dashboard with two-column responsive layout.
 * All widgets handle their own loading/error states via TanStack Query.
 *
 * @module pages/dashboard
 */

"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@nextlyhq/ui";
import type React from "react";

import { CollectionQuickLinks } from "@admin/components/features/dashboard/CollectionQuickLinks";
import { SeedDemoContentCard } from "@admin/components/features/dashboard/SeedDemoContentCard";
import { SinglesQuickLinks } from "@admin/components/features/dashboard/SinglesQuickLinks";
import { TeamSummary } from "@admin/components/features/dashboard/TeamSummary";
import { WelcomeHeader } from "@admin/components/features/dashboard/WelcomeHeader";
import { WidgetGrid } from "@admin/components/features/widgets/WidgetGrid";
import { AlertCircle } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { ErrorBoundary } from "@admin/components/shared/error-boundary";

/**
 * DashboardErrorFallback Component
 *
 * Error fallback UI displayed when the dashboard encounters an unexpected error.
 */
const DashboardErrorFallback = (
  <PageContainer>
    <div className="flex min-h-[400px] items-center justify-center">
      <Alert variant="destructive" className="max-w-2xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Dashboard Error</AlertTitle>
        <AlertDescription className="mt-2 space-y-3">
          <p>
            An unexpected error occurred while loading the dashboard. This could
            be due to a network issue or a temporary problem with the server.
          </p>
          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            size="md"
          >
            Reload Page
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  </PageContainer>
);

const DashboardPage: React.FC = () => {
  return (
    <ErrorBoundary fallback={DashboardErrorFallback}>
      <PageContainer>
        <div className="max-w-[1600px] mx-auto space-y-12 py-6 lg:py-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          {/* Top Section: Welcome and Actions */}
          <div className="space-y-2">
            <WelcomeHeader />
          </div>

          {/* Seed demo content card — visible only when the project ships
              a seed route and the meta flags aren't set. Hides itself
              entirely when not applicable, so blank-template projects and
              already-seeded/skipped projects render nothing here. */}
          <SeedDemoContentCard />

          {/* The stats grid is deliberately absent: the dashboard's job here is
              to get an editor to their content, and a row of counters above the
              resource sections competes with that without answering a question
              an editor actually has. Kept commented rather than deleted because
              the component still ships and is cheap to restore. */}
          {/* <ContentStatsGrid /> */}

          <div className="space-y-12">
            {/* Resource sections: Collections, Singles, Team. Each section
                handles its own loading / error / empty states; SinglesQuickLinks
                hides itself entirely when the project has no singles. */}
            <CollectionQuickLinks />
            <SinglesQuickLinks />
            <TeamSummary />
          </div>

          {/* The widget grid: every contributed widget, permission-gated, in a
              12-column layout that collapses to one column below `md`, with a
              single batched request behind all of them. Renders nothing when no
              plugin contributes a widget the current user may see.

              This REPLACED `PluginWidgetGrid`, which nothing mounts any more:
              it reads the same contributions, plus the registry the older grid
              could not see. `PluginWidgetGrid` itself is still in the tree,
              kept alive only by its own test, and is deleted with the core
              widget migration. */}
          <WidgetGrid />
        </div>
      </PageContainer>
    </ErrorBoundary>
  );
};

export default DashboardPage;
