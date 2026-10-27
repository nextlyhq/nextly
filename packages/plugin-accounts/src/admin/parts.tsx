"use client";

import type { JSX, ReactNode } from "react";

import type { StaffAccountSummary } from "../admin-contract";

/**
 * A moment as staff read it, in their own locale, or `none` when it has not
 * happened.
 */
export function formatWhen(at: string | null, none = "—"): string {
  return at === null ? none : new Date(at).toLocaleString();
}

/**
 * A short label, drawn with the theme's tokens alone, so it reads in both
 * of the admin's modes. `strong` marks a state staff should notice.
 */
function Tag({
  children,
  strong = false,
}: {
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <span
      className={
        strong
          ? "inline-flex items-center rounded-full border border-destructive bg-destructive px-2 text-xs font-medium text-destructive-foreground"
          : "inline-flex items-center rounded-full border border-border bg-muted px-2 text-xs font-medium text-muted-foreground"
      }
    >
      {children}
    </span>
  );
}

/** An account's states, as tags: verified or not, active or deactivated, and locked until a reset. */
export function AccountStates({
  account,
}: {
  account: Pick<StaffAccountSummary, "verified" | "active" | "resetRequired">;
}): JSX.Element {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Tag>{account.verified ? "Verified" : "Unverified"}</Tag>
      {account.active ? <Tag>Active</Tag> : <Tag strong>Deactivated</Tag>}
      {account.resetRequired ? <Tag strong>Reset required</Tag> : null}
    </span>
  );
}
