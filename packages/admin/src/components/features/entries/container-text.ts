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

/** What these read of a field. */
interface FieldShape {
  type?: string;
  name?: string;
  localized?: boolean;
  fields?: unknown;
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
  return childrenOf(shape).some(
    child =>
      holdsTranslatedText(child, documentLocalized) ||
      translated(child, documentLocalized)
  );
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
