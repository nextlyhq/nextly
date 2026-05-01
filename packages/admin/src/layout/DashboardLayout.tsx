import { Button, Sheet, SheetContent } from "@revnixhq/ui";
import type React from "react";
import { useState, useEffect } from "react";

import { Menu } from "@admin/components/icons";
import { ErrorBoundary } from "@admin/components/shared/error-boundary";
import { ThemeAwareLogo } from "@admin/components/shared/ThemeAwareLogo";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useRouter } from "@admin/hooks/useRouter";

import { DashboardHeader } from "../components/layout/header";
import { SidebarProvider } from "../components/layout/sidebar";
import { DualSidebar } from "../components/layout/sidebar/DualSidebar";
import { MediaProvider } from "../context/providers/MediaProvider";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Dashboard Layout Component
 *
 * Provides the main layout structure for the dashboard with responsive design.
 * Features a dual-sidebar system (Main Icon Sidebar + Detail Sub Sidebar).
 *
 * ## Responsive Behavior
 *
 * - **Desktop (≥ 1024px)**: Dual sidebar layout
 * - **Mobile (< 768px)**: Mobile header with a Sheet-based drawer
 */
export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { pathname } = useRouter();
  const branding = useBranding();

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  return (
    <MediaProvider>
      <SidebarProvider defaultOpen className="h-full overflow-hidden">
        <div className="h-full flex flex-col bg-background overflow-hidden relative w-full">
          {/* Mobile Header */}
          <div className="md:hidden flex h-14 shrink-0 items-center justify-between border-b border-border px-4 bg-background z-30">
            <div className="flex items-center gap-3 justify-between w-full flex-row-reverse">
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 h-9 w-9 text-foreground"
                onClick={() => setIsMobileMenuOpen(true)}
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle mobile menu</span>
              </Button>
              <div className="flex items-center gap-2">
                <ThemeAwareLogo
                  alt={branding?.logoText ?? "Logo"}
                  className="h-5 w-auto object-contain"
                />
                {!branding?.logoUrl &&
                  !branding?.logoUrlLight &&
                  !branding?.logoUrlDark && (
                    <span className="text-sm font-semibold tracking-tight text-foreground">
                      {branding?.logoText ?? "Nextly"}
                    </span>
                  )}
              </div>
            </div>
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="hidden md:flex h-full overflow-hidden shrink-0">
              <DualSidebar />
            </div>

            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetContent
                side="left"
                className="p-0 border-none w-auto max-w-[calc(100vw-2rem)] flex bg-transparent"
              >
                <DualSidebar isMobile />
              </SheetContent>
            </Sheet>

            {/* Main Content */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden relative">
              <DashboardHeader />
              <main className="flex-1 overflow-y-auto bg-transparent">
                <ErrorBoundary
                  fallback={
                    <div className="flex h-full items-center justify-center bg-background p-6 text-center">
                      <div className="max-w-md rounded-lg bg-card p-6 shadow-xl border border-border">
                        <h2 className="text-xl font-bold text-foreground mb-2">
                          Something went wrong
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Failed to load the dashboard content. Please try
                          refreshing the page.
                        </p>
                      </div>
                    </div>
                  }
                >
                  {children}
                </ErrorBoundary>
              </main>
            </div>
          </div>
        </div>
      </SidebarProvider>
    </MediaProvider>
  );
}
