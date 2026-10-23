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
import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";

import { MoreExist } from "@admin/components/features/widgets/archetypes/more-exist";
import {
  CardEmpty,
  CardError,
  CardSkeleton,
  CardUnavailable,
} from "@admin/components/features/widgets/frame/states";
import {
  rowsDrawn,
  useCardTier,
  useRowsTier,
} from "@admin/components/features/widgets/frame/tier";
import { AlertCircle } from "@admin/components/icons";
import {
  activityFromRow,
  useRecentActivity,
} from "@admin/hooks/queries/useRecentActivity";
import { useNowTick } from "@admin/hooks/useNowTick";
import { formatRelativeTime } from "@admin/lib/dashboard";
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
 * How many saves one row stands for: "· 12 times", or "· 1000+ times" when the
 * server stopped reading inside the run. The dot is drawn and not read; a
 * screen reader hears "updated Site style, 12 times".
 */
const RepeatCount: React.FC<{ activity: Activity }> = ({ activity }) => (
  <span className="text-muted-foreground font-medium">
    <span aria-hidden="true"> · </span>
    <span className="sr-only">, </span>
    {activity.count ?? 1}
    {activity.countAtLeast === true ? "+" : ""} times
  </span>
);

/**
 * Single Activity Item Component
 *
 * Displays a single activity entry with avatar, description, and badge.
 */
const ActivityItem: React.FC<{ activity: Activity; now: number }> = ({
  activity,
  // Passed down rather than each row starting its own clock: one timer per
  // CARD, not one per row, and every row then names the same instant.
  now,
}) => {
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
              {/* A Single's row has no collection to name: its title is the
                  Single's label, and the chip would repeat nothing true. */}
              {activity.collectionLabel !== undefined && (
                <span className="text-muted-foreground font-bold uppercase text-xs tracking-widest ml-1 bg-primary/5 px-1.5 py-0.5 rounded-md">
                  {activity.collectionLabel}
                </span>
              )}
            </>
          ) : (
            <span className="font-bold text-foreground tracking-tight">
              {activity.target}
            </span>
          )}
          {/* A floor is drawn even at one: "1+" says the server stopped reading inside it. */}
          {((activity.count ?? 1) > 1 || activity.countAtLeast === true) && (
            <RepeatCount activity={activity} />
          )}
        </p>

        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <Clock className="w-3 h-3 opacity-60" />
          {/*
            Derived HERE rather than carried on the entry. A relative time is a
            function of when it is read, and computing it while mapping the
            response froze it: an entry fetched as "just now" kept that label
            for as long as the query's data was reused. `dateTime` carries the
            absolute instant, so the machine-readable value is exact whatever
            the prose says.
          */}
          <time dateTime={activity.timestamp}>
            {formatRelativeTime(activity.timestamp, now)}
          </time>
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

/**
 * Nothing to show: the dashboard's one empty state, in this card's words, as
 * every other card says it.
 */
const EmptyState: React.FC = () => (
  <CardEmpty
    title="No activity yet"
    detail="Changes people make to your content show here."
  />
);

/** The rows of the feed, and nothing around them: one list, whichever card draws it. */
const ActivityRows: React.FC<{
  activities: readonly Activity[];
  now: number;
}> = ({ activities, now }) => (
  <div className="space-y-1">
    {activities.map(activity => (
      <ActivityItem key={activity.id} activity={activity} now={now} />
    ))}
  </div>
);

/**
 * The dashboard's Recent activity card, answered by `system:activity` in the
 * dashboard's batch: framed, so the heading and the size are the card's.
 *
 * It draws the rows its tier draws, at most the "Number of items" its reader
 * chose, from the query it asked, and says more exist when the answer holds
 * the one row more the batch asked for: the rule core's own lists follow. A
 * run of one person's saves is one row.
 *
 * A custom card owns its states, so each is drawn here with the frame's own:
 * the loading rows, "not available", an error, and the empty state.
 */
export const RecentActivityCard: React.FC<WidgetComponentProps> = ({
  slot,
  isFetching,
  query,
}) => {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  const drawn = rowsDrawn(useRowsTier(tier), query?.limit);
  // See `RecentActivity` below: a relative time is read again as time passes.
  const now = useNowTick();

  if (!slot) {
    return isFetching ? (
      <CardSkeleton shape="rows" rows={drawn} layout={{ kind: "list" }} />
    ) : null;
  }
  if (!slot.ok) {
    return slot.code === "unavailable" ? (
      <CardUnavailable />
    ) : (
      <CardError message={slot.error} title="Recent activity" />
    );
  }
  if (slot.result.op !== "list") {
    return (
      <CardError
        message="This card was answered with something other than a list."
        title="Recent activity"
      />
    );
  }
  // A row this build cannot read is left out rather than drawn from guesses.
  const activities = slot.result.items.flatMap(row => {
    const activity = activityFromRow(row);
    return activity ? [activity] : [];
  });
  if (activities.length === 0) return <EmptyState />;
  return (
    <div className="space-y-2">
      <ActivityRows activities={activities.slice(0, drawn)} now={now} />
      {slot.result.items.length > drawn && <MoreExist query={query} />}
    </div>
  );
};

RecentActivityCard.displayName = "RecentActivityCard";

/**
 * Recent activity as a section of its own, reading `GET /api/dashboard/activity`.
 *
 * @deprecated The dashboard draws {@link RecentActivityCard}, answered by the
 * `system:activity` widget source. This stays for code that renders the section
 * itself, and draws the same rows and the same empty state.
 */
export const RecentActivity: React.FC<RecentActivityProps> = ({
  limit = 5,
}) => {
  const { data, isLoading, error } = useRecentActivity(limit);
  /*
   * 🔴 Deriving the label at render is only half the repair. A render has to
   * HAPPEN, and a dashboard card nobody touches gets none -- so an entry
   * fetched as "just now" would keep that wording for as long as the page is
   * open, which is the same wrong label reached by a different route. This is
   * what makes the derivation run again.
   *
   * The value is passed to the formatter rather than discarded, so the label a
   * reader sees and the instant this hook re-rendered for are the same one.
   */
  const now = useNowTick();

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
            <ActivityRows activities={data.activities} now={now} />
          )}
        </div>
      )}
    </section>
  );
};

RecentActivity.displayName = "RecentActivity";
