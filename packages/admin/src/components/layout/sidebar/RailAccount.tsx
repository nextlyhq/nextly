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
  pluginHeaderItems,
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
  const { flow, side, testId } = ACCOUNT_LAYOUT[placement];
  const inRail = placement === "rail";
  const footItemsShown = railFootItemsShown(
    placement,
    settled,
    branding?.plugins
  );
  const frameClass = useAccountFrameClass(
    placement,
    // The space above the foot is the items' box's while it shows; the gap
    // under it is the foot's own gap between items. The account's box is
    // held to the bottom, so its margin moves nothing.
    cn(className, footItemsShown && "mt-0")
  );

  const account = (
    <div
      className={frameClass}
      data-testid={testId}
      data-shell-answers={shellAnswersMarker(settled)}
    >
      {/* In the rail, the Inbox's and the avatar's shapes hold the foot
          until both can be drawn, so the rail never reads as missing them. */}
      {!settled && inRail ? <RailFootGhost /> : null}
      <div hidden={!settled} className={settled ? flow : undefined}>
        {/* Plugins' own items in the bar, before the Inbox. */}
        {!inRail && <RailFootPluginPlace />}
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
  return inRail ? (
    <>
      <RailFootPluginBox shown={footItemsShown} />
      {account}
    </>
  ) : (
    account
  );
}

/**
 * Whether the rail's box for plugins' foot items shows: in the rail, once the
 * answers are in, and only where a plugin places an item there.
 *
 * The items get a box of their own above the account's because the rail's
 * foot is held to the window's bottom: an item added inside the account's box
 * grew that box upwards, its top moving by an item's height as the answers
 * arrived, which the browser records as the shell moving, though the Inbox and
 * the avatar stayed where their shapes stood. A box of its own appears whole
 * instead, and the account's box keeps the size and the place its outline drew.
 */
function railFootItemsShown(
  placement: AccountPlacement,
  settled: boolean,
  plugins: Parameters<typeof pluginHeaderItems>[0]
): boolean {
  return (
    placement === "rail" &&
    settled &&
    pluginHeaderItems(plugins, "rail-foot").length > 0
  );
}

/**
 * Plugins' own items at the rail's foot, above the Inbox. Kept mounted while
 * hidden, so an item that only registers what a page needs runs before the
 * answers are in.
 */
function RailFootPluginBox({ shown }: { shown: boolean }): JSX.Element {
  return (
    <div
      hidden={!shown}
      data-testid="rail-foot-plugin-box"
      className={
        shown ? cn(ACCOUNT_LAYOUT.rail.flow, "mt-4 mb-2 shrink-0") : undefined
      }
    >
      <RailFootPluginPlace />
    </div>
  );
}
