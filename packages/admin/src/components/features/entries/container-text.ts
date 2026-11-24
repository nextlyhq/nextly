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
  if (!isContainer(shape)) return false;
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
      continue;
    }
    if (!child.name) continue;
    if (isComponent(child)) {
      out[child.name] = componentTextFrom(
        out[child.name],
        source[child.name],
        child,
        documentLocalized
      );
      continue;
    }
    if (isContainer(child)) {
      if (holdsTranslatedText(child, documentLocalized)) {
        out[child.name] = withTextFrom(
          out[child.name],
          source[child.name],
          child,
          documentLocalized
        );
      }
      continue;
    }
    if (translated(child, documentLocalized) && present(source[child.name])) {
      out[child.name] = source[child.name];
    }
  }
  return out;
}

/**
 * A component's value inside a row, with the text its fields translate taken from `source`: each
 * instance from the source instance with the same id (a list), or the one instance (a single),
 * read by the fields of the component it is.
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
    const byId = new Map<unknown, Record<string, unknown>>();
    for (const instance of source) {
      if (isRecord(instance) && instance.id !== undefined) {
        byId.set(instance.id, instance);
      }
    }
    return current.map(instance => {
      if (!isRecord(instance)) return instance;
      const from = byId.get(instance.id);
      return from ? onto(instance, from) : instance;
    });
  }
  return isRecord(current) && isRecord(source)
    ? onto(current, source)
    : current;
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
  const fields = childrenOf(shape);
  if (shape.type === "group") {
    return isRecord(current) && isRecord(source)
      ? textOntoLevel(current, source, fields, documentLocalized)
      : current;
  }
  if (!Array.isArray(current) || !Array.isArray(source)) return current;
  const byId = new Map<unknown, Record<string, unknown>>();
  for (const row of source) {
    if (isRecord(row) && row.id !== undefined) byId.set(row.id, row);
  }
  return current.map(row => {
    if (!isRecord(row)) return row;
    const from = byId.get(row.id);
    return from ? textOntoLevel(row, from, fields, documentLocalized) : row;
  });
}

/**
 * The value `source` holds for the field at `path` (a form path such as `slides.1.caption`) of
 * `target`, the form being edited: each repeater row on the way is matched by its id, so a row
 * the translator moved or inserted takes the text of the same row in the source, never the row
 * that happens to sit at its position there. A row with no id is matched by position.
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
      const id = isRecord(row) ? row.id : undefined;
      from = Array.isArray(from)
        ? id !== undefined
          ? from.find(candidate => isRecord(candidate) && candidate.id === id)
          : from[index]
        : undefined;
      at = row;
      continue;
    }
    from = isRecord(from) ? from[segment] : undefined;
    at = isRecord(at) ? at[segment] : undefined;
  }
  return from;
}
