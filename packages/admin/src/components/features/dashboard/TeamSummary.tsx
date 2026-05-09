"use client";

import { Card, CardContent, Skeleton } from "@nextlyhq/ui";
import { AlertCircle, ShieldCheck, Users as UsersIcon } from "lucide-react";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useDashboardStats } from "@admin/hooks/queries";

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
      className="block group h-full rounded-none overflow-hidden border border-border bg-card transition-colors duration-200 hover-subtle-row hover:border-primary/30"
    >
      <Card
        variant="interactive"
        className="h-full !border-0 !bg-transparent transition-colors duration-200 rounded-none overflow-hidden relative"
      >
        <CardContent className="p-5 relative z-10">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground leading-none group-hover:text-primary transition-colors">
                {count}
              </span>
              <h5 className="font-semibold text-xs tracking-tight transition-colors leading-tight text-muted-foreground group-hover:text-primary pt-1">
                {label}
              </h5>
            </div>
            <div className="text-muted-foreground/60 group-hover:text-primary transition-colors pt-1">
              <Icon className="h-5 w-5 shrink-0" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {Array.from({ length: 2 }, (_, i) => (
        <Skeleton
          key={i}
          className="h-24 rounded-none bg-muted/30 border border-border"
        />
      ))}
    </div>
  );
}

export const TeamSummary: React.FC = () => {
  const { data, isLoading, error } = useDashboardStats();

  return (
    <section aria-labelledby="dashboard-team-heading" className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1">
          <h4
            id="dashboard-team-heading"
            className="text-sm font-semibold tracking-tight text-foreground whitespace-nowrap"
          >
            Team
          </h4>
          <div className="h-px flex-1 bg-border" />
        </div>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="flex items-center gap-2 py-6 text-sm text-destructive justify-center bg-destructive/5 border border-destructive/20 rounded-none">
          <AlertCircle className="h-4 w-4" />
          <span>Couldn&apos;t load team summary.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TeamCard
            label="Users"
            count={data?.users ?? 0}
            href={ROUTES.USERS}
            Icon={UsersIcon}
          />
          <TeamCard
            label="Roles"
            count={data?.roles ?? 0}
            href={ROUTES.SECURITY_ROLES}
            Icon={ShieldCheck}
          />
        </div>
      )}
    </section>
  );
};
