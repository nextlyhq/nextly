/**
 * "Current draft" and "Currently published", pinned above the story for each
 * part, and only for the states that exist.
 *
 * The draft says which fields it changes compared with what is live, or that
 * nothing is published yet. The published row says who published it and when,
 * or that the publisher was not recorded, for a publish made before events
 * were. A publish of several parts is one row naming them.
 *
 * @module components/features/versions/HistoryPins
 */

import { FilePenLine, Globe } from "lucide-react";

import { useVersionDiff } from "@admin/hooks/queries/useVersions";
import { formatDateTime } from "@admin/lib/dates/format";
import { cn } from "@admin/lib/utils";
import type { VersionScope } from "@admin/services/versionApi";

import type { PinnedDraft, PinnedPublished } from "./history-story";
import {
  changeSummary,
  eventActor,
  fieldLabels,
  timeOfDay,
  versionActor,
  type PartsLabel,
} from "./history-story-text";
import { StoryActorName } from "./HistoryStoryRows";

export interface HistoryPinsProps {
  scope: VersionScope;
  drafts: PinnedDraft[];
  published: PinnedPublished[];
  partsLabel: PartsLabel;
  selected: number | null;
  onSelect: (versionNo: number) => void;
}

/** What a draft changes compared with the published version of its part. */
function DraftChanges({
  scope,
  draft,
  published,
}: {
  scope: VersionScope;
  draft: PinnedDraft;
  published: PinnedPublished | undefined;
}) {
  // Compared within the part: the server compares two versions of one
  // language, or of the shared fields, never across them.
  const from =
    published?.version && published.version.locale === draft.version.locale
      ? published.version.versionNo
      : null;
  const diff = useVersionDiff({
    scope,
    from,
    to: draft.version.versionNo ?? 0,
    modifiedOnly: true,
    enabled: from !== null && draft.version.versionNo !== null,
  });
  if (!draft.published) return <span>Not published yet</span>;
  if (!diff.data) return null;
  const labels = fieldLabels(diff.data.fields);
  return labels.length === 0 ? null : <span>{changeSummary(labels)}</span>;
}

/**
 * A pinned card: a title, and a line for each part. It opens a version when
 * it has one to open; without one it is a plain card.
 */
function Pin({
  icon: Icon,
  title,
  hint,
  active,
  onClick,
  children,
}: {
  icon: typeof Globe;
  title: string;
  hint?: string;
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4" aria-hidden />
        {title}
        {hint ? (
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
      <ul className="grid gap-1.5">{children}</ul>
    </>
  );
  const frame =
    "grid w-full gap-2 rounded-lg border border-border bg-card p-3 text-left";
  if (!onClick) return <div className={frame}>{body}</div>;
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={cn(
        frame,
        "hover:border-input",
        active &&
          "border-foreground shadow-[inset_0_0_0_1px_var(--nx-foreground)]"
      )}
    >
      {body}
    </button>
  );
}

/**
 * One part's line in a pinned card. The part is named only where the document
 * has parts to tell apart; otherwise the line is the state alone.
 */
function PinLine({
  part,
  children,
}: {
  part: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "grid gap-x-2 text-[13px] leading-[18px]",
        part ? "grid-cols-[104px_minmax(0,1fr)]" : "grid-cols-1"
      )}
    >
      {part ? (
        <span className="font-medium text-foreground">{part}</span>
      ) : null}
      <span className="grid gap-0.5 text-muted-foreground">{children}</span>
    </li>
  );
}

export function HistoryPins({
  scope,
  drafts,
  published,
  partsLabel,
  selected,
  onSelect,
}: HistoryPinsProps) {
  if (drafts.length === 0 && published.length === 0) return null;
  const draftActive = drafts.some(d => d.version.versionNo === selected);
  const publishedActive = published.some(
    p => p.version !== null && p.version.versionNo === selected
  );
  // The first live version the card can open; a part shipped by another
  // part's publish has none.
  const openable = published.find(p => p.version !== null)?.version;
  return (
    <div className="grid gap-2 px-4 pb-2 pt-4">
      {drafts.length > 0 ? (
        <Pin
          icon={FilePenLine}
          title="Current draft"
          hint="compared with what is live"
          active={draftActive}
          onClick={() => onSelect(drafts[0].version.versionNo ?? 0)}
        >
          {drafts.map(draft => (
            <PinLine key={draft.part} part={partsLabel([draft.part])}>
              <span className="text-foreground">
                <DraftChanges
                  scope={scope}
                  draft={draft}
                  published={published.find(p => p.parts.includes(draft.part))}
                />
              </span>
              <span className="text-xs">
                <StoryActorName actor={versionActor(draft.version)} /> ·{" "}
                {timeOfDay(draft.version.createdAt)}
              </span>
            </PinLine>
          ))}
        </Pin>
      ) : null}
      {published.length > 0 ? (
        <Pin
          icon={Globe}
          title="Currently published"
          active={publishedActive}
          onClick={
            openable ? () => onSelect(openable.versionNo ?? 0) : undefined
          }
        >
          {published.map(row => (
            <PinLine
              key={row.version?.id ?? row.publishedBy?.id ?? row.at}
              part={partsLabel(row.parts)}
            >
              <span className="text-xs">
                {row.publishedBy ? (
                  <>
                    By <StoryActorName actor={eventActor(row.publishedBy)} />
                  </>
                ) : (
                  "Publisher not recorded"
                )}
                {" · "}
                {formatDateTime(row.at)}
              </span>
            </PinLine>
          ))}
        </Pin>
      ) : null}
    </div>
  );
}
