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
import {
  NODE_ID_ATTRIBUTE,
  PROP_ATTRIBUTE,
  isAllowedAttribute,
} from "@nextlyhq/blocks-react";

import { CHROME_ATTRIBUTE } from "./canvas";

/** One row of the attributes editor, as the author is typing it. */
export interface AttributeRow {
  readonly name: string;
  readonly value: string;
}

/**
 * Names the EDITOR needs, which the renderer has no reason to refuse.
 *
 * Both are `data-` attributes, so the render-safe rule admits them — correctly,
 * because on a published page they are ordinary author data. They are not
 * ordinary HERE: the canvas reads one to decide which block was clicked and
 * treats the other as its own chrome, so a block carrying either can send a
 * click to the wrong block or swallow it. That is an editing surface the
 * renderer cannot see, which is why this narrowing lives here and not there.
 *
 * ALL THREE, which is the point: the first version of this reserved two and
 * missed `data-nx-prop`, the marker inline editing reads to decide which
 * property a click makes editable. On a block with more than one inline
 * property, an author's value matching another property makes the whole root
 * editable and commits its text into the wrong property; a value matching none
 * disables inline editing on that root entirely.
 *
 * Taken from the modules that define them rather than written out, so renaming
 * any of them moves this with it.
 */
const RESERVED_FOR_THE_EDITOR = new Set([
  NODE_ID_ATTRIBUTE,
  PROP_ATTRIBUTE,
  CHROME_ATTRIBUTE,
]);

/** Why a row will not reach the page, or `undefined` when it will. */
export type RowProblem =
  | { readonly kind: "not-allowed" }
  | { readonly kind: "reserved" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "overridden-by-css-id" }
  | { readonly kind: "duplicate-dom-id" };

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
  index: number,
  cssId: string,
  takenIds: ReadonlySet<string> = new Set()
): RowProblem | undefined {
  const row = rows[index];
  if (row === undefined || isBlankRow(row)) return undefined;
  const key = attributeKey(row.name);
  if (!isAllowedAttribute(key)) return { kind: "not-allowed" };
  if (RESERVED_FOR_THE_EDITOR.has(key)) return { kind: "reserved" };
  /*
   * Located by INDEX, never by object identity. A row is a plain value the UI
   * rebuilds on every keystroke, so two rows holding the same name and value
   * are indistinguishable by `===`, and a caller passing an equal-but-separate
   * object had every row reported as a duplicate of itself. Position is what
   * actually decides this — the FIRST row holding a key is the one that lands,
   * matching the renderer's own iteration over the stored record — so position
   * is what the caller passes.
   */
  const first = rows.findIndex(
    other => !isBlankRow(other) && attributeKey(other.name) === key
  );
  if (first !== -1 && first !== index) return { kind: "duplicate" };
  if (key === "id" && cssId.trim() !== "") {
    return { kind: "overridden-by-css-id" };
  }
  // An `id` set through the bag is the same page-wide identifier as one set in
  // the field beside it, so it collides with other blocks the same way.
  if (key === "id" && takenIds.has(row.value.trim())) {
    return { kind: "duplicate-dom-id" };
  }
  return undefined;
}

/**
 * Whether a problem is the author's to FIX before anything is stored.
 *
 * Most are: a name the page would drop, a name the editor needs, a second row
 * setting a name another row sets, an id another block holds. Each means the
 * author has typed something wrong, and writing the reduced set would delete
 * whatever the row used to hold — renaming `data-x` to `onclick` would remove
 * `data-x`, which is not what renaming asks for.
 *
 * One is not: a row the CSS id field shadows is not a mistake, it is a
 * consequence of the field beside it, and dropping it is exactly right — the
 * value could never reach the page anyway, and holding the whole write for it
 * would mean an author could not set a CSS id while such a row existed.
 */
export function holdsTheWrite(problem: RowProblem): boolean {
  return problem.kind !== "overridden-by-css-id";
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
    case "overridden-by-css-id":
      return "The CSS id above sets this element’s id, and it wins over this row, so this value would not be used. Clear the CSS id, or set the id there instead.";
    case "duplicate-dom-id":
      return "Another block on this page already uses that id. Two elements with one id give a link, a label and a style rule two possible targets.";
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
    .map(([name, value]) => ({ name, value }))
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
  takenIds: ReadonlySet<string> = new Set()
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
    if (rowProblem(rows, index, cssId, takenIds) !== undefined) return;
    kept[attributeKey(row.name)] = row.value;
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
  const visit = (node: BlockNode): void => {
    if (node.id !== exceptNodeId) {
      if (typeof node.cssId === "string" && node.cssId !== "") {
        taken.add(node.cssId);
      }
      const fromBag = renderedIdIn(node.attributes);
      if (fromBag !== undefined) taken.add(fromBag);
    }
    for (const child of childNodesOf(node)) visit(child);
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
  if (attributes === undefined) return undefined;
  let found: string | undefined;
  for (const [name, value] of Object.entries(attributes)) {
    if (name.toLowerCase() !== "id") continue;
    if (typeof value === "string" && value !== "") found = value;
  }
  return found;
}

/** Every node nested inside one, across all of its slots. */
function childNodesOf(node: BlockNode): BlockNode[] {
  const slots = node.slots;
  if (slots === undefined) return [];
  return Object.values(slots).flatMap(held =>
    Array.isArray(held) ? held : []
  );
}

/**
 * The same bag without an `id` the CSS id field would shadow.
 *
 * Applied to whatever set is about to be stored, because the shadowing is a
 * consequence of the ID rather than of the rows. Reducing the rows already
 * drops it — `rowProblem` reports the row and `storedAttributes` skips it — but
 * the rows are NOT always what gets written: when one of them is a mistake the
 * stored bag is kept instead, and that bag still holds the old id. Without this
 * the two fixes cancelled: setting a CSS id beside a mistyped row left the
 * shadowed id in place, and clearing the CSS id later brought it back.
 *
 * Case-insensitive, for the reason the collision scan is: the renderer
 * lowercases every key, so `ID` and `id` are one attribute on the page.
 */
export function withoutShadowedId(
  attributes: Readonly<Record<string, string>> | undefined,
  cssId: string
): Record<string, string> | undefined {
  if (attributes === undefined || cssId.trim() === "") {
    return attributes === undefined ? undefined : { ...attributes };
  }
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (name.toLowerCase() === "id") continue;
    kept[name] = value;
  }
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/** What a node should hold, and what it holds now. */
export interface HtmlFields {
  readonly cssId: string;
  readonly attributes: Readonly<Record<string, string>> | undefined;
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
  if (left === undefined || right === undefined) return left === right;
  const names = Object.keys(left);
  if (names.length !== Object.keys(right).length) return false;
  return names.every(name => left[name] === right[name]);
}
