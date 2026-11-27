/**
 * The value at a dotted path into a stored document, the one way every
 * reader of a field named by its path (a structured data detail, the field
 * a type's pages are named from) reads it. Pure, and importing only the
 * plain-value checks, so any module can take it without a cycle.
 *
 * @module value-path
 */
import { isRecord } from "./plain-values";

/**
 * The value at a dotted path, such as `event.venue`, in `document`: a
 * field's name, or a path into its groups; nothing where a step is missing.
 */
export function valueAtPath(
  document: Readonly<Record<string, unknown>>,
  path: string
): unknown {
  let value: unknown = document;
  for (const part of path.split(".")) {
    if (!isRecord(value)) return undefined;
    value = value[part];
  }
  return value;
}
