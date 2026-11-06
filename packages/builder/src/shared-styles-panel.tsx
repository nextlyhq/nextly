/**
 * The Shared styles tab of the Design panel: every shared style the site
 * renders, found by name, property or value, with how widely each is used,
 * and each row's details beside the panel ({@link shared-style-details}).
 *
 * Drawn in the Variables and Fonts tabs' language: a search, a small-caps
 * group, compact rows, and a 240px popover editor per row.
 *
 * ## Styles are made from a block
 *
 * There is no "+" here. A shared style is made from a block's own look, with
 * "Save as shared style…" on the block, so the empty tab says that.
 *
 * ## Counts are read a page of rows at a time
 *
 * How widely a style is used comes from the site's usage index, asked for the
 * rows on screen (at most fifty per read), never for the whole library. While
 * some pages are still being counted every number is a floor, said "at least",
 * and nothing can be removed.
 *
 * ## Edits are lifted
 *
 * Renaming, locking and removing are the host's writes; this panel reports an
 * intent and shows the answer.
 *
 * @module shared-styles-panel
 */
import type {
  NamedClass,
  SiteTokenSet,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  TooltipProvider,
} from "@nextlyhq/ui";
import { Lock, Moon, Search } from "lucide-react";
import * as React from "react";

import {
  blockLookGroups,
  type BlockLookGroup,
  type LookKey,
} from "./block-look-rows";
import { BlockLooksGroup } from "./block-looks-group";
import { useSurvivingReport } from "./builder-notices";
import { ChromeTooltip } from "./chrome-tooltip";
import { BACKGROUND_JOBS_DOCS_HREF } from "./docs-links";
import { EDITOR_WORDS } from "./editor-words";
import type { TokenMode } from "./font-library";
import {
  KeepOrRemove,
  Refusal,
  ShowMore,
  useRefusableWrite,
} from "./panel-actions";
import { usePrefersDark } from "./prefers-dark";
import {
  HoldReason,
  removeSharedStylesThrough,
  SharedStyleDetails,
} from "./shared-style-details";
import {
  inSharedStyleFilter,
  isUnused,
  renameSharedStyle,
  sharedStyleFilterEmpty,
  sharedStyleTile,
  SHARED_STYLE_DARK_UNREADABLE,
  sharedStyleUse,
  SHARED_STYLE_FILTERS,
  searchSharedStyles,
  sharedStylePreview,
  sharedStyleReachChip,
  sharedStyleReachSentence,
  sharedStyleRows,
  sharedStylesOnly,
  sharedStyleSearchText,
  SHARED_STYLE_NOT_WHOLE_REMOVAL,
  SHARED_STYLE_RENAME_PENDING,
  SHARED_STYLE_COUNTING_NOTE,
  SHARED_STYLE_UNCOUNTABLE_NOTE,
  SHARED_STYLE_UNCOUNTABLE_REMOVAL,
  SHARED_STYLE_UNUSED_UNCERTAIN,
  SHARED_STYLES_WORD,
  type BlocksOnThisPage,
  type SharedStyleFilter,
  type SharedStyleReach,
  type SharedStyleRefusal,
  type SharedStylesCount,
  type SharedStyleRow,
  type SharedStyleTile,
  type SharedStylesUsage,
  type SharedStyleUsesPage,
} from "./shared-style-library";
import { activeTokenMode } from "./style-colour";

/** What the host answers a rename with. */
export type ClassRenameOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** The host's reads and writes through the site's shared-style routes. */
export interface SharedStylesAccess {
  /** How widely each of these styles is used: at most fifty ids per read. */
  readonly usage: (
    ids: readonly string[],
    signal: AbortSignal
  ) => Promise<SharedStylesUsage>;
  /** One page, from 1, of the documents a style is used on. */
  readonly uses: (
    id: string,
    page: number,
    signal: AbortSignal
  ) => Promise<SharedStyleUsesPage>;
  /** Lock or unlock a style. Resolves to the refusal, or nothing. */
  readonly lock: (id: string, locked: boolean) => Promise<string | undefined>;
  /** Remove unused styles, at most fifty. Resolves to the refusal, or nothing. */
  readonly remove: (ids: readonly string[]) => Promise<string | undefined>;
  /**
   * `remove`, answering a refusal with its words and whether it said a style
   * is still used. Optional: a host without it keeps working through
   * `remove`, and the tab then takes no refusal as saying a style is used.
   *
   * @experimental Settles with the Shared styles tab.
   */
  readonly removeWithReason?: (
    ids: readonly string[]
  ) => Promise<SharedStyleRefusal | undefined>;
  /**
   * Count the site's pages now, for a bounded time, rather than waiting for
   * the site's background jobs. Optional: without it the tab only says the
   * jobs count them.
   *
   * @experimental Settles with the Shared styles tab.
   */
  readonly count?: () => Promise<SharedStylesCount>;
}

/** The blocks on the open page carrying each style, by id. */
export interface PageClassBlocks {
  readonly counts: ReadonlyMap<string, number>;
  /** False when the page has more blocks than could be read. */
  readonly complete: boolean;
}

export interface SharedStylesPanelProps {
  /** The site's class library, or `undefined` while it is being read. */
  library: readonly NamedClass[] | undefined;
  /** Why the library is absent, when it is. */
  absence?: "pending" | "failed";
  /** The styles the site's code supplies: shown, never changed here. */
  suppliedClassIds?: readonly string[];
  /** The context the page compiles with, so summaries match the page. */
  styleContext?: StyleCompileContext;
  /**
   * The site's variables, so each row's preview is drawn on the site's page
   * colours. Absent: a neutral tile.
   */
  tokens?: SiteTokenSet;
  /** The blocks on the open page carrying each style. */
  pageBlocks: PageClassBlocks;
  /** Shown, never changed: no rename and no removal. A lock is its own right. */
  readOnly?: boolean;
  /** The usage routes and the lock and remove writes. Absent: none read. */
  access?: SharedStylesAccess;
  /** Rename a style: the name typed, and the class name derived from it. */
  onRename?: (
    classId: string,
    name: { label: string; slug: string }
  ) => Promise<ClassRenameOutcome>;
  /**
   * The live rename attempt for a style, as the host counts it, read right
   * after `onRename` is called, so a late answer to an earlier rename is not
   * shown as the current one.
   */
  currentRenameAttempt?: (classId: string) => number;
  /** The name each style is being renamed to while its write is open. */
  pendingNames?: Readonly<Record<string, string>>;
  /**
   * Choosing a look to edit in the inspector, with no block selected. Absent:
   * the Block looks group is listed, not chosen.
   *
   * @experimental
   */
  looks?: PanelLookEditing;
}

/** How the Block looks group's rows choose the look the inspector edits. */
export interface PanelLookEditing {
  /** Edit a look in the inspector. */
  readonly onEdit: (look: LookKey) => void;
  /** The look the inspector is editing, whose row shows as chosen. */
  readonly editing: LookKey | null;
}

/** How many rows mount before the author asks for more; also one usage read. */
const PAGE_SIZE = 50;

/**
 * How long the rows on screen wait before their usage is asked again while
 * some pages are still being counted, so the counts become whole, and Remove
 * unused becomes possible, without reopening the tab.
 */
export const USAGE_RECOUNT_MS = 15_000;

/**
 * How many times in a row the rows are asked again with nothing changing:
 * five minutes of recounts. A site says it is counting when the backfill
 * still has pages to count, but only a scheduler running the site's jobs
 * counts them, so on a site with none it says so for ever; and a host
 * written before `counting` existed does not say at all. Either way the tab
 * stops asking rather than polling for as long as it stays open, and any
 * change in the counts, or a style not read before, renews it.
 */
export const USAGE_RECOUNT_IDLE_MAX = 20;

/** The words for a refusal that came with none. */
const UNEXPLAINED_REFUSAL = "This shared style could not be renamed.";

/** No pending names, as one value rather than a fresh record each render. */
const NO_NAMES: Readonly<Record<string, string>> = Object.freeze({});

/**
 * The name a style is heading for while its rename is open, read as an own
 * entry: a style id is stored data, and `__proto__` must not read the
 * record's prototype.
 */
function pendingName(
  pendingNames: Readonly<Record<string, string>>,
  id: string
): string | undefined {
  return Object.hasOwn(pendingNames, id) ? pendingNames[id] : undefined;
}

/** A refusal shown where the author will see it: in its popover or the panel. */
interface Issue {
  readonly id: string;
  readonly reason: string;
}

/**
 * A list of ids as one string an effect or a memo can depend on. JSON, since
 * a class id is any string up to 128 characters, a newline or a comma
 * included, so no separator could be told apart from an id.
 */
function idsKey(ids: readonly string[]): string {
  return JSON.stringify(ids);
}

/** The ids a key made by {@link idsKey} holds. */
function idsOf(key: string): string[] {
  const parsed: unknown = JSON.parse(key);
  return Array.isArray(parsed)
    ? parsed.filter((id): id is string => typeof id === "string")
    : [];
}

/** The rows the library gives, kept while the library and the code's ids are. */
function useRows(
  library: readonly NamedClass[] | undefined,
  suppliedClassIds: readonly string[] | undefined
): { rows: SharedStyleRow[]; lookIds: string[] } {
  // Keyed by the ids rather than the array, which a host may build afresh on
  // every render: the search text compiles every style, once per library,
  // not once per render.
  const suppliedKey = idsKey(suppliedClassIds ?? []);
  return React.useMemo(() => {
    if (library === undefined) return { rows: [], lookIds: [] };
    const supplied = new Set(idsOf(suppliedKey));
    return {
      rows: sharedStyleRows(sharedStylesOnly(library), supplied),
      // The worn looks, whose counts are read with the styles' in one read,
      // so the tab's counting and failure notes speak for both.
      lookIds: wornLookIds(blockLookGroups(library, supplied)),
    };
  }, [library, suppliedKey]);
}

/**
 * The site's looks by block type, narrowed by the search to the looks whose
 * name holds it; a type with none left is not listed.
 */
function useLookGroups(
  library: readonly NamedClass[] | undefined,
  suppliedClassIds: readonly string[] | undefined,
  query: string,
  styleContext: StyleCompileContext | undefined
): BlockLookGroup[] {
  const suppliedKey = idsKey(suppliedClassIds ?? []);
  const groups = React.useMemo(
    () =>
      library === undefined
        ? []
        : blockLookGroups(library, new Set(idsOf(suppliedKey))),
    [library, suppliedKey]
  );
  // Each look's search text, as each shared style's is: its name and every
  // property and value it declares, so a search the box promises finds both.
  const texts = React.useMemo(
    () =>
      new Map(
        groups.flatMap(group =>
          group.rows.map(row => [
            row.id,
            sharedStyleSearchText(row, styleContext),
          ])
        )
      ),
    [groups, styleContext]
  );
  if (query.trim() === "") return groups;
  return groups
    .map(group => {
      const found = new Set(
        searchSharedStyles(
          group.rows,
          query,
          row => texts.get(row.id) ?? ""
        ).map(row => row.id)
      );
      return { ...group, rows: group.rows.filter(row => found.has(row.id)) };
    })
    .filter(group => group.rows.length > 0);
}

/**
 * The Block looks group above the shared styles: the site's looks by block
 * type, found by the same search, with the worn looks' counts read as the
 * shared styles' are. An own look has no count of its own.
 */
function PanelLooks({
  library,
  suppliedClassIds,
  query,
  paint,
  editing,
  styleContext,
  reaches,
}: {
  library: readonly NamedClass[];
  suppliedClassIds: readonly string[] | undefined;
  query: string;
  styleContext: StyleCompileContext | undefined;
  paint: TilePaint;
  editing: PanelLookEditing | undefined;
  /** Each worn look's reach, from the tab's one usage read. */
  reaches: ReadonlyMap<string, SharedStyleReach>;
}): React.JSX.Element | null {
  const groups = useLookGroups(library, suppliedClassIds, query, styleContext);
  return (
    <BlockLooksGroup
      groups={groups}
      library={library}
      tokens={paint.tokens}
      mode={paint.mode}
      editing={editing?.editing}
      onEdit={editing?.onEdit}
      reachOf={row => reaches.get(row.id)}
      chip={reach => <ReachChip reach={reach} />}
    />
  );
}

/** Whether a style may be renamed here: the tab is writable and a rename has a host. */
function mayRename(
  readOnly: boolean,
  onRename: SharedStylesPanelProps["onRename"]
): boolean {
  return !readOnly && onRename !== undefined;
}

/** The worn looks among the groups, whose counts are read. */
function wornLookIds(groups: readonly BlockLookGroup[]): string[] {
  return groups.flatMap(group =>
    group.rows.filter(row => !row.own).map(row => row.id)
  );
}

export function SharedStylesPanel({
  library,
  absence = "pending",
  suppliedClassIds,
  styleContext,
  tokens,
  pageBlocks,
  readOnly = false,
  access,
  onRename,
  currentRenameAttempt,
  pendingNames = NO_NAMES,
  looks,
}: SharedStylesPanelProps): React.JSX.Element {
  const paint = usePaint(tokens);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<SharedStyleFilter>("all");
  const [pages, setPages] = React.useState(1);
  const [issue, setIssue] = React.useState<Issue | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const { rows, lookIds } = useRows(library, suppliedClassIds);
  const texts = React.useMemo(
    () =>
      new Map(
        rows.map(row => [row.id, sharedStyleSearchText(row, styleContext)])
      ),
    [rows, styleContext]
  );
  const found = searchSharedStyles(rows, query, row => texts.get(row.id) ?? "");
  // Every style's usage is read, so each filter can be counted: the rows the
  // search puts first, then the rest, fifty to a read.
  const usage = useUsage(access, usageOrder(rows, found, pages, lookIds));
  const { counter } = usage;
  const exact = countsExact(usage, pageBlocks, rows);

  const usageOf = (row: SharedStyleRow) =>
    sharedStyleUse(pageBlocksOf(pageBlocks, row.id), usage.styles.get(row.id));
  const reason = floorReason(usage.whole, usage.counting);
  const notes = countingNotes(unusedWithheld(filter, found, usageOf), reason);
  const filtered = found.filter(row =>
    inSharedStyleFilter(row, filter, usageOf(row))
  );
  const shown = filtered.slice(0, pages * PAGE_SIZE);
  const rename = useRename({
    library,
    onRename,
    currentRenameAttempt,
    pendingNames,
    setIssue,
  });
  const search = React.useRef<HTMLInputElement>(null);

  if (library === undefined) return <Unread absence={absence} />;

  const blocksOf = (id: string): BlocksOnThisPage =>
    pageBlocksOf(pageBlocks, id);
  const writable = mayRename(readOnly, onRename);
  // Any rename still being stored. A rename writes the whole list of styles,
  // and so do Lock, Remove and Remove unused, so each waits for every
  // pending rename, not only its own row's: whichever landed second would put
  // the other's list back.
  const held = Object.keys(pendingNames).length > 0;

  return (
    <div className="nx-vars nx-shared-styles" {...readOnlyMark(readOnly)}>
      <SearchBox
        ref={search}
        query={query}
        onQuery={next => {
          setQuery(next);
          setPages(1);
        }}
      />
      {rows.length > 0 && (
        <FilterBar
          rows={rows}
          filter={filter}
          onFilter={next => {
            setFilter(next);
            setPages(1);
          }}
          usageOf={usageOf}
          exact={exact}
        />
      )}
      <div className="nx-vars__body">
        <PanelNotes
          readOnly={readOnly}
          usageFailed={usage.failed}
          issue={issueBesideList(issue, openId)}
        />
        <PanelLooks
          library={library}
          suppliedClassIds={suppliedClassIds}
          query={query}
          paint={paint}
          editing={looks}
          styleContext={styleContext}
          reaches={usage.styles}
        />
        <section
          className="nx-vars__group"
          aria-labelledby="nx-shared-styles-all"
        >
          <RemoveUnusedHead
            rows={rows}
            offered={!readOnly && access !== undefined}
            access={access}
            reason={reason}
            held={held}
            saidInNote={notes.one}
            blocksOf={blocksOf}
            onRemoved={() => search.current?.focus()}
          />
          <TopNote
            note={notes.top}
            says={notes.one}
            jobs={notes.jobs}
            counter={counter}
          />
          <StyleList
            rows={rows}
            found={filtered}
            filter={filter}
            query={query.trim()}
            withheld={notes.withheld}
            covered={notes.top !== undefined}
          >
            {shown.map(row => (
              <StyleRow
                key={row.id}
                row={row}
                name={pendingName(pendingNames, row.id) ?? row.name}
                details={{
                  styleContext,
                  blocks: blocksOf(row.id),
                  reach: usage.styles.get(row.id),
                  whole: usage.whole,
                  mayLock: usage.mayLock,
                  readOnly: !writable,
                  access,
                  held,
                  issue: issueOf(issue, row.id),
                  onRename: value => rename(row, value),
                  onRemoved: () => {
                    setOpenId(null);
                    search.current?.focus();
                  },
                  // A refusal says why, not whether it is used: a lock or a
                  // count no longer whole refuses too. The read again decides.
                  onRefused: () => usage.reread([row.id]),
                }}
                paint={paint}
                open={openId === row.id}
                onOpenChange={open => setOpenId(open ? row.id : null)}
              />
            ))}
          </StyleList>
          <ShowMore
            hidden={filtered.length - shown.length}
            pageSize={PAGE_SIZE}
            onMore={() => setPages(count => count + 1)}
          />
        </section>
      </div>
    </div>
  );
}

/** The tab's read-only mark, for the styles that draw a read-only tab. */
function readOnlyMark(readOnly: boolean): { "data-read-only"?: "" } {
  return readOnly ? { "data-read-only": "" } : {};
}

/** The search over every style, by name, property or value. */
function SearchBox({
  ref,
  query,
  onQuery,
}: {
  ref: React.Ref<HTMLInputElement>;
  query: string;
  onQuery: (query: string) => void;
}): React.JSX.Element {
  return (
    <div className="nx-vars__search">
      <Search aria-hidden="true" size={16} />
      <Input
        ref={ref}
        type="search"
        aria-label={`Search ${SHARED_STYLES_WORD}`}
        placeholder="Search by name, property or value"
        value={query}
        onChange={event => onQuery(event.target.value)}
      />
    </div>
  );
}

/** What each row's tile is drawn from: the site's variables, in the canvas's mode. */
interface TilePaint {
  readonly tokens: SiteTokenSet | undefined;
  readonly mode: TokenMode;
}

/** The site's variables and the mode the canvas shows, for every row's tile. */
function usePaint(tokens: SiteTokenSet | undefined): TilePaint {
  return { tokens, mode: activeTokenMode(usePrefersDark()) };
}

/**
 * Whether Used and Unused can be counted: every page counted, the open page
 * read in full, and every style's reach complete.
 */
function countsExact(
  usage: UsageState,
  pageBlocks: PageClassBlocks,
  rows: readonly SharedStyleRow[]
): boolean {
  return (
    usage.whole === true &&
    pageBlocks.complete &&
    rows.every(row => usage.styles.get(row.id)?.complete === true)
  );
}

/** The blocks on the open page that carry one style. */
function pageBlocksOf(
  pageBlocks: PageClassBlocks,
  id: string
): BlocksOnThisPage {
  return {
    count: pageBlocks.counts.get(id) ?? 0,
    complete: pageBlocks.complete,
  };
}

/**
 * The order usage is read in: the rows the search lists on screen first, so
 * their counts arrive first, then every other style, so each filter can be
 * counted.
 */
function usageOrder(
  rows: readonly SharedStyleRow[],
  found: readonly SharedStyleRow[],
  pages: number,
  lookIds: readonly string[] = []
): string[] {
  const first = found.slice(0, pages * PAGE_SIZE).map(row => row.id);
  const listed = new Set(first);
  // The worn looks after the styles: few, and listed above the styles.
  return [
    ...first,
    ...rows.map(row => row.id).filter(id => !listed.has(id)),
    ...lookIds,
  ];
}

/**
 * All · Used · Unused · Locked, each with how many styles it holds. Used and
 * Unused are counted only once every count is exact: while some pages are
 * still being counted, or some usage is still being read, a number there
 * would be a guess.
 */
function FilterBar({
  rows,
  filter,
  onFilter,
  usageOf,
  exact,
}: {
  rows: readonly SharedStyleRow[];
  filter: SharedStyleFilter;
  onFilter: (filter: SharedStyleFilter) => void;
  usageOf: (row: SharedStyleRow) => "used" | "unused" | undefined;
  exact: boolean;
}): React.JSX.Element {
  const countOf = (candidate: SharedStyleFilter): number | undefined => {
    if ((candidate === "used" || candidate === "unused") && !exact) {
      return undefined;
    }
    return rows.filter(row => inSharedStyleFilter(row, candidate, usageOf(row)))
      .length;
  };
  return (
    <div className="nx-shared-styles__filters" role="group" aria-label="Show">
      <div className="nx-vars__seg">
        {SHARED_STYLE_FILTERS.map(({ filter: candidate, word }) => {
          const count = countOf(candidate);
          return (
            <button
              key={candidate}
              type="button"
              className="nx-shared-styles__filter"
              aria-pressed={filter === candidate}
              aria-label={
                count === undefined ? word : `${word} ${String(count)}`
              }
              onClick={() => onFilter(candidate)}
            >
              {word}
              {count === undefined ? null : (
                <span
                  className="nx-shared-styles__filter-count"
                  aria-hidden="true"
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A rename refused for this style, shown in its details. */
function issueOf(issue: Issue | null, id: string): string | null {
  return issue?.id === id ? issue.reason : null;
}

/** A refused rename whose details are closed, shown above the list instead. */
function issueBesideList(
  issue: Issue | null,
  openId: string | null
): string | null {
  return issue === null || issue.id === openId ? null : issue.reason;
}

/**
 * The one note while counts are floors, at the top of the list, and while
 * pages are still being counted, what counts them, with Count now. Carries
 * the id Remove unused points at when it says why that waits.
 */
function TopNote({
  note,
  says,
  jobs,
  counter,
}: {
  note: string | undefined;
  /** Whether it says why Remove unused waits. */
  says: boolean;
  jobs: boolean;
  counter: CountNow | undefined;
}): React.JSX.Element | null {
  if (note === undefined) return null;
  return (
    <div className="nx-shared-styles__counting">
      <p
        className="nx-vars__note"
        id={says ? "nx-shared-styles-withheld" : undefined}
      >
        {note}
      </p>
      {jobs ? <CountedBy counter={counter} /> : null}
    </div>
  );
}

/**
 * Who counts the pages, beside a note that some are not counted yet. The
 * counts are filled in by one of the site's background jobs, which nothing
 * runs on a site with no scheduler, so there the counts never finish; this
 * says so, and links to how the jobs are run, rather than promising a wait.
 */
function CountedBy({
  counter,
}: {
  /** Counting the pages now, when this author may and the host can. */
  counter: CountNow | undefined;
}): React.JSX.Element {
  const docs = (
    <a
      className="nx-vars__link"
      href={BACKGROUND_JOBS_DOCS_HREF}
      target="_blank"
      rel="noreferrer"
    >
      How background jobs run
    </a>
  );
  if (counter === undefined) {
    return (
      <p className="nx-vars__note">
        {"Pages are counted by the site's background jobs. "}
        {docs}
      </p>
    );
  }
  // One line under the note: the count, what it found, and how the jobs
  // that would have counted run. A button, since it does work; the docs are
  // a link, since they go somewhere.
  return (
    <div className="nx-shared-styles__count-row">
      {/* None once a count said another cannot get further. */}
      {counter.final ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="nx-shared-styles__count-now"
          disabled={counter.busy}
          onClick={counter.run}
        >
          {countNowWords(counter)}
        </Button>
      )}
      {/* What the last count found, said as it changes. */}
      <span className="nx-vars__note" role="status">
        {counter.said ?? ""}
      </span>
      {docs}
    </div>
  );
}

/** The count button's words: what it will do, or that it is doing it. */
function countNowWords(counter: CountNow): string {
  if (counter.busy) return "Counting…";
  return counter.again ? "Count again" : "Count now";
}

/**
 * Counting the pages now, offered beside who counts them when the host can
 * and this author may: the way out for a site whose background jobs no
 * scheduler runs.
 */
interface CountNow {
  readonly busy: boolean;
  /** What the last count found, when it found something to say. */
  readonly said: string | undefined;
  /** Whether a count left pages to count, so the next one goes on. */
  readonly again: boolean;
  /**
   * Whether the last count said no further count can get anywhere: what is
   * left cannot be counted, so none is offered until the counts are read
   * again and say otherwise.
   */
  readonly final: boolean;
  readonly run: () => void;
}

/** What a count says when what is left cannot be counted at all. */
const SHARED_STYLE_CANNOT_COUNT_MORE = "The pages left can't be counted.";

/** What a count found to say, and whether no further count can help. */
interface CountFound {
  readonly said: string;
  readonly again: boolean;
  readonly final?: true;
}

/** What the row says after a count: nothing once every page is counted. */
function countFound(answer: {
  readonly whole: boolean;
  readonly counting: boolean;
}): CountFound | undefined {
  if (answer.whole) return undefined;
  return answer.counting
    ? { said: SHARED_STYLE_STILL_TO_COUNT, again: true }
    : { said: SHARED_STYLE_CANNOT_COUNT_MORE, again: false, final: true };
}

/** What a count that failed with no words of its own says. */
const SHARED_STYLE_COUNT_FAILED = "The pages could not be counted.";

/** What a count leaves to say when the pages are not all counted yet. */
const SHARED_STYLE_STILL_TO_COUNT = "Some pages are still to count.";

/**
 * The count, run once at a time: on an answer the rows on screen are read
 * again, so their counts and the notes follow; a refusal says why, and a
 * count that left pages says so and offers the next.
 */
function useCountNow(
  access: SharedStylesAccess | undefined,
  mayCount: boolean,
  recountNow: () => void,
  /** The reads so far, and whether the latest say the site is counting. */
  reads: {
    readonly answered: number;
    readonly counting: "yes" | "unknown" | "no";
  }
): CountNow | undefined {
  const [busy, setBusy] = React.useState(false);
  const [found, setFound] = React.useState<
    | (CountFound & {
        /** How many reads had answered when it was said. */
        readonly at: number;
      })
    | undefined
  >(undefined);
  // A final word gives way to a later read that says the site is counting
  // again: something new to count has turned up since the count.
  const stale =
    found?.final === true &&
    reads.answered > found.at &&
    reads.counting === "yes";
  React.useEffect(() => {
    if (stale) setFound(undefined);
  }, [stale]);
  const answeredNow = React.useRef(reads.answered);
  answeredNow.current = reads.answered;
  const count = access?.count;
  const run = React.useCallback(() => {
    if (count === undefined || busy) return;
    setBusy(true);
    setFound(undefined);
    count()
      .then(answer => {
        setBusy(false);
        if (answer.kind === "refused") {
          setFound({
            said: answer.reason,
            again: false,
            at: answeredNow.current,
          });
          return;
        }
        recountNow();
        // Another count is offered only when the answer says one would get
        // further: pages left that cannot be counted are not "still to
        // count", whatever the panel last read.
        const said = countFound(answer);
        // Stamped with the reads answered so far. The read the count sets
        // off is not counted as answered, since it can tell this answer
        // nothing newer than itself, so the first other read moves past it.
        setFound(
          said === undefined ? undefined : { ...said, at: answeredNow.current }
        );
      })
      // A host that throws rather than answering a refusal: said all the
      // same, so the button is not left saying it is counting.
      .catch(() => {
        setBusy(false);
        setFound({
          said: SHARED_STYLE_COUNT_FAILED,
          again: false,
          at: answeredNow.current,
        });
      });
  }, [count, busy, recountNow]);
  if (count === undefined || !mayCount) return undefined;
  return {
    busy,
    said: found?.said,
    again: found?.again === true,
    final: found?.final === true,
    run,
  };
}

/** The read-only line, a usage read that failed, and a refused rename. */
function PanelNotes({
  readOnly,
  usageFailed,
  issue,
}: {
  readOnly: boolean;
  usageFailed: boolean;
  issue: string | null;
}): React.JSX.Element {
  return (
    <>
      {readOnly ? (
        <p className="nx-vars__note">
          {`You can view the site’s ${SHARED_STYLES_WORD} but not change them.`}
        </p>
      ) : null}
      {usageFailed ? (
        <p className="nx-vars__alert" role="alert">
          {`Where these ${SHARED_STYLES_WORD} are used could not be read.`}
        </p>
      ) : null}
      {issue === null ? null : (
        <p className="nx-vars__alert" role="alert">
          {issue}
        </p>
      )}
    </>
  );
}

/**
 * Why the tab's counts are floors: the site is still being counted (or may
 * be), or it cannot be counted in full, so they stay floors. Undefined while
 * every page is counted, whatever one style's own count says.
 */
type FloorReason = "counting" | "permanent" | undefined;

function floorReason(
  whole: boolean | undefined,
  counting: "yes" | "unknown" | "no"
): FloorReason {
  if (whole !== false) return undefined;
  return counting === "no" ? "permanent" : "counting";
}

/**
 * Which notes the tab says about floors. While counts are floors, ONE note
 * says why, at the top of the list, where the counts first read as
 * minimums. It covers the minimums, the rows Unused holds back and Remove
 * unused waiting, so neither the head nor the list says it again. Rows held back while every page is counted (one
 * style's count cut short) get their own line in the list: nothing is
 * waiting, and the proven rows are listed.
 */
function countingNotes(
  withheld: boolean,
  reason: FloorReason
): {
  withheld: boolean;
  /** Whether the top note says why Remove unused waits. */
  one: boolean;
  /** The top note's words, while counts are floors. */
  top: string | undefined;
  /** Whether that note says pages are not counted yet, so who counts them. */
  jobs: boolean;
} {
  return {
    withheld,
    one: reason !== undefined,
    top:
      reason === "counting"
        ? SHARED_STYLE_COUNTING_NOTE
        : reason === "permanent"
          ? SHARED_STYLE_UNCOUNTABLE_NOTE
          : undefined,
    jobs: reason === "counting",
  };
}

/**
 * Whether Unused is holding back a row the search found: one whose zero is
 * not counted in full yet, so it is neither used nor certainly unused.
 */
function unusedWithheld(
  filter: SharedStyleFilter,
  found: readonly SharedStyleRow[],
  usageOf: (row: SharedStyleRow) => "used" | "unused" | undefined
): boolean {
  return filter === "unused" && found.some(row => usageOf(row) === undefined);
}

/**
 * Unused while it holds rows back: the rows proven unused, and, when the top
 * note does not already say why (every page counted, but one style's count
 * cut short), a line that says so.
 */
function WithheldList({
  covered,
  listed,
  children,
}: {
  covered: boolean;
  listed: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      {covered ? null : (
        <p className="nx-vars__empty">{SHARED_STYLE_UNUSED_UNCERTAIN}</p>
      )}
      {listed ? <ul className="nx-vars__list">{children}</ul> : null}
    </>
  );
}

/** The rows, or what to say when there are none or none match. */
function StyleList({
  rows,
  found,
  filter,
  query,
  withheld,
  covered,
  children,
}: {
  rows: readonly SharedStyleRow[];
  /** The rows the search and the filter leave. */
  found: readonly SharedStyleRow[];
  filter: SharedStyleFilter;
  query: string;
  /**
   * Unused is holding back rows whose zero is not counted in full yet. The
   * rows proven unused are still listed, each judged on its own.
   */
  withheld: boolean;
  /** Whether the top note already says why rows are held back. */
  covered: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  // Whenever Unused holds a row back it says so, beside the rows it lists.
  if (withheld && rows.length > 0) {
    return (
      <WithheldList covered={covered} listed={found.length > 0}>
        {children}
      </WithheldList>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="nx-vars__empty">
        {`No ${SHARED_STYLES_WORD} yet. Select a block and choose Save as shared style…`}
      </p>
    );
  }
  if (found.length === 0) {
    return (
      <p className="nx-vars__empty">
        {filter === "all"
          ? `No ${SHARED_STYLES_WORD} match “${query}”.`
          : sharedStyleFilterEmpty(filter, query)}
      </p>
    );
  }
  return <ul className="nx-vars__list">{children}</ul>;
}

/** What shows while the library is being read, or after a read failed. */
function Unread({
  absence,
}: {
  absence: "pending" | "failed";
}): React.JSX.Element {
  const failed = absence === "failed";
  return (
    <div className="nx-vars nx-shared-styles">
      <div className="nx-vars__body">
        <p
          className={failed ? "nx-vars__alert" : "nx-vars__note"}
          role={failed ? "alert" : "status"}
        >
          {failed
            ? `This site’s ${SHARED_STYLES_WORD} could not be read, so none can be shown or changed. Reload to try again.`
            : `Reading this site’s ${SHARED_STYLES_WORD}…`}
        </p>
      </div>
    </div>
  );
}

/** Usage read for the rows on screen, kept as it arrives. */
interface UsageState {
  readonly styles: ReadonlyMap<string, SharedStyleReach>;
  /**
   * Whether every style's usage was read while every page had been counted.
   * Undefined until a read has answered.
   */
  readonly whole: boolean | undefined;
  /** Whether floors among them may still become whole; see {@link countingOf}. */
  readonly counting: "yes" | "unknown" | "no";
  readonly mayLock: boolean;
  /** Whether this author may ask for the pages to be counted now. */
  readonly mayCount: boolean;
  readonly failed: boolean;
  /** Ask about these styles again, as after a removal the server refused. */
  readonly reread: (ids: readonly string[]) => void;
  /**
   * Counting the pages now, when this author may and the host can; its
   * answer reads the rows on screen again.
   */
  readonly counter: CountNow | undefined;
}

/** The health a style's usage was read under: its read's `whole` and `counting`. */
interface Reading {
  readonly whole: boolean;
  /** Undefined where the host did not say. */
  readonly counting: boolean | undefined;
}

/**
 * Whether the listed styles' floors are worth asking for again: "yes" when a
 * style read before the count was whole was read while the site was still
 * being counted, "unknown" when such a reading did not say, "no" otherwise.
 * Per style, like {@link wholeOf}, since one scan is several reads and the
 * count can finish between them: a later read saying it is done says nothing
 * of the floors an earlier read left.
 */
function countingOf(
  readings: ReadonlyMap<string, Reading>,
  ids: readonly string[]
): "yes" | "unknown" | "no" {
  const floors = ids.flatMap(id => {
    const reading = readings.get(id);
    return reading === undefined || reading.whole ? [] : [reading.counting];
  });
  if (floors.includes(true)) return "yes";
  return floors.includes(undefined) ? "unknown" : "no";
}

/**
 * Whether the rows on screen are due another read on the recount timer: while
 * their counts are floors the site is still counting, or may be, and fewer
 * than {@link USAGE_RECOUNT_IDLE_MAX} recounts have changed nothing.
 */
function recountDue(args: {
  access: SharedStylesAccess | undefined;
  whole: boolean | undefined;
  counting: "yes" | "unknown" | "no";
  failed: boolean;
  recounts: number;
}): boolean {
  if (args.access === undefined || args.whole !== false || args.failed) {
    return false;
  }
  return args.counting !== "no" && args.recounts < USAGE_RECOUNT_IDLE_MAX;
}

/**
 * The usage of `ids` as one value, so a recount that moved any of it is told
 * from one that changed nothing. Each style's whole answer, not a summary of
 * it: a page use added as a component use goes keeps the total and changes
 * what the row says. JSON, for the reason {@link idsKey} is.
 */
function progressKey(
  styles: ReadonlyMap<string, SharedStyleReach>,
  ids: readonly string[]
): string {
  return JSON.stringify(ids.map(id => styles.get(id) ?? null));
}

/** What the reads kept: each style's usage, and the health it was read under. */
interface UsageReads {
  readonly styles: ReadonlyMap<string, SharedStyleReach>;
  /** Per style, the health of the read that counted it. */
  readonly readings: ReadonlyMap<string, Reading>;
  readonly mayLock: boolean;
  readonly mayCount: boolean;
  readonly failed: boolean;
  /** How many reads have answered, so a later one can be told from an earlier. */
  readonly answered: number;
}

/**
 * Whether the counts of `ids` are whole: every one read so far was read under
 * a whole index. Derived per style rather than from the last read, since one
 * scan is several reads and the index can finish counting between them: an
 * earlier read's floors stay floors until that style is read again. Only the
 * styles listed now are asked, so a style since removed cannot hold it false.
 */
function wholeOf(
  readings: ReadonlyMap<string, Reading>,
  ids: readonly string[]
): boolean | undefined {
  const read = ids.flatMap(id => {
    const reading = readings.get(id);
    return reading === undefined ? [] : [reading.whole];
  });
  return read.length === 0 ? undefined : read.every(Boolean);
}

/** Usage for some styles, read fifty at a time, each read handed on as it answers. */
async function readUsage(
  access: SharedStylesAccess,
  ids: readonly string[],
  signal: AbortSignal,
  onRead: (read: SharedStylesUsage) => void
): Promise<void> {
  for (let at = 0; at < ids.length; at += PAGE_SIZE) {
    const read = await access.usage(ids.slice(at, at + PAGE_SIZE), signal);
    if (signal.aborted) return;
    onRead(read);
  }
}

/**
 * How widely the rows on screen are used: each id is read once, fifty to a
 * read, as rows come on screen; a row already read is not asked again while
 * the counts are whole. While some pages are still being counted, every row
 * on screen is asked again each {@link USAGE_RECOUNT_MS}, until they are.
 */
function useUsage(
  access: SharedStylesAccess | undefined,
  ids: readonly string[]
): UsageState {
  const [state, setState] = React.useState<UsageReads>({
    styles: new Map(),
    readings: new Map(),
    mayLock: false,
    mayCount: false,
    failed: false,
    answered: 0,
  });
  const known = React.useRef(state.styles);
  known.current = state.styles;
  const key = idsKey(ids);
  const whole = wholeOf(state.readings, ids);
  const counting = countingOf(state.readings, ids);
  const [recount, setRecount] = React.useState(0);
  const recounted = React.useRef(recount);
  // The recount a count set off, so its read is told from every other.
  const countRead = React.useRef<number | undefined>(undefined);
  // The recount the budget runs from: renewed whenever styles not read
  // before are read, so a style made after the budget was spent is still
  // asked about again, not only once, and whenever the counts change, so a
  // site still getting on with its counting is asked until it is done.
  const budgetFrom = React.useRef(0);
  const progress = progressKey(state.styles, ids);
  const progressSeen = React.useRef(progress);
  // Before the timer's effect, which reads the budget this may renew.
  React.useEffect(() => {
    if (progressSeen.current === progress) return;
    progressSeen.current = progress;
    budgetFrom.current = recount;
  }, [progress, recount]);
  React.useEffect(() => {
    // Only while the site is still being counted, or may be: floors that
    // nothing will make whole (content the index cannot reach) are not asked
    // for again.
    const due = recountDue({
      access,
      whole,
      counting,
      failed: state.failed,
      recounts: recount - budgetFrom.current,
    });
    if (!due) return;
    const timer = setTimeout(
      () => setRecount(count => count + 1),
      USAGE_RECOUNT_MS
    );
    return () => clearTimeout(timer);
  }, [access, whole, counting, state, recount]);
  React.useEffect(() => {
    if (access === undefined) return;
    // A recount asks for every row on screen; otherwise only the rows that
    // have come on screen since the last read.
    const again = recounted.current !== recount;
    recounted.current = recount;
    // An empty id names no style, and the route refuses one.
    const unread = idsOf(key).filter(
      id => id !== "" && (again || !known.current.has(id))
    );
    if (unread.length === 0) return;
    if (!again) budgetFrom.current = recount;
    return readInto(
      access,
      unread,
      setState,
      again && recount === countRead.current
    );
  }, [access, key, recount]);
  // Styles asked about again on their own, after a write the server refused.
  const [asked, reread] = React.useState<readonly string[]>([]);
  React.useEffect(() => {
    if (access === undefined || asked.length === 0) return;
    return readInto(access, asked, setState);
  }, [access, asked]);
  // A recount now, its budget renewed: the author just asked for the pages
  // to be counted, so what follows is worth following again.
  const latest = React.useRef(recount);
  latest.current = recount;
  const recountNow = React.useCallback(() => {
    const next = latest.current + 1;
    countRead.current = next;
    budgetFrom.current = next;
    setRecount(next);
  }, []);
  const counter = useCountNow(access, state.mayCount, recountNow, {
    answered: state.answered,
    counting,
  });
  return {
    styles: state.styles,
    whole,
    counting,
    mayLock: state.mayLock,
    mayCount: state.mayCount,
    failed: state.failed,
    reread,
    counter,
  };
}

/** One read's answer folded into what the reads kept. */
function mergedReads(
  current: UsageReads,
  read: SharedStylesUsage,
  ownCount = false
): UsageReads {
  return {
    styles: new Map([...current.styles, ...read.styles]),
    readings: new Map([
      ...current.readings,
      ...[...read.styles.keys()].map(
        id => [id, { whole: read.whole, counting: read.counting }] as const
      ),
    ]),
    mayLock: read.mayLock,
    // Absent from a host written before it existed: no.
    mayCount: read.mayCount === true,
    failed: false,
    // Not a later word for a count when it is the count's own read: a final
    // word is stamped with the reads answered before it, and only another
    // read may move past it, whether or not the count's own ever answers.
    answered: ownCount ? current.answered : current.answered + 1,
  };
}

/**
 * Read some styles' usage into the kept reads, a failure marked; answers the
 * effect's cleanup, which drops a read the effect no longer wants.
 */
function readInto(
  access: SharedStylesAccess,
  ids: readonly string[],
  setState: React.Dispatch<React.SetStateAction<UsageReads>>,
  /** The read a count sets off, which tells the count nothing newer. */
  ownCount = false
): () => void {
  const controller = new AbortController();
  readUsage(access, ids, controller.signal, read =>
    setState(current => mergedReads(current, read, ownCount))
  ).catch(() => {
    if (!controller.signal.aborted) {
      setState(current => ({ ...current, failed: true }));
    }
  });
  return () => controller.abort();
}

/**
 * The rename a row's Name field commits: checked here, written by the host,
 * and a refusal shown where the author is, or raised as a notice once this
 * panel is gone.
 */
function useRename({
  library,
  onRename,
  currentRenameAttempt,
  pendingNames,
  setIssue,
}: {
  library: readonly NamedClass[] | undefined;
  onRename: SharedStylesPanelProps["onRename"];
  currentRenameAttempt: SharedStylesPanelProps["currentRenameAttempt"];
  pendingNames: Readonly<Record<string, string>>;
  setIssue: (issue: Issue | null) => void;
}): (row: SharedStyleRow, value: string) => void {
  const survive = useSurvivingReport();
  return (row, value) => {
    if (onRename === undefined || library === undefined) return;
    // Compared with the name the style is heading for, so typing back the
    // old name while a rename is open is a rename of its own.
    if (value.trim() === (pendingName(pendingNames, row.id) ?? row.name)) {
      setIssue(null);
      return;
    }
    const report = (reason: string): void =>
      survive(reason, () => {
        setIssue({ id: row.id, reason });
        return true;
      });
    const verdict = renameSharedStyle(value, row.id, library);
    if (!verdict.ok) {
      report(verdict.reason);
      return;
    }
    setIssue(null);
    const answer = onRename(row.id, {
      label: verdict.label,
      slug: verdict.slug,
    });
    const mine = currentRenameAttempt?.(row.id);
    const current = (): boolean =>
      mine === undefined || currentRenameAttempt?.(row.id) === mine;
    answer.then(
      outcome => {
        if (!current() || outcome.ok) return;
        report(
          outcome.reason.trim() === "" ? UNEXPLAINED_REFUSAL : outcome.reason
        );
      },
      () => {
        if (current()) report(UNEXPLAINED_REFUSAL);
      }
    );
  };
}

/** A row's accessible name: its name, class name, marks and reach in words. */
function rowLabel(
  row: SharedStyleRow,
  name: string,
  sentence: string,
  tile: SharedStyleTile
): string {
  return [
    name,
    row.className,
    ...(row.locked ? ["locked"] : []),
    ...(row.inCode ? ["set in your site’s code"] : []),
    ...(tile.darkUnreadable ? [SHARED_STYLE_DARK_UNREADABLE] : []),
    ...(sentence === "" ? [] : [sentence]),
  ].join(", ");
}

/** What a row's details are handed beside the row and its name. */
type RowDetails = Omit<
  React.ComponentProps<typeof SharedStyleDetails>,
  "row" | "name" | "sentence"
>;

/** One shared style: a row that opens its details beside the panel. */
function StyleRow({
  row,
  name,
  details,
  paint,
  open,
  onOpenChange,
}: {
  row: SharedStyleRow;
  name: string;
  details: RowDetails;
  /** What the row's preview tile is drawn from. */
  paint: TilePaint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const sentence = sharedStyleReachSentence(details.blocks, details.reach);
  const tile = sharedStyleTile(
    paint.tokens,
    paint.mode,
    sharedStylePreview(row.styles, details.styleContext)
  );
  // A name that can't be changed is not focused, and so not selected, on
  // open: selected text reads as editable. The details take focus instead.
  const fixed = details.readOnly || row.locked || row.inCode;
  const content = React.useRef<HTMLDivElement>(null);
  return (
    <li>
      <Popover open={open} onOpenChange={onOpenChange} modal>
        <DarkModeTip shown={tile.darkUnreadable}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="nx-vars__row nx-shared-styles__row"
              aria-label={rowLabel(row, name, sentence, tile)}
              title={sentence === "" ? undefined : sentence}
              data-shared-style={row.id}
            >
              <RowContent
                row={row}
                name={name}
                reach={details.reach}
                tile={tile}
              />
            </button>
          </PopoverTrigger>
        </DarkModeTip>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          className="nx-vars-editor nx-shared-styles__editor"
          aria-label={name}
          ref={content}
          onOpenAutoFocus={
            fixed
              ? event => {
                  event.preventDefault();
                  content.current?.focus();
                }
              : undefined
          }
        >
          <SharedStyleDetails
            {...details}
            row={row}
            name={name}
            sentence={sentence}
          />
        </PopoverContent>
      </Popover>
    </li>
  );
}

/**
 * The row's "Hard to read in dark mode" tooltip, shown when the row is
 * hovered or focused, so keyboard and touch users meet it too; the row's
 * accessible name says it as well. Nothing is added inside the row button,
 * which is already the one control.
 */
function DarkModeTip({
  shown,
  children,
}: {
  shown: boolean;
  children: React.ReactElement;
}): React.JSX.Element {
  if (!shown) return children;
  return (
    <TooltipProvider delayDuration={300}>
      {/* The editor's own tooltip, which closes as the pointer moves onto the
          canvas; to the right of the row, as before. */}
      <ChromeTooltip side="right" content={SHARED_STYLE_DARK_UNREADABLE}>
        {children}
      </ChromeTooltip>
    </TooltipProvider>
  );
}

/** A row's preview, name and class name, lock, and count. */
function RowContent({
  row,
  name,
  reach,
  tile,
}: {
  row: SharedStyleRow;
  name: string;
  reach: SharedStyleReach | undefined;
  tile: SharedStyleTile;
}): React.JSX.Element {
  return (
    <>
      {/* The page under the preview, so its colours read as on the site; the
          light page, marked, where the style is hard to read on the dark. */}
      <span
        className="nx-shared-styles__tile"
        aria-hidden="true"
        style={tile.page}
        data-dark-unreadable={tile.darkUnreadable ? "" : undefined}
      >
        {/* Outlined: its outline is inline, chosen against its own
            background; the class marks it. */}
        <span
          className={
            tile.outlined
              ? "nx-vars__specimen nx-shared-styles__lead nx-shared-styles__lead--outlined"
              : "nx-vars__specimen nx-shared-styles__lead"
          }
          style={tile.specimen}
        >
          Aa
        </span>
        {tile.darkUnreadable ? (
          <Moon className="nx-shared-styles__dark-flag" size={8} />
        ) : null}
      </span>
      <span className="nx-shared-styles__names">
        <span className="nx-vars__name" title={name}>
          {name}
        </span>
        <span className="nx-shared-styles__class">{row.className}</span>
      </span>
      {row.locked ? (
        <Lock className="nx-shared-styles__lock" aria-hidden="true" size={12} />
      ) : null}
      {row.inCode ? (
        <span className="nx-vars__chip" aria-hidden="true">
          In code
        </span>
      ) : null}
      {reach === undefined ? null : <ReachChip reach={reach} />}
    </>
  );
}

/** A row's count, muted while it is a zero not counted yet. */
function ReachChip({ reach }: { reach: SharedStyleReach }): React.JSX.Element {
  const chip = sharedStyleReachChip(reach);
  return (
    <span
      className={
        chip.uncounted
          ? "nx-vars__chip nx-shared-styles__count--uncounted"
          : "nx-vars__chip"
      }
      aria-hidden="true"
      // Each kind in words on hover, which "5 places" totals; the row's
      // name says the same to a screen reader.
      title={sharedStyleReachSentence(undefined, reach) || undefined}
    >
      {chip.words}
    </span>
  );
}

/**
 * Why "Remove unused…" waits, or `undefined` when it need not: while some
 * pages are still being counted, said first since it lasts longer, or while
 * a rename is stored, since a removal writes the whole list of styles too.
 */
function removeUnusedWait(
  reason: FloorReason,
  held: boolean
): string | undefined {
  if (reason === "counting") return SHARED_STYLE_NOT_WHOLE_REMOVAL;
  if (reason === "permanent") return SHARED_STYLE_UNCOUNTABLE_REMOVAL;
  return held ? SHARED_STYLE_RENAME_PENDING : undefined;
}

/** What "Remove unused…" found: still reading, a refusal, or the list. */
type UnusedRead =
  | { readonly kind: "reading" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "found"; readonly rows: readonly SharedStyleRow[] };

/**
 * The group's heading, with "Remove unused…": it reads the usage of every
 * style that could be removed, lists the unused ones by name, and removes
 * them only once the author confirms. Withheld while some pages are still
 * being counted, saying so in the route's words.
 */
function RemoveUnusedHead({
  rows,
  offered,
  access,
  reason,
  held,
  saidInNote,
  blocksOf,
  onRemoved,
}: {
  rows: readonly SharedStyleRow[];
  /** False for a role that may not change the site's design. */
  offered: boolean;
  access: SharedStylesAccess | undefined;
  /** Why the counts are floors, which decides why removal waits. */
  reason: FloorReason;
  /** A rename is being stored, so a removal, which writes the whole list, waits. */
  held: boolean;
  /**
   * The tab's one counting note already says why it waits, under the same
   * id, so its own line is not drawn a second time.
   */
  saidInNote: boolean;
  blocksOf: (id: string) => BlocksOnThisPage;
  onRemoved: () => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  // A locked style refuses removal, and one in code cannot be removed here.
  const candidates = rows.filter(row => !row.locked && !row.inCode);
  const shown = offered && access !== undefined && candidates.length > 0;
  const wait = removeUnusedWait(reason, held);
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverAnchor asChild>
        <div className="nx-vars__group-head">
          <h3 className="nx-vars__group-name" id="nx-shared-styles-all">
            {EDITOR_WORDS.sharedStyles}
          </h3>
          {shown ? (
            <PopoverTrigger asChild>
              <button
                type="button"
                className="nx-vars__link nx-shared-styles__remove-unused"
                disabled={wait !== undefined}
                aria-describedby={
                  wait === undefined ? undefined : "nx-shared-styles-withheld"
                }
              >
                Remove unused&hellip;
              </button>
            </PopoverTrigger>
          ) : null}
        </div>
      </PopoverAnchor>
      {shown && wait !== undefined && !saidInNote ? (
        <p className="nx-shared-styles__meta" id="nx-shared-styles-withheld">
          {wait}
        </p>
      ) : null}
      {shown && access !== undefined ? (
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          className="nx-vars-editor nx-shared-styles__editor"
          aria-label={`Remove unused ${SHARED_STYLES_WORD}`}
        >
          <RemoveUnused
            candidates={candidates}
            access={access}
            held={held}
            blocksOf={blocksOf}
            onDone={() => {
              setOpen(false);
              onRemoved();
            }}
            onKeep={() => setOpen(false)}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

/**
 * The styles nothing uses, from the usage of every candidate read fifty at a
 * time; a refusal in the route's words while some pages are still being
 * counted.
 */
async function findUnused(
  access: SharedStylesAccess,
  candidates: readonly SharedStyleRow[],
  blocksOf: (id: string) => BlocksOnThisPage,
  signal: AbortSignal
): Promise<UnusedRead> {
  const unused: SharedStyleRow[] = [];
  for (let at = 0; at < candidates.length; at += PAGE_SIZE) {
    const batch = candidates.slice(at, at + PAGE_SIZE);
    const answer = await access.usage(
      batch.map(row => row.id),
      signal
    );
    if (!answer.whole) {
      return { kind: "refused", reason: SHARED_STYLE_NOT_WHOLE_REMOVAL };
    }
    unused.push(
      ...batch.filter(row => {
        const reach = answer.styles.get(row.id);
        return reach !== undefined && isUnused(blocksOf(row.id), reach);
      })
    );
  }
  return { kind: "found", rows: unused };
}

/** "1 unused shared style", "3 unused shared styles". */
function unusedCount(count: number): string {
  return `${count} unused ${count === 1 ? "shared style" : SHARED_STYLES_WORD}`;
}

/** The unused styles, listed, and their removal once confirmed. */
function RemoveUnused({
  candidates,
  access,
  held,
  blocksOf,
  onDone,
  onKeep,
}: {
  candidates: readonly SharedStyleRow[];
  access: SharedStylesAccess;
  held: boolean;
  blocksOf: (id: string) => BlocksOnThisPage;
  onDone: () => void;
  onKeep: () => void;
}): React.JSX.Element {
  const [read, setRead] = React.useState<UnusedRead>({ kind: "reading" });
  // Read once per opening, from what stands when the author asks.
  const [asked] = React.useState(() => ({ candidates, blocksOf }));
  React.useEffect(() => {
    const controller = new AbortController();
    findUnused(access, asked.candidates, asked.blocksOf, controller.signal)
      .then(found => {
        if (!controller.signal.aborted) setRead(found);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setRead({
          kind: "refused",
          reason: `Where these ${SHARED_STYLES_WORD} are used could not be read.`,
        });
      });
    return () => controller.abort();
  }, [access, asked]);

  if (read.kind !== "found") {
    return (
      <div className="nx-vars-editor__body">
        {read.kind === "refused" ? (
          <Refusal refusal={read.reason} />
        ) : (
          <p className="nx-shared-styles__meta" role="status">
            {`Finding unused ${SHARED_STYLES_WORD}…`}
          </p>
        )}
      </div>
    );
  }
  if (read.rows.length === 0) {
    return (
      <div className="nx-vars-editor__body">
        <p className="nx-shared-styles__meta" role="status">
          Every shared style here is in use.
        </p>
      </div>
    );
  }
  return (
    <ConfirmUnused
      rows={read.rows}
      access={access}
      held={held}
      onDone={onDone}
      onKeep={onKeep}
    />
  );
}

/** "50 were removed before the rest were refused." */
function removedBefore(count: number): string {
  return `${count} ${count === 1 ? "was" : "were"} removed before the rest were refused.`;
}

/**
 * The confirmation listing the unused styles, removed fifty at a time.
 *
 * Each batch the route stores is gone for good, so it leaves the list as it
 * lands: when a later batch is refused, the list holds only what is left, a
 * retry sends only that, and the dialog says how many went first.
 */
function ConfirmUnused({
  rows,
  access,
  held,
  onDone,
  onKeep,
}: {
  rows: readonly SharedStyleRow[];
  access: SharedStylesAccess;
  held: boolean;
  onDone: () => void;
  onKeep: () => void;
}): React.JSX.Element {
  const { busy, refusal, run } = useRefusableWrite();
  const [left, setLeft] = React.useState(rows);
  const [removed, setRemoved] = React.useState(0);
  const count = left.length;
  const remove = async (): Promise<void> => {
    let rest = left;
    while (rest.length > 0) {
      const batch = rest.slice(0, PAGE_SIZE);
      const write = async () =>
        (
          await removeSharedStylesThrough(
            access,
            batch.map(row => row.id)
          )
        )?.reason;
      if (!(await run(write))) return;
      rest = rest.slice(PAGE_SIZE);
      setLeft(rest);
      setRemoved(gone => gone + batch.length);
    }
    onDone();
  };
  return (
    <div
      className="nx-vars-editor__body nx-vars-editor__confirm"
      role="group"
      aria-label={`Remove ${unusedCount(count)}`}
    >
      <p>{`Remove ${unusedCount(count)}? No page uses them.`}</p>
      {/* Stacked, so a long name and its class both read in full. */}
      <ul className="nx-shared-styles__uses nx-shared-styles__uses--stacked">
        {left.map(row => (
          <li key={row.id}>
            <span className="nx-shared-styles__use-title">{row.name}</span>
            <span className="nx-shared-styles__class">{row.className}</span>
          </li>
        ))}
      </ul>
      {refusal !== null && removed > 0 ? (
        <p className="nx-shared-styles__meta">{removedBefore(removed)}</p>
      ) : null}
      <Refusal refusal={refusal} />
      <KeepOrRemove
        busy={busy}
        onKeep={onKeep}
        onRemove={() => void remove()}
        removeLabel={`Remove ${count}`}
        removeHeld={held}
        removeDescribedBy="nx-shared-styles-confirm-held"
      />
      <HoldReason held={held} id="nx-shared-styles-confirm-held" />
    </div>
  );
}
