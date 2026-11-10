"use client";

/**
 * The foot of the icon rail: the reader's Inbox (notifications, with the
 * unread count) and their account menu.
 *
 * They lived at the right end of the top bar on every page. At the rail's
 * foot they stay in one place whatever the page, and the bar is left to the
 * page's own breadcrumb and actions. Docs, GitHub, Discord and the theme are
 * in the account menu.
 */
import type { JSX } from "react";

import { NotificationBell } from "@admin/components/features/notifications";
import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import { useLogout } from "@admin/hooks/useLogout";
import { cn } from "@admin/lib/utils";

import {
  computeHiddenHeaderButtons,
  headerControlsSettled,
  type HeaderAnswersPending,
} from "../header/header-visibility";
import { shellAnswersMarker } from "../lib/shell-answers";

import { useNextDevOverlay } from "./use-next-dev-overlay";
import { UserProfileDropdown } from "./UserProfileDropdown";

export function RailAccount({
  className,
}: {
  className?: string;
}): JSX.Element {
  const branding = useBranding();
  const hidden = computeHiddenHeaderButtons(branding?.plugins);
  const { isPending: workspacePending } = useBrandingStatus();
  const bellOffered = !hidden.has("notifications");

  return bellOffered ? (
    <AwaitingPermissions
      className={className}
      workspacePending={workspacePending}
    />
  ) : (
    <RailAccountItems
      className={className}
      pending={{ workspace: workspacePending, permissions: false }}
      bellOffered={false}
    />
  );
}

/**
 * The bell is the one item that waits on the reader's permissions, so they are
 * read only where it is offered; elsewhere nothing would use the answer.
 */
function AwaitingPermissions({
  className,
  workspacePending,
}: {
  className?: string;
  workspacePending: boolean;
}): JSX.Element {
  const { isLoading } = useCurrentUserPermissions();
  return (
    <RailAccountItems
      className={className}
      pending={{ workspace: workspacePending, permissions: isLoading }}
      bellOffered
    />
  );
}

function RailAccountItems({
  className,
  pending,
  bellOffered,
}: {
  className?: string;
  pending: HeaderAnswersPending;
  bellOffered: boolean;
}): JSX.Element {
  const { user } = useDashboardUser();
  const logout = useLogout();
  const branding = useBranding();
  const hidden = computeHiddenHeaderButtons(branding?.plugins);
  const journalOffered = branding?.showBuilder !== false;
  // Drawn only once every answer it depends on is in, so neither the bell nor
  // the avatar arrives after the rest and moves the foot.
  const settled = headerControlsSettled(pending, bellOffered);
  // Next.js draws its development badge in the bottom-left corner, over the
  // rail's foot, while the host runs `next dev`.
  const devOverlay = useNextDevOverlay();

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2",
        // In development the rail keeps its foot clear below the avatar, so
        // Next.js's development badge (bottom-left by default) sits in that
        // space instead of over the avatar.
        devOverlay && "pb-16",
        className
      )}
      data-testid="rail-account"
      data-shell-answers={shellAnswersMarker(settled)}
    >
      <div
        hidden={!settled}
        className={settled ? "flex flex-col items-center gap-2" : undefined}
      >
        {bellOffered && (
          <NotificationBell
            journalOffered={journalOffered}
            side="right"
            align="end"
          />
        )}
        <UserProfileDropdown
          user={user}
          onLogout={() => {
            void logout();
          }}
          hidden={hidden}
          side="right"
          align="end"
        />
      </div>
    </div>
  );
}
