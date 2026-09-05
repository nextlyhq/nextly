/**
 * Who changed what, most recent first.
 *
 * Drawn as the dashboard card `core/recent-activity`, which declares
 * `chrome: "none"` -- so this component owns its own heading and its own
 * loading, error and empty states, and draws the `<section>` shell its
 * neighbours draw rather than a `Card` the grid would frame a second time.
 *
 * ## It shows a fixed page and offers no way past it
 *
 * 🔴 That is the decision, not a gap. The server publishes `{ activities,
 * hasMore }` and deliberately no total -- counting the feed would mean
 * authorizing every matching row against its document's read rule, which is
 * unbounded over a table that only grows. So there is no "showing 5 of N" to
 * write, and the surveyed products (Strapi's audit widget, WordPress's activity
 * section, Sanity's document list) all answer the same way: a fixed handful of
 * rows, no in-widget pagination, no count.
 *
 * This component previously carried both of the controls that implies and
 * NEITHER worked: a "Detailed Log" link whose href was the dashboard the card
 * sits on, and a "Sync Previous Events" button with no handler. Each promised a
 * destination that does not exist -- there is no audit-log route in `ROUTES` at
 * all -- and both were removed rather than wired, because a feed with a
 * pagination affordance is the shape nothing else ships and the missing page is
 * a feature to decide on, not a link to point somewhere plausible.
 *
 * @module components/features/dashboard/RecentActivity
 */

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Spinner,
} from "@nextlyhq/ui";
import { Clock } from "lucide-react";
import type React from "react";

import { AlertCircle } from "@admin/components/icons";
import { useRecentActivity } from "@admin/hooks/queries/useRecentActivity";
import { cn } from "@admin/lib/utils";
import type { Activity } from "@admin/types/dashboard/activity";

/**
 * Props for RecentActivity component
 */
export interface RecentActivityProps {
  /** Maximum number of activities to display (default: 5) */
  limit?: number;
}

/**
 * Single Activity Item Component
 *
 * Displays a single activity entry with avatar, description, and badge.
 */
const ActivityItem: React.FC<{ activity: Activity }> = ({ activity }) => {
  const getBadgeStyle = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes("create"))
      return "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-100 ring-1 ring-success-500/20";
    if (t.includes("update"))
      return "bg-primary/5 text-primary ring-1 ring-primary/20";
    if (t.includes("delete"))
      return "bg-destructive-100 text-destructive-700 dark:bg-destructive-900 dark:text-destructive-100 ring-1 ring-destructive-500/20";
    return "bg-primary/5 text-muted-foreground ring-1 ring-border/50";
  };

  return (
    <div className="flex items-center gap-5 p-3 rounded-md hover:bg-primary/[0.03] transition-all duration-500 group/item">
      <div className="relative">
        <Avatar className="h-11 w-11 border-2 border-background shadow-sm ring-1 ring-border/10">
          <AvatarImage src={activity.user.avatar} alt={activity.user.name} />
          <AvatarFallback className="bg-primary/5 text-primary text-xs font-black">
            {activity.user.initials}
          </AvatarFallback>
        </Avatar>
        {/* Activity badge: a circle so it sits cleanly on the round avatar. */}
        <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-background p-0.5 shadow-sm ring-1 ring-border/10">
          <div
            className={cn(
              "h-full w-full rounded-full ring-1 ring-inset",
              activity.type.toLowerCase().includes("create")
                ? "bg-success-500 ring-success-500/40"
                : activity.type.toLowerCase().includes("delete")
                  ? "bg-destructive-500 ring-destructive-500/40"
                  : "bg-primary ring-primary/40"
            )}
          />
        </div>
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm text-foreground/80 leading-snug">
          <span className="font-bold text-foreground tracking-tight">
            {activity.user.name}
          </span>{" "}
          <span className="text-muted-foreground font-medium">
            {activity.action}
          </span>{" "}
          {activity.entryTitle ? (
            <>
              <span className="font-bold text-foreground tracking-tight underline decoration-primary/20 underline-offset-4">
                {activity.entryTitle}
              </span>{" "}
              <span className="text-muted-foreground font-bold uppercase text-xs tracking-widest ml-1 bg-primary/5 px-1.5 py-0.5 rounded-md">
                {activity.collectionLabel}
              </span>
            </>
          ) : (
            <span className="font-bold text-foreground tracking-tight">
              {activity.target}
            </span>
          )}
        </p>

        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <Clock className="w-3 h-3 opacity-60" />
          <time dateTime={activity.timestamp}>{activity.relativeTime}</time>
        </div>
      </div>

      <Badge
        className={cn(
          "uppercase text-xs px-2.5 py-0.5 rounded-sm font-black tracking-[0.15em] border-none shadow-none transition-all duration-500 group-hover/item:scale-105",
          getBadgeStyle(activity.type)
        )}
      >
        {activity.type}
      </Badge>
    </div>
  );
};

const EmptyState: React.FC = () => (
  <div className="py-20 text-center space-y-4">
    <div className="inline-flex p-6 rounded-lg bg-primary/5  border border-border">
      <Clock className="h-10 w-10 text-muted-foreground" />
    </div>
    <div className="space-y-1">
      <p className="text-sm font-bold text-foreground tracking-tight">
        Activity log is currently silent
      </p>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
        Actions will appear here as you work
      </p>
    </div>
  </div>
);

export const RecentActivity: React.FC<RecentActivityProps> = ({
  limit = 5,
}) => {
  const { data, isLoading, error } = useRecentActivity(limit);

  return (
    <section aria-labelledby="dashboard-activity-heading" className="space-y-6">
      <div className="flex items-center gap-4">
        <h4
          id="dashboard-activity-heading"
          className="text-sm font-semibold tracking-tight text-foreground whitespace-nowrap"
        >
          Recent activity
        </h4>
        <div className="h-px flex-1 bg-border" />
      </div>

      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Spinner size="md" className="text-primary/40" />
          <span className="text-sm text-muted-foreground">
            Loading activity…
          </span>
        </div>
      )}

      {error && (
        // Full-strength destructive border so the boundary is perceivable at
        // the 3:1 UI minimum, matching the other cards' error state.
        <div className="flex items-center gap-2 py-6 text-sm text-destructive justify-center bg-destructive/5 border border-destructive rounded-md">
          <AlertCircle className="h-4 w-4" />
          <span>Couldn&apos;t load recent activity.</span>
        </div>
      )}

      {data && !isLoading && !error && (
        <div className="space-y-1">
          {data.activities.length === 0 ? (
            <EmptyState />
          ) : (
            data.activities.map(activity => (
              <ActivityItem key={activity.id} activity={activity} />
            ))
          )}
        </div>
      )}
    </section>
  );
};

RecentActivity.displayName = "RecentActivity";
