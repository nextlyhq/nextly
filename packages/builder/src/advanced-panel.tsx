/**
 * The block's HTML surface: its `id`, and the attributes an author may add.
 *
 * ## Why these two sit together, and away from Content and Style
 *
 * Neither is a block PROPERTY — those are the block's own schema and live on
 * the Content tab — and neither is a style. They are the escape hatch: the way
 * an author reaches the rendered element itself, for an anchor to link to, a
 * `data-` attribute an analytics script reads, or an `aria-` attribute the
 * block's own markup does not offer. Every editor that has this puts it behind
 * its own heading for the same reason, and the surface this replaces did too.
 *
 * ## The rules are the RENDERER's, and are asked rather than repeated
 *
 * `custom-attributes.ts` holds that reasoning. What matters here is that this
 * panel shows a row as refused for exactly the reasons the page would drop it,
 * so an author is never told something saved and then finds it missing.
 *
 * ## Warnings wait for the author to stop typing
 *
 * A refusal shown mid-keystroke says `data-` is not allowed while the author is
 * two characters into typing `data-x`. `useDeferredValue` lets the character
 * land first, which is the same reason the editor this replaces deferred its
 * own validation.
 *
 * @module advanced-panel
 */
import { Button, Input, Label } from "@nextlyhq/ui";
import * as React from "react";

import {
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

/**
 * The panel, holding the author's rows while they are being edited.
 *
 * Rows are LOCAL state rather than derived per render, because a half-typed row
 * has no home in the document: a name with no value yet, or a name that is not
 * allowed, is not something to store. The document is written on commit, and
 * the stored value is what comes back if the panel is remounted.
 */
export function AdvancedPanel({
  nodeId,
  cssId,
  attributes,
  editor,
}: AdvancedPanelProps): React.JSX.Element {
  const [idDraft, setIdDraft] = React.useState(cssId);
  const [rows, setRows] = React.useState<AttributeRow[]>(() =>
    rowsOf(attributes)
  );

  // The stored values win whenever they change underneath the panel — an undo,
  // or an edit applied from somewhere else. Without this the fields would go on
  // showing what the document no longer holds.
  React.useEffect(() => {
    setIdDraft(cssId);
  }, [cssId]);
  React.useEffect(() => {
    setRows(rowsOf(attributes));
  }, [attributes]);

  /*
   * Judged against the SETTLED text, so a refusal does not appear while a name
   * is still being typed. The rows themselves stay live — the input must show
   * every keystroke — and only the verdict lags.
   */
  const settled = React.useDeferredValue(rows);
  const settledId = React.useDeferredValue(idDraft);

  const commitId = (): void => {
    if (idDraft.trim() === cssId) return;
    editor.apply({
      kind: "update",
      id: nodeId,
      // Removed rather than stored empty: a node that never had an id and one
      // whose id was cleared are the same node, and an empty string would
      // render as `id=""`.
      patch: { cssId: idDraft.trim() === "" ? undefined : idDraft.trim() },
    });
  };

  const commitRows = (next: readonly AttributeRow[]): void => {
    editor.apply({
      kind: "update",
      id: nodeId,
      patch: { attributes: storedAttributes(next, idDraft) },
    });
  };

  const change = (index: number, part: Partial<AttributeRow>): void => {
    setRows(current =>
      current.map((row, at) => (at === index ? { ...row, ...part } : row))
    );
  };

  const remove = (index: number): void => {
    const next = rows.filter((_row, at) => at !== index);
    setRows(next);
    // Immediately, with no blur to wait for: removal is a decision rather than
    // a value being typed, and there is nothing to coalesce.
    commitRows(next);
  };

  return (
    <div className="nx-inspector__fields">
      <div className="nx-inspector__field">
        <Label htmlFor="nx-block-css-id">CSS id</Label>
        <Input
          id="nx-block-css-id"
          value={idDraft}
          placeholder="none"
          onChange={event => setIdDraft(event.target.value)}
          // Committed on blur and on Enter, matching every other text field
          // here: an op per keystroke would make one undo remove one letter.
          onBlur={commitId}
          onKeyDown={event => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitId();
          }}
        />
        <p className="nx-inspector__hint">
          Becomes this block&rsquo;s <code>id</code>, so a link can point at it.
          It must be different from every other block&rsquo;s.
        </p>
      </div>

      <fieldset className="nx-attributes">
        <legend className="nx-attributes__legend">Attributes</legend>
        {rows.length === 0 ? (
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
              {rows.map((row, index) => (
                <AttributeRowFields
                  // Keyed by POSITION, not by name: a name is what the author is
                  // editing, so keying on it would remount the input on every
                  // keystroke and lose the caret.
                  key={`${nodeId}:${String(index)}`}
                  row={row}
                  index={index}
                  problem={problemOf(settled, index, settledId, rows)}
                  onChange={change}
                  onCommit={() => commitRows(rows)}
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
          onClick={() => setRows([...rows, { name: "", value: "" }])}
        >
          Add attribute
        </Button>
      </fieldset>
    </div>
  );
}

/**
 * The verdict for one row, read from the settled text but keyed to the live one.
 *
 * `useDeferredValue` can hand back a row list one keystroke behind the one being
 * rendered, and a verdict read at an index that no longer holds the same row
 * would be attached to the wrong input. So the row is compared before the
 * verdict is used, and a stale pair simply says nothing yet.
 */
function problemOf(
  settled: readonly AttributeRow[],
  index: number,
  settledId: string,
  live: readonly AttributeRow[]
): string | undefined {
  const behind = settled[index];
  const now = live[index];
  if (behind === undefined || now === undefined) return undefined;
  if (behind.name !== now.name) return undefined;
  const problem = rowProblem(settled, index, settledId);
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
   * The visible labels are short because they sit inline beside the fields, and
   * short labels REPEAT: "Name" is also the block's own name field a few
   * hundred pixels above, and every row here would announce "Name" again. A
   * screen reader reading the page in order would hear one word for several
   * different things.
   *
   * So the accessible name is made unique per row while still CONTAINING the
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
