"use client";

/**
 * The environment the site config names, as a badge beside the project's name:
 * its label, drawn upper case, in the tone the config gives. Absent when the
 * config names none; never guessed from the process environment.
 *
 * @module components/features/dashboard/header/EnvironmentBadge
 */

import { Badge } from "@nextlyhq/ui";
import type { JSX } from "react";

import { cn } from "@admin/lib/utils";
import type { DashboardEnvironment } from "@admin/types/dashboard/summary";

/** Each tone's badge: neutral as an outline, warning and critical in their status colours. */
const VARIANT = {
  neutral: "outline",
  warning: "warning",
  critical: "destructive",
} as const;

/**
 * Each tone's edge, at least 3:1 against the page in both modes, so the badge reads as a badge
 * and not as loose text: the page's control border for the neutral outline, whose own hairline
 * border is under 1.4:1; and for warning and critical, whose pale fills alone are under 2:1, a
 * border in the badge's own text colour, which already clears 4.5:1 on that fill.
 */
const EDGE = {
  neutral: "border-control-border dark:border-control-border",
  warning: "border border-current",
  critical: "border border-current",
} as const;

export function EnvironmentBadge({
  environment,
}: {
  environment: DashboardEnvironment;
}): JSX.Element {
  return (
    <Badge
      variant={VARIANT[environment.tone]}
      // A pill in monospace, small beside the 20px name, as the approved design draws it.
      className={cn(
        "rounded-full px-[7px] py-[2px] font-mono text-[10.5px] font-medium uppercase",
        EDGE[environment.tone]
      )}
      data-testid="dashboard-environment"
      data-tone={environment.tone}
    >
      {environment.label}
    </Badge>
  );
}
