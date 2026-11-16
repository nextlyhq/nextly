/**
 * The `list` archetype: a few rows, each a line of text.
 *
 * WHICH field a row shows is taken from the answer: the fields the widget's
 * `load` answered its rows with (`declaredAnswerFields`), in order. The first
 * titles the row, a field of choices (a status) sits at its end, and the
 * others join the meta line under the title, up to three of them.
 *
 * Read from the answer rather than declared beside it, because the rows are
 * the declaration's own answer, read through reads already bound to this
 * reader: a second list of fields could name one the answer does not carry.
 *
 * @module components/features/widgets/archetypes/list
 */

import { declaredAnswerFields, rowsOrInstead } from "./cell-text";
import { answerTotal, TieredRows } from "./tiered-rows";
import type { ArchetypeBody } from "./types";

export const listBody: ArchetypeBody = (answer, definition) => {
  const result = rowsOrInstead(answer, definition.title, {
    expected: "a list",
    rows: "Items",
  });
  if (!("op" in result)) return result;

  // The fields the answer's rows are drawn by (`declaredAnswerFields`); the
  // first titles each row, the rest are its meta and trailing fields.
  const select = declaredAnswerFields(result).map(field => field.name);
  const [labelField] = select;
  if (!labelField) {
    // Rows with no field at all: the widget's `load` answered rows with
    // nothing in them to draw, which no declaration check could have seen
    // before it ran.
    return {
      ok: false,
      message: `"${definition.title}" answered rows with no fields to draw.`,
    };
  }

  return {
    ok: true,
    node: (
      <TieredRows
        items={result.items}
        // The columns the SOURCE said survived the read, each with its declared kind and
        // value labels, so each cell is presented rather than printed. An answer that describes
        // no columns at all is drawn by the fields its first row carries, as plain text under
        // their names. They also head the large tier's table.
        columns={result.fields ?? select.map(name => ({ name }))}
        labelField={labelField}
        total={answerTotal(result)}
      />
    ),
  };
};
