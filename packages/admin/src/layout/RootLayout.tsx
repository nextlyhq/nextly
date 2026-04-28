"use client";
import { PortalProvider } from "@revnixhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { Suspense, lazy, useEffect, useState } from "react";
import { toast } from "sonner";

import { PermissionGuard } from "../components/guards/PermissionGuard";
import { PrivateRoute } from "../components/guards/PrivateRoute";
import { PublicRoute } from "../components/guards/PublicRoute";
import { Toaster } from "../components/ui/toaster";
import { BrandingProvider } from "../context/providers/BrandingProvider";
import { GeneralSettingsSyncProvider } from "../context/providers/GeneralSettingsSyncProvider";
import { ThemeProvider, useTheme } from "../context/providers/ThemeProvider";
import { RestartProvider } from "../context/RestartContext";
import { useRouter } from "../hooks/useRouter";
import { cn } from "../lib/utils";

import "../styles/globals.css";
import { DashboardLayout } from "./DashboardLayout";

const RestartOverlay = lazy(() =>
  import("../components/features/schema-builder/RestartOverlay").then(m => ({
    default: m.RestartOverlay,
  }))
);

/**
 * Admin App Content component
 * Handles theme synchronization via React state instead of manual DOM manipulation.
 */
function AdminAppContent() {
  const { route, isHydrated } = useRouter();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const queryClient = useQueryClient();

  // Listen for external schema changes (code-first or another tab).
  // The fetcher detects X-Nextly-Schema-Version header bumps and dispatches this event.
  useEffect(() => {
    const handler = () => {
      toast.info("Schema updated externally, refreshing...");
      // void: the cache invalidations are fire-and-forget; downstream
      // queries refetch on their own when they observe the new key state.
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["entries"] });
      void queryClient.invalidateQueries({ queryKey: ["singles"] });
      void queryClient.invalidateQueries({ queryKey: ["components"] });
    };
    window.addEventListener("nextly:schema-updated", handler);
    return () => window.removeEventListener("nextly:schema-updated", handler);
  }, [queryClient]);

  // Show loading until BOTH hydration is complete AND the route has been resolved.
  if (!isHydrated || !route) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center adminapp">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  const { Component, params, searchParams, routeType, requiredPermission } =
    route;

  // Wrap component with appropriate route guard
  const renderComponent = () => {
    const componentElement = (
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        }
      >
        <Component params={params} searchParams={searchParams} />
      </Suspense>
    );

    if (routeType === "private") {
      const content = requiredPermission ? (
        <PermissionGuard requiredPermission={requiredPermission}>
          {componentElement}
        </PermissionGuard>
      ) : (
        componentElement
      );

      return (
        <PrivateRoute>
          <div className="flex-1 min-h-0 h-full overflow-hidden">
            <DashboardLayout>{content}</DashboardLayout>
          </div>
        </PrivateRoute>
      );
    }

    if (routeType === "public") {
      return <PublicRoute>{componentElement}</PublicRoute>;
    }

    return componentElement;
  };

  return (
    <div className={cn("adminapp", isDark && "dark")} suppressHydrationWarning>
      <PortalProvider container={portalRoot}>
        <BrandingProvider>
          <GeneralSettingsSyncProvider>
            {/* Conditional wrapper: Public routes need centering and padding, private routes don't */}
            {routeType === "public" ? (
              <div className="min-h-screen bg-background flex flex-col justify-center text-foreground">
                {renderComponent()}
              </div>
            ) : (
              <div className="h-screen overflow-hidden bg-background text-foreground flex flex-col">
                {renderComponent()}
              </div>
            )}
            {/* Restart overlay for schema save flow */}
            <Suspense fallback={null}>
              <RestartOverlay />
            </Suspense>
            {/* Toaster uses default position (bottom-right) per component spec */}
            <Toaster richColors />
            {/* Portal root for dialogs, dropdowns, etc. Synchronized with theme class. */}
            <div
              id="adminapp-portal-root"
              ref={setPortalRoot}
              className={cn("adminapp", isDark && "dark")}
            />
          </GeneralSettingsSyncProvider>
        </BrandingProvider>
      </PortalProvider>
    </div>
  );
}

const RootLayout = (): React.ReactElement => {
  return (
    <ThemeProvider>
      <RestartProvider>
        <AdminAppContent />
      </RestartProvider>
    </ThemeProvider>
  );
};

export { RootLayout };
