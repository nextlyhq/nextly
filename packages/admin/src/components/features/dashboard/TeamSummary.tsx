"use client";

import { Card, CardContent } from "@nextlyhq/ui";
import { ShieldCheck, Users as UsersIcon } from "lucide-react";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useDashboardStats } from "@admin/hooks/queries";

import { CardFigure } from "../widgets/frame/figure";
import { CardError, CardSkeleton } from "../widgets/frame/states";
import { useCardTier } from "../widgets/frame/tier";

/**
 * Compact "Team" summary on the dashboard. Two cards: total Users + total
 * Roles. Each card links to its respective Settings page.
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

export const TeamSummary: React.FC = () => {
  const { data, isLoading, error, refetch } = useDashboardStats();

  // The card's frame draws its title, so this is only its body: the two counts, or the
  // frame's own skeleton and error while they are not there.
  if (isLoading) return <CardSkeleton shape="figure" />;
  if (error) {
    return (
      <CardError
        title="Team"
        message="The team summary couldn't be loaded."
        onRetry={() => void refetch()}
      />
    );
  }
  return <TeamTiles users={data?.users ?? 0} roles={data?.roles ?? 0} />;
};

/**
 * The team at the card's tier: a small card is the number of people alone, and a wider one adds
 * the roles beside it. By the card's own width, never the window's, so a narrow card on a wide
 * screen does not squeeze two tiles into it.
 */
function TeamTiles({ users, roles }: { users: number; roles: number }) {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  return (
    <div
      data-testid="team-summary"
      className={
        tier === "small" ? "grid grid-cols-1 gap-4" : "grid grid-cols-2 gap-4"
      }
    >
      <TeamCard
        label="Users"
        count={users}
        href={ROUTES.USERS}
        Icon={UsersIcon}
      />
      {tier !== "small" && (
        <TeamCard
          label="Roles"
          count={roles}
          href={ROUTES.SECURITY_ROLES}
          Icon={ShieldCheck}
        />
      )}
    </div>
  );
}
