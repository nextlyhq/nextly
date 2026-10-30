"use client";

import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";
import { useMemo } from "react";

import { AlertTriangle, Check } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";

import { ENTITY_LEADING_CLASS } from "../widgets/frame/entity-row";

import {
  systemHealthLines,
  type HealthLine,
  type HealthSeverity,
} from "./system-health-model";

/**
 * System health, for super-admins: the Nextly version, whether migrations are
 * applied, and whether storage is working.
 *
 * A declared widget's view: the frame draws loading and error, and this draws
 * the three lines `load` answered, always all three, since "up to date" and
 * "working" are answers too. Each line leads with its severity, by shape as
 * well as colour, then its name and state, and a link for each problem.
 *
 * The root carries the `system-health` anchor that the system problems in
 * Needs your attention link to.
 */
export const SystemHealthCard: React.FC<DeclaredComponentProps> = ({
  data,
}) => {
  const lines = useMemo(() => systemHealthLines(data), [data]);
  return (
    <div id="system-health" data-testid="system-health">
      <ul className="grid divide-y divide-border">
        {lines.map(line => (
          <HealthRow key={line.id} line={line} />
        ))}
      </ul>
    </div>
  );
};

SystemHealthCard.displayName = "SystemHealthCard";

/** A severity as assistive technology hears it before the line. */
function severityName(severity: HealthSeverity): string {
  if (severity === "critical") return "Problem";
  if (severity === "warning") return "Warning";
  return "OK";
}

/** One line: its severity, its name and state, any detail, then its links. */
function HealthRow({ line }: { line: HealthLine }) {
  return (
    <li
      className="flex min-w-0 items-start gap-2.5 py-2"
      data-testid={`system-health-${line.id}`}
    >
      <SeverityMark severity={line.severity} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            {line.label}
          </span>
          <span
            className="truncate text-sm font-medium text-foreground"
            data-testid="system-health-value"
          >
            {line.value}
          </span>
        </span>
        {line.detail !== undefined && (
          <span
            className="truncate text-xs text-muted-foreground"
            data-testid="system-health-detail"
          >
            {line.detail}
          </span>
        )}
        {line.links.length > 0 && (
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            {line.links.map(link =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className="font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                >
                  {link.label}
                </Link>
              )
            )}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * A line's severity, told apart by shape as well as colour, so a reader who
 * cannot tell green from red still can: a check when all is well, a triangle
 * for a warning, and "!" in a filled circle for a problem. Its name is said in
 * words to assistive technology.
 */
function SeverityMark({ severity }: { severity: HealthSeverity }) {
  return (
    <span
      data-testid={`system-health-${severity}`}
      className={cn(
        "flex shrink-0 items-center justify-center",
        ENTITY_LEADING_CLASS.compact
      )}
    >
      {severity === "critical" && (
        <span
          aria-hidden="true"
          data-shape="filled-circle"
          className="flex size-4 items-center justify-center rounded-full bg-destructive-solid text-[10px] font-bold text-destructive-foreground"
        >
          !
        </span>
      )}
      {severity === "warning" && (
        <AlertTriangle
          aria-hidden="true"
          data-shape="triangle"
          className="size-4 text-warning"
        />
      )}
      {severity === "ok" && (
        <Check
          aria-hidden="true"
          data-shape="check"
          className="size-4 text-success"
        />
      )}
      <span className="sr-only">{severityName(severity)}</span>
    </span>
  );
}
