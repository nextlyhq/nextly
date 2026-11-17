/**
 * The Shared styles tab of the Design panel: every shared style the site
 * renders, found by name, property or value, with how widely each is used,
 * and each row's details beside the panel ({@link shared-style-details}).
 *
 * Drawn in the Variables and Fonts tabs' language: a search, a small-caps
 * group, compact rows, and a 240px popover editor per row.
 *
 * ## Two sections
 *
 * "Block styles" first, the saved looks for one kind of block by block type
 * ({@link block-looks-group}), then "Shared styles", the author's own styles
 * for any block, each with a line that says which is which.
 *
 * ## Shared styles are made from a block
 *
 * There is no "+" among the shared styles. One is made from a block's own
 * look, with "Save as shared style…" on the block, so the empty list says
 * that. A block style is made with its type's "+ New <block> style".
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
 * ## Where the parts live
 *
 * This module is the tab itself and the entry for the rest: its shapes are in
 * `shared-styles-types.ts`, the usage reads and the rename in
 * `shared-styles-usage.ts`, one row in `shared-style-row.tsx`, the list and
 * the notes around it in `shared-styles-list.tsx`, and removing unused styles
 * in `shared-styles-remove-unused.tsx`. Every name it exported, it still
 * exports.
 *
 * @module shared-styles-panel
 */
import type {
  NamedClass,
  SiteTokenSet,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import { Input } from "@nextlyhq/ui";
import { Search } from "lucide-react";
import * as React from "react";

import { lookKeyOf, type BlockLookGroup } from "./block-look-rows";
import { BlockLooksGroup } from "./block-looks-group";
import {
  BLOCK_STYLE_WORDS,
  blockStyleActionsOf,
  type BlockStyleActions,
} from "./block-style-actions";
import { ShowMore, withOpenRow } from "./panel-actions";
import {
  inSharedStyleFilter,
  sharedStyleUse,
  sharedStyleSearchText,
  SHARED_STYLES_WORD,
  type BlocksOnThisPage,
  type SharedStyleFilter,
  type SharedStyleReach,
  type SharedStyleRow,
} from "./shared-style-library";
import {
  ReachChip,
  StyleRow,
  type TilePaint,
  usePaint,
} from "./shared-style-row";
import {
  countingNotes,
  floorReason,
  FilterBar,
  issueBesideList,
  issueOf,
  PanelNotes,
  StyleList,
  TopNote,
  Unread,
  unusedWithheld,
} from "./shared-styles-list";
import { RemoveUnusedHead } from "./shared-styles-remove-unused";
import type {
  PageClassBlocks,
  PanelLookEditing,
  SharedStylesAccess,
  SharedStylesPanelProps,
} from "./shared-styles-types";
import { PAGE_SIZE } from "./shared-styles-types";
import {
  type Issue,
  pendingName,
  type UsageState,
  useRename,
  useUsage,
} from "./shared-styles-usage";
import {
  foundLooks,
  foundSharedStyles,
  stylesTabSource,
} from "./styles-tab-matches";
import type { GroupFolds } from "./tokens-panel";
import { idsKey, idsOf } from "./usage-reads";

// The tab's shapes, its usage reads and rename, its row, its list and the
// removal of unused styles live in modules of their own beside it; every name
// this module exported still is.
export type {
  ClassRenameOutcome,
  PageClassBlocks,
  SharedStylesAccess,
  SharedStylesPanelProps,
} from "./shared-styles-types";
// Part of this module's exported names; no importer in the package reads it.
// fallow-ignore-next-line unused-type
export type { PanelLookEditing } from "./shared-styles-types";

/*
 * The recount timing lives with the reads it times; said here too, where the
 * tab's hosts and tests have always found it.
 */
export { USAGE_RECOUNT_IDLE_MAX, USAGE_RECOUNT_MS } from "./usage-reads";

/** A search a host keeps across several views, and the way to change it. */
export interface HostSearch {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  /** The host's search box, where focus goes once a style is removed. */
  readonly searchRef?: React.RefObject<HTMLInputElement | null>;
}

/**
 * The search a host keeps across several views, as the Design panel keeps
 * one across its tabs. Provided, the tab lists what it matches and draws no
 * search box of its own.
 */
export const SharedStylesHostSearch: React.Context<HostSearch | undefined> =
  React.createContext<HostSearch | undefined>(undefined);

/**
 * What the tab searches for: the host's search where it keeps one, changed
 * through the host, else the tab's own. With it, the box focus goes back to
 * once a style is removed: the host's, since the tab then draws none.
 */
function usePanelSearch(): {
  query: string;
  setQuery: (query: string) => void;
  box: React.RefObject<HTMLInputElement | null>;
} {
  const host = React.useContext(SharedStylesHostSearch);
  const [own, setOwn] = React.useState("");
  const ownBox = React.useRef<HTMLInputElement>(null);
  return host === undefined
    ? { query: own, setQuery: setOwn, box: ownBox }
    : {
        query: host.query,
        setQuery: host.onQuery,
        box: host.searchRef ?? ownBox,
      };
}

/** The filter bar, drawn only while there are styles to filter. */
function FiltersWhenListed(
  props: React.ComponentProps<typeof FilterBar>
): React.JSX.Element | null {
  return props.rows.length > 0 ? <FilterBar {...props} /> : null;
}

/** No pending names, as one value rather than a fresh record each render. */
const NO_NAMES: Readonly<Record<string, string>> = Object.freeze({});

/**
 * The rows the library gives, from the listing the Design panel counts with,
 * kept while the library and the code's ids are.
 */
function useRows(
  library: readonly NamedClass[] | undefined,
  suppliedClassIds: readonly string[] | undefined
): { rows: SharedStyleRow[]; groups: BlockLookGroup[]; lookIds: string[] } {
  // Keyed by the ids rather than the array, which a host may build afresh on
  // every render: the search text compiles every style, once per library,
  // not once per render.
  const suppliedKey = idsKey(suppliedClassIds ?? []);
  return React.useMemo(() => {
    if (library === undefined) return { rows: [], groups: [], lookIds: [] };
    const { rows, groups } = stylesTabSource(
      library,
      new Set(idsOf(suppliedKey))
    );
    // The worn looks, whose counts are read with the styles' in one read, so
    // the tab's counting and failure notes speak for both.
    return { rows, groups, lookIds: wornLookIds(groups) };
  }, [library, suppliedKey]);
}

/**
 * The rows, those the search finds by name, property or value, and what
 * their tiles are drawn from. Each row's search text compiles its style, so
 * it is kept per library and context rather than made again on every render.
 */
function useListedRows({
  library,
  suppliedClassIds,
  styleContext,
  tokens,
  query,
}: {
  library: readonly NamedClass[] | undefined;
  suppliedClassIds: readonly string[] | undefined;
  styleContext: StyleCompileContext | undefined;
  tokens: SiteTokenSet | undefined;
  query: string;
}): {
  rows: SharedStyleRow[];
  lookIds: string[];
  found: SharedStyleRow[];
  paint: TilePaint;
} {
  const paint = usePaint(tokens);
  const { rows, lookIds } = useRows(library, suppliedClassIds);
  const texts = React.useMemo(
    () =>
      new Map(
        rows.map(row => [row.id, sharedStyleSearchText(row, styleContext)])
      ),
    [rows, styleContext]
  );
  const found = foundSharedStyles(rows, query, row => texts.get(row.id) ?? "");
  return { rows, lookIds, found, paint };
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
  const { groups } = useRows(library, suppliedClassIds);
  // Each look's search text, as each shared style's is: its name and every
  // property and value it declares, so a search the box promises finds both.
  // Keyed by look, its type with its id, since two types' own looks may
  // share an id and each is found by its own text.
  const texts = React.useMemo(
    () =>
      new Map(
        groups.flatMap(group =>
          group.rows.map(row => [
            lookKeyOf(row),
            sharedStyleSearchText(row, styleContext),
          ])
        )
      ),
    [groups, styleContext]
  );
  return foundLooks(groups, query, row => texts.get(lookKeyOf(row)) ?? "");
}

/**
 * The Block styles section above the shared styles: the site's looks by
 * block type, found by the same search, with the worn looks' counts read as
 * the shared styles' are. An own look has no count of its own.
 */
function PanelLooks({
  library,
  suppliedClassIds,
  query,
  paint,
  editing,
  styleContext,
  reaches,
  blocksOf,
  actions,
  readOnly,
  folds,
}: {
  library: readonly NamedClass[];
  suppliedClassIds: readonly string[] | undefined;
  query: string;
  styleContext: StyleCompileContext | undefined;
  paint: TilePaint;
  editing: PanelLookEditing | undefined;
  /** Each worn look's reach, from the tab's one usage read. */
  reaches: ReadonlyMap<string, SharedStyleReach>;
  /** The open page's blocks carrying a class, as the shared styles read them. */
  blocksOf: (id: string) => BlocksOnThisPage;
  actions: BlockStyleActions | undefined;
  readOnly: boolean;
  folds: GroupFolds | undefined;
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
      {...(actions === undefined ? {} : { actions })}
      readOnly={readOnly}
      {...(folds === undefined ? {} : { folds })}
      searching={query.trim() !== ""}
      reachOf={row => reaches.get(row.id)}
      blocksOf={row => blocksOf(row.id)}
      chip={reach => <ReachChip reach={reach} />}
    />
  );
}

/**
 * The Block styles section's writes, over the host's whole-list class write
 * and the shared styles' removal, which refuses a style a page still uses.
 */
function useBlockStyleActions(
  edit: SharedStylesPanelProps["onEditClasses"],
  access: SharedStylesAccess | undefined
): BlockStyleActions | undefined {
  const remove = access?.remove;
  return React.useMemo(
    () => (edit === undefined ? undefined : blockStyleActionsOf(edit, remove)),
    [edit, remove]
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
  onEditClasses,
  folds,
  initialOpenId,
}: SharedStylesPanelProps): React.JSX.Element {
  const { query, setQuery, box: search } = usePanelSearch();
  const [filter, setFilter] = React.useState<SharedStyleFilter>("all");
  const [pages, setPages] = React.useState(1);
  const [issue, setIssue] = React.useState<Issue | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(
    openFirst(initialOpenId)
  );
  const { rows, lookIds, found, paint } = useListedRows({
    library,
    suppliedClassIds,
    styleContext,
    tokens,
    query,
  });
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
  const shown = shownWithOpen(filtered, pages, openId);
  const rename = useRename({
    library,
    onRename,
    currentRenameAttempt,
    pendingNames,
    setIssue,
  });
  const blockStyles = useBlockStyleActions(onEditClasses, access);
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
      <FiltersWhenListed
        rows={rows}
        filter={filter}
        onFilter={next => {
          setFilter(next);
          setPages(1);
        }}
        usageOf={usageOf}
        exact={exact}
      />
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
          blocksOf={blocksOf}
          actions={blockStyles}
          readOnly={readOnly}
          folds={folds}
        />
        <section
          className="nx-vars__group"
          aria-labelledby="nx-shared-styles-all"
          aria-describedby="nx-shared-styles-line"
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
          <p className="nx-shared-styles__line" id="nx-shared-styles-line">
            {BLOCK_STYLE_WORDS.sharedLine}
          </p>
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

/** The style whose details open first: the one another tab asked for, or none. */
function openFirst(initialOpenId: string | undefined): string | null {
  return initialOpenId ?? null;
}

/**
 * The rows the pages show, with the open style's row: a style opened from
 * another tab can lie past the pages, and its row is drawn all the same, so
 * its details have a row to open beside.
 */
function shownWithOpen(
  rows: readonly SharedStyleRow[],
  pages: number,
  openId: string | null
): readonly SharedStyleRow[] {
  return withOpenRow(rows, pages * PAGE_SIZE, row => row.id === openId);
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
}): React.JSX.Element | null {
  // Not drawn where a host keeps the search.
  if (React.useContext(SharedStylesHostSearch) !== undefined) return null;
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
