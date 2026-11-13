"use client";

/**
 * The cells both of the Content overview's tables draw: a row's name with its
 * icon, a section's heading, a time, and the stand-ins while a row's figures
 * load or when there are none.
 *
 * @module components/features/content-overview/overview-cells
 */
import { Skeleton } from "@nextlyhq/ui";
import type { JSX, ReactNode } from "react";

import { Link } from "@admin/components/ui/link";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { contentIcon } from "@admin/lib/content-icons";
import { formatRelativeTime } from "@admin/lib/dashboard";

/** A row's name: the icon its kind draws in every list, and a link to it. */
export function RowName({
  kind,
  icon,
  label,
  href,
}: {
  kind: "collection" | "single";
  icon: string | null | undefined;
  label: string;
  href: string;
}): JSX.Element {
  const Icon = contentIcon(kind, icon);
  return (
    <Link
      href={href}
      className="inline-flex min-w-0 items-center gap-2 font-medium text-foreground hover:underline underline-offset-2"
    >
      <Icon
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-muted-foreground"
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** A figure still loading: a still shape where it will be. */
export function Pending(): JSX.Element {
  return (
    <span className="inline-flex">
      <Skeleton className="h-4 w-8" aria-hidden="true" />
      <span className="sr-only">Loading</span>
    </span>
  );
}

/** A cell with nothing to say, said as nothing rather than as a zero. */
export function NoValue({ label }: { label: string }): JSX.Element {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** When something happened, relative, with the exact instant on hover. */
export function When({ at }: { at: string }): JSX.Element {
  const instant = formatDateWithAdminTimezone(at, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return (
    <time dateTime={at} title={instant} className="text-muted-foreground">
      {formatRelativeTime(at)}
    </time>
  );
}

/**
 * A table's heading: its kind, how many it lists, and what one of them is
 * ("Many entries each"), as a section of the page.
 */
export function SectionHead({
  id,
  label,
  count,
  hint,
}: {
  id: string;
  label: string;
  count: number;
  hint: string;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2
        id={id}
        className="flex items-baseline gap-2 text-base font-semibold text-foreground"
      >
        {label}
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {count}
        </span>
      </h2>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

/** A group's heading above its own table, as quiet as a table's heading row. */
export function GroupHead({
  label,
  count,
}: {
  label: string;
  count: number;
}): JSX.Element {
  return (
    <h3 className="flex items-baseline gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
      <span className="font-medium tracking-normal tabular-nums">{count}</span>
    </h3>
  );
}

/** A table's cell for actions, named for assistive technology only. */
export const ACTIONS_HEADER: ReactNode = (
  <span className="sr-only">Actions</span>
);
