/**
 * The History panel's list: what happened to the document, as a story.
 *
 * Pinned "Current draft" and "Currently published" rows, then the entries
 * under day headings, newest first, on a quiet timeline; saves fold under the
 * publish that shipped them, and events sit between the versions. It opens on
 * the language being edited with the shared fields, with "All languages" one
 * choice away, and filters Everything, Published, Named and Events. One line
 * says what retention keeps.
 *
 * @module components/features/versions/HistoryStoryList
 */

import { Info } from "lucide-react";
import type { JSX } from "react";
import { useCallback, useMemo, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui";
import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";
import type {
  DocumentEvent,
  VersionMeta,
  VersionScope,
} from "@admin/services/versionApi";

import {
  buildStory,
  storyShows,
  type HistoryFilter,
  type HistoryView,
  type StoryDay,
  type StoryEntry,
} from "./history-story";
import { dayHeading, partsText, retentionLine } from "./history-story-text";
import { HistoryPins } from "./HistoryPins";
import {
  EventStoryRow,
  RemovalMark,
  VersionStoryRow,
  type VersionStoryRowProps,
} from "./HistoryStoryRows";
import { predecessorOf, type Predecessor } from "./version-pairing";

/** How many rows read their changed fields; a reader scrolls for the rest. */
const SUMMARISED_ROWS = 12;

const FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: "everything", label: "Everything" },
  { value: "published", label: "Published" },
  { value: "named", label: "Named" },
  { value: "events", label: "Events" },
];

/** The value the language choice carries for every part at once. */
const ALL_LANGUAGES = "~all";

export interface HistoryStoryListProps {
  scope: VersionScope;
  versions: readonly VersionMeta[];
  events: readonly DocumentEvent[];
  /** Whether the document has the Draft/Published lifecycle. */
  lifecycle: boolean;
  /** Whether the document is translated; the language choice shows if so. */
  localized: boolean;
  /** The language being edited, which the list opens on. */
  editingLocale: string | null;
  /**
   * Whether every language's versions were read. When only the language being
   * edited was, the list offers no "All languages": the other languages'
   * versions are not there, and the events alone would tell half their story.
   */
  allLanguages?: boolean;
  /** The retention limit, when the editor knows it. */
  retention?: number | false;
  /** Whether older versions remain to load: a predecessor may be among them. */
  hasMore: boolean;
  selected: number | null;
  onSelect: (versionNo: number) => void;
  onRename?: (versionNo: number) => void;
  /** Ends the preview of a version, when a view change hides its row. */
  onClearSelection?: () => void;
  /** What sits under the entries, above the retention line: Load more. */
  footer?: React.ReactNode;
}

/** The language choice and the filters, above the list. */
function StoryTools({
  localized,
  editingLocale,
  allLanguages,
  languageName,
  view,
  onView,
  filter,
  onFilter,
}: {
  localized: boolean;
  editingLocale: string | null;
  allLanguages: boolean;
  languageName: (code: string) => string;
  view: HistoryView;
  onView: (view: HistoryView) => void;
  filter: HistoryFilter;
  onFilter: (filter: HistoryFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-1 pt-2">
      {localized && editingLocale && allLanguages ? (
        <Select
          value={view.kind === "all" ? ALL_LANGUAGES : view.locale}
          onValueChange={value =>
            onView(
              value === ALL_LANGUAGES
                ? { kind: "all" }
                : { kind: "language", locale: value }
            )
          }
        >
          <SelectTrigger
            className="h-8 w-auto gap-2 text-xs"
            aria-label="Languages shown"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={editingLocale}>
              {languageName(editingLocale)} and shared fields
            </SelectItem>
            <SelectItem value={ALL_LANGUAGES}>All languages</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
      <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
        {FILTERS.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => onFilter(option.value)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium",
              filter === option.value
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The view the list opens on: the language being edited, where there is one. */
function openingView(
  localized: boolean,
  editingLocale: string | null
): HistoryView {
  return localized && editingLocale
    ? { kind: "language", locale: editingLocale }
    : { kind: "all" };
}

/** The one line that says what retention keeps, when the editor knows it. */
function RetentionNote({ retention }: { retention?: number | false }) {
  if (retention === undefined) return null;
  return (
    <p className="flex items-start gap-2 px-4 py-4 text-xs text-muted-foreground">
      <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      {retentionLine(retention)}
    </p>
  );
}

/** How the list names languages and parts, for this document. */
function useStoryWords(localized: boolean) {
  const { getLocale } = useLocalization();
  const languageName = useCallback(
    (code: string) => getLocale(code)?.label ?? code,
    [getLocale]
  );
  // A document without languages still records its default language as the
  // part, so parts are named only where there are several to tell apart.
  const partsLabel = useCallback(
    (parts: readonly string[]) =>
      localized ? partsText(parts, languageName) : "",
    [localized, languageName]
  );
  return { languageName, partsLabel };
}

/**
 * The version each row's changed fields are read against: the one before it
 * in its own part, the question the comparison page answers too.
 *
 * A document without languages can carry two tags (the default language, and
 * none), and only same-tag versions can be compared. A version with no older
 * one of its own tag but older ones of the other is not the first, so its row
 * says nothing rather than claim it is.
 */
function usePrevious(
  versions: readonly VersionMeta[],
  hasMore: boolean,
  localized: boolean
) {
  return useCallback(
    (version: VersionMeta): Predecessor => {
      const found = predecessorOf(versions, version.versionNo ?? -1, hasMore);
      const olderExists = versions.some(
        v => (v.versionNo ?? 0) < (version.versionNo ?? 0)
      );
      return !localized && found.kind === "first" && olderExists
        ? { kind: "unknown" }
        : found;
    },
    [versions, hasMore, localized]
  );
}

/** The ids of the version rows that read their changed fields: the top ones. */
function summarisedIds(days: readonly StoryDay[]): Set<string> {
  return new Set(
    days
      .flatMap(day => day.entries)
      .flatMap(entry => (entry.kind === "version" ? [entry.version.id] : []))
      .slice(0, SUMMARISED_ROWS)
  );
}

/** One entry of the story, as its kind draws it. */
function StoryEntryRow({
  entry,
  summarised,
  rowProps,
}: {
  entry: StoryEntry;
  summarised: ReadonlySet<string>;
  rowProps: Omit<VersionStoryRowProps, "entry" | "summarised">;
}) {
  if (entry.kind === "removed") return <RemovalMark entry={entry} />;
  if (entry.kind === "event") {
    return <EventStoryRow entry={entry} partsLabel={rowProps.partsLabel} />;
  }
  return (
    <VersionStoryRow
      {...rowProps}
      entry={entry}
      summarised={summarised.has(entry.version.id)}
    />
  );
}

/** The entries under their day headings, on the timeline. */
function StoryDays({
  days,
  rowProps,
}: {
  days: readonly StoryDay[];
  rowProps: Omit<VersionStoryRowProps, "entry" | "summarised">;
}) {
  if (days.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        Nothing to show for this filter.
      </p>
    );
  }
  const summarised = summarisedIds(days);
  return (
    <ol aria-label="History, newest first" className="px-4">
      {days.map(day => (
        <li key={day.day}>
          <h3 className="pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {dayHeading(day.day)}
          </h3>
          <ol className="relative before:absolute before:bottom-1.5 before:left-[9px] before:top-1.5 before:w-px before:bg-border">
            {day.entries.map(entry => (
              <li
                key={`${entry.kind}:${entry.kind === "version" ? entry.version.id : entry.event.id}`}
              >
                <StoryEntryRow
                  entry={entry}
                  summarised={summarised}
                  rowProps={rowProps}
                />
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

/**
 * The language view, and the change of it. A version the new view no longer
 * shows is no longer previewed: the document returns to its current state
 * rather than showing a version whose row has gone.
 */
function useHistoryView(
  input: Omit<Parameters<typeof buildStory>[0], "view">,
  opening: HistoryView,
  selected: number | null,
  onClearSelection: (() => void) | undefined
): [HistoryView, (next: HistoryView) => void] {
  const [view, setView] = useState<HistoryView>(opening);
  const changeView = (next: HistoryView) => {
    setView(next);
    if (onClearSelection && hidesSelection(input, next, selected)) {
      onClearSelection();
    }
  };
  return [view, changeView];
}

/** Whether a view would stop showing the version being previewed. */
function hidesSelection(
  input: Omit<Parameters<typeof buildStory>[0], "view">,
  view: HistoryView,
  selected: number | null
): boolean {
  return (
    selected !== null && !storyShows(buildStory({ ...input, view }), selected)
  );
}

export function HistoryStoryList({
  scope,
  versions,
  events,
  lifecycle,
  localized,
  editingLocale,
  allLanguages = true,
  retention,
  hasMore,
  selected,
  onSelect,
  onRename,
  onClearSelection,
  footer,
}: HistoryStoryListProps): JSX.Element {
  const { languageName, partsLabel } = useStoryWords(localized);
  const [filter, setFilter] = useState<HistoryFilter>("everything");
  const [view, changeView] = useHistoryView(
    { versions, events, lifecycle, localized, filter },
    openingView(localized, editingLocale),
    selected,
    onClearSelection
  );
  const story = useMemo(
    () => buildStory({ versions, events, lifecycle, localized, view, filter }),
    [versions, events, lifecycle, localized, view, filter]
  );
  const previous = usePrevious(versions, hasMore, localized);

  return (
    <div>
      {/* The pins say where the document stands, which a filter narrowing
          the rows does not change; they stand above everything only. */}
      {filter === "everything" && (
        <HistoryPins
          scope={scope}
          drafts={story.drafts}
          published={story.published}
          partsLabel={partsLabel}
          selected={selected}
          onSelect={onSelect}
        />
      )}
      <StoryTools
        localized={localized}
        editingLocale={editingLocale}
        allLanguages={allLanguages}
        languageName={languageName}
        view={view}
        onView={changeView}
        filter={filter}
        onFilter={setFilter}
      />
      <StoryDays
        days={story.days}
        rowProps={{ scope, previous, partsLabel, selected, onSelect, onRename }}
      />
      {footer}
      <RetentionNote retention={retention} />
    </div>
  );
}
