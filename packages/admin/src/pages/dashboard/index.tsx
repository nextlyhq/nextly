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

          {/* Every card, through ONE grid.
 
              The seed prompt, the collection counts, the singles and the team
              summary used to be mounted here by name, above a grid that drew
              only what plugins contributed. That made two dashboards: a
              hardcoded half nobody could arrange and a managed half that was
              empty on every real install, because nothing contributed a widget.

              They are ordinary widgets now, registered by core under reserved
              `core#` paths with a declared `defaultOrder` that keeps the order
              this page had. Each still draws its own titled section -- their
              definitions decline the card frame -- so what a reader sees is
              unchanged while what they can arrange is the whole page.

              The stats grid stays deliberately absent: a row of counters above
              the resource sections competes with getting an editor to their
              content without answering a question they actually have. The
              component still ships and is cheap to restore, as a widget now. */}
          <WidgetGrid />
        </div>
      </PageContainer>
    </ErrorBoundary>
  );
};

export default DashboardPage;
