/**
 * The text inside a repeater's or group's rows, in the editor.
 *
 * A repeater or group keeps one structure in every language: its rows, their ids and order, and
 * its shared values are the same everywhere, and only the text inside each row is translated. So
 * the editor tells such a container apart from a wholly shared field, and copying from another
 * language copies the text inside onto the rows this language already has, by row id, never the
 * other language's rows themselves. Which text is translated is the classifier storage reads
 * (`isFieldLocalized`), applied at every depth.
 *
 * @module components/features/entries/container-text
 */
import { isFieldLocalized } from "nextly/config";
import {
  isFieldGroupFieldType,
  readFieldGroupType,
} from "nextly/field-group-type";

/** What these read of a field: a component field as the API enriches it, with its fields. */
interface FieldShape {
  type?: string;
  name?: string;
  localized?: boolean;
  fields?: unknown;
  repeatable?: boolean;
  /** One component's fields (a single reference). */
  componentFields?: unknown;
  /** Each component's schema by slug (a dynamic zone). */
  componentSchemas?: Record<string, { fields?: unknown } | undefined>;
}

const isComponent = (field: FieldShape): boolean =>
  isFieldGroupFieldType(field.type);

/** The fields of the component an instance is, or of each component a field may hold. */
function componentFieldLists(
  field: FieldShape,
  instance?: unknown
): FieldShape[][] {
  if (Array.isArray(field.componentFields)) {
    return [field.componentFields as FieldShape[]];
  }
  const schemas = field.componentSchemas ?? {};
  const type =
    instance === undefined ? undefined : readFieldGroupType(instance);
  const chosen = type !== undefined ? [schemas[type]] : Object.values(schemas);
  return chosen.flatMap(schema =>
    Array.isArray(schema?.fields) ? [schema.fields as FieldShape[]] : []
  );
}

const isContainer = (field: FieldShape): boolean =>
  field.type === "repeater" || field.type === "group";

const childrenOf = (field: FieldShape): FieldShape[] =>
  Array.isArray(field.fields) ? (field.fields as FieldShape[]) : [];

/** Whether a field's own value is translated: a text-like field, or one marked so. */
function translated(field: FieldShape, documentLocalized: boolean): boolean {
  return (
    !isContainer(field) &&
    isFieldLocalized(
      {
        type: field.type ?? "",
        name: field.name ?? "",
        localized: field.localized,
      },
      documentLocalized
    )
  );
}

/**
 * Whether a repeater or group holds a translated text inside its rows, at any depth: one whose
 * rows are shared across languages and whose text inside is translated row by row.
 */
export function holdsTranslatedText(
  field: unknown,
  documentLocalized: boolean
): boolean {
  const shape = field as FieldShape;
  // A container saying it is not translated is shared whole, its text inside the same in every
  // language, as storage keeps it.
  if (!isContainer(shape) || shape.localized === false) return false;
  return levelHoldsText(childrenOf(shape), documentLocalized, new Set());
}

/**
 * Whether a level's fields hold translated text: a translated field, a container holding some, or
 * a component placed there whose fields do (its values held inline in the row). `open` stops a
 * component that places itself.
 */
function levelHoldsText(
  fields: readonly FieldShape[],
  documentLocalized: boolean,
  open: Set<FieldShape[]>
): boolean {
  return fields.some(child => {
    // A field inside saying it is not translated, a container or a component among them, holds
    // no language's text.
    if (child.localized === false) return false;
    if (isComponent(child)) {
      return componentFieldLists(child).some(list => {
        if (open.has(list)) return false;
        open.add(list);
        const holds = levelHoldsText(list, documentLocalized, open);
        open.delete(list);
        return holds;
      });
    }
    if (isContainer(child)) {
      return levelHoldsText(childrenOf(child), documentLocalized, open);
    }
    return translated(child, documentLocalized);
  });
}

/** Whether a copied value has something to copy (an empty one would blank the target). */
function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One row (or a group's value): `current` with the text `source` holds laid on it. */
function textOntoLevel(
  current: Record<string, unknown>,
  source: Record<string, unknown>,
  fields: readonly FieldShape[],
  documentLocalized: boolean
): Record<string, unknown> {
  let out = { ...current };
  for (const child of fields) {
    // A group with no name lays its fields out at this level.
    if (child.type === "group" && !child.name) {
      out = textOntoLevel(out, source, childrenOf(child), documentLocalized);
    } else if (child.name) {
      const value = fieldTextFrom(
        out[child.name],
        source[child.name],
        child,
        documentLocalized
      );
      if (value !== undefined) out[child.name] = value;
    }
  }
  return out;
}

/**
 * One named field's value with its text taken from `source`'s: a component's instances and a
 * container's rows matched by id, a translated value replaced where the source has one.
 * `undefined` where the field keeps its value.
 */
function fieldTextFrom(
  current: unknown,
  source: unknown,
  field: FieldShape,
  documentLocalized: boolean
): unknown {
  if (field.localized === false) return undefined;
  if (isComponent(field)) {
    return componentTextFrom(current, source, field, documentLocalized);
  }
  if (isContainer(field)) {
    return holdsTranslatedText(field, documentLocalized)
      ? withTextFrom(current, source, field, documentLocalized)
      : undefined;
  }
  return translated(field, documentLocalized) && present(source)
    ? source
    : undefined;
}

/**
 * A component's value inside a row, with the text its fields translate taken from `source`: each
 * instance from the source instance with the same id (a list), or the one instance where it is
 * the same one (a single: `sameInstance`), read by the fields of the component it is.
 */
function componentTextFrom(
  current: unknown,
  source: unknown,
  field: FieldShape,
  documentLocalized: boolean
): unknown {
  const onto = (
    instance: Record<string, unknown>,
    from: Record<string, unknown>
  ) =>
    componentFieldLists(field, instance).reduce(
      (out, fields) => textOntoLevel(out, from, fields, documentLocalized),
      instance
    );
  if (Array.isArray(current)) {
    if (!Array.isArray(source)) return current;
    const byKey = keyedRows(source);
    const keys = rowKeys(current);
    return current.map((instance, index) => {
      const key = keys[index];
      const from = key === undefined ? undefined : byKey.get(key);
      return isRecord(instance) && from ? onto(instance, from) : instance;
    });
  }
  return isRecord(current) && isRecord(source) && sameInstance(current, source)
    ? onto(current, source)
    : current;
}

/**
 * Whether a single component's value here and in the source are the same instance: the same
 * component type, and the same id where both carry one. An instance changed to another component,
 * or replaced, takes nothing from the one the source holds.
 */
function sameInstance(
  current: Record<string, unknown>,
  source: Record<string, unknown>
): boolean {
  if (readFieldGroupType(current) !== readFieldGroupType(source)) return false;
  return (
    current.id === undefined ||
    source.id === undefined ||
    current.id === source.id
  );
}

/**
 * `current`, a container's value in the language being edited, with the text inside it taken from
 * `source`, the same container in another language: each row's text from the source row with the
 * same id, the rows, their order and their shared values as they are. A row the source does not
 * hold keeps its own text; a source value that is empty never blanks it.
 */
export function withTextFrom(
  current: unknown,
  source: unknown,
  field: unknown,
  documentLocalized: boolean
): unknown {
  const shape = field as FieldShape;
  if (shape.localized === false) return current;
  const fields = childrenOf(shape);
  if (shape.type === "group") {
    return isRecord(current) && isRecord(source)
      ? textOntoLevel(current, source, fields, documentLocalized)
      : current;
  }
  if (!Array.isArray(current) || !Array.isArray(source)) return current;
  const byKey = keyedRows(source);
  const keys = rowKeys(current);
  return current.map((row, index) => {
    const key = keys[index];
    const from = key === undefined ? undefined : byKey.get(key);
    return isRecord(row) && from
      ? textOntoLevel(row, from, fields, documentLocalized)
      : row;
  });
}

/**
 * The value `source` holds for the field at `path` (a form path such as `slides.1.caption`) of
 * `target`, the form being edited: each repeater row on the way is matched by its id, so a row
 * the translator moved or inserted takes the text of the same row in the source, never the row
 * that happens to sit at its position there. A row with no unique id has no source row: storage
 * keeps its text shared, so it has no text of the source's own to take (`rowKeys`).
 */
export function sourceValueAt(
  source: unknown,
  target: unknown,
  path: string
): unknown {
  let from: unknown = source;
  let at: unknown = target;
  for (const segment of path.split(".")) {
    const index = /^\d+$/.test(segment) ? Number(segment) : undefined;
    if (index !== undefined && Array.isArray(at)) {
      const row: unknown = at[index];
      from = sourceRowFor(from, at, index);
      at = row;
    } else {
      from = isRecord(from) ? from[segment] : undefined;
      at = isRecord(at) ? at[segment] : undefined;
    }
  }
  return from;
}

/**
 * The row of `rows` (the source's list) that the form's row at `index` of `formRows` is: the one
 * under its key ({@link rowKeys}). `undefined` where `rows` is no list, or the form's row has no
 * key.
 */
function sourceRowFor(
  rows: unknown,
  formRows: readonly unknown[],
  index: number
): unknown {
  if (!Array.isArray(rows)) return undefined;
  const key = rowKeys(formRows)[index];
  return key === undefined ? undefined : keyedRows(rows).get(key);
}

/**
 * The key each row of a list keeps its translations under, by the rule storage keeps it
 * (`rowKeys` in nextly's shared structure): its id, a non-empty string, or a finite number by its
 * text. A row with no such id, or whose id an earlier row already holds, has none: storage keeps
 * its text shared, so nothing is copied into it.
 */
function rowKeys(rows: readonly unknown[]): (string | undefined)[] {
  const taken = new Set<string>();
  return rows.map(row => {
    const id = isRecord(row) ? row.id : undefined;
    const key =
      typeof id === "string"
        ? id === ""
          ? undefined
          : id
        : typeof id === "number" && Number.isFinite(id)
          ? String(id)
          : undefined;
    if (key === undefined || taken.has(key)) return undefined;
    taken.add(key);
    return key;
  });
}

/** The rows of `rows` that have a key ({@link rowKeys}), by it. */
function keyedRows(
  rows: readonly unknown[]
): Map<string, Record<string, unknown>> {
  const keys = rowKeys(rows);
  const byKey = new Map<string, Record<string, unknown>>();
  rows.forEach((row, index) => {
    const key = keys[index];
    if (key !== undefined && isRecord(row)) byKey.set(key, row);
  });
  return byKey;
}
