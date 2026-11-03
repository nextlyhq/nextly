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
 * There is no "+" here. A shared style is made from a block's own look, so
 * the empty tab says where they come from.
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
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import { Lock, Search } from "lucide-react";
import * as React from "react";

import { useSurvivingReport } from "./builder-notices";
import { EDITOR_WORDS } from "./editor-words";
import {
  KeepOrRemove,
  Refusal,
  ShowMore,
  useRefusableWrite,
} from "./panel-actions";
import { usePrefersDark } from "./prefers-dark";
import { HoldReason, SharedStyleDetails } from "./shared-style-details";
import {
  inSharedStyleFilter,
  isUnused,
  renameSharedStyle,
  sharedStyleFilterEmpty,
  sharedStylePageTile,
  sharedStyleUse,
  SHARED_STYLE_FILTERS,
  searchSharedStyles,
  sharedStylePreview,
  sharedStyleReachChip,
  sharedStyleReachSentence,
  sharedStyleRows,
  sharedStyleSearchText,
  SHARED_STYLE_NOT_WHOLE_NOTE,
  SHARED_STYLE_NOT_WHOLE_REMOVAL,
  SHARED_STYLE_RENAME_PENDING,
  SHARED_STYLES_WORD,
  type BlocksOnThisPage,
  type SharedStyleFilter,
  type SharedStyleReach,
  type SharedStyleRow,
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
}

/** How many rows mount before the author asks for more; also one usage read. */
const PAGE_SIZE = 50;

/**
 * How long the rows on screen wait before their usage is asked again while
 * some pages are still being counted, so the counts become whole, and Remove
 * unused becomes possible, without reopening the tab.
 */
export const USAGE_RECOUNT_MS = 15_000;

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
): SharedStyleRow[] {
  // Keyed by the ids rather than the array, which a host may build afresh on
  // every render: the search text compiles every style, once per library,
  // not once per render.
  const suppliedKey = idsKey(suppliedClassIds ?? []);
  return React.useMemo(
    () =>
      library === undefined
        ? []
        : sharedStyleRows(library, new Set(idsOf(suppliedKey))),
    [library, suppliedKey]
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
}: SharedStylesPanelProps): React.JSX.Element {
  const page = usePageTile(tokens);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<SharedStyleFilter>("all");
  const [pages, setPages] = React.useState(1);
  const [issue, setIssue] = React.useState<Issue | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const rows = useRows(library, suppliedClassIds);
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
  const usage = useUsage(access, usageOrder(rows, found, pages));
  const usageOf = (row: SharedStyleRow) =>
    sharedStyleUse(pageBlocksOf(pageBlocks, row.id), usage.styles.get(row.id));
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
  const writable = !readOnly && onRename !== undefined;
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
          exact={countsExact(usage, pageBlocks, rows)}
        />
      )}
      <div className="nx-vars__body">
        <PanelNotes
          readOnly={readOnly}
          usageFailed={usage.failed}
          issue={issueBesideList(issue, openId)}
        />
        <section
          className="nx-vars__group"
          aria-labelledby="nx-shared-styles-all"
        >
          <RemoveUnusedHead
            rows={rows}
            offered={!readOnly && access !== undefined}
            access={access}
            whole={usage.whole}
            held={held}
            blocksOf={blocksOf}
            onRemoved={() => search.current?.focus()}
          />
          <StyleList
            rows={rows}
            found={filtered}
            filter={filter}
            query={query.trim()}
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
                }}
                page={page}
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
        <FloorNote whole={usage.whole} />
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

/** The page each row's preview is drawn on, in the mode the canvas shows. */
function usePageTile(tokens: SiteTokenSet | undefined): React.CSSProperties {
  return sharedStylePageTile(tokens, activeTokenMode(usePrefersDark()));
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
  pages: number
): string[] {
  const first = found.slice(0, pages * PAGE_SIZE).map(row => row.id);
  const listed = new Set(first);
  return [...first, ...rows.map(row => row.id).filter(id => !listed.has(id))];
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

/** The note under the list while every count is a floor. */
function FloorNote({
  whole,
}: {
  whole: boolean | undefined;
}): React.JSX.Element | null {
  if (whole !== false) return null;
  return <p className="nx-vars__note">{SHARED_STYLE_NOT_WHOLE_NOTE}</p>;
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

/** The rows, or what to say when there are none or none match. */
function StyleList({
  rows,
  found,
  filter,
  query,
  children,
}: {
  rows: readonly SharedStyleRow[];
  /** The rows the search and the filter leave. */
  found: readonly SharedStyleRow[];
  filter: SharedStyleFilter;
  query: string;
  children: React.ReactNode;
}): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="nx-vars__empty">
        {`${EDITOR_WORDS.sharedStyles} you make from a block show here.`}
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
  readonly mayLock: boolean;
  readonly failed: boolean;
}

/** What the reads kept: each style's usage, and the health it was read under. */
interface UsageReads {
  readonly styles: ReadonlyMap<string, SharedStyleReach>;
  /** Per style, whether the read that counted it saw a whole index. */
  readonly readWhole: ReadonlyMap<string, boolean>;
  readonly mayLock: boolean;
  readonly failed: boolean;
}

/**
 * Whether the counts of `ids` are whole: every one read so far was read under
 * a whole index. Derived per style rather than from the last read, since one
 * scan is several reads and the index can finish counting between them: an
 * earlier read's floors stay floors until that style is read again. Only the
 * styles listed now are asked, so a style since removed cannot hold it false.
 */
function wholeOf(
  readWhole: ReadonlyMap<string, boolean>,
  ids: readonly string[]
): boolean | undefined {
  const read = ids.flatMap(id => {
    const whole = readWhole.get(id);
    return whole === undefined ? [] : [whole];
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
    readWhole: new Map(),
    mayLock: false,
    failed: false,
  });
  const known = React.useRef(state.styles);
  known.current = state.styles;
  const key = idsKey(ids);
  const whole = wholeOf(state.readWhole, ids);
  const [recount, setRecount] = React.useState(0);
  const recounted = React.useRef(recount);
  React.useEffect(() => {
    if (access === undefined || whole !== false || state.failed) return;
    const timer = setTimeout(
      () => setRecount(count => count + 1),
      USAGE_RECOUNT_MS
    );
    return () => clearTimeout(timer);
  }, [access, whole, state.failed, state.styles, recount]);
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
    const controller = new AbortController();
    readUsage(access, unread, controller.signal, read =>
      setState(current => ({
        styles: new Map([...current.styles, ...read.styles]),
        readWhole: new Map([
          ...current.readWhole,
          ...[...read.styles.keys()].map(id => [id, read.whole] as const),
        ]),
        mayLock: read.mayLock,
        failed: false,
      }))
    ).catch(() => {
      if (!controller.signal.aborted) {
        setState(current => ({ ...current, failed: true }));
      }
    });
    return () => controller.abort();
  }, [access, key, recount]);
  return {
    styles: state.styles,
    whole,
    mayLock: state.mayLock,
    failed: state.failed,
  };
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
function rowLabel(row: SharedStyleRow, name: string, sentence: string): string {
  return [
    name,
    row.className,
    ...(row.locked ? ["locked"] : []),
    ...(row.inCode ? ["set in your site’s code"] : []),
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
  page,
  open,
  onOpenChange,
}: {
  row: SharedStyleRow;
  name: string;
  details: RowDetails;
  /** The site's page colours, which the row's preview is drawn on. */
  page: React.CSSProperties;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const sentence = sharedStyleReachSentence(details.blocks, details.reach);
  // A name that can't be changed is not focused, and so not selected, on
  // open: selected text reads as editable. The details take focus instead.
  const fixed = details.readOnly || row.locked || row.inCode;
  const content = React.useRef<HTMLDivElement>(null);
  return (
    <li>
      <Popover open={open} onOpenChange={onOpenChange} modal>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="nx-vars__row nx-shared-styles__row"
            aria-label={rowLabel(row, name, sentence)}
            title={sentence === "" ? undefined : sentence}
            data-shared-style={row.id}
          >
            <RowContent
              row={row}
              name={name}
              reach={details.reach}
              styleContext={details.styleContext}
              page={page}
            />
          </button>
        </PopoverTrigger>
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

/** A row's preview, name and class name, lock, and count. */
function RowContent({
  row,
  name,
  reach,
  styleContext,
  page,
}: {
  row: SharedStyleRow;
  name: string;
  reach: SharedStyleReach | undefined;
  styleContext: StyleCompileContext | undefined;
  page: React.CSSProperties;
}): React.JSX.Element {
  return (
    <>
      {/* The page under the preview, so its colours read as on the site. */}
      <span className="nx-shared-styles__tile" aria-hidden="true" style={page}>
        <span
          className="nx-vars__specimen nx-shared-styles__lead"
          style={sharedStylePreview(row.styles, styleContext)}
        >
          Aa
        </span>
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
      {reach === undefined ? null : (
        <span className="nx-vars__chip" aria-hidden="true">
          {sharedStyleReachChip(reach)}
        </span>
      )}
    </>
  );
}

/**
 * Why "Remove unused…" waits, or `undefined` when it need not: while some
 * pages are still being counted, said first since it lasts longer, or while
 * a rename is stored, since a removal writes the whole list of styles too.
 */
function removeUnusedWait(
  whole: boolean | undefined,
  held: boolean
): string | undefined {
  if (whole === false) return SHARED_STYLE_NOT_WHOLE_REMOVAL;
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
  whole,
  held,
  blocksOf,
  onRemoved,
}: {
  rows: readonly SharedStyleRow[];
  /** False for a role that may not change the site's design. */
  offered: boolean;
  access: SharedStylesAccess | undefined;
  whole: boolean | undefined;
  /** A rename is being stored, so a removal, which writes the whole list, waits. */
  held: boolean;
  blocksOf: (id: string) => BlocksOnThisPage;
  onRemoved: () => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  // A locked style refuses removal, and one in code cannot be removed here.
  const candidates = rows.filter(row => !row.locked && !row.inCode);
  const shown = offered && access !== undefined && candidates.length > 0;
  const wait = removeUnusedWait(whole, held);
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
      {shown && wait !== undefined ? (
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
      if (!(await run(() => access.remove(batch.map(row => row.id))))) return;
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
