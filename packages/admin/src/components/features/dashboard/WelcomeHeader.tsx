"use client";

import { Skeleton } from "@revnixhq/ui";

import { useSeedStatus } from "@admin/hooks/queries/useSeedStatus";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";

function getFirstName(name: string | undefined | null): string {
  if (!name) return "there";
  const first = name.split(" ")[0];
  return first || "there";
}

/**
 * Top-of-dashboard welcome strip.
 *
 * Hidden when the SeedDemoContentCard is the active CTA (idle / seeding /
 * success / success-partial / error states) so the seed flow gets the
 * stage on first visit. Reappears once the user dismisses or completes
 * seeding, and on every subsequent visit.
 *
 * Copy is intentionally neutral — works for both first-time visitors and
 * returners, since the dashboard surfaces content + schemas + team
 * regardless of when you came back.
 */
export function WelcomeHeader() {
  const { user, isLoading: userLoading } = useDashboardUser();
  const { status: seedStatus } = useSeedStatus();

  // Hide while the seed card is the dominant CTA. Only show once seeding
  // is hidden (probe missing, completed, or skipped).
  if (seedStatus.kind !== "loading" && seedStatus.kind !== "hidden") {
    return null;
  }

  if (userLoading) {
    return (
      <div className="space-y-2 pb-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
    );
  }

  return (
    <div className="space-y-1 pb-4">
      <h1 className="text-xl font-semibold tracking-[-0.04em] text-foreground leading-tight">
        Welcome,{" "}
        <span className="text-primary/90">{getFirstName(user?.name)}</span>
      </h1>
      <p className="text-sm font-normal text-muted-foreground tracking-tight">
        Manage your content, schemas, and team from one place.
      </p>
    </div>
  );
}
