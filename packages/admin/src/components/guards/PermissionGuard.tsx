"use client";

import { Spinner } from "@nextlyhq/ui";
import type React from "react";
import { useEffect, useState } from "react";

import { PageContainer } from "@admin/components/layout/page-container";
import { SectionErrorFallback } from "@admin/components/shared/error-fallbacks";
import { NoAccessPage } from "@admin/components/shared/no-access-page";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import {
  DEFAULT_MARK_PATHS,
  DEFAULT_MARK_VIEWBOX,
} from "@admin/lib/branding/default-mark";
import { cn } from "@admin/lib/utils";
import type { AccessSubject, EntityAccess } from "@admin/types/access-subject";

interface PermissionGuardProps {
  /**
   * Permission required to access this route. A single slug (e.g. "read-users"),
   * or a list of slugs treated as any-of — holding any one grants access. The
   * list form models a backend umbrella permission (e.g. "update-webhooks"
   * satisfying read/create/delete) without duplicating a route per slug.
   */
  requiredPermission: string | string[];
  /** What the route opens, so a refusal can name it; absent for other pages. */
  subject?: AccessSubject;
  /**
   * What a collection or Single route asks of its entity. Given, the route is
   * decided by the server's answer about that entity, code rules included,
   * rather than by `requiredPermission`.
   */
  entity?: EntityAccess;
  children: React.ReactNode;
}

/**
 * Route-level permission guard.
 *
 * Checks if the current user has the required permission before rendering
 * the protected page. Must be used inside `PrivateRoute` (auth is already verified).
 *
 * - Super-admin bypasses all permission checks
 * - While permissions are loading, shows a loading spinner
 * - If permission is denied, shows the no-access page in place of the route,
 *   at the address that was asked for. It never redirects: a silent trip to
 *   the dashboard reads as a broken link rather than as a refusal.
 */
export function PermissionGuard({
  requiredPermission,
  subject,
  entity,
  children,
}: PermissionGuardProps): React.JSX.Element {
  const access = useCurrentUserPermissions();
  const { hasPermission, canAccessCollection, content, retry } = access;
  const [isForceLoading, setIsForceLoading] = useState(false);
  // A collection or Single route is decided by the server's answer about its
  // entity alone, and any other route by the permission list alone, so a
  // failure of either leaves the pages the other decides open.
  const decidedBy = entity ? content : access;
  const { hasAnswer, error } = decidedBy;
  const hasAccess = entity
    ? canAccessCollection(entity.slug, entity.action)
    : Array.isArray(requiredPermission)
      ? requiredPermission.some(hasPermission)
      : hasPermission(requiredPermission);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug_loading") === "true") {
        setIsForceLoading(true);
      }
    }
  }, []);

  // While the content language changes, the answer for the one moved from
  // stays on screen until the new one's arrives (`content.isPlaceholder`).
  // The page this guard has open for the same entity stays mounted through
  // it, so the editor keeps its place; that answer grants nothing on the page,
  // and the route is decided again on the new one. Any other route waits for
  // the new answer as on a first visit, never opened on the old one's word.
  // Each settled answer decides what is open: the entity it opens, or nothing
  // once it refuses, so a page refused in one language is not reopened on the
  // way to the next.
  const entityKey = entity ? `${entity.slug}:${entity.action}` : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const switching = entity !== undefined && content.isPlaceholder;
  const settledOpen = hasAccess ? entityKey : null;
  if (!switching && hasAnswer && settledOpen !== openedFor) {
    setOpenedFor(settledOpen);
  }

  if (switching && openedFor === entityKey && !isForceLoading) {
    return <>{children}</>;
  }

  const isLoading = decidedBy.isLoading || isForceLoading || switching;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] h-[60vh] w-full animate-fade-in relative">
        {/* Ambient glowing background decoration */}
        <div className="absolute w-[280px] h-[280px] rounded-full bg-primary/5 dark:bg-primary/10 blur-[80px] pointer-events-none -z-10 animate-brand-pulse" />

        {/* Premium glassmorphic container card */}
        {/* The hairline uses `border`, whose token is already a low-alpha ink
            that inverts per mode, so the card keeps one edge under any theme. */}
        <div className="flex flex-col items-center text-center p-8 md:p-12 rounded-lg border border-border bg-card/40 backdrop-blur-xl shadow-soft-primary max-w-sm w-full mx-auto relative overflow-hidden transition-all duration-300">
          {/* Brand Mark Orbiter Loader */}
          <div className="relative w-20 h-20 mb-8 flex items-center justify-center">
            {/* Shared UI Spinner component */}
            <Spinner className="absolute inset-0 w-full h-full text-primary/80" />

            {/* Inner branding prisms */}
            <div className="w-8 h-8 animate-brand-pulse flex items-center justify-center z-10">
              <svg
                viewBox={DEFAULT_MARK_VIEWBOX}
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full text-primary fill-current"
                role="img"
                aria-label="Nextly Logo"
              >
                {DEFAULT_MARK_PATHS.map((d, index) => (
                  <path
                    key={index}
                    d={d}
                    className={cn(
                      "transition-all duration-700 ease-premium",
                      index === 0
                        ? "opacity-100 dark:opacity-95"
                        : "opacity-85 dark:opacity-80"
                    )}
                  />
                ))}
              </svg>
            </div>
          </div>

          <h2 className="text-base font-semibold tracking-tight text-foreground mb-1.5">
            Setting up your workspace
          </h2>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground font-medium leading-relaxed">
            Verifying permissions and loading data...
          </p>
        </div>
      </div>
    );
  }

  // No answer is not a refusal. With the first request failed, the
  // permissions are empty for everyone, a super-admin included, and saying
  // "you don't have access" would be a claim nothing supports.
  if (!hasAnswer && error) {
    return (
      <PageContainer className="py-8">
        <SectionErrorFallback
          title="Couldn't check your access"
          description="The admin couldn't load your permissions, so it can't tell whether you can open this page."
          error={error}
          reset={retry}
        />
      </PageContainer>
    );
  }

  if (!hasAccess) {
    return <NoAccessPage subject={subject} />;
  }

  return <>{children}</>;
}
