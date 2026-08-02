import type { FieldDefinition } from "../../../schemas/dynamic-collections";

/**
 * State the width of a Schema Builder text field that does not state one itself.
 *
 * `getColumnDescriptor` reads an unstated width as the bounded kind, which renders `varchar(255)`
 * on MySQL. The generator the Builder's create path used before it moved onto the shared pipeline
 * read the same silence as unbounded `TEXT`. Both answers are defensible, but they are 255 and
 * 65 535 characters apart, so leaving the silence to be interpreted means a field created before
 * the move and an identical field created after it hold different amounts of text.
 *
 * Resolving it here rather than by changing the descriptor's default is deliberate: the default is
 * also what every code-first table was built with, and moving it would make those tables read as
 * drift and stop `nextly migrate` from applying anything. The two paths need different answers
 * because they have different histories, so the one that needs the non-default says so explicitly.
 *
 * A field that declares a width is returned untouched — that width is the author's answer, and the
 * descriptor renders it.
 *
 * Typed on `FieldDefinition` rather than on the create handlers' `FieldConfig`, because `options`
 * means different things in the two: here it holds the Builder's `variant`, while on a
 * `SelectFieldConfig` it holds the list of choices. The handlers annotate their payload as
 * `FieldConfig` but receive the Builder shape, which is why they already convert before reading it.
 */
export function withDeclaredTextWidth(
  fields: readonly FieldDefinition[]
): FieldDefinition[] {
  return fields.map(field => {
    if (field.type !== "text") return field;

    const statesWidth =
      field.options?.variant !== undefined ||
      field.length !== undefined ||
      field.validation?.maxLength !== undefined;
    if (statesWidth) return field;

    return {
      ...field,
      options: { ...field.options, variant: "long" as const },
    };
  });
}
