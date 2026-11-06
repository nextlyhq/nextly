/**
 * Who changed what, most recent first: each row says who created, saved,
 * published, unpublished or deleted which entry or Single.
 *
 * Drawn as the dashboard card `core/team-activity`, inside the dashboard's
 * frame, which draws its heading and every state; this component draws the
 * rows, and reports an empty feed or an unreadable answer for the frame to say.
 * The server answers only events about what the reader may read, so every row
 * drawn, and the one row more its `load` asks for, is one they may see.
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
 * @module components/features/dashboard/TeamActivity
 */

import { Avatar, AvatarFallback, AvatarImage } from "@nextlyhq/ui";
import type { CoreListWidgetData } from "nextly/core-widget-data";
import type {
  ActivityEvent,
  DeclaredComponentProps,
} from "nextly/widget-result";
import type React from "react";

import { FrameState } from "@admin/components/features/widgets/frame/card-state";
import { useCollectionLabel } from "@admin/components/features/widgets/frame/collection-label";
import {
  ListCard,
  type ListModel,
  type ListTotal,
} from "@admin/components/features/widgets/frame/list-card";
import { useListCard } from "@admin/components/features/widgets/frame/list-card-hook";
import {
  activityFromRow,
  activityHref,
} from "@admin/hooks/queries/useRecentActivity";
import { formatRelativeTime } from "@admin/lib/dashboard";
import type { Activity } from "@admin/types/dashboard/activity";

/**
 * The verb each event the source names is told in, one for every event of the server's closed
 * set: an event added to it fails to compile here until it has its words. The source names it
 * from the trail's own record of the change, so a publish reads as one and not as a save.
 */
const EVENT_VERBS = {
  created: "created",
  saved: "saved",
  published: "published",
  unpublished: "unpublished",
  deleted: "deleted",
} as const satisfies Record<ActivityEvent, string>;

/**
 * The row's verb: the event the source names, or, for a row that names none, the verb its
 * action reads as.
 */
function verbOf(activity: Activity): string {
  return activity.event === undefined
    ? activity.action
    : EVENT_VERBS[activity.event];
}

/**
 * One feed row: the activity it reads as, where it leads, if anywhere, and whether it is an
 * install-level settings change, which is about no entry.
 */
interface ActivityRow {
  activity: Activity;
  href: string | undefined;
  settings: boolean;
}

/**
 * How many saves one row stands for, as its title says it: " · 12 times", or " · 1000+ times"
 * when the server stopped reading inside the run. A floor is said even at one: "1+" says the
 * server stopped reading inside it. Nothing for a row of one save.
 */
function repeatText(activity: Activity): string {
  const count = activity.count ?? 1;
  if (count <= 1 && activity.countAtLeast !== true) return "";
  return ` · ${count}${activity.countAtLeast === true ? "+" : ""} times`;
}

/**
 * The same as a screen reader hears it: the dot is a pause to the eye and is said as a comma,
 * "Ana updated Site style, 12 times". Nothing for a row of one save, whose title reads well.
 */
function activitySpoken({
  activity,
  settings,
}: ActivityRow): string | undefined {
  const repeat = repeatText(activity);
  if (repeat === "") return undefined;
  const subject = activitySubject(activity, settings);
  return `${activity.user.name} ${activity.action} ${subject}, ${repeat.slice(3)}`;
}

/**
 * What a row names: its entry's title, or a Single's own name, when the row carries one. A row
 * without one names "an entry in" its collection, by the label the row shows on its meta line so
 * the two never name it differently, and a Single without one is "a Single". Never the bare
 * label: "Ana deleted Posts" reads as though the whole collection went. A settings change is about
 * no entry, so it names what it changed by its label alone.
 *
 * A row carries no title for an entry that has none, and for one whose title the reader may not
 * be told: the server drops the title of a document that no longer exists, whose read rule went
 * with it. The two read alike here, so a hidden title is never called an empty one.
 */
function activitySubject(activity: Activity, settings: boolean): string {
  if (activity.entryTitle !== undefined) return activity.entryTitle;
  if (settings && activity.collectionLabel !== undefined) {
    return activity.collectionLabel;
  }
  if (activity.collectionLabel !== undefined) {
    return `an entry in ${activity.collectionLabel}`;
  }
  return activity.target;
}

/** What a row's title says: who did what to which document, and how many times. */
function activityTitle({ activity, settings }: ActivityRow): string {
  const subject = activitySubject(activity, settings);
  return `${activity.user.name} ${activity.action} ${subject}${repeatText(activity)}`;
}

/**
 * The feed's rows as a list: the actor's avatar leads, the title says who did what, the meta
 * line names the collection, and when sits at the end. The kind of change is the title's verb,
 * so no badge repeats it. A Single's row has no collection to name: its title is the Single's
 * label.
 *
 * The time is derived HERE rather than carried on the entry: a relative time is a function of
 * when it is read, and `dateTime` carries the absolute instant, so the machine-readable value is
 * exact whatever the prose says.
 */
function activityListModel(now: number): ListModel<ActivityRow> {
  return {
    titleLabel: "Activity",
    titleOf: row => activityTitle(row),
    spokenOf: row => activitySpoken(row),
    hrefOf: ({ href }) => href,
    leadingOf: ({ activity }) => (
      <Avatar className="size-full">
        <AvatarImage src={activity.user.avatar} alt="" />
        <AvatarFallback className="bg-primary/5 text-primary text-[10px] font-semibold">
          {activity.user.initials}
        </AvatarFallback>
      </Avatar>
    ),
    fields: [
      {
        key: "collection",
        label: "Collection",
        role: "meta",
        present: ({ activity }) => activity.collectionLabel,
      },
      {
        key: "when",
        label: "When",
        role: "trailing",
        align: "end",
        present: ({ activity }) => (
          <time dateTime={activity.timestamp}>
            {formatRelativeTime(activity.timestamp, now)}
          </time>
        ),
      },
    ],
  };
}

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

/**
 * The dashboard's Team activity card, drawn from the rows its `load` read from
 * `system:activity`: framed, so the heading and the size are the card's.
 *
 * It draws the rows its body holds, at most the "Number of items" its reader
 * chose, through the one list card core's lists use, each row leading to the
 * entry or Single it is about. Its `load` asks one row more than the card
 * draws, and that row is not drawn: the feed has no list to open, so the card
 * has no footer, and a footer only ever draws a link. A run of one person's
 * saves is one row.
 *
 * The frame draws loading, no permission and error; an empty feed this card
 * reports itself, saying what the feed holds.
 */
/** How many events the read counted in all, as the footer counts them; nothing when it did not. */
function listTotal(data: CoreListWidgetData): ListTotal | undefined {
  if (data.total === undefined) return undefined;
  return data.atLeast === true
    ? { count: data.total, atLeast: true }
    : { count: data.total };
}

/** What the Team activity card is handed: its declaration's props, with the rows its `load` read. */
export type TeamActivityCardProps = Omit<DeclaredComponentProps, "data"> & {
  data: CoreListWidgetData;
};

export const TeamActivityCard: React.FC<TeamActivityCardProps> = ({
  data,
  settings,
}) => {
  // A relative time is read again as time passes: the clock ticks.
  const { tier, drawn, density, now } = useListCard(settings.limit);
  const labelOf = useCollectionLabel();
  // A row this build cannot read is left out rather than drawn from guesses.
  const rows = data.items.flatMap(row => {
    const activity = activityFromRow(row);
    if (!activity) return [];
    // The feed names a collection by its slug; the row names it as the reader is shown it, and
    // says what happened in the event's own verb.
    const told = { ...activity, action: verbOf(activity) };
    const named =
      told.collectionLabel === undefined
        ? told
        : { ...told, collectionLabel: labelOf(told.collectionLabel) };
    return [
      {
        activity: named,
        href: activityHref(row),
        settings: row.subjectKind === "settings",
      },
    ];
  });
  if (rows.length === 0) return <EmptyState />;
  return (
    <ListCard
      model={activityListModel(now)}
      rows={rows}
      drawn={drawn}
      total={listTotal(data)}
      tier={tier}
      density={density}
    />
  );
};

TeamActivityCard.displayName = "TeamActivityCard";
