/**
 * Dashboard Page
 *
 * Content-editor-centric dashboard with two-column responsive layout.
 * All widgets handle their own loading/error states via TanStack Query.
 *
 * @module pages/dashboard
 */

"use client";

import { Alert, AlertDescription, Button } from "@nextlyhq/ui";
import type React from "react";

import { GreetingActionProvider } from "@admin/components/features/dashboard/GreetingAction";
import { WelcomeHeader } from "@admin/components/features/dashboard/WelcomeHeader";
import { WidgetGrid } from "@admin/components/features/widgets/WidgetGrid";
import { AlertCircle } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { ErrorBoundary } from "@admin/components/shared/error-boundary";
import { TargetSlot } from "@admin/components/shared/target-slot";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";

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
        {/* The fallback replaces the whole page, welcome heading included, so
            its title is the page's one level-one heading: a person jumping by
            heading lands on what went wrong. It names the problem rather than
            sitting beside a second "Dashboard" heading, and keeps the alert
            title's look (AlertTitle itself is an h5). */}
        <h1
          data-slot="alert-title"
          className="mb-1 text-sm font-semibold leading-tight tracking-tight"
        >
          The dashboard couldn&apos;t load
        </h1>
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

/**
 * The page's own two parts, the dashboard place's built-ins `welcome` and
 * `widgets`, with plugins' blocks around them in the order the server sent,
 * each behind its own boundary, after the grid unless placed before it. The
 * grid itself is passed through as it is, and no plugin may replace it.
 *
 * Its own component, inside the page's error boundary, so reading who is
 * looking can fail into the dashboard's crash screen like the rest.
 */
function DashboardPlace(): React.ReactNode {
  const { user } = useDashboardUser();
  // What a plugin's block here is told: who is looking. Held while the viewer
  // is not known yet, so no block is handed an id that is not theirs.
  const placeContext = user ? { userId: user.id } : null;
  return (
    <TargetSlot
      place="dashboard"
      context={placeContext}
      builtIns={{
        welcome: <WelcomeHeader />,
        widgets: <WidgetGrid />,
      }}
    />
  );
}

const DashboardPage: React.FC = () => {
  return (
    <ErrorBoundary fallback={DashboardErrorFallback}>
      <PageContainer>
        {/* The greeting row's own bottom margin is the space above the cards, as
            the approved design draws it. No padding of its own above or
            below: the page container's is every admin page's, so the greeting
            starts where other pages' headings do. */}
        {/* No entrance motion: the greeting and the cards replace the
            dashboard's outline where it stands, and sliding them in would
            move every part the outline had placed. */}
        <div className="max-w-[1600px] mx-auto">
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
          {/* Above both the greeting and the grid: the grid draws its cog
              into the greeting row's place. */}
          <GreetingActionProvider>
            <DashboardPlace />
          </GreetingActionProvider>
        </div>
      </PageContainer>
    </ErrorBoundary>
  );
};

export default DashboardPage;
