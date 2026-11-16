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
 * - the collection it newly names, as `collection` or as an own design's
 *   `entryCollection`: the one the guard let through, which passed its
 *   collection check (`templateCollectionProblem`), so a hook cannot point
 *   it at the page builder's own collection, a hidden one, or one with no
 *   address field once the guard has run;
 * - for a new own design, that its entry is still there, holding the entry's
 *   row for share until the write ends
 *   (`ctx.services.collections.holdEntryInTransaction`). A delete of the
 *   entry locks the row for update before it removes it, and deletes the
 *   entry's own design in its in-transaction phase after
 *   (`entry-design-cascade`), so the two take turns: the design commits
 *   first and is deleted with the entry, or waits and is refused, the entry
 *   gone. That holds for a Direct API create as for the template action.
 * - for a write that sets or changes the template a design was copied from
 *   (`forkedFrom`), that the template is still there, holding its row for
 *   share until the write ends. A delete of that template locks its row for
 *   update before it removes it, and empties the link of every copy it finds
 *   in its in-transaction phase after (`unlink-copies`), so the two take
 *   turns: the copy commits first and the delete finds it and empties its
 *   link, or waits and is refused, the template gone. Without the hold, a
 *   copy written while the delete walked the copies would commit after it,
 *   naming a template that no longer exists.
 *
 * @module templates/entry-design-write
 */
import {
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
  TEMPLATE_FORKED_FROM_FIELD,
} from "../collections/templates";

import {
  designShapeProblem,
  designShapeRefusal,
  isEntryDesign,
  type DesignShapeProblem,
} from "./entry-designs";
import {
  GUARDED_COLLECTIONS_CONTEXT,
  namedCollection,
  TEMPLATE_COLLECTION_FIELDS,
  templateCollectionRefusal,
} from "./template-guard";

/** What an in-transaction handler is told about a template's write. */
interface TemplateWrite<Tx> {
  readonly operation: "create" | "update" | "delete";
  readonly data?: Record<string, unknown>;
  readonly originalData?: Record<string, unknown> | null;
  /** A frozen copy of the write's shared hook context. */
  readonly context?: Readonly<Record<string, unknown>>;
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
 * Refuse a row that newly names a collection the guard did not let through:
 * one a hook running after the guard put there. `original` is the document
 * an update replaced, null for a create; a collection an update leaves as it
 * was is not asked about. A write the guard did not see (one that ran no
 * hooks) carries no record, and no hook can have changed it.
 */
function refuseUnguardedCollection(
  context: Readonly<Record<string, unknown>> | undefined,
  data: Readonly<Record<string, unknown>>,
  original: Readonly<Record<string, unknown>> | null
): void {
  const letThrough = guardedCollectionsOf(context);
  if (letThrough === undefined) return;
  for (const field of TEMPLATE_COLLECTION_FIELDS) {
    const named = namedCollection(data[field]);
    if (!collectionStillGuarded(letThrough, field, named, original)) {
      // Refused rather than judged here: see `GUARDED_COLLECTIONS_CONTEXT`.
      throw unguardedCollectionRefusal(field, named);
    }
  }
}

/** What the guard recorded letting through, or undefined where it saw no write. */
function guardedCollectionsOf(
  context: Readonly<Record<string, unknown>> | undefined
): Readonly<Record<string, unknown>> | undefined {
  const guarded = context?.[GUARDED_COLLECTIONS_CONTEXT];
  return typeof guarded === "object" && guarded !== null
    ? (guarded as Readonly<Record<string, unknown>>)
    : undefined;
}

/**
 * Whether `field` may commit naming `named`: an update that leaves it as it
 * was, or the collection the guard let through for it.
 */
function collectionStillGuarded(
  letThrough: Readonly<Record<string, unknown>>,
  field: string,
  named: string | null,
  original: Readonly<Record<string, unknown>> | null
): boolean {
  if (original !== null && named === namedCollection(original[field])) {
    return true;
  }
  return (
    Object.prototype.hasOwnProperty.call(letThrough, field) &&
    letThrough[field] === named
  );
}

/** The refusal of `field` newly naming `named` after the guard had judged it. */
function unguardedCollectionRefusal(
  field: string,
  named: string | null
): ReturnType<typeof templateCollectionRefusal> {
  const message =
    named === null
      ? "A hook emptied the collection this template names after the collection was checked."
      : `A hook changed the collection this template names to "${named}" after the collection was checked. Set it on the template itself.`;
  return field === TEMPLATE_COLLECTION_FIELD
    ? templateCollectionRefusal(message)
    : designShapeRefusal({ path: field, message });
}

/** Refuse a write whose shape has `problem`, when it has one. */
function refuseShape(problem: DesignShapeProblem | null): void {
  if (problem !== null) throw designShapeRefusal(problem);
}

/**
 * Judge an update on what it moves, as the guard judged its patch. Without
 * the stored row there is nothing to tell a move from, and an update cannot
 * make an own design, so such an update is let through.
 */
function judgeUpdate(
  context: Readonly<Record<string, unknown>> | undefined,
  data: Readonly<Record<string, unknown>>,
  original: Readonly<Record<string, unknown>> | null
): void {
  if (original === null) return;
  refuseShape(designShapeProblem(original, changedShape(original, data)));
  refuseUnguardedCollection(context, data, original);
}

/**
 * Hold a new own design's entry on the write's transaction, and refuse the
 * design once the entry is gone. A collection's template names no entry and
 * holds nothing.
 */
async function holdNewDesignEntry<Tx>(
  holdEntry: (tx: Tx, collection: string, id: string) => Promise<boolean>,
  tx: Tx,
  data: Readonly<Record<string, unknown>>
): Promise<void> {
  if (!isEntryDesign(data)) return;
  const collection = data[TEMPLATE_ENTRY_COLLECTION_FIELD];
  const id = data[TEMPLATE_ENTRY_ID_FIELD];
  // Both are text here: the shape check refused anything else.
  if (typeof collection !== "string" || typeof id !== "string") return;
  if (await holdEntry(tx, collection, id)) return;
  throw designShapeRefusal({
    path: TEMPLATE_ENTRY_ID_FIELD,
    message: `The collection "${collection}" has no entry "${id}" to give its own design.`,
  });
}

/**
 * The template a write newly links its row to as the one it was copied from,
 * or undefined: a create naming one, or an update naming another than the
 * stored row did. An update without the stored row has nothing to tell an
 * unchanged link from, so the link it names counts as new. An empty link
 * names no template.
 */
function newSourceOf(
  data: Readonly<Record<string, unknown>>,
  original: Readonly<Record<string, unknown>> | null
): string | undefined {
  const source = data[TEMPLATE_FORKED_FROM_FIELD];
  if (typeof source !== "string" || source === "") return undefined;
  if (original !== null && original[TEMPLATE_FORKED_FROM_FIELD] === source) {
    return undefined;
  }
  return source;
}

/**
 * Hold the template a write newly names as the one its row was copied from,
 * on the write's transaction, and refuse the write once that template is
 * gone, so no row commits linked to a template already deleted.
 */
async function holdNewSource<Tx>(
  holdEntry: (tx: Tx, collection: string, id: string) => Promise<boolean>,
  templates: string,
  tx: Tx,
  data: Readonly<Record<string, unknown>>,
  original: Readonly<Record<string, unknown>> | null
): Promise<void> {
  const source = newSourceOf(data, original);
  if (source === undefined) return;
  if (await holdEntry(tx, templates, source)) return;
  throw designShapeRefusal({
    path: TEMPLATE_FORKED_FROM_FIELD,
    message: `There is no template "${source}" for forkedFrom to name: it was deleted, or never existed.`,
  });
}

/**
 * The in-transaction handler for the templates collection: the shape of
 * every create and update judged again, the collections it newly names
 * held to those the guard let through, a new own design's entry held and
 * refused once it is gone, and the template a write newly names in
 * `forkedFrom` held and refused once it is gone. `holdEntry` answers whether
 * an entry exists, holding its row until the transaction ends; `templates`
 * is the RESOLVED templates slug, which a host may rename.
 */
export function judgeTemplateInTransaction<Tx>(
  holdEntry: (tx: Tx, collection: string, id: string) => Promise<boolean>,
  templates: string
): (write: TemplateWrite<Tx>) => Promise<void> {
  return async write => {
    if (write.operation === "delete") return;
    const data = write.data ?? {};
    if (write.operation === "update") {
      const original = write.originalData ?? null;
      judgeUpdate(write.context, data, original);
      await holdNewSource(
        holdEntry,
        templates,
        write.transaction,
        data,
        original
      );
      return;
    }
    refuseShape(designShapeProblem(null, data));
    refuseUnguardedCollection(write.context, data, null);
    await holdNewDesignEntry(holdEntry, write.transaction, data);
    await holdNewSource(holdEntry, templates, write.transaction, data, null);
  };
}
