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

import {
  classRows,
  deletionWarning,
  filterClassRows,
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
 * What a rename may answer with, including answering nothing.
 *
 * `Promise<void>` is in the union deliberately. A host whose handler is merely
 * `async` already satisfied the older `void` contract — TypeScript accepts any
 * return type where `void` is declared — so narrowing to the outcome alone
 * would stop those callers compiling. The runtime cost is worse than the
 * compile one: a resolved `Promise<void>` read as `result.ok` throws, the throw
 * is caught, and a rename that SUCCEEDED is reported to the author as failed.
 *
 * So an `undefined` resolution means the host is not reporting, which is the
 * same silence the synchronous form has always meant.
 */
export type ClassRenameAnswer = void | Promise<ClassRenameOutcome | void>;

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
  usage,
  documentClassIds,
  suppliedClassIds,
  onRename,
  onDelete,
}: ClassManagerPanelProps): React.ReactElement {
  const [filter, setFilter] = React.useState<ClassFilter>("all");
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
  const rows = filterClassRows(
    classRows(library, usage ?? {}, documentClassIds),
    active
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
      <FilterChips active={active} filters={offerable} onChange={setFilter} />
      <ClassList
        rows={rows}
        library={library}
        supplied={new Set(suppliedClassIds ?? [])}
        usageKnown={usageKnown}
        onRename={onRename}
        onDelete={onDelete}
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

function ClassList({
  rows,
  library,
  supplied,
  usageKnown,
  onRename,
  onDelete,
}: {
  rows: readonly ClassRow[];
  library: readonly NamedClass[];
  supplied: ReadonlySet<string>;
  usageKnown: boolean;
  onRename: ClassManagerPanelProps["onRename"];
  onDelete?: (classId: string) => void;
}): React.ReactElement {
  if (rows.length === 0) {
    return <p className="nx-inspector__note">No classes match this filter.</p>;
  }
  return (
    <ul className="nx-classman__list">
      {rows.map(row => (
        <li key={row.id} className="nx-classman__row">
          <ClassRowView
            row={row}
            library={library}
            isSupplied={supplied.has(row.id)}
            usageKnown={usageKnown}
            onRename={onRename}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ul>
  );
}

function ClassRowView({
  row,
  library,
  isSupplied,
  usageKnown,
  onRename,
  onDelete,
}: {
  row: ClassRow;
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
        <NameField row={row} library={library} onRename={onRename} />
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
  library,
  onRename,
}: {
  row: ClassRow;
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
    if (outcome.slug === row.slug) {
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
    let answered: ClassRenameAnswer;
    try {
      answered = onRename(row.id, outcome.slug);
    } catch {
      setDraft(null);
      setRefused("This class could not be renamed.");
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
    if (answered === undefined) return;
    attempt.current += 1;
    const mine = attempt.current;
    void answered
      .then(result => {
        // Superseded: a newer rename on this row is the one being awaited, and
        // this answer describes a name the author has already moved past.
        if (attempt.current !== mine) return;
        // `undefined` is a host that does not report, which is silence rather
        // than refusal — reading `.ok` off it would throw, and the catch below
        // would then present a SUCCESSFUL rename as a failed one.
        if (result === undefined || result.ok) {
          setRefused(null);
          return;
        }
        setRefused(result.reason);
      })
      /*
       * A REJECTED promise is a refusal too. The contract is to answer, but a
       * thrown error or a rejected write arrives here all the same, and without
       * this the row clears and says nothing — the exact silence the outcome
       * was added to remove.
       */
      .catch(() => {
        if (attempt.current !== mine) return;
        setRefused("This class could not be renamed.");
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
