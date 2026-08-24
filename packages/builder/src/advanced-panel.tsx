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
import { registeredBlocks } from "@nextlyhq/blocks-react";
import type { BlockResolver } from "@nextlyhq/blocks-react";
import { Button, Input, Label } from "@nextlyhq/ui";
import * as React from "react";

import {
  attributeKey,
  domIdsTaken,
  htmlUpdate,
  type HtmlFields,
  isBlankRow,
  problemMessage,
  rebasedRows,
  requestedId,
  rowsOf,
  rowProblems,
  sameDraft,
  wantedFields,
  type AttributeRow,
  type Draft,
  type RowProblem,
} from "./custom-attributes";
import type { EditorState } from "./editor-state";

export interface AdvancedPanelProps {
  readonly nodeId: string;
  /**
   * The element's `id`, or `undefined` when the node carries no such field.
   *
   * The two are different states and the renderer reads them differently: a
   * stored `""` is PRESENT, renders `id=""`, and shadows any `id` in the bag
   * below. The panel has to be able to say which one it is looking at, or the
   * empty-but-present one can never be removed.
   */
  readonly cssId: string | undefined;
  readonly attributes: Readonly<Record<string, string>> | undefined;
  readonly editor: EditorState;
  /**
   * Whether this is the tab currently on screen.
   *
   * The panel stays MOUNTED behind the other tabs — see the commit effect below
   * — so it no longer learns that the author looked away by being destroyed.
   * This is how it is told.
   */
  readonly active: boolean;
  /**
   * The definitions the CANVAS is rendering against.
   *
   * Which ids are taken depends on which nodes render, and that turns on the
   * block set. `Canvas` forwards a `render.blocks` resolver to `PageRenderer`,
   * so a host that supplies one and a panel that reached for the global
   * registry would be answering about two different pages: a node the canvas
   * renders would look like a placeholder here and free its id, and a node it
   * does not would reserve one.
   *
   * Optional, and defaulted to the same registry `PageRenderer` defaults to, so
   * the ordinary host states nothing and the two still agree.
   */
  readonly blocks?: BlockResolver;
}

export function AdvancedPanel({
  nodeId,
  cssId,
  attributes,
  editor,
  active,
  blocks,
}: AdvancedPanelProps): React.JSX.Element {
  const [draft, setDraft] = React.useState<Draft>(() => ({
    id: cssId ?? "",
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
    id: cssId ?? "",
    rows: rowsOf(attributes),
  });

  /*
   * What this panel last WROTE, so it can tell its own echo from a real change.
   *
   * The stored values must win when they change underneath the panel — an undo,
   * or an edit from somewhere else — or the fields go on showing what the
   * document no longer holds. But a write of our own comes back through the
   * same props, and resetting on that throws away whatever the author has typed
   * since: a row renamed to a refused name lost its text AND the explanation
   * beside it, in the same moment the valid attribute it replaced was deleted.
   */
  const lastWritten = React.useRef<HtmlFields | null>(null);
  /*
   * The draft as last SYNCHRONIZED with the document — what the fields held
   * when they were filled from it, or when a write of ours landed.
   *
   * A commit asks this before it asks anything else, because "the normalized
   * draft differs from what is stored" is not the same question as "the author
   * changed something", and answering the first one for the second wrote an
   * edit nobody made: a stored `" hero "` trims and a stored `DATA-X`
   * lowercases, so opening Advanced and switching tabs rewrote the document,
   * added an undo entry, and moved the anchor a link pointed at.
   */
  const loaded = React.useRef<Draft>(draft);
  const [refusal, setRefusal] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    const written = lastWritten.current;
    // Asked through the same function that decides whether a write is needed,
    // so "unchanged" means one thing here and there rather than two.
    if (
      written !== null &&
      htmlUpdate(written, { cssId, attributes }) === undefined
    ) {
      /*
       * CONSUMED, not merely matched. Left in place, the marker goes on
       * describing a state the document may return to — undo then redo lands
       * back on it, this branch returns again, and the panel keeps showing the
       * undone value while a later blur writes from that stale draft and erases
       * the redone edit. One echo, one write.
       */
      lastWritten.current = null;
      return;
    }
    const stored = { id: cssId ?? "", rows: rowsOf(attributes) };
    setDraft(stored);
    setSettled(stored);
    loaded.current = stored;
  }, [cssId, attributes]);

  const taken = React.useMemo(
    () =>
      domIdsTaken(editor.document.nodes, nodeId, blocks ?? registeredBlocks()),
    [editor.document, nodeId, blocks]
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
    /*
     * NOTHING is written unless the author edited something. Every other test
     * this could have used compares a NORMALIZED draft against the document,
     * and normalization is exactly what an untouched panel does to a value it
     * did not choose — so a panel that had only been looked at wrote a change,
     * added an undo entry, and moved the anchor a link pointed at.
     *
     * The refusal goes with it: a message about a save that failed is about a
     * pending change, and there is no longer one to fail.
     */
    if (sameDraft(next, loaded.current)) {
      setRefusal(undefined);
      return;
    }
    const stored = { cssId, attributes };
    // Read BEFORE `loaded` moves below, or it compares the draft against the
    // value this very write is about to record and always agrees.
    const asked = requestedId(next, loaded.current);
    const wanted = wantedFields(next, loaded.current, stored, taken);
    const update = htmlUpdate(wanted, stored);
    // Edited, but to something the document already holds — a value typed back
    // to what it was, or a row whose refusal leaves the stored bag as it was.
    // Nothing to save, so nothing left to report about saving.
    if (update === undefined) {
      setRefusal(undefined);
      return;
    }
    const applied = editor.apply({
      kind: "update",
      id: nodeId,
      patch: update.patch,
      ...(update.unset.length > 0 ? { unset: update.unset } : {}),
    } as Parameters<EditorState["apply"]>[0]);
    /*
     * REFUSED ops leave the document alone, and `apply` says so by answering
     * `null`. Marking the attempt as written before knowing would tell the
     * effect above that the props it sees are this panel's own echo, so it
     * would stop re-reading the document and the field would go on showing a
     * value nothing stored.
     *
     * The message names no single cause, because `apply` reports none: it
     * answers `null` for ANY refused op — a value past the document's byte
     * limit, but equally an update to a node a concurrent edit or an undo has
     * removed. Both are reachable from this panel, and telling an author their
     * page is full when their block has gone sends them to fix the wrong thing.
     */
    if (applied === null) {
      setRefusal(
        "That change could not be saved. A very long value can push the page past its size limit; otherwise the block may have changed since you opened this tab."
      );
      return;
    }
    setRefusal(undefined);
    lastWritten.current = wanted;
    /*
     * REBASED onto what landed — the id as well as the rows, because the id is
     * normalized on the way out and the rows are not.
     *
     * Recording the raw draft here left the two disagreeing: the document held
     * `hero` while the draft still held `" hero "`, so the next commit saw an id
     * unchanged from what was loaded, declined to trim it a second time, and
     * patched the spaces back — breaking every fragment link to the block. The
     * rows were already rebased for the same reason; the id was the site this
     * rule had not reached.
     */
    // The DRAFT is text, so an absent field and an empty one are both the empty
    // box; the difference lives in `wanted` and is settled before this.
    const landed = wanted.cssId ?? "";
    loaded.current = { id: landed, rows: rebasedRows(next.rows, wanted) };
    /*
     * The FIELD only follows when the author's own id is the one that landed.
     *
     * A refused id — one another block already holds — is kept out of the write
     * while staying in the field with its reason beside it, so `wanted.cssId`
     * is the value the node already had rather than anything the author typed.
     * Rebasing the field onto that replaced the text they were fixing, and took
     * the collision message with it, because an unrelated attribute saved.
     */
    setDraft(current => ({
      // Unless the author has typed since, in which case theirs is newer than
      // anything this write knows about.
      id: current.id === next.id && landed === asked ? landed : current.id,
      rows: rebasedRows(current.rows, wanted),
    }));
  };

  const settle = (next: Draft): void => {
    setSettled(next);
    write.current(next);
  };

  /*
   * Read at commit time rather than closed over, for the same reason `latest`
   * is: both effects below run after a render the author has already moved on
   * from.
   */
  const settleLatest = React.useRef<() => void>(() => {});
  settleLatest.current = (): void => {
    settle(latest.current);
  };

  /*
   * Committed when the author LOOKS AWAY, and again if the panel goes away.
   *
   * The inspector's tabs activate on `mousedown`, so an author who types an
   * attribute and clicks Style leaves before the browser delivers the blur.
   * This tab's content is force-mounted for that reason — destroying it took
   * the draft with it, and took the explanation beside a refused row with it
   * too: renaming `data-x` to `onclick` and clicking Style correctly declined
   * to store the name, then discarded the row that said so, so returning to
   * Advanced showed `data-x` again and the author never learned why.
   *
   * Settled rather than merely written, because the verdicts an author needs to
   * come back to are read from the settled draft.
   */
  const shown = React.useRef(active);
  React.useEffect(() => {
    if (shown.current === active) return;
    shown.current = active;
    if (active) return;
    settleLatest.current();
  }, [active]);

  /*
   * Selecting another block still DESTROYS this panel, through the key on it,
   * and so does closing the inspector. Neither passes through the effect above,
   * so the draft is committed here as well.
   */
  React.useEffect(
    () => () => {
      write.current(latest.current);
    },
    []
  );

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

  const idProblem = idProblemOf(settled.id, cssId ?? "", taken);
  /*
   * Analysed ONCE for the settled set, not once per row. Every verdict depends
   * on the whole set — who keeps a contested key, which keys refused rows are
   * holding — so asking row by row recomputed all of it for each row, and an
   * imported bag of a few hundred attributes stopped rendering.
   */
  const problems = React.useMemo(() => rowProblems(settled.rows), [settled]);
  /*
   * Whether removing the empty id would reveal one. The bag's `id` is dead
   * while the modelled field is present, so saying so is the difference
   * between "this does nothing visible" and "this changes the anchor".
   */
  const emptyIdShadows =
    attributes !== undefined &&
    Object.keys(attributes).some(name => attributeKey(name) === "id");

  /*
   * Written directly rather than through the draft, because the draft cannot
   * hold the distinction: its id is text, and the box is already empty.
   */
  const removeEmptyId = (): void => {
    const update = htmlUpdate(
      { cssId: undefined, attributes },
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

  return (
    <div className="nx-inspector__fields">
      {refusal === undefined ? null : (
        <p className="nx-attributes__problem" role="alert">
          {refusal}
        </p>
      )}
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
        {/*
          The EMPTY-BUT-PRESENT id, which the box above cannot express.

          A field holding `""` renders `id=""` and shadows any `id` in the bag
          below, and no amount of typing in an already-empty box says "remove
          it" — the draft matches what was loaded, so a commit correctly finds
          nothing to do. This is the gesture that was missing.

          Shown only in that state. Cleaning it up on open would be a write
          nobody asked for, and folding it into an unrelated save would change
          the id the page renders as a side effect of editing an attribute:
          removing the modelled field UNSHADOWS the bag's `id`, so it has to be
          the author's decision and has to say what it does.
        */}
        {cssId !== "" ? null : (
          <p className="nx-inspector__note" role="status">
            This block has an empty id set, which renders as{" "}
            <code>id=&quot;&quot;</code>
            {emptyIdShadows
              ? " and hides the id set in the attributes below"
              : ""}
            .{" "}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeEmptyId()}
            >
              Remove the empty id
            </Button>
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
                  problem={problemOf(settled, problems, index, draft)}
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
  problems: readonly (RowProblem | undefined)[],
  index: number,
  live: Draft
): string | undefined {
  const behind = settled.rows[index];
  const now = live.rows[index];
  if (behind === undefined || now === undefined) return undefined;
  if (behind.name !== now.name) return undefined;
  /*
   * Every row problem is about the NAME, which is why the reason below is wired
   * to that input alone. A colliding id used to be the exception — a good name
   * with a value another block held — and it no longer reaches a row at all:
   * an id belongs in the field above, and that field carries its own collision
   * message on the one input whose value it is about.
   */
  const problem = problems[index];
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
  /*
   * Enter COMMITS here; it must not reach the form above. The builder mounts
   * inside the entry's `<form>`, and a single-line input with nothing
   * stopping the key implicitly submits it — so typing an attribute and
   * pressing Enter would save the whole entry.
   */
  const onEnter = (event: React.KeyboardEvent): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onCommit();
  };
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
          // than leaving it as text that happens to sit nearby — and only when
          // the NAME is the thing that is wrong.
          aria-describedby={problem === undefined ? undefined : problemId}
          aria-invalid={problem === undefined ? undefined : true}
          onChange={event => onChange(index, { name: event.target.value })}
          onBlur={onCommit}
          onKeyDown={onEnter}
        />
        <Input
          id={valueId}
          value={row.value}
          aria-label={`Value of attribute ${position}`}
          onChange={event => onChange(index, { value: event.target.value })}
          onBlur={onCommit}
          onKeyDown={onEnter}
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
