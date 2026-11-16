"use client";
// `toast` comes from @nextlyhq/ui, not sonner directly: the Toaster mounted
// below is ui's, and sonner keeps its queue in module state, so a toast
// published into admin's own bundled copy would never reach that Toaster.
import { PortalProvider, ShortcutProvider, toast } from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ADMIN_ROBOTS } from "nextly/config";
import type React from "react";
import { Suspense, lazy, useEffect, useState } from "react";

import { SessionStallNotice } from "../components/guards/AdminPending";
import { BuilderGuard } from "../components/guards/BuilderGuard";
import { PermissionGuard } from "../components/guards/PermissionGuard";
import { PrivateRoute } from "../components/guards/PrivateRoute";
import { PublicRoute } from "../components/guards/PublicRoute";
import { WaitClockContext } from "../components/shared/loading-frame/delayed-reveal";
import { ScreenOutlineFor } from "../components/shared/loading-frame/screen-outline-for";
import { PluginPageRegistrar } from "../components/shared/plugin-page-registrar";
import { Toaster } from "../components/ui/toaster";
import { AdminI18nProvider } from "../context/providers/AdminI18nProvider";
import { AdminStartupScript } from "../context/providers/AdminStartupScript";
import { BrandingProvider } from "../context/providers/BrandingProvider";
import { DocumentTitleProvider } from "../context/providers/DocumentTitleProvider";
import { GeneralSettingsSync } from "../context/providers/GeneralSettingsSync";
import {
  ThemePaintScript,
  ThemeProvider,
  useTheme,
} from "../context/providers/ThemeProvider";
import { RestartProvider } from "../context/RestartContext";
import { RoutedPathnameContext } from "../context/RoutedPathnameContext";
import { invalidateContentCaches } from "../hooks/schema-change-invalidation";
import { useRouter } from "../hooks/useRouter";
import { cn } from "../lib/utils";
import LoginPage from "../pages/(auth)/login";
import { RouteLoadingOutline } from "../pages/route-loading-outline";

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
function AdminAppContent({ nonce }: RootLayoutProps) {
  const { route, isHydrated, pathname, routedAt } = useRouter();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const queryClient = useQueryClient();

  // Listen for external schema changes (code-first or another tab).
  // The fetcher detects X-Nextly-Schema-Version header bumps and dispatches this event.
  useEffect(() => {
    const handler = () => {
      toast.info("Schema updated externally, refreshing...");
      invalidateContentCaches(queryClient);
    };
    window.addEventListener("nextly:schema-updated", handler);
    return () => window.removeEventListener("nextly:schema-updated", handler);
  }, [queryClient]);

  // Show loading until BOTH hydration is complete AND the route has been resolved.
  // Render an empty themed container so the layout doesn't flash a mismatched
  // background during the cold-load gap.
  if (!isHydrated || !route) {
    // The server renders this placeholder, so it is what the browser paints
    // first. The script inside applies the saved theme to it before that
    // paint, which is why its class may differ from what hydration expects.
    return (
      <div
        className={cn(
          "min-h-screen bg-background nextly-admin",
          isDark && "dark"
        )}
        suppressHydrationWarning
      >
        {/* The startup request, sent as the browser reads this page rather
            than once the admin's code has loaded; the admin takes it. */}
        <AdminStartupScript nonce={nonce} />
        <ThemePaintScript nonce={nonce} />
        {/* Nothing but the admin's own surface: before its code runs the
            admin cannot know the screen, nor whether this browser has signed
            in here, and a spinner that a fast load replaces at once is the
            flash the frame exists to avoid. The frame or the sign-in form
            paints as soon as the code runs, before any request answers. */}
      </div>
    );
  }

  const {
    Component,
    params,
    searchParams,
    routeType,
    requiredPermission,
    accessSubject,
    entityAccess,
    requiresBuilder,
  } = route;

  // Wrap component with appropriate route guard
  const renderComponent = () => {
    // Suspense lets React handle suspended lazy chunks gracefully; fallback
    // is null because we don't render a load indicator during transitions.
    // A private screen's code arriving shows the screen's outline, which is
    // also what it shows while its data loads, so the outline stays put.
    // The same while a lazily fetched route's code arrives (`lazyRoute`).
    const routeOutline =
      routeType === "private" ? <ScreenOutlineFor pathname={pathname} /> : null;
    const suspended = (
      <Suspense fallback={routeOutline}>
        <RouteLoadingOutline.Provider value={routeOutline}>
          <Component params={params} searchParams={searchParams} />
        </RouteLoadingOutline.Provider>
      </Suspense>
    );

    // Builder routes are unreachable where the builder is disabled, even by
    // URL. Wraps inside the permission guard so permissions still decide first.
    const componentElement = requiresBuilder ? (
      <BuilderGuard>{suspended}</BuilderGuard>
    ) : (
      suspended
    );

    if (routeType === "private") {
      const content = requiredPermission ? (
        <PermissionGuard
          requiredPermission={requiredPermission}
          subject={accessSubject}
          entity={entityAccess}
        >
          {componentElement}
        </PermissionGuard>
      ) : (
        componentElement
      );

      // One frame for both moments: while the session is checked it draws
      // the screen's outline and no data, and once the server confirms it,
      // the screen. The same layout element across both, so the frame is
      // never redrawn when the answer lands.
      return (
        <PrivateRoute
          signIn={
            // In the admin's column, scrolling on its own where the form is
            // taller than the window.
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <LoginPage />
            </div>
          }
        >
          {confirmed => (
            <div className="flex-1 min-h-0 h-full overflow-hidden">
              <DashboardLayout sessionConfirmed={confirmed}>
                {confirmed ? (
                  content
                ) : (
                  <>
                    <ScreenOutlineFor pathname={pathname} />
                    <SessionStallNotice />
                  </>
                )}
              </DashboardLayout>
            </div>
          )}
        </PrivateRoute>
      );
    }

    if (routeType === "public") {
      return <PublicRoute>{componentElement}</PublicRoute>;
    }

    return componentElement;
  };

  // Everything the settings sync would wrap. Held in a variable because the
  // provider around it is now conditional — see the comment at its use.
  const content = (
    <>
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
        id="nextly-admin-portal-root"
        ref={setPortalRoot}
        className={cn("nextly-admin", isDark && "dark")}
      />
    </>
  );

  return (
    <div
      className={cn("nextly-admin", isDark && "dark")}
      suppressHydrationWarning
    >
      <PortalProvider container={portalRoot}>
        <BrandingProvider>
          {/* The interface language every screen's strings are read in: the
              signed-in person's own choice, else the browser's, where the
              admin has a catalog for it, else English. Inside branding, which
              carries the plugins' catalogs. */}
          <AdminI18nProvider signedIn={routeType !== "public"}>
            {/* Keeps the plugin page route registry in sync with admin-meta (D21). */}
            <PluginPageRegistrar />
            {/* The settings sync applies the admin timezone to date rendering,
              and mounting it starts the ["generalSettings"] query — an
              endpoint gated by settings permissions, so on the signed-out
              screens (login, register, forgot password, setup) the query
              can only fail and retry once while the form waits on nothing
              it needs. The sign-in form drawn in place on a private route
              mounts it too, so the query itself also waits for a signed-in
              session (`useGeneralSettings`). It renders nothing and sits beside the subtree
              rather than around it, for the load-bearing reasons recorded
              on GeneralSettingsSync itself. */}
            {routeType !== "public" && <GeneralSettingsSync />}
            {/* Names the browser tab after the routed screen and the site. Inside
            branding, which supplies the site's name, and around the screen,
            whose detail pages add the name of the item they show. Rendered
            only once a route is resolved, so the host's own title stands
            until the admin knows which screen it is on. */}
            <DocumentTitleProvider route={route} pathname={pathname}>
              {/* The address the router drew this screen for, which a screen
              writing the address compares with the bar's. */}
              <RoutedPathnameContext.Provider value={pathname}>
                {/* When the browser arrived at this screen: every loading
                    sign in it is timed from here. */}
                <WaitClockContext.Provider value={routedAt ?? null}>
                  {content}
                </WaitClockContext.Provider>
              </RoutedPathnameContext.Provider>
            </DocumentTitleProvider>
          </AdminI18nProvider>
        </BrandingProvider>
      </PortalProvider>
    </div>
  );
}

/**
 * Adds the admin's robots tag to the head in the browser where the page has
 * none, for an app whose admin layout predates exporting `adminMetadata` as
 * its metadata. That export puts the tag in the first HTML the server sends;
 * this cannot, since the admin streams in after the head has gone, but a
 * crawler that runs the page still reads it. One tag, never a second: a
 * robots tag already in the head, the layout's or any other, is left as it is.
 * Only the tag added here is taken away again.
 */
function AdminRobotsFallback(): null {
  useEffect(() => {
    if (document.head.querySelector('meta[name="robots"]')) return;
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = ADMIN_ROBOTS;
    document.head.append(tag);
    return () => tag.remove();
  }, []);
  return null;
}

/** The admin's root layout's settings. */
export interface RootLayoutProps {
  /**
   * The nonce a `script-src` Content Security Policy needs. The admin paints
   * its saved theme, and sends its startup request, with small inline scripts
   * before the first paint, which such a policy blocks without it.
   */
  nonce?: string;
}

const RootLayout = ({ nonce }: RootLayoutProps = {}): React.ReactElement => {
  return (
    <>
      {/* The admin's robots tag, where the app's layout has not put one in
          the head (\`AdminRobotsFallback\`). */}
      <AdminRobotsFallback />
      <ThemeProvider nonce={nonce}>
        <RestartProvider>
          {/*
          The admin's one keydown listener, and the root of the shortcut layer stack. It sits
          above everything so precedence follows the component tree: a dialog or an editor canvas
          registers deeper and therefore outranks the shell without either naming a number the
          other has to stay clear of.
        */}
          <ShortcutProvider>
            <AdminAppContent nonce={nonce} />
          </ShortcutProvider>
        </RestartProvider>
      </ThemeProvider>
    </>
  );
};

export { RootLayout };
