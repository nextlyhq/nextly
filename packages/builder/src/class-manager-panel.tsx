/**
 * The class manager: every class the site renders, and the edits to the library.
 *
 * A panel over {@link class-library}, which holds every rule this draws. The
 * other half is {@link class-selector}: applying a class happens constantly and
 * belongs beside the style controls, while auditing and cleaning up is
 * occasional and needs a surface built for reading a list. Webflow splits them
 * for that reason and this follows it.
 *
 * ## The table is the editor
 *
 * A name is edited where it is read, which is the shape {@link tokens-panel}
 * established here: the common edit is renaming one class, and a detail form
 * turns that into two clicks and a context switch.
 *
 * ## A count is evidence, and the wording has to carry that
 *
 * The usage index has no concurrency control and can UNDER-count: two saves to
 * one document can each remove the other's row, leaving a class that still
 * renders with nothing to say so. So a count is a floor, never a measurement,
 * and nothing here is phrased as though it were one — the filter reports an
 * absence of evidence rather than an absence of usage, and a row with no known
 * document says so in those words.
 *
 * That is also why deleting confirms unconditionally. Skipping the
 * confirmation when the count is zero would put the whole weight of an
 * irreversible edit on the one value the index is known to get wrong in the
 * direction that loses work.
 *
 * ## Edits are lifted, not saved here
 *
 * Every control reports an intent and stores nothing. Persistence belongs to
 * whoever owns the document — the section-scoped site-style write this package
 * cannot reach.
 *
 * @module class-manager-panel
 */
import type { NamedClass } from "@nextlyhq/blocks-engine";
import { Button, Input } from "@nextlyhq/ui";
import * as React from "react";

import { useSurvivingReport } from "./builder-notices";
import {
  classRows,
  deletionWarning,
  filterClassRows,
  searchClassRows,
  renamedClassName,
  usageSummary,
  type ClassFilter,
  type ClassRow,
  type ClassUsageCounts,
} from "./class-library";
import { commitOnEnter } from "./commit-on-enter";

/** The filters, with the wording each one is allowed to use. */
const FILTERS: ReadonlyArray<{ value: ClassFilter; label: string }> = [
  { value: "all", label: "All" },
  // NOT "Unused", and not "No known usage" either. The index cannot tell a
  // class no document uses from one whose rows a save removed, and it also
  // retains rows a failed removal left behind — so the only thing this filter
  // can honestly name is the index itself.
  { value: "not-in-index", label: "Not in index" },
  { value: "on-this-page", label: "On this page" },
];

/**
 * The filters that can be answered from what the host supplied.
 *
 * "Not in index" is withheld when no usage was read, rather than answered from
 * the empty map that stands in for one. Every class would satisfy it, which
 * reads as a site where nothing is used — the most alarming possible reading,
 * produced entirely by not having asked.
 */
function offerableFilters(
  usageKnown: boolean
): ReadonlyArray<{ value: ClassFilter; label: string }> {
  return usageKnown
    ? FILTERS
    : FILTERS.filter(filter => filter.value !== "not-in-index");
}

/**
 * What a host answers a rename with, when it answers at all.
 *
 * A persisted rename is a network write and can be refused. A host that returns
 * nothing is taken at its word and the row simply clears, which keeps every
 * existing caller working; one that returns this gets its refusal SHOWN rather
 * than swallowed, which is the difference between a rename that failed and a
 * rename that appears to have worked until the next read.
 */
export type ClassRenameOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * What a rename may answer with, which is ANYTHING.
 *
 * `unknown` rather than a union, because the contract this replaced was
 * `=> void` and TypeScript accepts every return type where `void` is declared.
 * `onRename={() => map.set(id, slug)}` and an async helper resolving to some
 * mutation result both satisfied it, so any narrower union stops existing
 * callers compiling — and a union that merely ADDS `Promise<void>` still
 * rejects them.
 *
 * The runtime cost of narrowing was the worse half. A synchronous non-undefined
 * return reaching `.then` throws out of the event handler, and a resolved
 * `Promise<void>` read as `result.ok` threw and was caught — reporting a rename
 * that SUCCEEDED as failed.
 *
 * So nothing is assumed about the answer. It is interpreted only once it has
 * been shown to be a promise, and its resolution only once it has been shown to
 * be an outcome; anything else is a host that does not report, which is the
 * silence the `void` form always meant.
 */
export type ClassRenameAnswer = unknown;

/** Whether a value can be awaited, without assuming it is a native promise. */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

/** Whether a resolution is an outcome this panel can report, or something else. */
function isRenameOutcome(value: unknown): value is ClassRenameOutcome {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean"
  );
}

export interface ClassManagerPanelProps {
  /**
   * The site's class library, or `undefined` while the host has not read it.
   *
   * A real third state rather than an empty library, for the reason the tokens
   * studio has one: a site that has stored nothing legitimately has no classes,
   * and an author must not be shown "no classes" for a library still loading.
   */
  library: readonly NamedClass[] | undefined;
  /**
   * Why the library is absent, when it is.
   *
   * A read that FAILED will not finish, and a surface that goes on saying
   * "loading" describes a state the site is not in — the author waits for
   * something that is never coming rather than retrying or reporting it. The
   * selector and the fonts panel already draw this distinction; the manager
   * discarded it and showed one wording for both.
   */
  absence?: "pending" | "failed";
  /**
   * Documents known to reference each class, keyed by id. A floor.
   *
   * `undefined` is a THIRD state, not an empty index: a host that cannot read
   * the usage index has not established that nothing uses these classes, and
   * an empty map would say exactly that. The rows then report the absence of
   * the reading rather than an absence of usage.
   */
  usage?: ClassUsageCounts;
  /** The class ids the open document applies, for the on-this-page filter. */
  documentClassIds: readonly string[];
  /**
   * Whether that list covers the whole document.
   *
   * The walk producing it stops at the document's node ceiling, so a class
   * applied past that bound is missing from the list — and its absence must
   * not be read as "not on this page". `"partial"` says so on the surface
   * rather than leaving the filter to make a claim it cannot support.
   */
  documentScan?: "complete" | "partial";
  /**
   * The name each class is currently being RENAMED to, keyed by id.
   *
   * A rename is a network write and `library` does not move until it comes
   * back, so the rendered slug is stale for as long as it is in flight. An
   * author who renames `hero` to `promo` and types `hero` again inside that
   * window is reverting — and comparing against the rendered name reads it as
   * a no-op and lets the first write land.
   *
   * Supplied by the HOST rather than remembered here, because the host owns the
   * write queue and this panel does not survive a switch to another rail panel.
   * A field holding it locally lost it on exactly the switch that makes the
   * window long enough to matter.
   */
  pendingSlugs?: Readonly<Record<string, string>>;
  /**
   * How many rows to mount at once, and how many each "show more" adds.
   *
   * A host embedding the manager in a narrower column has a legitimate reason
   * to want fewer, so the page size is stated rather than fixed. Omitted — or
   * given a value that cannot bound a list, which the `number` type still
   * admits — it is {@link DEFAULT_PAGE_SIZE}, a bound that exists so a library
   * near its ceiling does not mount two thousand text inputs at once.
   *
   * A later value replaces the earlier one, so a column that narrows after
   * mount is bounded by what the host asks for NOW.
   */
  pageSize?: number;
  /**
   * The classes something ELSE supplies, which the stored library layers over.
   *
   * Needed because these two are not equally editable, exactly as the tokens
   * studio found for tokens. `resolveSiteStyle` merges the site's configured
   * classes back over the stored tier BY ID, so absence from storage means "no
   * override" rather than "deleted" — a supplied class reappears on the next
   * read while the delete callback has already stripped it from every document
   * that referenced it. The author is left with the class back, nothing using
   * it, and the references gone.
   *
   * Offering a Delete that quietly undoes itself is worse than not offering
   * one, so it is withheld and the row says why.
   */
  suppliedClassIds?: readonly string[];
  /**
   * Rename a class. The slug has already passed the engine's grammar.
   *
   * May answer with the outcome. A host that persists asynchronously and stays
   * silent leaves the row looking renamed whatever happened, so returning a
   * {@link ClassRenameOutcome} is how a refusal reaches the author.
   */
  onRename: (classId: string, slug: string) => ClassRenameAnswer;
  /**
   * Delete a class, removing it from every document that references it.
   *
   * Optional, because that removal is a site-wide write and a host without one
   * cannot honour what the word promises. Absent, no Delete is offered at all:
   * a disabled one invites an author to hunt for the permission that would
   * enable it, and there is none to find.
   */
  onDelete?: (classId: string) => void;
}

/** Every class the site renders, filtered, renameable and deletable. */
export function ClassManagerPanel({
  library,
  absence,
  documentScan,
  pendingSlugs,
  pageSize,
  usage,
  documentClassIds,
  suppliedClassIds,
  onRename,
  onDelete,
}: ClassManagerPanelProps): React.ReactElement {
  const [filter, setFilter] = React.useState<ClassFilter>("all");
  /*
   * The name search, which is what makes every class REACHABLE.
   *
   * The list is capped so a library near its ceiling does not mount two
   * thousand rows and their inputs at once. Without a search that cap is a
   * wall: the chips narrow by index state and by the open page, so a class
   * past the cap that no filter happens to select could never be shown or
   * renamed — and the note under the cap said to filter, which was advice the
   * surface could not honour.
   */
  const [query, setQuery] = React.useState("");
  /*
   * A filter the panel no longer offers cannot stay selected. `usage` is a
   * host prop and can go from read to unread between renders, which would
   * otherwise leave the list narrowed by a chip that is no longer on screen —
   * an empty panel with nothing to explain it.
   */
  const offerable = offerableFilters(usage !== undefined);
  const stillOffered = offerable.some(entry => entry.value === filter);
  /*
   * CLEARED rather than masked. Deriving a display value while the stored one
   * stayed `"not-in-index"` left two answers to "which filter is active", and
   * the hidden one came back the moment usage was readable again — narrowing a
   * list the author had last seen showing everything, with no chip to explain
   * why.
   */
  React.useEffect(() => {
    if (!stillOffered) setFilter("all");
  }, [stillOffered]);
  const active = stillOffered ? filter : "all";

  if (library === undefined) {
    return (
      <div className="nx-classman">
        <p className="nx-inspector__note">
          {absence === "failed"
            ? "This site's classes could not be read."
            : "Loading classes…"}
        </p>
      </div>
    );
  }

  const usageKnown = usage !== undefined;
  const rows = searchClassRows(
    filterClassRows(classRows(library, usage ?? {}, documentClassIds), active),
    query
  );

  return (
    <div className="nx-classman">
      <div className="nx-classman__head">
        <h2 className="nx-classman__title">Classes</h2>
      </div>
      {documentScan === "partial" ? (
        // Stated rather than silently narrowing: the page filter and the row
        // marks are still TRUE where they appear, and it is their absence that
        // cannot be trusted.
        <p className="nx-inspector__note">
          This page has more blocks than can be read at once, so a class it uses
          may not be marked here.
        </p>
      ) : null}
      {usageKnown ? null : (
        // Stated once, at the top, rather than on every row. It is a property
        // of this reading of the site, not of any one class.
        <p className="nx-inspector__note">
          Where these classes are used has not been read.
        </p>
      )}
      {/*
       * What a class IS, and where one is made.
       *
       * The second sentence is the load-bearing half. This panel deliberately
       * has no create control — applying happens beside the style controls,
       * where it is done constantly, while auditing happens here — and without
       * saying so the absent button reads as a missing feature rather than as a
       * split someone chose.
       */}
      <p className="nx-classman__lede">
        <b>A class is a saved set of styles you can reuse.</b>{" "}
        {onDelete === undefined ? "Rename them" : "Rename and clear them out"}{" "}
        here; you apply one beside the style controls.
      </p>
      <FilterChips active={active} filters={offerable} onChange={setFilter} />
      <ClassSearch query={query} onChange={setQuery} />
      <ClassList
        rows={rows}
        searching={query.trim() !== ""}
        filter={active}
        pendingSlugs={pendingSlugs}
        pageSize={pageSize}
        library={library}
        supplied={new Set(suppliedClassIds ?? [])}
        usageKnown={usageKnown}
        onRename={onRename}
        onDelete={onDelete}
      />
    </div>
  );
}

/**
 * The name search.
 *
 * Uncontrolled by the filter chips: narrowing by name and narrowing by index
 * state are separate choices, and clearing one must not clear the other.
 */
function ClassSearch({
  query,
  onChange,
}: {
  query: string;
  onChange: (next: string) => void;
}): React.ReactElement {
  const id = React.useId();
  return (
    <div className="nx-classman__search">
      <label className="sr-only" htmlFor={id}>
        Search classes
      </label>
      <Input
        id={id}
        onChange={event => onChange(event.target.value)}
        placeholder="Search classes"
        type="search"
        value={query}
      />
    </div>
  );
}

function FilterChips({
  active,
  filters,
  onChange,
}: {
  active: ClassFilter;
  filters: ReadonlyArray<{ value: ClassFilter; label: string }>;
  onChange: (filter: ClassFilter) => void;
}): React.ReactElement {
  return (
    <div className="nx-classman__filters" role="group" aria-label="Filter">
      {filters.map(({ value, label }) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={active === value ? "default" : "ghost"}
          aria-pressed={active === value}
          onClick={() => onChange(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Why the list is empty, in the terms of whatever actually emptied it.
 *
 * Extracted from `ClassList` because four narrowings with four different
 * honest answers is its own question, and inlining them pushed that component
 * past the cognitive-complexity gate. Mirrors `EmptyTokens` in tokens-panel.
 */
function EmptyClasses({
  searching,
  filter,
  canDelete,
}: {
  searching: boolean;
  filter: ClassFilter;
  /**
   * Whether the host wired a delete callback. The production `BlocksField`
   * mount does not, so a row shows no delete control there and copy offering
   * to clear classes out would name an action this panel cannot perform.
   */
  canDelete: boolean;
}): React.JSX.Element {
  /*
   * Which narrowing produced the empty list. Blaming the search when the box
   * is blank sends an author to clear something that is not set, and hides
   * the filter that actually did it.
   */
  if (searching) {
    return <p className="nx-inspector__note">No classes match this search.</p>;
  }
  /*
   * An empty "not in index" is the one absence here that is a RESULT rather
   * than a lack: nothing is known to be stranded. Wording it like the others
   * reports the outcome an author was hoping for as a failure to find
   * anything.
   *
   * The sentence still refuses to claim more than the index can support. It
   * says what is not KNOWN, never what is not USED — the same care the
   * filter's own name takes, and for the same reason: the index errs in both
   * directions, so an empty list is a floor rather than a measurement.
   */
  if (filter === "not-in-index") {
    return (
      <div className="nx-classman__empty">
        <p className="nx-classman__empty-head">
          Nothing here &mdash; and that is good news.
        </p>
        <p className="nx-inspector__note">
          Every class has an index entry, so none is listed as stranded. That is
          the whole claim: the index errs in BOTH directions — it can miss a
          class that is still applied, and it keeps rows a failed removal left
          behind — so an empty list here is evidence about the index rather than
          a measurement of what is used.
        </p>
      </div>
    );
  }
  /*
   * An empty library is not a filter miss. With `all` active nothing is
   * narrowing anything, so blaming "this filter" points an author at a
   * control that is not doing what the sentence says it did — and stops at
   * the absence, which is the dead end this panel was reported for.
   *
   * It teaches instead, and names where the next step happens. Classes are
   * not created here (applying belongs beside the style controls, auditing
   * belongs on a reading surface), so the action this state can honestly
   * offer is where to go, not a button.
   */
  if (filter === "all") {
    return (
      <div className="nx-classman__empty">
        <p className="nx-classman__empty-head">No classes yet.</p>
        <p className="nx-inspector__note">
          A class saves a set of styles under a name so other blocks can wear
          the same one. You make the first beside the style controls, and it
          appears here to rename
          {canDelete ? " or clear out" : ""}.
        </p>
      </div>
    );
  }
  return <p className="nx-inspector__note">No classes match this filter.</p>;
}

/**
 * How many rows the manager mounts at once.
 *
 * A library may hold `MAX_NAMED_CLASSES`, and the `All` filter matches every
 * one — so opening the panel on a large site would mount two thousand rows and
 * two thousand text inputs synchronously. The selector caps its own results at
 * fifty for exactly this reason; the manager needs a bound of the same kind,
 * and a larger one because reading a list IS what this surface is for.
 *
 * The remainder is REPORTED rather than dropped quietly: a list that silently
 * stops is a list an author believes is complete, and this one is the surface
 * they would use to decide a class is safe to delete.
 */
const DEFAULT_PAGE_SIZE = 200;

/*
 * The page size a host actually gets. `pageSize` is typed `number`, which
 * admits zero, negatives, fractions and NaN — and each of those breaks the
 * list in a way an author cannot escape: zero and NaN mount nothing and offer
 * a control that adds nothing, a negative slice drops rows off the END, and a
 * fraction mounts a row count that never reaches the total. Falling back to
 * the default keeps every class reachable, which refusing to render would not.
 */
function usablePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) return DEFAULT_PAGE_SIZE;
  return Number.isInteger(pageSize) && pageSize > 0
    ? pageSize
    : DEFAULT_PAGE_SIZE;
}

function ClassList({
  rows,
  searching,
  filter,
  pendingSlugs,
  pageSize,
  library,
  supplied,
  usageKnown,
  onRename,
  onDelete,
}: {
  rows: readonly ClassRow[];
  /** Whether a search is narrowing them, for the empty-list wording. */
  searching: boolean;
  /**
   * Which narrowing is active, because one of them is GOOD news when empty.
   *
   * An empty "not in index" is the outcome an author auditing a site wants, and
   * wording it like the others reports a success as a failure.
   */
  filter: ClassFilter;
  pendingSlugs?: Readonly<Record<string, string>>;
  pageSize?: number;
  library: readonly NamedClass[];
  supplied: ReadonlySet<string>;
  usageKnown: boolean;
  onRename: ClassManagerPanelProps["onRename"];
  onDelete?: (classId: string) => void;
}): React.ReactElement {
  /*
   * How many rows are mounted right now. Raised by the control below rather
   * than fixed, because a search cannot be relied on to reach the tail: a
   * library of `class-0` to `class-259` matches every query an author is
   * likely to type, and the last sixty would stay unreachable however the
   * message was worded.
   */
  const page = usablePageSize(pageSize);
  /*
   * How many PAGES are open, not how many rows. Holding the row count would
   * freeze the first page size this component ever saw: a host that recomputes
   * `pageSize` for a narrowed column re-renders without unmounting, and state
   * seeded from a prop ignores every value after the first. Counting pages
   * makes the mounted total derive from the CURRENT prop, so the initial slice
   * and the "show more" step cannot disagree about what a page is.
   */
  const [pagesOpen, setPagesOpen] = React.useState(1);
  const limit = pagesOpen * page;
  if (rows.length === 0) {
    return (
      <EmptyClasses
        searching={searching}
        filter={filter}
        canDelete={onDelete !== undefined}
      />
    );
  }
  const shown = rows.slice(0, limit);
  const hidden = rows.length - shown.length;
  return (
    <>
      {hidden > 0 ? (
        <p className="nx-inspector__note">
          {`Showing ${shown.length} of ${rows.length}.`}
        </p>
      ) : null}
      <ul className="nx-classman__list">
        {shown.map(row => (
          <li key={row.id} className="nx-classman__row">
            <ClassRowView
              row={row}
              pendingSlug={pendingSlugs?.[row.id]}
              library={library}
              isSupplied={supplied.has(row.id)}
              usageKnown={usageKnown}
              onRename={onRename}
              onDelete={onDelete}
            />
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <Button
          className="nx-classman__more"
          onClick={() => setPagesOpen(current => current + 1)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {`Show ${Math.min(hidden, page)} more`}
        </Button>
      ) : null}
    </>
  );
}

function ClassRowView({
  row,
  pendingSlug,
  library,
  isSupplied,
  usageKnown,
  onRename,
  onDelete,
}: {
  row: ClassRow;
  /** The name this class is being renamed to, when a write is in flight. */
  pendingSlug?: string;
  library: readonly NamedClass[];
  isSupplied: boolean;
  usageKnown: boolean;
  onRename: ClassManagerPanelProps["onRename"];
  onDelete?: (classId: string) => void;
}): React.ReactElement {
  const [confirming, setConfirming] = React.useState(false);

  return (
    <>
      <div className="nx-classman__fields">
        <NameField
          library={library}
          onRename={onRename}
          pendingSlug={pendingSlug}
          row={row}
        />
        <UsageNote row={row} usageKnown={usageKnown} />
        {isSupplied ? (
          // Named rather than shown disabled. A greyed button invites an
          // author to hunt for the permission that would enable it, and there
          // is none — the class comes from the site's own configuration.
          <span className="nx-classman__origin">Default</span>
        ) : onDelete === undefined ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Delete ${row.slug}`}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        )}
      </div>
      {confirming && onDelete !== undefined ? (
        <DeleteConfirm
          row={row}
          usageKnown={usageKnown}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onDelete(row.id);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The name, edited in place, committed only when the engine would accept it.
 *
 * The draft is local so a half-typed name is not reported as a rename on every
 * keystroke, and a refusal leaves the draft ON SCREEN rather than reverting it:
 * an author who mistypes should see what they typed beside the reason, not have
 * the field silently undo their work.
 */
function NameField({
  row,
  pendingSlug,
  library,
  onRename,
}: {
  row: ClassRow;
  pendingSlug?: string;
  library: readonly NamedClass[];
  onRename: ClassManagerPanelProps["onRename"];
}): React.ReactElement {
  const [draft, setDraft] = React.useState<string | null>(null);
  /*
   * A refusal from the HOST, which is a different failure from a name the
   * grammar rejects: the name was fine and the write did not land. Held apart
   * so the two cannot overwrite one another, and cleared on the next edit
   * because a stale reason beside a fresh draft describes neither.
   */
  const [refused, setRefused] = React.useState<string | null>(null);
  /*
   * Which rename this row is currently waiting on.
   *
   * An author can commit a second rename while the first is still in flight,
   * and the answers can arrive in either order. Without this, a refusal from
   * the superseded attempt lands after the newer edit cleared it, and the row
   * reports a failure for a rename that is no longer being attempted — or,
   * with the orders reversed, keeps reporting one the retry already fixed.
   */
  const attempt = React.useRef(0);
  /*
   * Where a refusal goes when this row is no longer on screen.
   *
   * `BuilderShell` keys its content by the open panel, so switching panels or
   * leaving the editor unmounts this field while a save is still on the
   * network, and `setRefused` then reaches nothing. This row can always show
   * one while it exists, so it always takes responsibility.
   */
  const survive = useSurvivingReport();
  const report = (reason: string): void => {
    survive(reason, () => {
      setRefused(reason);
      return true;
    });
  };
  const id = React.useId();
  const outcome =
    draft === null ? null : renamedClassName(draft, row.id, library);

  const commit = (): void => {
    if (outcome === null) return;
    if (!outcome.ok) return;
    /*
     * A rename to the name the class already has is not a rename. Text typed
     * away and back, or the same slug with surrounding space, both normalise to
     * the stored value — and a host that persists every reported intent would
     * write a revision whose rendered output is identical to the one before it.
     * The draft still clears, because the author did finish editing.
     */
    /*
     * Compared against the name this class is HEADING FOR, which is the
     * pending one while a write is in flight and the stored one otherwise.
     * Comparing against the rendered slug read a revert as a no-op and let the
     * superseded write land.
     */
    if (outcome.slug === (pendingSlug ?? row.slug)) {
      setDraft(null);
      return;
    }
    /*
     * Called inside a boundary that catches a SYNCHRONOUS throw, so a handler
     * failing before it returns is treated exactly as one that rejects. A
     * permission or storage check that throws is a legitimate implementation
     * of the contract, and letting it escape the event handler left the draft
     * uncleared and the author told nothing at all.
     */
    /*
     * Superseded BEFORE the call, not after it. Advancing only once a promise
     * came back meant a newer rename that returned synchronous `void`, or that
     * threw, never took the number — so an older pending promise could resolve
     * afterwards and overwrite or clear what the newer attempt had said.
     */
    attempt.current += 1;
    const mine = attempt.current;
    let answered: ClassRenameAnswer;
    try {
      answered = onRename(row.id, outcome.slug);
    } catch {
      setDraft(null);
      report("This class could not be renamed.");
      return;
    }
    /*
     * The draft clears immediately, because the author DID finish editing and
     * a field that holds their text hostage until the network answers reads as
     * frozen. A refusal arrives beside the row instead, naming the class it is
     * about — the row is still there to name it, which is why this needs no
     * shell-level surface the way an unmounting control does.
     */
    setDraft(null);
    setRefused(null);
    // A host that answered with something un-awaitable is one that does not
    // report. Reaching for `.then` on it threw out of this event handler.
    if (!isPromiseLike(answered)) return;
    void Promise.resolve(answered)
      .then(result => {
        // Superseded: a newer rename on this row is the one being awaited, and
        // this answer describes a name the author has already moved past.
        if (attempt.current !== mine) return;
        // Anything that is not an outcome is silence rather than refusal —
        // reading `.ok` off it would throw, and the catch below would then
        // present a SUCCESSFUL rename as a failed one.
        if (!isRenameOutcome(result) || result.ok) {
          setRefused(null);
          return;
        }
        report(result.reason);
      })
      /*
       * A REJECTED promise is a refusal too. The contract is to answer, but a
       * thrown error or a rejected write arrives here all the same, and without
       * this the row clears and says nothing — the exact silence the outcome
       * was added to remove.
       */
      .catch(() => {
        if (attempt.current !== mine) return;
        report("This class could not be renamed.");
      });
  };

  return (
    <div className="nx-classman__name">
      <label className="sr-only" htmlFor={id}>
        {`Name of ${row.slug}`}
      </label>
      <Input
        id={id}
        value={draft ?? row.slug}
        aria-invalid={outcome !== null && !outcome.ok}
        aria-describedby={
          outcome !== null && !outcome.ok ? `${id}-why` : undefined
        }
        onChange={event => {
          setDraft(event.target.value);
          setRefused(null);
        }}
        onBlur={commit}
        onKeyDown={event => {
          if (commitOnEnter(event, commit)) return;
          if (event.key === "Escape") setDraft(null);
        }}
      />
      {outcome !== null && !outcome.ok ? (
        <p className="nx-classman__issue" id={`${id}-why`} role="alert">
          {REFUSALS[outcome.refusal]}
        </p>
      ) : null}
      {refused !== null ? (
        <p className="nx-classman__issue" role="alert">
          {refused}
        </p>
      ) : null}
    </div>
  );
}

/** Why a name was refused, in the author's terms rather than the grammar's. */
const REFUSALS = {
  empty: "A class needs a name.",
  "too-long": "That name is too long.",
  "not-a-slug": "Use lowercase letters, numbers and hyphens.",
  "already-taken": "Another class already has that name.",
  "library-full": "This site already has as many classes as the page can use.",
} as const;

/**
 * A class's usage figure, in the one vocabulary every surface uses.
 *
 * Delegated to {@link usageSummary} rather than phrased here. A row saying one
 * thing beside a confirmation saying another is two uncertainty policies for
 * one number, and the row is the one an author reads far more often.
 */
function UsageNote({
  row,
  usageKnown,
}: {
  row: ClassRow;
  usageKnown: boolean;
}): React.ReactElement {
  return (
    <span className="nx-classman__usage">
      {/*
        `usageSummary` answers about the INDEX, and with no index read there is
        nothing for it to answer about. Letting it run on the empty map that
        stands in for one would print "Not in index" against every class — a
        statement about the site, made from never having looked.

        "On this page" survives, because it is answered by the open document
        rather than by the index and is just as true either way.
      */}
      {usageKnown ? usageSummary(row) : "Usage not read"}
      {row.onThisPage ? " · on this page" : ""}
    </span>
  );
}

/**
 * The confirmation, which is asked whatever the count says.
 *
 * Both wordings state what deleting DOES — it removes the class from every
 * document holding it — and neither presents the number as a measurement.
 *
 * "At least N" is as wrong as a bare N. The index loses rows to interleaved
 * saves, and it also RETAINS them when a removal fails, so it errs in both
 * directions — a lower-bound claim would be false for a stale over-count. The
 * only honest phrasing names what was recorded and says it can be wrong.
 */
function DeleteConfirm({
  row,
  usageKnown,
  onCancel,
  onConfirm,
}: {
  row: ClassRow;
  usageKnown: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const warning = deletionWarning(row);
  return (
    <div className="nx-classman__confirm" role="group">
      <p className="nx-classman__issue">
        {/*
          Three wordings, because there are three states and the middle one is
          the dangerous one to collapse. Rows are built from an empty map when
          no index was read, so "knows of no document using it" would be
          reassurance derived entirely from never having asked — offered
          immediately before an irreversible site-wide write.
        */}
        {!usageKnown
          ? `Delete “${row.slug}”? Where this class is used has not been read, so there is no telling how many documents carry it. Deleting removes it from every one of them.`
          : warning.hasIndexedUsage
            ? `Delete “${row.slug}”? The index has it on ${warning.indexedDocuments} document(s), and deleting removes it from every document that carries it. That number is what the index recorded, and it can be wrong in either direction.`
            : `Delete “${row.slug}”? The index knows of no document using it, but it cannot rule one out.`}
      </p>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        aria-label={`Confirm deleting ${row.slug}`}
        onClick={onConfirm}
      >
        Delete
      </Button>
    </div>
  );
}
