"use client";

import { Card, CardContent } from "@nextlyhq/ui";
import { ShieldCheck, Users as UsersIcon } from "lucide-react";
import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

import { FrameState, readSlot } from "../widgets/frame/card-state";
import { CardFigure } from "../widgets/frame/figure";
import { useCardTier } from "../widgets/frame/tier";

/**
 * Compact "Team" summary on the dashboard. Two cards: total Users + total
 * Roles. Each card links to its respective Settings page.
 *
 * Each count is drawn only when the summary carries it: the server leaves out
 * a count the reader may not read, and drawing that as 0 would put back an
 * answer it withheld, and a wrong one.
 */

interface TeamCardProps {
  label: string;
  count: number;
  href: string;
  Icon: React.ElementType;
}

function TeamCard({ label, count, href, Icon }: TeamCardProps) {
  return (
    <Link
      href={href}
      // Full-strength hover border, more visible than the resting border, not a fainter alpha.
      className="block group h-full rounded-lg overflow-hidden border border-border bg-card transition-colors duration-200 hover-subtle-row hover:border-primary"
    >
      <Card
        variant="interactive"
        className="h-full border-0! bg-transparent! transition-colors duration-200 rounded-lg overflow-hidden relative"
      >
        <CardContent className="p-5 relative z-10">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              {/* The card type ramp's big number, through the one card formatter. */}
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground leading-none transition-colors">
                <CardFigure value={count} />
              </span>
              {/* A label, not a heading: the frame's title is the card's one heading. */}
              <span className="block font-medium text-xs tracking-tight transition-colors leading-tight text-muted-foreground group-hover:text-foreground pt-1">
                {label}
              </span>
            </div>
            <div className="text-muted-foreground group-hover:text-foreground transition-colors pt-1">
              <Icon className="h-5 w-5 shrink-0" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/** The count a `system:team` row carries for `figure`, or `undefined` when the source sent none. */
function figureOf(
  rows: readonly Record<string, unknown>[],
  figure: "users" | "roles"
): number | undefined {
  const row = rows.find(candidate => candidate.figure === figure);
  return typeof row?.count === "number" ? row.count : undefined;
}

/**
 * The dashboard's Team card, answered by `system:team` in the dashboard's batch.
 *
 * The source asks the card's gate itself, so a reader it refuses gets the
 * frame's one "not available" state, and it sends the roles figure only to a
 * reader who may see roles: a figure it did not send is not drawn, rather than
 * drawn as 0.
 */
export const TeamSummary: React.FC<WidgetComponentProps> = ({
  slot,
  isFetching,
  onRetry,
}) => {
  const read = readSlot(slot, {
    isFetching,
    skeleton: { shape: "figure" },
    onRetry,
  });
  if ("state" in read) return <FrameState state={read.state} />;
  const rows = read.result.op === "list" ? read.result.items : [];
  const users = figureOf(rows, "users");
  const roles = figureOf(rows, "roles");
  // Neither figure came: the frame's one unavailable state, rather than an empty body.
  if (users === undefined && roles === undefined) {
    return <FrameState state={{ kind: "no-access" }} />;
  }
  return <TeamTiles users={users} roles={roles} />;
};

/**
 * The team at the card's tier: the counts this reader may see, of which a small card draws the
 * first alone -- the number of people, when that is theirs to see. By the card's own width, never
 * the window's, so a narrow card on a wide screen does not squeeze two tiles into it.
 */
function TeamTiles({
  users,
  roles,
}: {
  users: number | undefined;
  roles: number | undefined;
}) {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  const tiles = [
    users === undefined ? null : (
      <TeamCard
        key="users"
        label="Users"
        count={users}
        href={ROUTES.USERS}
        Icon={UsersIcon}
      />
    ),
    roles === undefined ? null : (
      <TeamCard
        key="roles"
        label="Roles"
        count={roles}
        href={ROUTES.SECURITY_ROLES}
        Icon={ShieldCheck}
      />
    ),
  ].filter(tile => tile !== null);
  const drawn = tier === "small" ? tiles.slice(0, 1) : tiles;
  return (
    <div
      data-testid="team-summary"
      className={
        drawn.length > 1 ? "grid grid-cols-2 gap-4" : "grid grid-cols-1 gap-4"
      }
    >
      {drawn}
    </div>
  );
}
