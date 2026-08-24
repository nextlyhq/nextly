/**
 * What an author may put on a block's root element, and why a row will not land.
 *
 * The engine models two fields beside a node's props: `cssId`, which becomes the
 * element's `id`, and `attributes`, a bag of author-supplied HTML attributes.
 * `blocks-react` already decides which of those reach the DOM and already
 * applies them — this module is the EDITOR's half, and it owns exactly one
 * question: what to tell an author before they save.
 *
 * ## Every rule here is ASKED, never restated
 *
 * The render-safe set lives in the renderer and says so in its own docblock, so
 * `isAllowedAttribute` is imported rather than copied. A second copy would
 * drift, and it drifts in the worse direction: an editor accepting a name the
 * renderer skips lets an author set an attribute, watch it save, and never see
 * it on the page. Nothing here decides what is safe — it decides what to SAY.
 *
 * @module custom-attributes
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import { EDITOR_NAMESPACE, isAllowedAttribute } from "@nextlyhq/blocks-react";

/** One row of the attributes editor, as the author is typing it. */
export interface AttributeRow {
  readonly name: string;
  readonly value: string;
  /**
   * The name this row was LOADED with, when it came from the document.
   *
   * Kept so a row that cannot land does not delete what it replaced. Renaming
   * `data-x` to `onclick` means the author typed something wrong, not that they
   * want `data-x` gone — and without an origin the only way to avoid deleting
   * it was to hold the whole write, which then blocked removing an unrelated
   * row beside it.
   *
   * Absent on a row the author added, which has nothing to fall back to.
   */
  readonly origin?: string;
}

/** The id and rows an author is editing, before any of it is written down. */
export interface Draft {
  readonly id: string;
  readonly rows: readonly AttributeRow[];
}

/**
 * Whether two drafts hold the same TEXT — what the author typed, character for
 * character.
 *
 * Deliberately not `htmlUpdate`, which compares a NORMALIZED draft against the
 * document and therefore reports a difference nobody made: a stored `" hero "`
 * trims and a stored `DATA-X` lowercases, so a panel that had only been looked
 * at wrote a change, added an undo entry, and moved the rendered anchor. The
 * question a commit has to ask first is whether the author edited anything, and
 * that is this one.
 *
 * `origin` is not compared: it records where a row came from so a mistake can
 * fall back to it, and it moves when a write lands rather than when an author
 * types.
 */
export function sameDraft(left: Draft, right: Draft): boolean {
  if (left.id !== right.id) return false;
  if (left.rows.length !== right.rows.length) return false;
  return left.rows.every((row, at) => {
    const other = right.rows[at];
    return (
      other !== undefined &&
      row.name === other.name &&
      row.value === other.value
    );
  });
}

/** Why a row will not reach the page, or `undefined` when it will. */
export type RowProblem =
  | { readonly kind: "not-allowed" }
  | { readonly kind: "reserved" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "use-css-id-field" };

/**
 * HTML attribute names are ASCII case-insensitive; React props are not.
 *
 * The renderer lowercases before writing for exactly that reason — `ID` and
 * `id` would otherwise both survive and land as two id attributes on one
 * element. So two rows differing only in case are ONE attribute here too, and
 * the editor has to say so rather than let an author believe they set two.
 */
export function attributeKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Whether a row has been started at all. A blank row is not an error. */
export function isBlankRow(row: AttributeRow): boolean {
  return row.name.trim() === "";
}

/**
 * What is wrong with one row, judged against its siblings and the node's id.
 *
 * `cssId` is checked because the renderer resolves the collision in its favour
 * and says so: "the modelled field wins over an attribute of the same name".
 * That is not a defect to fix here — a dedicated field beating an escape hatch
 * is the right precedence — but it is invisible from the editor, so an author
 * typing `id` beside a filled CSS id is writing a value that will never be
 * used. Naming it is the whole point of the surface.
 */
export function rowProblem(
  rows: readonly AttributeRow[],
  index: number
): RowProblem | undefined {
  const row = rows[index];
  if (row === undefined || isBlankRow(row)) return undefined;
  const key = attributeKey(row.name);
  if (!isAllowedAttribute(key)) return { kind: "not-allowed" };
  /*
   * The editor's own NAMESPACE, asked as a prefix rather than as a list of
   * the markers that exist today. The renderer drops these while it is
   * rendering for the editor, so accepting one here would store a name that
   * never appears — and a list is a thing to keep in sync, which this one
   * already fell behind on once.
   */
  if (key.startsWith(EDITOR_NAMESPACE)) return { kind: "reserved" };
  /*
   * Located by INDEX, never by object identity. A row is a plain value the UI
   * rebuilds on every keystroke, so two rows holding the same name and value
   * are indistinguishable by `===`, and a caller passing an equal-but-separate
   * object had every row reported as a duplicate of itself. Position is what
   * actually decides this — the FIRST row holding a key is the one that lands,
   * matching the renderer's own iteration over the stored record — so position
   * is what the caller passes.
   */
  /*
   * Among rows sharing a key, exactly one is kept and the rest are duplicates.
   * The one kept is a row that came from the DOCUMENT and still carries its
   * own name — never a row the author has just renamed onto it.
   *
   * First-wins alone got this backwards in one direction: renaming the first
   * row onto a name a later row already held left the edited row looking fine
   * and blamed the untouched one, so on rebuild the untouched row's old value
   * overwrote the edit and the name renamed FROM disappeared. Between two rows
   * that both came from the document — two spellings of one name in an
   * imported bag — first-wins is still the answer.
   */
  const sharing = rows
    .map((other, at) => ({ other, at }))
    .filter(
      ({ other }) => !isBlankRow(other) && attributeKey(other.name) === key
    );
  if (sharing.length > 1) {
    const settled = sharing.filter(
      ({ other }) =>
        other.origin !== undefined && attributeKey(other.origin) === key
    );
    const keeps = (settled.length > 0 ? settled : sharing)[0]?.at;
    if (keeps !== index) return { kind: "duplicate" };
  }
  if (key === "id") return { kind: "use-css-id-field" };
  return undefined;
}

/** What to tell the author about a row that will not land. */
export function problemMessage(problem: RowProblem): string {
  switch (problem.kind) {
    case "not-allowed":
      return "This site does not put that attribute on a page. Names starting with “data-” or “aria-” are open, along with role, title, lang and dir.";
    case "reserved":
      return "The editor uses that name to find blocks on the canvas, so setting it here would make clicking this block select the wrong one. Pick another name.";
    case "duplicate":
      return "Another row already sets this attribute, and only the first is used. Attribute names ignore capitals, so “Data-X” and “data-x” are one name.";
    case "use-css-id-field":
      return "Set this block’s id in the CSS id field above. An id written here is not used while that field has a value, and it is the field the rest of the editor reads.";
  }
}

/**
 * The rows an author edits, from what the node stores.
 *
 * Sorted by name so the list does not reorder itself as an author types — a
 * record's key order is its insertion order, and rewriting the record on every
 * keystroke would make rows jump.
 */
export function rowsOf(
  attributes: Readonly<Record<string, string>> | undefined
): AttributeRow[] {
  return Object.entries(attributes ?? {})
    .map(([name, value]) => ({ name, value, origin: name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * What to store for a set of rows, or `undefined` to store nothing at all.
 *
 * Blank rows are dropped rather than saved as empty keys, and a row that cannot
 * land is dropped too: storing a value the page will never use is the silent
 * half of the problem this surface exists to make loud. `undefined` rather than
 * `{}` for an empty result, so removing the last attribute leaves the node as
 * it was before any were added rather than carrying an empty bag forever.
 */
export function storedAttributes(
  rows: readonly AttributeRow[],
  cssId: string,
  stored: Readonly<Record<string, string>> = {}
): Record<string, string> | undefined {
  const kept: Record<string, string> = {};
  rows.forEach((row, index) => {
    /*
     * Blankness is asked SEPARATELY from correctness, because they are
     * different questions and `rowProblem` answers only the second. A row an
     * author has not started typing is not an error to show them — that is why
     * it has no problem — and it is not something to store either. Reading one
     * answer for both stored an attribute under the empty name.
     */
    if (isBlankRow(row)) return;
    const problem = rowProblem(rows, index);
    if (problem === undefined) {
      kept[attributeKey(row.name)] = row.value;
      return;
    }
    /*
     * A row that cannot land KEEPS what it replaced, rather than deleting it.
     * The author has typed something wrong, and the row is on screen with the
     * reason — removing the attribute underneath it as well would take away
     * work they never asked to lose. A row they ADDED has no origin, so there
     * is nothing to keep and nothing is written.
     *
     * The one exception is an id the field above now owns: keeping it would let
     * the renderer fall back to it the moment that field is cleared, which is
     * the value coming back from the dead.
     */
    /*
     * ANY row that would render as `id`, whichever problem it happened to
     * draw. A bag holding two spellings gives the first `use-css-id-field`
     * and every later one `duplicate` — the duplicate check runs earlier —
     * so keying this on one kind preserved the second, and clearing the CSS
     * id later made a supposedly removed value render again.
     */
    if (cssId.trim() !== "" && attributeKey(row.name) === "id") return;
    const origin = row.origin;
    if (origin === undefined) return;
    const had = stored[origin];
    if (had !== undefined) kept[origin] = had;
  });
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/**
 * Every DOM id the document already uses, other than one node's own.
 *
 * A rendered id must be unique across the page: two elements answering to one
 * `id` give a fragment link, a `<label for>` and a CSS selector two possible
 * targets, and which one wins is the document order rather than anything the
 * author chose.
 *
 * The engine already detects this — `validateDomIds` reports `duplicate-dom-id`
 * — but only as a WARNING in forgiving mode, and the field's own validation
 * discards warnings, so a duplicate saves and publishes with nothing said. This
 * is the editor refusing it while the author still has the keyboard, which is
 * the only moment they can act on it.
 *
 * Both sources are read, because both become the same attribute: the modelled
 * `cssId` and the `id` an author can put in the attribute bag.
 */
export function domIdsTaken(
  nodes: readonly BlockNode[],
  exceptNodeId: string
): Set<string> {
  const taken = new Set<string>();
  /*
   * Every node passes through HERE, which is why the shape is checked here
   * and not at the two places that call it. A stored document holds what the
   * database returned: a `null` inside a slot array reaches this, and reading
   * `.id` off it throws before the tab renders. Guarding the callers instead
   * would be two guards to keep in step, and the walk gained its second
   * caller in the same commit that guarded the first.
   */
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const held = node as BlockNode;
    if (held.id !== exceptNodeId) {
      /*
       * ONE id per node, because the renderer emits one: the modelled field
       * wins over the bag. Adding both refused another block the bag's value
       * even though that id never reaches the page.
       */
      /*
       * PRESENT whenever it is a string, the empty one included, because that
       * is the renderer's test: it writes `extra.id = cssId` on
       * `cssId !== undefined`, so an empty modelled field still overwrites
       * the bag and the element renders `id=""`. Reading it as absent here
       * recorded the bag's value and refused another block an id that never
       * renders.
       */
      const modelled = typeof held.cssId === "string" ? held.cssId : undefined;
      const rendered = modelled ?? renderedIdIn(held.attributes);
      // An empty id is not an id, so it takes nothing — it only stops the bag.
      if (rendered !== undefined && rendered !== "") taken.add(rendered);
    }
    for (const child of childNodesOf(held)) visit(child);
  };
  for (const node of nodes) visit(node);
  return taken;
}

/**
 * The `id` the renderer would emit from an attribute bag, if any.
 *
 * Read case-INSENSITIVELY, because that is how the renderer reads it: HTML
 * attribute names are ASCII case-insensitive and it lowercases every key before
 * writing, so a stored `{ ID: "hero" }` renders as `id="hero"`. A scan looking
 * only at the exact key `id` misses it, and another block is then allowed to
 * take the same id — producing the collision this exists to prevent.
 *
 * The LAST variant wins, matching the renderer's own loop: it assigns each
 * lowercased key in turn, so a later one replaces an earlier one. This editor
 * never writes two spellings, but an import or a script can.
 */
function renderedIdIn(
  attributes: Readonly<Record<string, string>> | undefined
): string | undefined {
  /*
   * Shape-checked, because this walks OTHER nodes and a stored document can
   * hold whatever the database returned. `Object.entries(null)` throws, and
   * one malformed node elsewhere would take down the whole tab before it
   * rendered. The reader and the renderer both treat a malformed bag as
   * absent; this agrees with them.
   */
  if (typeof attributes !== "object" || attributes === null) return undefined;
  if (Array.isArray(attributes)) return undefined;
  let found: string | undefined;
  for (const [name, value] of Object.entries(attributes)) {
    if (name.toLowerCase() !== "id") continue;
    /*
     * The last variant wins whatever it holds, empty included: the renderer
     * assigns each lowercased key in turn, so a trailing `ID: ""` leaves the
     * element with `id=""`. Skipping it here kept an earlier value and
     * refused another block an id that does not render.
     */
    if (typeof value === "string") found = value;
  }
  return found;
}

/** Every node nested inside one, across all of its slots. */
function childNodesOf(node: BlockNode): unknown[] {
  const slots = node.slots;
  // `Object.values(null)` throws, and a stored `slots` can be anything —
  // the same shape check the attribute bag beside it already gets.
  if (typeof slots !== "object" || slots === null) return [];
  return Object.values(slots).flatMap(held =>
    Array.isArray(held) ? held : []
  );
}

/** What a node should hold, and what it holds now. */
export interface HtmlFields {
  readonly cssId: string;
  readonly attributes: Readonly<Record<string, string>> | undefined;
}

/**
 * What a draft wants the node to hold — the whole question of what to STORE.
 *
 * Separate from getting the document there, which is the caller's job and a
 * different kind of problem: this one is about attribute rules and knows
 * nothing about ops, refusals or undo.
 *
 * The id is trimmed only when the author TYPED it. Normalizing a value nobody
 * touched is a change nobody asked for, and the two normalizations here are not
 * alike: the renderer lowercases an attribute name itself, so storing `DATA-X`
 * as `data-x` renders the same byte for byte — but it does not trim `cssId`, so
 * tidying a stored `" hero "` silently moves the anchor every link to this
 * block points at. What the renderer already does is safe to store; what it
 * does not do is the author's to decide.
 *
 * An id another block holds is not written at all: the field keeps showing what
 * the author typed, with the reason beside it, and the document keeps what it
 * had.
 */
export function wantedFields(
  draft: Draft,
  loaded: Draft,
  stored: HtmlFields,
  taken: ReadonlySet<string>
): HtmlFields {
  const id = draft.id === loaded.id ? draft.id : draft.id.trim();
  const keptId = id !== "" && taken.has(id) ? stored.cssId : id;
  return {
    cssId: keptId,
    /*
     * The shadowed `id` is dropped only when the author has just SET the field,
     * never merely because it holds something. A node imported with both a
     * `cssId` and a legacy `id` would otherwise lose the second the moment
     * anyone opened this tab — and lose it again on a change that was REFUSED,
     * since a refusal keeps the id the node already had and that is still
     * non-empty. Nothing the author did not ask for gets deleted.
     */
    attributes: storedAttributes(
      draft.rows,
      keptId === stored.cssId ? "" : keptId,
      stored.attributes ?? {}
    ),
  };
}

/**
 * The rows again, each pointed at the name it is now STORED under.
 *
 * A row keeps the name it was loaded with so a later mistake can fall back to
 * it — but once a rename has landed, that old name is no longer in the document,
 * and falling back to it finds nothing and unsets the value the rename had just
 * saved.
 *
 * Only the origins move. The names and values the author is looking at stay
 * exactly as they are, so nothing shifts under a cursor.
 */
export function rebasedRows(
  rows: readonly AttributeRow[],
  wanted: HtmlFields
): AttributeRow[] {
  const written = wanted.attributes;
  return rows.map(row =>
    written !== undefined && written[attributeKey(row.name)] === row.value
      ? { ...row, origin: attributeKey(row.name) }
      : row
  );
}

/**
 * The smallest update that makes a node hold `wanted`, or nothing to do.
 *
 * Its own question, and a pure one: deciding what an author's draft SHOULD
 * become is about attribute rules, and saying so as an op is about the patch
 * contract. Both live away from the component, which then only has to hand over
 * two values and apply what comes back.
 *
 * Removal is spelled `unset`, never `undefined` as a patch value: `applyOp`
 * refuses that and says why — the key disappears when the op is stored, so a
 * replayed edit would silently do nothing.
 *
 * Only what CHANGED is named. An op that unsets a field the node never had, or
 * rewrites one to the value it already holds, is an undo entry that undoes
 * nothing — and an author pressing undo for their last edit gets a step that
 * does nothing instead.
 */
export function htmlUpdate(
  wanted: HtmlFields,
  stored: HtmlFields
): { patch: Record<string, unknown>; unset: string[] } | undefined {
  const sameId = wanted.cssId === stored.cssId;
  const sameAttributes = sameRecord(wanted.attributes, stored.attributes);
  if (sameId && sameAttributes) return undefined;

  const patch: Record<string, unknown> = {};
  const unset: string[] = [];
  if (!sameId) {
    if (wanted.cssId === "") unset.push("cssId");
    else patch["cssId"] = wanted.cssId;
  }
  if (!sameAttributes) {
    if (wanted.attributes === undefined) unset.push("attributes");
    else patch["attributes"] = wanted.attributes;
  }
  return { patch, unset };
}

/** Whether two attribute records hold the same names and values. */
function sameRecord(
  left: Readonly<Record<string, string>> | undefined,
  right: Readonly<Record<string, string>> | undefined
): boolean {
  /*
   * An EMPTY bag and no bag are the same thing to a reader — the renderer
   * asks `Object.keys(attributes).length > 0` — so they must compare equal
   * here too. Treating them as different meant a node stored with `{}` was
   * rewritten the moment anyone looked at the tab, putting an edit in the
   * undo history for having opened a panel.
   */
  const held = (bag: Readonly<Record<string, string>> | undefined) =>
    bag === undefined || Object.keys(bag).length === 0 ? undefined : bag;
  const [a, b] = [held(left), held(right)];
  if (a === undefined || b === undefined) return a === b;
  const names = Object.keys(a);
  if (names.length !== Object.keys(b).length) return false;
  return names.every(name => a[name] === b[name]);
}
