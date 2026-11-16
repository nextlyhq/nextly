"use client";

import type React from "react";
import { useEffect, useState } from "react";

import { PageContainer } from "@admin/components/layout/page-container";
import { SectionErrorFallback } from "@admin/components/shared/error-fallbacks";
import { ScreenOutlineFor } from "@admin/components/shared/loading-frame/screen-outline-for";
import { NoAccessPage } from "@admin/components/shared/no-access-page";
import { useRoutedPathname } from "@admin/context/RoutedPathnameContext";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
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
/**
 * Whether the route opens: a collection or Single route as the server's answer
 * about its entity says, any other as the permission list does, any one of
 * several slugs sufficing.
 */
function routeAllows(
  entity: EntityAccess | undefined,
  requiredPermission: string | string[],
  canAccessCollection: (
    slug: string,
    action: EntityAccess["action"]
  ) => boolean,
  hasPermission: (slug: string) => boolean
): boolean {
  if (entity) return canAccessCollection(entity.slug, entity.action);
  return Array.isArray(requiredPermission)
    ? requiredPermission.some(hasPermission)
    : hasPermission(requiredPermission);
}

export function PermissionGuard({
  requiredPermission,
  subject,
  entity,
  children,
}: PermissionGuardProps): React.JSX.Element {
  const access = useCurrentUserPermissions();
  // The routed address, which says whose outline to draw while this waits.
  const pathname = useRoutedPathname();
  const { hasPermission, canAccessCollection, content, retry } = access;
  const [isForceLoading, setIsForceLoading] = useState(false);
  // A collection or Single route is decided by the server's answer about its
  // entity alone, and any other route by the permission list alone, so a
  // failure of either leaves the pages the other decides open.
  const decidedBy = entity ? content : access;
  const { hasAnswer, error } = decidedBy;
  const hasAccess = routeAllows(
    entity,
    requiredPermission,
    canAccessCollection,
    hasPermission
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug_loading") === "true") {
        setIsForceLoading(true);
      }
    }
  }, []);

  // While a change of content language is answered, the answer on screen is
  // the language moved from (`content.isPlaceholder`). A collection or Single
  // route waits for the new one, as on a first visit: its page reads the new
  // language's document, which that old answer does not let it show.
  const switching = entity !== undefined && content.isPlaceholder;
  const isLoading = decidedBy.isLoading || isForceLoading || switching;

  // The screen's outline while its permissions arrive, as while the session
  // was checked and as the screen draws while its data loads: one outline
  // for the whole wait, which the screen replaces where it stands.
  if (isLoading) {
    return <ScreenOutlineFor pathname={pathname ?? ""} />;
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
