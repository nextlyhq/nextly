/**
 * A template's write judged again inside its own transaction, on the row as
 * it is about to commit, whichever path the write took.
 *
 * The guard (`template-guard`) judges a write in `beforeChange`, before its
 * transaction opens. Two things can change after it: a hook running later
 * can rewrite the fields that say what the template serves, and the entry an
 * own design names can be deleted. So the in-transaction phase asks both
 * again, with the row core hands it:
 *
 * - the shape of what the template serves ({@link designShapeProblem}), so a
 *   row naming both a collection and an entry, or an entry under a key it
 *   does not make, never commits;
 * - for a new own design, that its entry is still there, holding the entry's
 *   row for share until the write ends
 *   (`ctx.services.collections.holdEntryInTransaction`). A delete of the
 *   entry locks the row for update before it removes it, and deletes the
 *   entry's own design in its in-transaction phase after
 *   (`entry-design-cascade`), so the two take turns: the design commits
 *   first and is deleted with the entry, or waits and is refused, the entry
 *   gone. That holds for a Direct API create as for the template action.
 *
 * @module templates/entry-design-write
 */
import {
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
} from "../collections/templates";

import {
  designShapeProblem,
  designShapeRefusal,
  isEntryDesign,
} from "./entry-designs";

/** What an in-transaction handler is told about a template's write. */
interface TemplateWrite<Tx> {
  readonly operation: "create" | "update" | "delete";
  readonly data?: Record<string, unknown>;
  readonly originalData?: Record<string, unknown> | null;
  readonly transaction: Tx;
}

/** The fields that say what a template serves. */
const SHAPE_FIELDS = [
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_ENTRY_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
] as const;

/**
 * The fields saying what a template serves that an update changed, as the
 * patch the guard judged would give them: the row core hands the phase is
 * the whole document, and a template stored before a rule existed is judged
 * only on what this write moves.
 */
function changedShape(
  original: Readonly<Record<string, unknown>>,
  data: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const field of SHAPE_FIELDS) {
    if (
      Object.prototype.hasOwnProperty.call(data, field) &&
      data[field] !== original[field]
    ) {
      changed[field] = data[field];
    }
  }
  return changed;
}

/**
 * The in-transaction handler for the templates collection: the shape of
 * every create and update judged again, and a new own design's entry held
 * and refused once it is gone. `holdEntry` answers whether the entry exists,
 * holding its row until the transaction ends.
 */
export function judgeTemplateInTransaction<Tx>(
  holdEntry: (tx: Tx, collection: string, id: string) => Promise<boolean>
): (write: TemplateWrite<Tx>) => Promise<void> {
  return async write => {
    if (write.operation === "delete") return;
    const data = write.data ?? {};
    const original = write.originalData ?? null;
    if (write.operation === "update") {
      // Without the stored row there is nothing to tell a move from, and an
      // update cannot make an own design, so only a create goes on.
      if (original === null) return;
      const shape = designShapeProblem(original, changedShape(original, data));
      if (shape !== null) throw designShapeRefusal(shape);
      return;
    }
    const shape = designShapeProblem(null, data);
    if (shape !== null) throw designShapeRefusal(shape);
    if (!isEntryDesign(data)) return;
    const collection = data[TEMPLATE_ENTRY_COLLECTION_FIELD];
    const id = data[TEMPLATE_ENTRY_ID_FIELD];
    // Both are text here: the shape check refused anything else.
    if (typeof collection !== "string" || typeof id !== "string") return;
    if (!(await holdEntry(write.transaction, collection, id))) {
      throw designShapeRefusal({
        path: TEMPLATE_ENTRY_ID_FIELD,
        message: `The collection "${collection}" has no entry "${id}" to give its own design.`,
      });
    }
  };
}
