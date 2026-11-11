"use client";

import {
  Button,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@nextlyhq/ui";
import type React from "react";
import { useState, useEffect } from "react";

import { Menu } from "@admin/components/icons";
import { ErrorBoundary } from "@admin/components/shared/error-boundary";
import { ThemeAwareLogo } from "@admin/components/shared/ThemeAwareLogo";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useRouter } from "@admin/hooks/useRouter";

import {
  ChromeSuppressionProvider,
  useSuppressedChrome,
} from "../components/layout/ChromeSuppression";
import { DashboardHeader } from "../components/layout/header";
import { HeaderTrailProvider } from "../components/layout/header/HeaderTrail";
import { TopBarPlacesProvider } from "../components/layout/header/TopBarPlaces";
import { PanelFoldProvider } from "../components/layout/PanelFold";
import { SidebarProvider } from "../components/layout/sidebar";
import { DualSidebar } from "../components/layout/sidebar/DualSidebar";
import { DualSidebarOutline } from "../components/layout/sidebar/DualSidebarOutline";
import { RailFootPluginItemsProvider } from "../components/layout/sidebar/RailFootPluginItems";
import {
  SidePanelReservationProvider,
  useReservedInlineEnd,
} from "../components/layout/SidePanelReservation";
import {
  MAIN_CONTENT_ID,
  SkipToContent,
} from "../components/layout/SkipToContent";
import {
  ScreenWaitProvider,
  ScreenWaitSigns,
} from "../components/shared/loading-frame/screen-wait";
import { MediaProvider } from "../context/providers/MediaProvider";

interface DashboardLayoutProps {
  children: React.ReactNode;
  /**
   * Whether the server has confirmed the session. Until it has, the frame is
   * drawn with an outline of the sidebar, which reads none of the reader's
   * data, and `children` is the screen's outline rather than the screen.
   * Defaults to confirmed, for a caller that mounts the layout only after.
   */
  sessionConfirmed?: boolean;
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
 * - **Below 1024px**: the rail and its panel open in a drawer, from the menu
 *   button at the start of the top bar
 */
/**
 * The provider sits ABOVE the chrome and above `children`, because the surfaces
 * that ask for chrome to be hidden are rendered as `children` and React state
 * has to be lifted past both to be read by the one and written by the other.
 */
export function DashboardLayout({
  children,
  sessionConfirmed = true,
}: DashboardLayoutProps): React.JSX.Element {
  return (
    <ChromeSuppressionProvider>
      {/* Inside chrome suppression: a page folding its panel asks for the
          panel to go through it, and the bar reads the fold to draw its
          toggle. */}
      <PanelFoldProvider>
        <SidePanelReservationProvider>
          {/* Above the chrome for the same reason: the top bar draws the trail
            a page below it registers. */}
          <HeaderTrailProvider>
            {/* And the bar draws what a page puts in its places. */}
            <TopBarPlacesProvider>
              {/* Around the chrome and the screen: the screen reports its
                  wait, and the chrome draws the signs of it. */}
              <ScreenWaitProvider>
                <DashboardChrome sessionConfirmed={sessionConfirmed}>
                  {children}
                </DashboardChrome>
              </ScreenWaitProvider>
            </TopBarPlacesProvider>
          </HeaderTrailProvider>
        </SidePanelReservationProvider>
      </PanelFoldProvider>
    </ChromeSuppressionProvider>
  );
}

function DashboardChrome({
  children,
  sessionConfirmed = true,
}: DashboardLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const hidden = useSuppressedChrome();
  /*
   * The rail and the panel live in one component, so "hide the rail" is asked of
   * `DualSidebar` while "hide the whole sidebar column" is decided here. Hiding
   * the column only when BOTH are suppressed keeps a request for one of them
   * from silently taking the other.
   */
  const hideSidebarColumn =
    hidden.has("primaryRail") && hidden.has("subSidebar");
  const { pathname } = useRouter();
  const branding = useBranding();
  /*
   * A panel pinned to the window's edge is `position: fixed`, so it is outside
   * this column's layout and the column keeps its full width underneath it.
   * Padding the column is what turns "drawn over" into "beside": the header's
   * account controls and every document action move inboard of the panel
   * instead of sitting under it, unclickable and silent about it.
   */
  const reservedInlineEnd = useReservedInlineEnd();

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  return (
    <MediaProvider>
      <SidebarProvider defaultOpen className="h-full overflow-hidden">
        {/* Above every rail foot (the rail's, the drawer's and the bar's),
            so plugins' rail-foot items are mounted once, for as long as the
            layout is, and only moved into the foot that is showing. */}
        <RailFootPluginItemsProvider>
          <div className="h-full flex flex-col bg-background overflow-hidden relative w-full">
            {/* First in the tab order, ahead of the menu, rail and header, on
              every page this layout draws, the editor included. */}
            <SkipToContent />
            {/* The phone header: the logo and the menu button, drawn only while
              a surface has taken the top bar away (a document view such as
              the builder). Otherwise the menu button is in the top bar, so a
              phone gets the one bar every other width gets. */}
            {hidden.has("header") && (
              <div className="lg:hidden flex h-14 shrink-0 items-center justify-between  border-b border-border px-4 bg-background z-30">
                <div className="flex items-center gap-3 justify-between w-full flex-row-reverse">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-2 h-9 w-9 text-foreground"
                    onClick={() => setIsMobileMenuOpen(true)}
                  >
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Open the navigation menu</span>
                  </Button>
                  <div className="flex items-center gap-2">
                    {/* The one boxed mark the rail and sign-in show, or the
                      configured logo fitted to the same square. */}
                    <ThemeAwareLogo
                      boxed
                      alt={branding?.logoText ?? "Logo"}
                      className="size-7 object-contain"
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
            )}

            <div className="flex flex-1 min-h-0 overflow-hidden">
              {!hideSidebarColumn && (
                <div className="hidden lg:flex h-full overflow-hidden shrink-0">
                  {sessionConfirmed ? <DualSidebar /> : <DualSidebarOutline />}
                </div>
              )}

              <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                <SheetContent
                  side="left"
                  className="p-0 border-none w-auto max-w-[calc(100vw-2rem)] flex bg-transparent"
                >
                  {/* Screen-reader label for the drawer dialog. */}
                  <SheetTitle className="sr-only">Navigation menu</SheetTitle>
                  <SheetDescription className="sr-only">
                    Primary admin navigation
                  </SheetDescription>
                  {sessionConfirmed ? (
                    <DualSidebar isMobile />
                  ) : (
                    <DualSidebarOutline isMobile />
                  )}
                </SheetContent>
              </Sheet>

              {/* Main Content */}
              <div
                className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden relative transition-[padding] duration-150"
                style={{ paddingInlineEnd: reservedInlineEnd }}
              >
                {!hidden.has("header") && (
                  <DashboardHeader
                    onOpenMenu={() => setIsMobileMenuOpen(true)}
                  />
                )}
                {/* The line under the bar and the slow-start message, while
                  the screen waits; laid over the column, so they move
                  nothing. */}
                <ScreenWaitSigns />
                {/* Named container so content responds to the panel width
                  (viewport minus sidebar), not the viewport. */}
                {/* The skip link's target: an id to name, and tabIndex -1 so
                  focus can land on it without adding a Tab stop. */}
                <main
                  id={MAIN_CONTENT_ID}
                  tabIndex={-1}
                  className="@container/content flex-1 overflow-y-auto bg-transparent focus:outline-none"
                >
                  <ErrorBoundary
                    fallback={
                      <div className="flex h-full items-center justify-center bg-background p-6 text-center">
                        <div className="max-w-md rounded-lg bg-card p-6 shadow-xl  border border-border">
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
        </RailFootPluginItemsProvider>
      </SidebarProvider>
    </MediaProvider>
  );
}
