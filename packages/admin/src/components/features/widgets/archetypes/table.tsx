/**
 * The `table` archetype: a few rows across named columns.
 *
 * The COLUMNS come from the result, not from the declaration. A field can
 * carry its own `access.read` rule, and the server strips a denied field from
 * every row before the answer is built -- so the answer names the columns that
 * actually survived the read (`declaredAnswerFields`), and the table never
 * draws a column no row can fill or the label of a field this reader may not
 * see.
 *
 * Each heading is the source's own label for the field, falling back to the
 * field name. `publishedAt` is a poor heading and "Published at" is the string
 * the entry form already puts above that field, so the two agree by
 * construction rather than by a second declaration that could drift.
 *
 * @module components/features/widgets/archetypes/table
 */

import { declaredAnswerFields, rowsOrInstead } from "./cell-text";
import { answerTotal, TieredRows } from "./tiered-rows";
import type { ArchetypeBody } from "./types";

export const tableBody: ArchetypeBody = (answer, definition) => {
  const result = rowsOrInstead(answer, definition.title, {
    expected: "a table of rows",
    rows: "Rows",
  });
  if (!("op" in result)) return result;

  // The answer describes its own rows: they are the widget's `load`'s own
  // answer, so they are not ones a heading could misname (`declaredAnswerFields`).
  const columns = declaredAnswerFields(result);
  if (columns.length === 0) {
    // Rows arrived and nothing described them, not even their own keys: there
    // is no column to head the table with.
    return {
      ok: false,
      message: `"${definition.title}" received rows the server did not describe, so its columns cannot be named.`,
    };
  }

  return {
    ok: true,
    // A table is a list type: below the large tier it is drawn as a list, headed by its first
    // column with the second as its line of detail, because a table narrower than 700 px is a
    // table whose columns do not fit. At the large tier it is the table.
    node: (
      <TieredRows
        items={result.items}
        columns={columns}
        labelField={columns[0].name}
        total={answerTotal(result)}
      />
    ),
  };
};
