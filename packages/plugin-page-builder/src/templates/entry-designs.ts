/**
 * An entry's own design: a template that serves one entry instead of its
 * collection, forked from the collection's template when it is made.
 *
 * Both are rows of the templates collection, told apart by which they name.
 * A collection's template names its collection and no entry; an own design
 * names its entry (its collection, its id, and the unique key the two make)
 * and no collection. So everything that finds a collection's template by its
 * collection finds the base template and never an own design, and the
 * database holds one own design per entry as it holds one template per
 * collection.
 *
 * @module templates/entry-designs
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  entryDesignKey,
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
} from "../collections/templates";

/** The fields that name the entry an own design serves. */
const ENTRY_FIELDS = [
  TEMPLATE_ENTRY_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
] as const;

/** Whether a stored or written value holds something: not absent, null or "". */
function filled(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** Whether `row` is an entry's own design rather than a collection's template. */
export function isEntryDesign(row: Readonly<Record<string, unknown>>): boolean {
  return ENTRY_FIELDS.some(field => filled(row[field]));
}

/** What is wrong with a template write's shape, and the field it is on. */
export interface DesignShapeProblem {
  readonly path: string;
  readonly message: string;
}

/**
 * What is wrong with the shape of a write to a template, or null: an empty
 * value for a field naming an entry; a new own design that names a
 * collection, names its entry only in part, or carries a key its entry does
 * not make; or a change to what an existing template serves. `original` is
 * the stored row of an update, null for a create.
 *
 * Read from the write alone, so it is asked inside a transaction too.
 */
export function designShapeProblem(
  original: Readonly<Record<string, unknown>> | null,
  data: Readonly<Record<string, unknown>>
): DesignShapeProblem | null {
  return (
    emptyEntryFieldProblem(data) ??
    (original === null
      ? newDesignProblem(data)
      : changedTemplateProblem(original, data))
  );
}

/**
 * What is wrong with a write giving a field that names an entry an empty
 * value, or null. Treated as none it would let the row through as a
 * collection's template, while the unique `entry` index holds the empty
 * value against every other row written the same way; so a field naming an
 * entry is left out, null, or names it. A form's cleared input is stored as
 * none before this is asked ({@link withoutEmptyEntryFields}).
 */
function emptyEntryFieldProblem(
  data: Readonly<Record<string, unknown>>
): DesignShapeProblem | null {
  const emptied = ENTRY_FIELDS.find(field => data[field] === "");
  return emptied === undefined
    ? null
    : {
        path: emptied,
        message:
          "A template names the entry it serves in full, or leaves these fields out: an empty value names none.",
      };
}

/**
 * `data` with each field naming an entry that a write gives an empty value
 * stored as none, as a form sends a cleared input; or undefined where the
 * write gives none of them an empty value, so the write is kept as it is.
 */
export function withoutEmptyEntryFields(
  data: Readonly<Record<string, unknown>> | null
): Record<string, unknown> | undefined {
  if (data === null || !ENTRY_FIELDS.some(field => data[field] === "")) {
    return undefined;
  }
  const kept: Record<string, unknown> = { ...data };
  for (const field of ENTRY_FIELDS) {
    if (kept[field] === "") kept[field] = null;
  }
  return kept;
}

/**
 * What is wrong with an update to a stored template: a change to what it
 * serves (an own design keeps its entry, and a collection's template never
 * becomes one, so a key once held never moves), or an own design given a
 * collection.
 */
function changedTemplateProblem(
  original: Readonly<Record<string, unknown>>,
  data: Readonly<Record<string, unknown>>
): DesignShapeProblem | null {
  const moved = ENTRY_FIELDS.find(
    field =>
      Object.prototype.hasOwnProperty.call(data, field) &&
      (filled(original[field]) ? original[field] : null) !==
        (filled(data[field]) ? data[field] : null)
  );
  if (moved !== undefined) {
    return {
      path: moved,
      message:
        "A template keeps what it serves: an entry's own design keeps its entry, and a collection's template never becomes one.",
    };
  }
  return isEntryDesign(original) && namesCollection(data)
    ? collectionNamed()
    : null;
}

/**
 * What is wrong with a new own design: one that names a collection, names
 * its entry only in part, or carries a key its entry does not make. A new
 * collection's template is judged elsewhere.
 */
function newDesignProblem(
  data: Readonly<Record<string, unknown>>
): DesignShapeProblem | null {
  if (!isEntryDesign(data)) return null;
  if (namesCollection(data)) return collectionNamed();
  const collection = data[TEMPLATE_ENTRY_COLLECTION_FIELD];
  const id = data[TEMPLATE_ENTRY_ID_FIELD];
  if (
    typeof collection !== "string" ||
    collection === "" ||
    typeof id !== "string" ||
    id === ""
  ) {
    return {
      path: TEMPLATE_ENTRY_FIELD,
      message:
        "An entry's own design names the entry it serves: its collection and its id.",
    };
  }
  const key = entryDesignKey(collection, id);
  return data[TEMPLATE_ENTRY_FIELD] === key
    ? null
    : {
        path: TEMPLATE_ENTRY_FIELD,
        message: `An entry's own design is held under the key its entry makes, "${key}".`,
      };
}

/**
 * Whether a write gives `collection` any value but none: an empty string is
 * a value too, and the unique index would hold it against every other own
 * design written the same way, so an own design leaves the field out or
 * null.
 */
function namesCollection(data: Readonly<Record<string, unknown>>): boolean {
  const value = data[TEMPLATE_COLLECTION_FIELD];
  return value !== undefined && value !== null;
}

/** The problem of an own design that also names a collection. */
function collectionNamed(): DesignShapeProblem {
  return {
    path: TEMPLATE_COLLECTION_FIELD,
    message:
      "An entry's own design serves its entry, not a collection: leave its collection out.",
  };
}

/** The refusal of a template write for `problem`. */
export function designShapeRefusal(problem: DesignShapeProblem): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: problem.path,
        code: "INVALID_TEMPLATE",
        message: problem.message,
      },
    ],
    logContext: { reason: "template-shape-refused", field: problem.path },
  });
}
