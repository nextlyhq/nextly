/**
 * Dashboard Page
 *
 * Content-editor-centric dashboard with two-column responsive layout.
 * All widgets handle their own loading/error states via TanStack Query.
 *
 * @module pages/dashboard
 */

"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@revnixhq/ui";
import React from "react";

import { CollectionQuickLinks } from "@admin/components/features/dashboard/CollectionQuickLinks";
import { WelcomeHeader } from "@admin/components/features/dashboard/WelcomeHeader";
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
            size="sm"
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

          {/* Widgets are intentionally omitted per user request to focus on resource organization */}
          {/* <ContentStatsGrid /> */}

          <div className="space-y-12">
            {/* Main Resource Surface */}
            <div className="relative">
              <CollectionQuickLinks />
            </div>
          </div>
        </div>
      </PageContainer>
    </ErrorBoundary>
  );
};

export default DashboardPage;
