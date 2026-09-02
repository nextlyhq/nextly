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

import { asText, selectsNothing } from "./cell-text";
import type { ArchetypeAccepts, ArchetypeBody } from "./types";

/**
 * How many rows a card of this size can show before it stops being a glance.
 *
 * Lower than a list's, because each row here is wider and a table that scrolls
 * inside a dashboard card is a table nobody reads. The footer link is how a
 * reader gets to the rest.
 */
const MAX_ROWS = 5;

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
    return {
      ok: true,
      node: (
        <p
          data-testid="widget-table-empty"
          className="text-sm text-muted-foreground"
        >
          Nothing yet.
        </p>
      ),
    };
  }

  const columns = result.fields ?? [];
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

  const rows = result.items.slice(0, MAX_ROWS);

  return {
    ok: true,
    node: (
      // Scrolls in its own container rather than widening the card: a dashboard
      // grid cell has a fixed span, and a table that pushes past it takes the
      // whole row's layout with it.
      <div className="min-w-0 overflow-x-auto">
        <table data-testid="widget-table" className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {columns.map(column => (
                <th
                  key={column.name}
                  scope="col"
                  data-testid="widget-table-heading"
                  className="whitespace-nowrap pb-1 pr-4 text-left text-xs font-medium text-muted-foreground last:pr-0"
                >
                  {/* The source's label when it has one. A field name is a
                      poor heading, but it is true, which an invented one
                      would not be. */}
                  {column.label ?? column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr
                // The index, because a widget's rows have no identity core can
                // rely on: `select` need not include a key, and two rows may be
                // identical in the fields it did select. The body is replaced
                // wholesale on every refetch and nothing in it is stateful, so
                // there is no state for a wrong key to strand.
                key={index}
                data-testid="widget-table-row"
                // Full-strength `border-border`, matching this table's own
                // header rule above and the resting edge every other admin
                // surface draws. The half-alpha variant measured 1.11:1 against
                // the card, which is not a lighter separator but an absent one.
                //
                // NOT a 3:1 claim, and the earlier wording here saying a row
                // rule "has to meet" that floor was wrong on this repository's
                // own reading of the standard. `styles/contrast/pairings.ts`
                // excludes this token deliberately: 1.4.11 scopes its 3:1
                // minimum to information required to IDENTIFY a component, and
                // a table whose rows are identified by their content and
                // spacing needs no rule to be operable. Measured from
                // `theme.css`, the token sits at ~1.27:1 light and ~1.28:1
                // dark, so a comment promising 3:1 would send the next reader
                // to darken one table out of step with all 189 files using it.
                className="border-b border-border last:border-0"
              >
                {columns.map(column => (
                  <td
                    key={column.name}
                    className="max-w-[12rem] truncate py-1 pr-4 text-foreground last:pr-0"
                  >
                    {/* An em dash rather than an empty cell, so the grid of
                        cells stays legible and a missing value is visibly a
                        missing value. */}
                    {asText(item[column.name]) ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  };
};
