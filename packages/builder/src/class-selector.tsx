/**
 * The classes on the selected node, and the one keystroke that changes them.
 *
 * A surface over {@link class-library}, which holds every rule this draws. The
 * split is the one {@link tokens-panel} uses: the projection decides what a
 * class IS and what an edit produces, this decides what it looks like, and the
 * rules stay testable without a DOM.
 *
 * ## Why this lives beside the style controls
 *
 * Applying a class is the FREQUENT action — it happens while styling, on the
 * element being styled — so it must not cost a context switch to a separate
 * surface. Webflow puts its selector field at the top of the Style panel for
 * the same reason, and splits the occasional work (auditing, deleting) into a
 * list built for reading. {@link class-manager-panel} is that half.
 *
 * ## Renaming is NOT here
 *
 * A chip menu offering rename would be a second rename policy: the manager's
 * table already edits a name where it is read, and two surfaces deciding
 * separately what a name may become is how they come to disagree about a
 * collision. Removing a class from THIS node is a different action — it changes
 * the document, not the library — so that one belongs on the chip.
 *
 * ## Edits are lifted, not saved here
 *
 * Every control reports an intent and stores nothing. Persistence belongs to
 * whoever owns the document, which in the page builder is the section-scoped
 * site-style write this package cannot reach.
 *
 * Creating is reported as ONE intent rather than as a library write followed by
 * a node write, because this surface cannot mint an id: the class it just asked
 * for has no identity until the host has stored it, and a two-step contract
 * would leave the caller to correlate them.
 *
 * @module class-selector
 */
import type { NamedClass } from "@nextlyhq/blocks-engine";
import { Button, Input } from "@nextlyhq/ui";
import * as React from "react";

import { useNoticeSink } from "./builder-notices";
import {
  appliedClasses,
  nodeHasRoom,
  selectorOptions,
  unappliedNodeClassCount,
  withClassApplied,
  withClassRemoved,
  type ClassChoice,
  type ClassOption,
} from "./class-library";

/**
 * What went wrong on the last attempt, in the terms the author is told.
 *
 * Three distinguishable causes rather than one flag: the node being full is
 * predictable from the ids in hand, a refused node write is only knowable by
 * asking the document, and a refused creation carries the site style's own
 * words. Collapsed into one boolean, the message would name the wrong cause.
 */
type SelectorFailure =
  | { readonly kind: "node-full" }
  | { readonly kind: "not-written" }
  | { readonly kind: "not-created"; readonly reason: string };

/**
 * The stored failure, if it still describes the node in hand.
 *
 * A capacity refusal is checked against the node as well as matched to it: the
 * element may have gained room since the attempt, and an alert saying it is
 * full would then be describing a state it is no longer in.
 */
function liveFailure(
  failure: {
    about: string;
    whenIds: readonly string[];
    issue: SelectorFailure;
  } | null,
  nodeId: string,
  nodeClassIds: readonly string[]
): SelectorFailure | null {
  if (failure === null) return null;
  // BOTH, because neither settles it alone. Identity catches the case content
  // cannot see — two blocks with no classes present the same empty list, so a
  // refusal raised against one would go on being shown against the other.
  // Content catches the case identity cannot — the same block whose classes
  // have since changed, where the refusal describes a state it has left.
  if (failure.about !== nodeId) return null;
  if (!sameClassIds(failure.whenIds, nodeClassIds)) return null;
  if (failure.issue.kind === "node-full" && nodeHasRoom(nodeClassIds)) {
    return null;
  }
  return failure.issue;
}

/**
 * Whether two class lists are the same list, by CONTENT.
 *
 * By value rather than by reference because a caller with no stored classes
 * hands over a fresh `[]` on every render — `?? []` in the style inspector
 * does exactly that — so a reference comparison would discard a failure on the
 * next render, which is every render.
 *
 * Half of the scoping, beside the block's own identity. This half catches what
 * identity cannot: the same block whose classes have since changed, where the
 * refusal describes a state it has left.
 */
function sameClassIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** What the author is told, per cause. */
function failureMessage(failure: SelectorFailure): string {
  if (failure.kind === "not-created") return failure.reason;
  if (failure.kind === "not-written") {
    return "This change could not be applied to the document.";
  }
  return "This element already has as many classes as the page can apply.";
}

/** Whether a write to the selected node's classes reached the document. */
export type ClassWriteOutcome = "applied" | "refused";

/**
 * What creating a class produced: its new id, or why it could not be created.
 *
 * The ID comes back rather than the host applying the class itself. Creating
 * is a SITE-STYLE write and applying is a NODE write — two documents — and the
 * host owns only the first. Returning the id lets the application go through
 * the same path every other apply takes, so the per-node bound and the store's
 * own refusal are enforced once instead of twice.
 *
 * A REASON rather than a bare refusal, because this one has words available:
 * the site-style save reports per-section issues, where a node write can only
 * answer null. `breakpoints` in the page-builder admin already returns its
 * refusal this way.
 */
export type ClassCreation =
  | { readonly ok: true; readonly classId: string }
  | { readonly ok: false; readonly reason: string };

export interface ClassSelectorProps {
  /**
   * Which block this is editing.
   *
   * Required, and read for two things: scoping a failure to the element it is
   * about, and telling a creation still in flight whether the block it was
   * started for is the one still selected.
   *
   * It does not replace the class-list comparison — {@link liveFailure} uses
   * both, and neither settles it alone. This one catches what content cannot:
   * two blocks with no classes present the same empty list, so a refusal
   * raised against one would go on being shown against the other.
   *
   * A prop rather than a documented requirement to mount this keyed. Keying
   * protects a caller who remembers; a prop cannot be forgotten.
   */
  nodeId: string;
  /**
   * The site's class library, or `undefined` when there is none to show.
   *
   * A real third state rather than an empty library: a site that has stored
   * nothing legitimately has no classes, and drawing the two the same way would
   * invite an author to create a class into a library about to be replaced by
   * the one still loading.
   *
   * `undefined` covers two causes — a read in flight and a read that failed —
   * and {@link ClassSelectorProps.libraryAbsence} says which. They need
   * different words: one will finish and the other will not.
   */
  library: readonly NamedClass[] | undefined;
  /**
   * Why there is no library, when there is none.
   *
   * `undefined` has two causes and they need different words: a read still in
   * flight will finish, and a refused or failed one will not. Told apart for
   * the reason the tokens studio tells them apart — a panel saying "reading…"
   * forever after a 403 describes a state the site is not in, and gives the
   * author nothing to do about it.
   */
  libraryAbsence?: "pending" | "failed";
  /** The class ids the selected node carries, as stored. */
  nodeClassIds: readonly string[];
  /**
   * The node's classes after an apply or a remove, and whether it landed.
   *
   * Returns an outcome rather than nothing, because the store can refuse a
   * write the rules here cannot anticipate: this module judges the class, while
   * the document has its own limits and a page at its byte cap rejects an edit
   * whose value is perfectly valid. Discarding that refusal would clear the
   * query and reset the highlight as though the class had been applied, leaving
   * the author with no explanation and no draft — the same failure the style
   * controls in this package already return an outcome to avoid.
   */
  onNodeClassesChange: (classIds: string[]) => ClassWriteOutcome;
  /**
   * Create a class under this slug and put it on the selected node.
   *
   * One intent, for the reason in the module note: the id does not exist yet.
   *
   * Asynchronous and answering, because creating a class is a SITE-STYLE write
   * — a different document from the one the node lives in, saved over the
   * network and refusable. A void contract would clear the typed name on a
   * refusal exactly as it does on success, which is the same failure
   * {@link ClassSelectorProps.onNodeClassesChange} returns an outcome to avoid.
   *
   * It creates only. Putting the class ON the node is this component's job,
   * through the same callback every other application uses.
   */
  onCreateClass: (slug: string) => Promise<ClassCreation>;
}

/** The classes on the selected node, with a field for adding another. */
export function ClassSelector({
  nodeId,
  library,
  libraryAbsence,
  nodeClassIds,
  onNodeClassesChange,
  onCreateClass,
}: ClassSelectorProps): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  /*
   * ONE failure at a time, carrying the node it was produced against.
   *
   * Separate flags each go stale on their own: a refusal outlived the host
   * handing this component a different node, so an alert went on describing an
   * element no longer selected. Storing the ids it is ABOUT and comparing them
   * on render means a change of node invalidates it with no effect to keep in
   * step — the same reason the capacity refusal is derived rather than
   * remembered.
   */
  const [failure, setFailure] = React.useState<{
    readonly about: string;
    readonly whenIds: readonly string[];
    readonly issue: SelectorFailure;
  } | null>(null);
  // In flight, so a second Enter cannot queue a duplicate class while the
  // first save is still on the network.
  const [saving, setSaving] = React.useState(false);
  /*
   * Where a refusal goes when this component is no longer there to show one.
   *
   * The style inspector keys this by node, so changing selection unmounts it
   * while a save is still on the network. `setFailure` then runs on a dead
   * instance and reaches nothing, which is silence about a class that was not
   * created. The shell outlives the key and can still speak.
   */
  const raiseNotice = useNoticeSink();
  /*
   * Whether this instance can still draw. A ref rather than state because
   * nothing renders from it and setting it must schedule no work: it is read
   * inside a callback that has already outlived the render it came from.
   */
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const listId = React.useId();
  /*
   * What the node holds RIGHT NOW, for the callback that runs after a save.
   *
   * A site-style save is asynchronous, and an author can remove a chip while it
   * is in flight. The success handler closes over the render that started the
   * request, so applying from that render's ids would write back the classes as
   * they stood before the removal — undoing it, from a callback about something
   * else entirely.
   */
  const currentIds = React.useRef(nodeClassIds);
  currentIds.current = nodeClassIds;
  /*
   * Which node is selected NOW, so a pending creation can tell whether it is
   * still about the element it was started for.
   *
   * The success handler captures `nodeId` and the write callback from the
   * render that began the request, while reading the class list live. Mixing
   * the two lets a resolution write one node's classes through another node's
   * callback — the built-in parent keys by node and never sees it, a direct
   * consumer that does not key would.
   */
  const currentNodeId = React.useRef(nodeId);
  currentNodeId.current = nodeId;
  /*
   * What is typed RIGHT NOW, for the same reason. The field stays editable
   * while a creation is in flight, so an author can begin the next class name
   * before the first one lands — and clearing on success would take away what
   * they had typed since.
   */
  const currentQuery = React.useRef(query);
  currentQuery.current = query;

  /**
   * Tell the author a class was not created, wherever they can still be told.
   *
   * Inline while this component is on screen and still showing the node the
   * request was made against, because a message beside the control that raised
   * it needs no explanation of what it refers to. Otherwise through the shell,
   * which no selection change unmounts.
   *
   * The two are exclusive on purpose: raising both would print one refusal
   * twice, and a region that repeats what is already on screen is one authors
   * learn to stop reading.
   */
  const reportRefusal = (about: string, reason: string): void => {
    if (mounted.current && currentNodeId.current === about) {
      setFailure({
        about,
        whenIds: currentIds.current,
        issue: { kind: "not-created", reason },
      });
      return;
    }
    raiseNotice(reason);
  };

  /*
   * Cleared, not merely hidden. Hiding leaves the refusal stored, so a node
   * returning to a class list it held before — an external edit and an undo
   * would do it — revives an alert about an operation that did not just fail.
   * This is React's documented adjust-state-during-render: the condition stops
   * being true once the state is null, so it converges on the next pass.
   *
   * Above the library-absence return because a refusal outlives the
   * library: a render that draws no list still observes the node leaving
   * the state the refusal was raised against, and skipping that lets a
   * list which changes and comes back while the library is away arrive
   * back matching.
   */
  if (failure !== null && liveFailure(failure, nodeId, nodeClassIds) === null) {
    setFailure(null);
  }

  if (library === undefined) {
    return (
      <div className="nx-classes">
        <p className="nx-inspector__note">
          {libraryAbsence === "failed"
            ? "This site's classes could not be read."
            : "Loading classes…"}
        </p>
      </div>
    );
  }

  const applied = appliedClasses(library, nodeClassIds);
  const { options, hidden } = selectorOptions(library, nodeClassIds, query);
  const unapplied = unappliedNodeClassCount(nodeClassIds);
  /*
   * The failure to draw, or none. Scoped twice over: it must have been produced
   * against THIS node, and a capacity refusal must still be true of it — the
   * node may have gained room since, through a removal, an undo, or the host
   * selecting a smaller element.
   */
  const shown = liveFailure(failure, nodeId, nodeClassIds);
  // Clamped rather than reset on every keystroke, so narrowing the list keeps a
  // highlight instead of silently sending Enter back to the first row.
  const highlighted = Math.min(active, Math.max(options.length - 1, 0));

  const commit = (option: ClassOption | undefined): void => {
    if (option === undefined || saving) return;
    if (option.kind === "create") {
      /*
       * The same node bound the apply path observes, asked before the class
       * exists. `withClassApplied` cannot answer here — the id it would append
       * is not minted until the host has stored the class — so the precondition
       * is checked directly rather than left for the host to rediscover.
       */
      if (!nodeHasRoom(nodeClassIds)) {
        setFailure({
          about: nodeId,
          whenIds: nodeClassIds,
          issue: { kind: "node-full" },
        });
        return;
      }
      /*
       * Not awaited here, and the query is not cleared until it answers. A
       * site-style save is a network write: clearing on dispatch would lose
       * the typed name the moment the author pressed Enter, before anything
       * knew whether it had landed.
       */
      const submitted = query;
      const startedOn = nodeId;
      setSaving(true);
      void onCreateClass(option.slug)
        .then(created => {
          /*
           * A refusal is reported first, and is NOT gated on the node still
           * being selected. Nothing was created, so the news is about the
           * site's class library rather than about the element that happened to
           * be in hand when the author asked — and gating it meant an author
           * who clicked elsewhere while the write was in flight was told
           * nothing at all.
           */
          if (!created.ok) {
            reportRefusal(startedOn, created.reason);
            return;
          }
          /*
           * The element moved on. The class was created and is in the library,
           * but applying it now would put it on a node the author did not ask
           * about — the request's own node is no longer selected, and there is
           * nothing here that could write to it safely.
           */
          if (currentNodeId.current !== startedOn) return;
          // Applied through the ordinary path, so a node already at its limit
          // refuses here exactly as it would for an existing class rather than
          // being special-cased into a second rule — and against the node as
          // it is NOW, not as it was when the request left.
          applyExisting(
            created.classId,
            currentIds.current,
            currentQuery.current === submitted
          );
        })
        /*
         * A REJECTED request is a refusal too. The contract is to answer, but a
         * thrown error or a rejected promise arrives here all the same — and
         * without this the in-flight flag never clears, so `commit` returns
         * early on every later keystroke and the surface is inert for as long
         * as the editor stays open. Silent, and unrecoverable without a reload.
         */
        .catch(() => {
          reportRefusal(startedOn, "This class could not be created.");
        })
        // In `finally`, so neither path can leave the field guarded.
        .finally(() => {
          setSaving(false);
        });
      return;
    }
    applyExisting(option.choice.id, nodeClassIds, true);
  };

  /**
   * Put a class the library already holds onto the node.
   *
   * One path for both kinds of apply. A newly created class reaches it with
   * the id the host just minted, so the per-node bound and the store's refusal
   * are enforced in one place rather than once per caller.
   */
  function applyExisting(
    classId: string,
    against: readonly string[],
    clearQuery: boolean
  ): void {
    /*
     * Every failure raised here is scoped to `against`, not to the ids this
     * closure was created with. On the asynchronous path those differ — a chip
     * removed while a creation was in flight — and scoping to the stale list
     * makes `liveFailure` discard the alert the moment it is set, so a refused
     * apply reports nothing at all.
     */
    // Through the shared helper rather than an append written here. The bound
    // on how many classes a node may carry belongs to one place, and a second
    // append would keep working after that place learned to refuse.
    const outcome = withClassApplied(against, classId);
    if (!outcome.ok) {
      setFailure({
        about: nodeId,
        whenIds: against,
        issue: { kind: "node-full" },
      });
      return;
    }
    if (onNodeClassesChange(outcome.classIds) === "refused") {
      // The draft survives, deliberately. An author whose write was refused
      // has lost nothing they typed, and the next thing they do is likely to
      // be trying it again.
      setFailure({
        about: nodeId,
        whenIds: against,
        issue: { kind: "not-written" },
      });
      return;
    }
    setFailure(null);
    if (!clearQuery) return;
    setQuery("");
    setActive(0);
  }

  return (
    <div className="nx-classes">
      <AppliedChips
        applied={applied}
        onRemove={id => {
          const landed = onNodeClassesChange(
            withClassRemoved(nodeClassIds, id)
          );
          setFailure(
            landed === "refused"
              ? {
                  about: nodeId,
                  whenIds: nodeClassIds,
                  issue: { kind: "not-written" as const },
                }
              : null
          );
        }}
      />
      <Input
        className="nx-classes__query"
        value={query}
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-activedescendant={
          options.length > 0 ? optionDomId(listId, highlighted) : undefined
        }
        aria-label="Add a class"
        placeholder="Add a class…"
        onChange={event => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={event =>
          handleKey(event, {
            count: options.length,
            highlighted,
            setActive,
            commit: () => commit(options[highlighted]),
          })
        }
      />
      <OptionList
        id={listId}
        options={options}
        highlighted={highlighted}
        onChoose={commit}
        onHighlight={setActive}
      />
      {hidden > 0 ? (
        <p className="nx-inspector__note">
          {`${hidden} more — keep typing to narrow the list.`}
        </p>
      ) : null}
      {shown !== null ? (
        <p className="nx-classes__issue" role="alert">
          {failureMessage(shown)}
        </p>
      ) : null}
      {unapplied > 0 ? (
        <p className="nx-classes__issue" role="status">
          {`This element lists ${unapplied} more class(es) than the page applies. They style nothing, and removing one here can bring another into use.`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The DOM id of one option row.
 *
 * `aria-activedescendant` names a row by id while focus stays in the field, so
 * the rows need ids that the field can compute without reaching into them.
 */
function optionDomId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/**
 * Keyboard handling for the field, kept off the render path.
 *
 * Arrow keys WRAP rather than stopping at the ends. The list is short and the
 * create row sits at the bottom, so wrapping is what makes it reachable with
 * one keystroke from the top instead of a scroll's worth.
 */
function handleKey(
  event: React.KeyboardEvent<HTMLInputElement>,
  ctx: {
    count: number;
    highlighted: number;
    setActive: (next: number) => void;
    commit: () => void;
  }
): void {
  if (ctx.count === 0) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    ctx.setActive((ctx.highlighted + 1) % ctx.count);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    ctx.setActive((ctx.highlighted - 1 + ctx.count) % ctx.count);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    ctx.commit();
  }
}

/** The classes already on the node, each removable from it. */
function AppliedChips({
  applied,
  onRemove,
}: {
  applied: readonly ClassChoice[];
  onRemove: (classId: string) => void;
}): React.ReactElement {
  if (applied.length === 0) {
    return <p className="nx-inspector__note">No classes on this element.</p>;
  }
  return (
    <ul className="nx-classes__chips">
      {applied.map(choice => (
        <li key={choice.id} className="nx-classes__chip">
          {/* The SLUG, not the emitted name. Every emitted name carries the
              same prefix, which would cost width the rail does not have and
              tell an author nothing that distinguishes one chip from another. */}
          <span className="nx-classes__chip-name">{choice.slug}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nx-classes__chip-remove"
            aria-label={`Remove ${choice.slug} from this element`}
            onClick={() => onRemove(choice.id)}
          >
            ×
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** What the typed query resolves to, in the order Enter would take them. */
function OptionList({
  id,
  options,
  highlighted,
  onChoose,
  onHighlight,
}: {
  id: string;
  options: readonly ClassOption[];
  highlighted: number;
  onChoose: (option: ClassOption) => void;
  onHighlight: (index: number) => void;
}): React.ReactElement | null {
  if (options.length === 0) return null;
  return (
    <ul className="nx-classes__options" id={id} role="listbox">
      {options.map((option, index) => (
        <li
          // Namespaced by KIND. A class id is any string the library accepted,
          // so a class whose id is literally "create" would otherwise collide
          // with the synthetic row and React would reuse one row's state for
          // the other.
          key={optionKey(option)}
          id={optionDomId(id, index)}
          role="option"
          /*
           * NOT in the tab sequence. The APG is explicit that with
           * `aria-activedescendant` only the composite container is tabbable —
           * DOM focus stays in the input and the arrows move the active
           * descendant. A nested native button put every row in the tab order,
           * so one Tab out of the field walked the whole list, and once focus
           * left the input the arrow handler stopped running at all.
           */
          tabIndex={-1}
          aria-selected={index === highlighted}
          className={optionClass(index === highlighted)}
          onMouseEnter={() => onHighlight(index)}
          onClick={() => onChoose(option)}
        >
          {optionLabel(option)}
        </li>
      ))}
    </ul>
  );
}

/** A key no class id can collide with, whatever the library stored. */
function optionKey(option: ClassOption): string {
  return option.kind === "create"
    ? `create:${option.slug}`
    : `apply:${option.choice.id}`;
}

function optionClass(isHighlighted: boolean): string {
  return isHighlighted
    ? "nx-classes__option nx-classes__option--active"
    : "nx-classes__option";
}

/** What one row says it will do, which is not the same for the two kinds. */
function optionLabel(option: ClassOption): string {
  return option.kind === "create"
    ? `Create “${option.slug}”`
    : option.choice.slug;
}
