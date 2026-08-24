/**
 * The block's HTML surface: its `id`, and the attributes an author may add.
 *
 * ## Why these two sit together, and away from Content and Style
 *
 * Neither is a block PROPERTY — those are the block's own schema and live on
 * the Content tab — and neither is a style. They are the escape hatch: the way
 * an author reaches the rendered element itself, for an anchor to link to, a
 * `data-` attribute an analytics script reads, or an `aria-` attribute the
 * block's own markup does not offer.
 *
 * ## ONE writer for both fields
 *
 * They are written by a single function, because they decide each other. A
 * `cssId` beats an `id` in the attribute bag, so setting one changes whether
 * the other lands — and two commit paths, one per field, disagreed about that:
 * committing rows dropped the shadowed `id` and committing the id did not, so
 * clearing the id later brought a stale one back to life.
 *
 * ## Removal is `unset`, never `undefined`
 *
 * `applyOp` refuses `undefined` as a patch value and says why: the key
 * disappears when the op is stored, so a replayed edit would silently do
 * nothing. Clearing a field is `unset`, which survives being written down.
 *
 * @module advanced-panel
 */
import { Button, Input, Label } from "@nextlyhq/ui";
import * as React from "react";

import {
  domIdsTaken,
  htmlUpdate,
  isBlankRow,
  problemMessage,
  rowProblem,
  rowsOf,
  storedAttributes,
  type AttributeRow,
} from "./custom-attributes";
import type { EditorState } from "./editor-state";

export interface AdvancedPanelProps {
  readonly nodeId: string;
  readonly cssId: string;
  readonly attributes: Readonly<Record<string, string>> | undefined;
  readonly editor: EditorState;
}

/** The draft an author is editing, before any of it is written down. */
interface Draft {
  readonly id: string;
  readonly rows: readonly AttributeRow[];
}

export function AdvancedPanel({
  nodeId,
  cssId,
  attributes,
  editor,
}: AdvancedPanelProps): React.JSX.Element {
  const [draft, setDraft] = React.useState<Draft>(() => ({
    id: cssId,
    rows: rowsOf(attributes),
  }));
  /*
   * What the author has FINISHED typing, and the only thing verdicts are read
   * from. Judging every keystroke tells someone two characters into `data-x`
   * that `da` is not allowed, and `useDeferredValue` does not prevent that —
   * it schedules a background render immediately and catches up whenever
   * React has capacity, so intermediate values are judged and shown exactly as
   * they would be without it. Settling on blur is the behaviour the panel
   * actually wanted, and it says what it does.
   */
  const [settled, setSettled] = React.useState<Draft>({
    id: cssId,
    rows: rowsOf(attributes),
  });

  // The stored values win whenever they change underneath the panel — an undo,
  // or an edit applied from somewhere else. Without this the fields would go on
  // showing what the document no longer holds.
  React.useEffect(() => {
    const stored = { id: cssId, rows: rowsOf(attributes) };
    setDraft(stored);
    setSettled(stored);
  }, [cssId, attributes]);

  const taken = React.useMemo(
    () => domIdsTaken(editor.document.nodes, nodeId),
    [editor.document, nodeId]
  );

  /*
   * Read at write time rather than closed over. The panel commits from an
   * unmount cleanup — see below — which runs after the render that removed it,
   * so a closure captured earlier would write a draft the author has since
   * changed.
   */
  const latest = React.useRef<Draft>(draft);
  latest.current = draft;
  const write = React.useRef<(next: Draft) => void>(() => {});

  write.current = (next: Draft): void => {
    const id = next.id.trim();
    // An id another block holds is not written at all: the field keeps showing
    // what the author typed, with the reason beside it, and the document keeps
    // what it had.
    const keptId = id !== "" && taken.has(id) ? cssId : id;
    const update = htmlUpdate(
      { cssId: keptId, attributes: storedAttributes(next.rows, keptId, taken) },
      { cssId, attributes }
    );
    if (update === undefined) return;
    editor.apply({
      kind: "update",
      id: nodeId,
      patch: update.patch,
      ...(update.unset.length > 0 ? { unset: update.unset } : {}),
    } as Parameters<EditorState["apply"]>[0]);
  };

  /*
   * Committed when the panel GOES AWAY, not only on blur.
   *
   * The inspector's tabs activate on `mousedown` and unmount the inactive tab's
   * content, so an author who types an attribute and clicks Style has this
   * panel removed before the browser delivers the blur — and the draft was
   * lost with it, silently. Selecting another block does the same through the
   * key on this element.
   */
  React.useEffect(
    () => () => {
      write.current(latest.current);
    },
    []
  );

  const settle = (next: Draft): void => {
    setSettled(next);
    write.current(next);
  };

  const change = (index: number, part: Partial<AttributeRow>): void => {
    setDraft(current => ({
      ...current,
      rows: current.rows.map((row, at) =>
        at === index ? { ...row, ...part } : row
      ),
    }));
  };

  const remove = (index: number): void => {
    const next: Draft = {
      ...draft,
      rows: draft.rows.filter((_row, at) => at !== index),
    };
    setDraft(next);
    // Immediately: removal is a decision rather than a value being typed, and
    // there is nothing to coalesce.
    settle(next);
  };

  const idProblem = idProblemOf(settled.id, cssId, taken);

  return (
    <div className="nx-inspector__fields">
      <div className="nx-inspector__field">
        <Label htmlFor="nx-block-css-id">CSS id</Label>
        <Input
          id="nx-block-css-id"
          value={draft.id}
          placeholder="none"
          aria-describedby={
            idProblem === undefined ? undefined : "nx-css-id-problem"
          }
          aria-invalid={idProblem === undefined ? undefined : true}
          onChange={event =>
            setDraft(current => ({ ...current, id: event.target.value }))
          }
          onBlur={() => settle(latest.current)}
          onKeyDown={event => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            settle(latest.current);
          }}
        />
        {idProblem === undefined ? (
          <p className="nx-inspector__hint">
            Becomes this block&rsquo;s <code>id</code>, so a link can point at
            it. It must be different from every other block&rsquo;s.
          </p>
        ) : (
          <p
            className="nx-attributes__problem"
            id="nx-css-id-problem"
            role="alert"
          >
            {idProblem}
          </p>
        )}
      </div>

      <fieldset className="nx-attributes">
        <legend className="nx-attributes__legend">Attributes</legend>
        {draft.rows.length === 0 ? (
          <p className="nx-inspector__note">No attributes on this block.</p>
        ) : (
          <>
            {/*
              Column headings, shown ONCE. Repeating "Name" and "Value" against
              every row is noise to look at, and worse to listen to: each
              repetition is another control announced with a word that already
              means the block's own name field above the tabs.

              `aria-hidden` because they label nothing — every input carries its
              own accessible name, which is unique per row and still contains
              the word written here.
            */}
            <div className="nx-attributes__head" aria-hidden="true">
              <span>Name</span>
              <span>Value</span>
            </div>
            <ul className="nx-attributes__rows">
              {draft.rows.map((row, index) => (
                <AttributeRowFields
                  // Keyed by POSITION, not by name: a name is what the author is
                  // editing, so keying on it would remount the input on every
                  // keystroke and lose the caret.
                  key={`${nodeId}:${String(index)}`}
                  row={row}
                  index={index}
                  problem={problemOf(settled, index, draft, taken)}
                  onChange={change}
                  onCommit={() => settle(latest.current)}
                  onRemove={() => remove(index)}
                />
              ))}
            </ul>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            setDraft(current => ({
              ...current,
              rows: [...current.rows, { name: "", value: "" }],
            }))
          }
        >
          Add attribute
        </Button>
      </fieldset>
    </div>
  );
}

/** Why the CSS id will not be written, or `undefined`. */
function idProblemOf(
  id: string,
  stored: string,
  taken: ReadonlySet<string>
): string | undefined {
  const trimmed = id.trim();
  if (trimmed === "" || trimmed === stored) return undefined;
  return taken.has(trimmed)
    ? "Another block on this page already uses that id. Two elements with one id give a link, a label and a style rule two possible targets."
    : undefined;
}

/**
 * The verdict for one row, read from the settled draft but keyed to the live one.
 *
 * A row the author is still typing has no verdict yet, so a settled list that
 * no longer matches the live one at this position simply says nothing.
 */
function problemOf(
  settled: Draft,
  index: number,
  live: Draft,
  taken: ReadonlySet<string>
): string | undefined {
  const behind = settled.rows[index];
  const now = live.rows[index];
  if (behind === undefined || now === undefined) return undefined;
  if (behind.name !== now.name) return undefined;
  const problem = rowProblem(settled.rows, index, settled.id.trim(), taken);
  return problem === undefined ? undefined : problemMessage(problem);
}

function AttributeRowFields({
  row,
  index,
  problem,
  onChange,
  onCommit,
  onRemove,
}: {
  row: AttributeRow;
  index: number;
  problem: string | undefined;
  onChange: (index: number, part: Partial<AttributeRow>) => void;
  onCommit: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const nameId = `nx-attr-name-${String(index)}`;
  const valueId = `nx-attr-value-${String(index)}`;
  const problemId = `nx-attr-problem-${String(index)}`;
  /*
   * The visible headings are short because they sit over the columns, and short
   * words REPEAT: "Name" is also the block's own name field above the tabs. So
   * the accessible name is made unique per row while still CONTAINING the
   * visible word, which is what lets someone say "name" to a voice control and
   * have it match what they can see.
   */
  const position = String(index + 1);
  return (
    <li className="nx-attributes__row">
      <div className="nx-attributes__pair">
        <Input
          id={nameId}
          value={row.name}
          placeholder="data-example"
          aria-label={`Name of attribute ${position}`}
          // Named so a screen reader reaches the reason with the field, rather
          // than leaving it as text that happens to sit nearby.
          aria-describedby={problem === undefined ? undefined : problemId}
          aria-invalid={problem === undefined ? undefined : true}
          onChange={event => onChange(index, { name: event.target.value })}
          onBlur={onCommit}
        />
        <Input
          id={valueId}
          value={row.value}
          aria-label={`Value of attribute ${position}`}
          onChange={event => onChange(index, { value: event.target.value })}
          onBlur={onCommit}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Named per row, because six identical "Remove" buttons give a screen
          // reader six identical announcements and no way to tell them apart.
          aria-label={
            isBlankRow(row) ? "Remove empty attribute" : `Remove ${row.name}`
          }
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      {problem === undefined ? null : (
        <p className="nx-attributes__problem" id={problemId} role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}
