"use client";

/**
 * The cells of the release list.
 *
 * Each one lays out what `release-list` and `release-time` say, so the wording
 * rules stay in functions a test can hold and these stay about arrangement.
 * The documents and owner cells ask for their own data: the list route returns
 * releases, not their documents or their owners' names, so a row fills in as
 * those answers arrive rather than holding the whole table back for them.
 *
 * The shared table draws these cells twice: in its table, and in a card per
 * row on a narrow screen, where each value sits right-aligned beside its
 * label. So a cell that lays out in rows or columns aligns to the end by
 * default and to the start from the table's `@md/table` width up, and its
 * lines may wrap only below that width, where the label beside them leaves
 * less room than a table column does.
 *
 * @module components/features/releases/ReleaseListCells
 */

import type { RELEASE_MEMBER_LIMIT as SERVER_RELEASE_MEMBER_LIMIT } from "nextly/schemas";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  Pencil,
  XCircle,
} from "@admin/components/icons";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Progress,
  Skeleton,
} from "@admin/components/ui";
import {
  useReleaseMembers,
  useReleaseReadiness,
} from "@admin/hooks/queries/useReleases";
import { useUser } from "@admin/hooks/queries/useUsers";
import { useCan } from "@admin/hooks/useCan";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import { cn } from "@admin/lib/utils";
import type { Release, ReleaseListTab } from "@admin/types/releases";

import {
  ownerIdToLookUp,
  releaseOwnerView,
  type ReleaseOwnerView,
  countMemberActions,
  describeDocuments,
  describeNeedFix,
  describeReadiness,
  RELEASE_ROW_STATUS,
  releaseWhenInstant,
  summariseReadiness,
  type ReleaseRowStatus,
} from "./release-list";
import { releaseTimeSentence, releaseTimeText } from "./release-time";

/**
 * The most documents a release holds, held to the server's own number.
 *
 * Typed as the server constant's literal type, so this file stops compiling
 * the day that number changes, without importing `nextly/schemas` at runtime
 * into a browser bundle for one integer.
 */
const RELEASE_MEMBER_LIMIT: typeof SERVER_RELEASE_MEMBER_LIMIT = 200;

const STATUS_ICON: Record<ReleaseRowStatus, typeof Clock> = {
  scheduled: Clock,
  overdue: AlertTriangle,
  stopped: AlertCircle,
  draft: Pencil,
  published: CheckCircle2,
  cancelled: XCircle,
};

/**
 * Where a release stands: an icon and a word, never a colour alone.
 */
export function ReleaseStatusBadge({ status }: { status: ReleaseRowStatus }) {
  const { label, variant } = RELEASE_ROW_STATUS[status];
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={variant} className="gap-1.5 whitespace-nowrap">
      <Icon className="size-3.5" aria-hidden />
      {label}
    </Badge>
  );
}

/**
 * The release's title, its description, and the single-document mark.
 *
 * The table wraps this cell in the row's link, and a link underlines what it
 * holds on hover. The description and the mark are inline-blocks so the
 * underline stays on the title, which is the part that names the link.
 */
export function ReleaseTitleCell({ release }: { release: Release }) {
  return (
    <span className="inline-block max-w-[26rem] align-top">
      <span className="text-sm font-medium text-foreground">
        {release.title}
      </span>
      {release.kind === "single" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-px align-[1px] text-[11px] font-normal leading-4 text-muted-foreground">
          <FileText className="size-3" aria-hidden />
          Single document
        </span>
      ) : null}
      {release.description ? (
        <span className="mt-0.5 inline-block w-full truncate text-xs font-normal text-muted-foreground">
          {release.description}
        </span>
      ) : null}
    </span>
  );
}

/**
 * When a release runs, ran, was due or was started, for the tab being read.
 *
 * The reader's time first, then how far away it is, then, only where the
 * release was scheduled on a clock that reads differently, the time it was
 * scheduled for there.
 */
export function ReleaseWhenCell({
  release,
  tab,
  readerZone,
  now,
}: {
  release: Release;
  tab: ReleaseListTab;
  readerZone: string;
  now: number;
}) {
  const instant = releaseWhenInstant(release, tab);
  // The scheduled zone belongs to the scheduled instant only. A draft's
  // creation time or a run's finish was never "scheduled" anywhere.
  const scheduledZone =
    tab === "upcoming" || tab === "attention" ? release.timezone : null;
  const text = releaseTimeText(instant, { readerZone, scheduledZone, now });
  if (!text) {
    return <span className="text-sm text-muted-foreground">Not scheduled</span>;
  }
  return (
    <span
      className="flex flex-col items-end gap-0.5 @md/table:min-w-[11rem] @md/table:items-start"
      title={releaseTimeSentence(text)}
    >
      <span className="text-sm @md/table:whitespace-nowrap tabular-nums text-foreground">
        {text.local}
        {text.scheduled ? (
          <span className="text-muted-foreground"> your time</span>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground">{text.relative}</span>
      {text.scheduled ? (
        <span className="flex flex-wrap items-center justify-end gap-1 @md/table:justify-start @md/table:whitespace-nowrap text-xs text-muted-foreground">
          <Globe className="size-3 shrink-0" aria-hidden />
          {text.scheduled.text} {text.scheduled.zone}
          <span className="whitespace-nowrap">(as scheduled)</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * How many documents a release holds, what it does with them, and, until it
 * has run, how many are ready.
 *
 * Readiness is asked only where it means something: a release that ran or was
 * cancelled has nothing left to get ready, and one holding more than a release
 * may now hold is a release made before the limit, whose check would be the
 * whole release's worth of reads for one row, so the row sends the reader to
 * its page instead.
 */
export function ReleaseDocumentsCell({
  release,
  tab,
}: {
  release: Release;
  tab: ReleaseListTab;
}) {
  const members = useReleaseMembers(release.id);
  const items = members.data?.items;
  const total = items?.length ?? 0;
  const oversized = total > RELEASE_MEMBER_LIMIT;
  const wantsReadiness =
    tab !== "done" && items !== undefined && total > 0 && !oversized;
  const readiness = useReleaseReadiness(release.id, wantsReadiness);

  if (members.isPending) {
    return (
      <span
        className="flex flex-col items-end gap-1.5 @md/table:min-w-[11rem] @md/table:items-start"
        aria-busy="true"
      >
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-2.5 w-20" />
      </span>
    );
  }
  if (members.isError || items === undefined) {
    return (
      <span className="text-sm text-muted-foreground">
        Documents unavailable
      </span>
    );
  }
  if (total === 0) {
    return (
      <span className="text-sm text-muted-foreground">No documents yet</span>
    );
  }

  const { count, tail } = describeDocuments(
    countMemberActions(items),
    release.state === "published" ? "ran" : "ahead"
  );

  return (
    <span className="flex flex-col items-end gap-1 @md/table:min-w-[11rem] @md/table:items-start">
      <span className="text-sm @md/table:whitespace-nowrap text-foreground">
        {count}
        {/* A cancelled release did nothing, so it is not described as doing
            anything; its count alone says what it held. */}
        {release.state === "cancelled" ? null : (
          <span className="text-muted-foreground">{tail}</span>
        )}
      </span>
      {tab === "done" ? null : oversized ? (
        <span className="text-xs text-muted-foreground">Open to check</span>
      ) : (
        <ReadinessLine
          total={total}
          pending={readiness.isPending}
          failed={readiness.isError}
          hard={readiness.data?.hard}
        />
      )}
    </span>
  );
}

function ReadinessLine({
  total,
  pending,
  failed,
  hard,
}: {
  total: number;
  pending: boolean;
  failed: boolean;
  hard: Parameters<typeof summariseReadiness>[1]["hard"] | undefined;
}) {
  if (pending) return <Skeleton className="h-2.5 w-24" aria-busy="true" />;
  if (failed || !hard) {
    return (
      <span className="text-xs text-muted-foreground">Could not check</span>
    );
  }
  const summary = summariseReadiness(total, { hard });
  const label = describeReadiness(summary);
  return (
    <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs @md/table:flex-nowrap @md/table:justify-start @md/table:whitespace-nowrap">
      <Progress
        value={summary.ready}
        max={summary.total}
        variant="success"
        className="h-1.5 w-14 shrink-0"
        aria-label={`${summary.ready} of ${summary.total} documents ready`}
      />
      <span className="text-muted-foreground">{label}</span>
      {summary.needFix > 0 ? (
        <span className="flex items-center gap-1 font-medium text-destructive">
          <AlertCircle className="size-3" aria-hidden />
          {describeNeedFix(summary.needFix)}
        </span>
      ) : null}
    </span>
  );
}

/** Initials for an avatar: the first letters of the first two words. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map(word => word.charAt(0).toUpperCase());
  return letters.join("") || "?";
}

/** Who owns a release, from the reader's own account and the users list. */
function useReleaseOwner(ownerId: string | null): ReleaseOwnerView {
  const { user: me } = useDashboardUser();
  const canReadUsers = useCan("read-users");
  const lookup = useUser(
    ownerIdToLookUp({ ownerId, meId: me?.id, canReadUsers })
  );
  return releaseOwnerView({
    ownerId,
    me,
    canReadUsers,
    lookup: { pending: lookup.isPending, user: lookup.data },
  });
}

const OWNER_ROW = "flex items-center justify-end gap-2 @md/table:justify-start";

export function ReleaseOwnerCell({ release }: { release: Release }) {
  const owner = useReleaseOwner(release.createdBy);

  if (owner.kind === "unrecorded") {
    return <span className="text-sm text-muted-foreground">Not recorded</span>;
  }
  if (owner.kind === "loading") {
    return (
      <span className={OWNER_ROW}>
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-3.5 w-16" />
      </span>
    );
  }
  const known = owner.kind === "known";
  return (
    <span className={OWNER_ROW} title={known ? owner.name : undefined}>
      <Avatar className="size-7">
        {known && owner.image ? <AvatarImage src={owner.image} alt="" /> : null}
        <AvatarFallback className="bg-muted text-[11px] font-medium text-foreground">
          {known ? initialsOf(owner.name) : "?"}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "max-w-[9rem] truncate text-sm",
          known ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {known ? owner.label : "Another user"}
      </span>
    </span>
  );
}
