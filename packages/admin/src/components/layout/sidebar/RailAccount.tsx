"use client";

/**
 * The foot of the icon rail: plugins' own items placed there, the reader's
 * Inbox (notifications, with the unread count) and their account menu.
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
  pluginUserMenuItems,
  type HeaderAnswersPending,
} from "../header/header-visibility";
import { shellAnswersMarker } from "../lib/shell-answers";

import { RailFootGhost } from "./RailColumn";
import { RailFootPluginPlace } from "./RailFootPluginItems";
import { useNextDevOverlay } from "./use-next-dev-overlay";
import { UserProfileDropdown } from "./UserProfileDropdown";

/**
 * Where the Inbox and the account menu are drawn: the rail's foot, or the top
 * bar's right end while a surface has taken the rail away and kept the bar.
 */
export type AccountPlacement = "rail" | "bar";

export function RailAccount({
  className,
  placement = "rail",
}: {
  className?: string;
  placement?: AccountPlacement;
}): JSX.Element {
  const branding = useBranding();
  const hidden = computeHiddenHeaderButtons(branding?.plugins);
  const { isPending: workspacePending } = useBrandingStatus();
  const bellOffered = !hidden.has("notifications");

  return bellOffered ? (
    <AwaitingPermissions
      className={className}
      placement={placement}
      workspacePending={workspacePending}
    />
  ) : (
    <RailAccountItems
      className={className}
      placement={placement}
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
  placement,
  workspacePending,
}: {
  className?: string;
  placement: AccountPlacement;
  workspacePending: boolean;
}): JSX.Element {
  const { isLoading } = useCurrentUserPermissions();
  return (
    <RailAccountItems
      className={className}
      placement={placement}
      pending={{ workspace: workspacePending, permissions: isLoading }}
      bellOffered
    />
  );
}

/**
 * How the controls sit in each place. In the rail they stack and open to its
 * right, and keep the foot clear below the avatar for Next.js's development
 * badge (bottom-left by default). In the bar they sit in a row and open
 * downwards, lined up with the bar's right edge, nowhere near the badge.
 */
const ACCOUNT_LAYOUT = {
  rail: {
    flow: "flex flex-col items-center gap-2",
    side: "right",
    devSpace: "pb-16",
    testId: "rail-account",
  },
  bar: {
    flow: "flex items-center gap-1",
    side: "bottom",
    devSpace: undefined,
    testId: "bar-account",
  },
} as const satisfies Record<
  AccountPlacement,
  {
    flow: string;
    side: "right" | "bottom";
    devSpace: string | undefined;
    testId: string;
  }
>;

/**
 * The class of the foot's own box in `placement`: its flow, and in the rail
 * the space kept clear for Next.js's development badge (bottom-left), which
 * Next.js draws over the rail's foot while the host runs `next dev`. One
 * answer for the foot and for its outline drawn before the session is
 * confirmed, so the outline's shapes stand exactly where the foot lands.
 */
function useAccountFrameClass(
  placement: AccountPlacement,
  className: string | undefined
): string {
  const devOverlay = useNextDevOverlay();
  const { flow, devSpace } = ACCOUNT_LAYOUT[placement];
  return cn(flow, devOverlay && devSpace, className);
}

/**
 * The rail's foot before the reader is known: the Inbox's and the avatar's
 * shapes, in the foot's own box, so the real foot replaces them in place.
 */
export function RailAccountOutline({
  className,
}: {
  className?: string;
}): JSX.Element {
  return (
    <div
      className={useAccountFrameClass("rail", className)}
      data-testid="rail-account-outline"
    >
      <RailFootGhost />
    </div>
  );
}

function RailAccountItems({
  className,
  placement,
  pending,
  bellOffered,
}: {
  className?: string;
  placement: AccountPlacement;
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
  const frameClass = useAccountFrameClass(placement, className);
  const { flow, side, testId } = ACCOUNT_LAYOUT[placement];

  return (
    <div
      className={frameClass}
      data-testid={testId}
      data-shell-answers={shellAnswersMarker(settled)}
    >
      {/* In the rail, the Inbox's and the avatar's shapes hold the foot
          until both can be drawn, so the rail never reads as missing them. */}
      {!settled && placement === "rail" ? <RailFootGhost /> : null}
      <div hidden={!settled} className={settled ? flow : undefined}>
        {/* Plugins' own items at the rail's foot, before the Inbox. */}
        <RailFootPluginPlace />
        {bellOffered && (
          <NotificationBell
            journalOffered={journalOffered}
            side={side}
            align="end"
          />
        )}
        <UserProfileDropdown
          user={user}
          onLogout={() => {
            void logout();
          }}
          hidden={hidden}
          pluginItems={pluginUserMenuItems(branding?.plugins)}
          side={side}
          align="end"
        />
      </div>
    </div>
  );
}
