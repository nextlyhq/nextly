/**
 * Who changed what, most recent first.
 *
 * Drawn as the dashboard card `core/recent-activity`, inside the dashboard's
 * frame, which draws its heading and every state; this component draws the
 * rows, and reports an empty feed or an unreadable answer for the frame to say.
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

import { Avatar, AvatarFallback, AvatarImage, Badge } from "@nextlyhq/ui";
import { Clock } from "lucide-react";
import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";

import { MoreExist } from "@admin/components/features/widgets/archetypes/more-exist";
import { FrameState } from "@admin/components/features/widgets/frame/card-state";
import { useListCard } from "@admin/components/features/widgets/frame/list-slot";
import { activityFromRow } from "@admin/hooks/queries/useRecentActivity";
import { formatRelativeTime } from "@admin/lib/dashboard";
import { cn } from "@admin/lib/utils";
import type { Activity } from "@admin/types/dashboard/activity";

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
 * Nothing to show: reported to the frame, which draws the dashboard's one empty
 * state in this card's words, as every other card says it.
 */
const EmptyState: React.FC = () => (
  <FrameState
    state={{
      kind: "empty",
      empty: {
        title: "No activity yet",
        detail: "Changes people make to your content show here.",
      },
    }}
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
 * The frame draws every state; what this card's own answer says beyond its
 * rows (still loading, an unreadable answer, or an empty feed) it reports.
 */
export const RecentActivityCard: React.FC<WidgetComponentProps> = props => {
  // See `RecentActivity` below: a relative time is read again as time passes.
  const { drawn, now, read } = useListCard(props);
  const { query } = props;
  if ("node" in read) return read.node;
  // A row this build cannot read is left out rather than drawn from guesses.
  const activities = read.list.items.flatMap(row => {
    const activity = activityFromRow(row);
    return activity ? [activity] : [];
  });
  if (activities.length === 0) return <EmptyState />;
  return (
    <div className="space-y-2">
      <ActivityRows activities={activities.slice(0, drawn)} now={now} />
      {read.list.items.length > drawn && <MoreExist query={query} />}
    </div>
  );
};

RecentActivityCard.displayName = "RecentActivityCard";
