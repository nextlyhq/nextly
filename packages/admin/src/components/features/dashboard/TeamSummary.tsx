"use client";

/**
 * The dashboard's Team card: the people on the project, most recently active first, each with
 * their name, email, role and when they were last active.
 *
 * Drawn from what its `load` read from `system:team-people`: at most the card's "Number of
 * people", of the role its header's filter names, and how many that role has in all. The role
 * filter is the card's quick setting, which the frame draws in the header. The footer holds
 * Invite, for a reader who may add people, and, as its trailing link, "View all (N)" when the
 * list is cut or "All users" when it is not. The frame drew loading, no permission and error
 * before this is reached.
 *
 * @module components/features/dashboard/TeamSummary
 */

import type { TeamPersonData, TeamWidgetData } from "nextly/core-widget-data";
import type { DeclaredComponentProps } from "nextly/widget-result";
import type { JSX } from "react";

import { Plus } from "@admin/components/icons";
import { Button } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES, withQuery } from "@admin/constants/routes";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useNowTick } from "@admin/hooks/useNowTick";
import { formatRelativeTime } from "@admin/lib/dashboard";
import { cn } from "@admin/lib/utils";

import { FrameState } from "../widgets/frame/card-state";
import {
  CARD_FOOTER_LINK_CLASS,
  CardFooterContent,
} from "../widgets/frame/footer-slot";
import { countSpoken, countText } from "../widgets/frame/list-card";
import { useRowsDrawn } from "../widgets/frame/tier";
import { WidgetList } from "../widgets/kit/list";

import { STEP_BUTTON } from "./setup/step-buttons";

/** What the Team card is handed: its declaration's props, with the data its `load` answers. */
export type TeamSummaryProps = Omit<DeclaredComponentProps, "data"> & {
  data: TeamWidgetData;
};

/** The role filter's "everyone" value, as the card's declaration names it. */
const ALL_ROLES = "all";

/** What a row says for a person with no sign-in on record. */
export const NO_RECENT_SIGN_IN = "No recent sign-in";

export function TeamSummary({ data, settings }: TeamSummaryProps): JSX.Element {
  // The clock ticks, so "5m ago" moves on as time passes.
  const now = useNowTick();
  const role =
    typeof settings.role === "string" && settings.role !== ALL_ROLES
      ? settings.role
      : undefined;
  const showLastActive = settings.lastActive !== false;
  // The reader's "Number of people": the list draws that many, and the footer counts the
  // people drawn by the same rule, so "All users" never stands under a cut list.
  const limit = typeof settings.limit === "number" ? settings.limit : undefined;
  const drawn = useRowsDrawn(limit);
  const { people, total } = data;
  const footer = (
    <TeamFooter
      role={role}
      total={total}
      shown={Math.min(people.length, drawn)}
    />
  );
  if (people.length === 0) {
    return (
      <>
        <FrameState
          state={{
            kind: "empty",
            empty: {
              title:
                role === undefined
                  ? "No one here yet"
                  : "No one has this role yet",
            },
          }}
        />
        {footer}
      </>
    );
  }
  return (
    <>
      <WidgetList<TeamPersonData>
        rows={people}
        {...(limit === undefined ? {} : { limit })}
        title={nameOf}
        meta={person => (person.name === undefined ? [] : [person.email])}
        leading={person => <Initials person={person} />}
        trailing={person => (
          <RoleAndActivity
            role={person.role}
            lastActive={showLastActive ? lastActiveOf(person, now) : undefined}
          />
        )}
        spoken={person => spokenOf(person, showLastActive, now)}
      />
      {footer}
    </>
  );
}

/** What a person is called on the card: their name, or their email when they have none. */
function nameOf(person: TeamPersonData): string {
  return person.name ?? person.email;
}

/** When a person was last active, as the row says it. */
function lastActiveOf(person: TeamPersonData, now: number): string {
  return person.lastActiveAt === undefined
    ? NO_RECENT_SIGN_IN
    : formatRelativeTime(person.lastActiveAt, now);
}

/** The whole row as assistive technology reads it, each part separated by a pause. */
function spokenOf(
  person: TeamPersonData,
  showLastActive: boolean,
  now: number
): string {
  const active = lastActiveOf(person, now);
  return [
    nameOf(person),
    person.name === undefined ? undefined : person.email,
    person.role,
    showLastActive
      ? person.lastActiveAt === undefined
        ? active
        : `last active ${active}`
      : undefined,
  ]
    .filter(part => part !== undefined)
    .join(", ");
}

/** Up to two initials: the first letters of the first two words of the name, or the email's. */
export function initialsOf(person: TeamPersonData): string {
  const words = (person.name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 0
      ? words.slice(0, 2).map(word => Array.from(word)[0] ?? "")
      : [Array.from(person.email)[0] ?? ""];
  return letters.join("").toUpperCase();
}

/** A person's leading avatar: their initials in a circle, decorative beside their name. */
function Initials({ person }: { person: TeamPersonData }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="flex size-full items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-foreground"
    >
      {initialsOf(person)}
    </span>
  );
}

/** A row's end: the person's role as a chip, and when they were last active under it. */
function RoleAndActivity({
  role,
  lastActive,
}: {
  role: string | undefined;
  lastActive: string | undefined;
}): JSX.Element | null {
  if (role === undefined && lastActive === undefined) return null;
  return (
    <span className="flex min-w-0 flex-col items-end gap-0.5">
      {role !== undefined && (
        // A long role name is cut short, its whole name on hover, so the person's own name keeps
        // its room beside it.
        <span
          data-testid="team-role"
          title={role}
          className="inline-flex h-5.5 max-w-36 items-center rounded-md border border-border bg-card px-2 text-xs text-foreground"
        >
          <span className="truncate">{role}</span>
        </span>
      )}
      {lastActive !== undefined && (
        <span data-testid="team-last-active" className="text-[11.5px]">
          {lastActive}
        </span>
      )}
    </span>
  );
}

/**
 * The card's footer: Invite on the left, for a reader who may add people, and the trailing
 * link to the Users page on the right, "View all (N)" when the card holds fewer than the role
 * has, "All users" when it holds them all.
 */
function TeamFooter({
  role,
  total,
  shown,
}: {
  role: string | undefined;
  total: number;
  shown: number;
}): JSX.Element {
  const { hasPermission } = useCurrentUserPermissions();
  const canInvite = hasPermission("create-users");
  const cut = total > shown;
  const href =
    role === undefined ? ROUTES.USERS : withQuery(ROUTES.USERS, { role });
  return (
    <CardFooterContent rank="explicit">
      <div
        data-testid="team-footer"
        className="flex w-full min-w-0 items-center gap-3"
      >
        {canInvite && (
          <Button
            asChild
            variant="outline"
            size="sm"
            className={cn(STEP_BUTTON, "gap-1.5")}
          >
            <Link href={ROUTES.USERS_CREATE}>
              <Plus className="size-3.5" aria-hidden="true" />
              Invite
            </Link>
          </Button>
        )}
        <Link
          data-testid="team-view-all"
          href={href}
          className={cn(CARD_FOOTER_LINK_CLASS, "ml-auto")}
        >
          {cut ? (
            <>
              <span aria-hidden="true">
                View all ({countText(total, false)})
              </span>
              <span className="sr-only">
                View all, {countSpoken(total, false)}
              </span>
            </>
          ) : (
            "All users"
          )}
        </Link>
      </div>
    </CardFooterContent>
  );
}
