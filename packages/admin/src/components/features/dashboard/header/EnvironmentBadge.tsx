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

import type { DashboardEnvironment } from "@admin/types/dashboard/summary";

/** Each tone's badge: neutral as an outline, warning and critical in their status colours. */
const VARIANT = {
  neutral: "outline",
  warning: "warning",
  critical: "destructive",
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
      className="rounded-full px-[7px] py-[2px] font-mono text-[10.5px] font-medium uppercase"
      data-testid="dashboard-environment"
      data-tone={environment.tone}
    >
      {environment.label}
    </Badge>
  );
}
