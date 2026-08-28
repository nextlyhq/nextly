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

export interface ClassSelectorProps {
  /**
   * The site's class library, or `undefined` while the host has not read it.
   *
   * A real third state rather than an empty library: a site that has stored
   * nothing legitimately has no classes, and drawing the two the same way would
   * invite an author to create a class into a library about to be replaced by
   * the one still loading.
   */
  library: readonly NamedClass[] | undefined;
  /** The class ids the selected node carries, as stored. */
  nodeClassIds: readonly string[];
  /** The node's classes after an apply or a remove. */
  onNodeClassesChange: (classIds: string[]) => void;
  /**
   * Create a class under this slug and put it on the selected node.
   *
   * One intent, for the reason in the module note: the id does not exist yet.
   */
  onCreateClass: (slug: string) => void;
}

/** The classes on the selected node, with a field for adding another. */
export function ClassSelector({
  library,
  nodeClassIds,
  onNodeClassesChange,
  onCreateClass,
}: ClassSelectorProps): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [refused, setRefused] = React.useState(false);
  const listId = React.useId();

  if (library === undefined) {
    return (
      <div className="nx-classes">
        <p className="nx-inspector__note">Loading classes…</p>
      </div>
    );
  }

  const applied = appliedClasses(library, nodeClassIds);
  const { options, hidden } = selectorOptions(library, nodeClassIds, query);
  const unapplied = unappliedNodeClassCount(nodeClassIds);
  /*
   * DERIVED from the current node rather than read from state alone. A stored
   * refusal outlives the node it described: removing a chip, an undo, or the
   * host selecting a different element all give the node room again while the
   * flag still says it is full. Deriving it cannot drift, where an effect that
   * cleared the flag would have to be kept in step with every one of those.
   */
  const showRefusal = refused && !nodeHasRoom(nodeClassIds);
  // Clamped rather than reset on every keystroke, so narrowing the list keeps a
  // highlight instead of silently sending Enter back to the first row.
  const highlighted = Math.min(active, Math.max(options.length - 1, 0));

  const commit = (option: ClassOption | undefined): void => {
    if (option === undefined) return;
    if (option.kind === "create") {
      /*
       * The same node bound the apply path observes, asked before the class
       * exists. `withClassApplied` cannot answer here — the id it would append
       * is not minted until the host has stored the class — so the precondition
       * is checked directly rather than left for the host to rediscover.
       */
      if (!nodeHasRoom(nodeClassIds)) {
        setRefused(true);
        return;
      }
      onCreateClass(option.slug);
    } else {
      // Through the shared helper rather than an append written here. The
      // bound on how many classes a node may carry belongs to one place, and a
      // second append would keep working after that place learned to refuse.
      const outcome = withClassApplied(nodeClassIds, option.choice.id);
      if (!outcome.ok) {
        setRefused(true);
        return;
      }
      onNodeClassesChange(outcome.classIds);
    }
    setRefused(false);
    setQuery("");
    setActive(0);
  };

  return (
    <div className="nx-classes">
      <AppliedChips
        applied={applied}
        onRemove={id => onNodeClassesChange(withClassRemoved(nodeClassIds, id))}
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
      {showRefusal ? (
        <p className="nx-classes__issue" role="alert">
          This element already has as many classes as the page can apply.
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
