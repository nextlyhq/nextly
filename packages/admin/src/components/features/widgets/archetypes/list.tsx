/**
 * The `list` archetype: a few rows, each a line of text.
 *
 * WHICH field a row shows is taken from the query's `select`, in order: the
 * first selected field is the row's label and the second, when there is one, is
 * the muted line under it. Everything after that is ignored.
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

import { declaredAnswerFields, selectsNothing } from "./cell-text";
import { TieredRows } from "./tiered-rows";
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
 * How many of a list card's selected fields this renderer draws below the large tier.
 *
 * 🔴 Declared because the number is otherwise invisible at the only place it
 * matters -- the card DECLARATION, in another package. A row is a label and a
 * detail, so below the large tier (where the rows become a table with every
 * column) a third selected field is not extra information: it is dropped in
 * silence, and the card looks finished while answering a narrower question than
 * it was written to answer. Two shipped cards did exactly that, one of them
 * omitting the timestamp from a card sorted by time.
 *
 * `listAccepts` cannot enforce it. Selecting too many fields is not a REFUSAL --
 * the card draws correctly, just not everything asked for -- and turning it into
 * one would blank a dashboard over what is a declaration mistake. So the check
 * belongs where declarations are reviewed, and this constant is what it reads.
 */
export const LIST_RENDERED_FIELDS = 2;

export const listBody: ArchetypeBody = (result, definition) => {
  if (result.op !== "list") {
    return {
      ok: false,
      message: `"${definition.title}" expected a list, but the query returned a ${result.op}.`,
    };
  }

  if (result.items.length === 0) {
    // Before the fields are read: a card core answered on the server names its
    // fields by its first row, and an answer with no rows is empty, not one
    // that names nothing to draw.
    // The frame's one empty state, worded for a list. Source-neutral: the card may read any
    // collection's, system's or plugin's data, so it names no kind of row it cannot know.
    return {
      ok: true,
      empty: {
        title: "Nothing here yet",
        detail: "Items appear here once something matches this card.",
      },
    };
  }

  // A card core answered on the server has no query: its answer says which
  // fields it is drawn by (`declaredAnswerFields`).
  const select =
    definition.serverData === true
      ? declaredAnswerFields(result).map(field => field.name)
      : (definition.query?.select ?? []);
  // Keep in step with LIST_RENDERED_FIELDS: this destructure IS the number that
  // constant declares, and a third name here without raising it would let a
  // card select a field the guard still calls undrawable.
  const [labelField, detailField] = select;
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
        // value labels, so each cell is presented rather than printed; a column it does not
        // describe falls back to plain text. They also head the large tier's table.
        columns={result.fields ?? []}
        labelField={labelField}
        detailField={detailField}
        query={definition.query}
      />
    ),
  };
};
