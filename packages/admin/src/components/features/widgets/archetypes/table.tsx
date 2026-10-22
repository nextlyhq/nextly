/**
 * The `table` archetype: a few rows across named columns.
 *
 * The COLUMNS come from the result, not from the declaration, and that is the
 * whole difference between this archetype and reading `select` directly. A
 * field can carry its own `access.read` rule, and the server strips a denied
 * field from every row before selection runs — so it answers with the columns
 * that actually survived the read (`WidgetResult.fields`). Heading a table from
 * `query.select` would draw a column no row can fill and print the label of a
 * field this reader may not see.
 *
 * Each heading is the source's own label for the field, falling back to the
 * field name. `publishedAt` is a poor heading and "Published at" is the string
 * the entry form already puts above that field, so the two agree by
 * construction rather than by a second declaration that could drift.
 *
 * @module components/features/widgets/archetypes/table
 */

import { declaredAnswerFields, selectsNothing } from "./cell-text";
import { TieredRows } from "./tiered-rows";
import type { ArchetypeAccepts, ArchetypeBody } from "./types";

/** A table is drawn from selected fields, exactly as a list is. */
export const tableAccepts: ArchetypeAccepts = definition => {
  const select = definition.query?.select ?? [];
  if (select.length > 0) return undefined;
  return selectsNothing(definition.title, "table", "column");
};

export const tableBody: ArchetypeBody = (result, definition) => {
  if (result.op !== "list") {
    return {
      ok: false,
      message: `"${definition.title}" expected a table of rows, but the query returned a ${result.op}.`,
    };
  }

  if (result.items.length === 0) {
    // The frame's one empty state, worded for a table. Source-neutral: the card may read any
    // collection's, system's or plugin's data, so it names no kind of row it cannot know.
    return {
      ok: true,
      empty: {
        title: "Nothing here yet",
        detail: "Rows appear here once something matches this card.",
      },
    };
  }

  // A card core answered on the server describes its own rows: the rows are its
  // data function's own answer, so they are not ones a query heading could
  // misname (`declaredAnswerFields`).
  const columns =
    definition.serverData === true
      ? declaredAnswerFields(result)
      : (result.fields ?? []);
  if (columns.length === 0) {
    // Rows arrived and nothing described them. A declaration with no `select`
    // never reaches here -- `tableAccepts` refuses it before the query runs --
    // so this is a server that answered without column descriptions, and the
    // tempting fallback is the one thing that must not happen: heading the
    // table from `query.select` would undo the access filtering the server
    // applied and print the labels of fields this reader may not see.
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
        detailField={columns[1]?.name}
        query={definition.query}
      />
    ),
  };
};
