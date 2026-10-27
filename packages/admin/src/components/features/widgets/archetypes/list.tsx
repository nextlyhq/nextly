/**
 * The `list` archetype: a few rows, each a line of text.
 *
 * WHICH field a row shows is taken from the query's `select`, in order: the
 * first selected field titles the row, a field of choices (a status) sits at its
 * end, and the others join the meta line under the title, up to three of them.
 *
 * Derived from `select` rather than declared separately, because a second
 * declaration would be a second answer to one question — the author has already
 * said which fields this widget is about, and a `list: { primary, secondary }`
 * block could disagree with it. It also means the widget cannot display a field
 * it did not ask the server for, which keeps the card honest about its own
 * query.
 *
 * A `list` widget that selects NOTHING is refused by name rather than guessed
 * at. Without `select` the rows carry whatever the collection happens to hold,
 * so core would be picking a key out of a document it knows nothing about — and
 * the field it picked would change the day someone added a column.
 *
 * @module components/features/widgets/archetypes/list
 */

import { MAX_META_FIELDS } from "../frame/entity-row";

import {
  declaredAnswerFields,
  rowsOrInstead,
  selectsNothing,
} from "./cell-text";
import { answerTotal, TieredRows } from "./tiered-rows";
import type { ArchetypeAccepts, ArchetypeBody } from "./types";

/**
 * A list needs to know which field heads each row, and only `select` says.
 *
 * Judged from the DECLARATION, before any request is made. The same refusal
 * used to arrive only after the query had run: the grid batched the widget
 * because its archetype had a renderer, the server performed an unprojected
 * read and shipped whole documents to the browser, and the card then threw them
 * away to print this sentence -- on every mount and every window focus.
 */
export const listAccepts: ArchetypeAccepts = definition => {
  const select = definition.query?.select ?? [];
  if (select.length > 0) return undefined;
  return selectsNothing(definition.title, "list", "row");
};

/**
 * How many of a list card's selected fields this renderer draws below the large tier: the
 * title and a meta line of up to three.
 *
 * 🔴 Declared because the number is otherwise invisible at the only place it
 * matters -- the card DECLARATION, in another package. Below the large tier
 * (where the rows become a table with every column) a field past these is not
 * extra information: it is dropped in silence, and the card looks finished
 * while answering a narrower question than it was written to answer. Two
 * shipped cards did exactly that, one of them omitting the timestamp from a
 * card sorted by time.
 *
 * `listAccepts` cannot enforce it. Selecting too many fields is not a REFUSAL --
 * the card draws correctly, just not everything asked for -- and turning it into
 * one would blank a dashboard over what is a declaration mistake. So the check
 * belongs where declarations are reviewed, and this constant is what it reads.
 */
export const LIST_RENDERED_FIELDS: number = 1 + MAX_META_FIELDS;

export const listBody: ArchetypeBody = (answer, definition) => {
  const result = rowsOrInstead(answer, definition.title, {
    expected: "a list",
    rows: "Items",
  });
  if (!("op" in result)) return result;

  // A card core answered on the server has no query: its answer says which
  // fields it is drawn by (`declaredAnswerFields`).
  const select =
    definition.serverData === true
      ? declaredAnswerFields(result).map(field => field.name)
      : (definition.query?.select ?? []);
  // The first selected field titles each row; the rest are its meta and trailing fields.
  const [labelField] = select;
  if (!labelField) {
    // A card core answered whose rows carry no field at all: its data function
    // answered rows with nothing in them to draw, which no declaration check
    // could have seen before it ran.
    if (definition.serverData === true) {
      return {
        ok: false,
        message: `"${definition.title}" answered rows with no fields to draw.`,
      };
    }
    // Unreachable through the grid, which declines this declaration before it
    // batches. Kept because a body must be safe to call on its own -- a test,
    // or a future caller that has a result in hand -- and because the sentence
    // is one thing said in one place.
    return { ok: false, message: listAccepts(definition) ?? "" };
  }

  return {
    ok: true,
    node: (
      <TieredRows
        items={result.items}
        // The columns the SOURCE said survived the read, each with its declared kind and
        // value labels, so each cell is presented rather than printed. A source that describes
        // no columns at all is drawn by the fields the card selected, as plain text under their
        // names, which the card's own declaration already holds. Where a source does describe
        // its columns, only those are drawn: a selected field it left out is one this reader
        // may not see. They also head the large tier's table.
        columns={result.fields ?? select.map(name => ({ name }))}
        labelField={labelField}
        query={definition.query}
        total={answerTotal(result)}
      />
    ),
  };
};
