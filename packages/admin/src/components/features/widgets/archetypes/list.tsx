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

import { asText, selectsNothing } from "./cell-text";
import type { ArchetypeAccepts, ArchetypeBody } from "./types";

/** How many rows a card of this size can show without becoming a table. */
const MAX_ROWS = 5;

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
 * How many of a list card's selected fields this renderer actually draws.
 *
 * 🔴 Declared because the number is otherwise invisible at the only place it
 * matters -- the card DECLARATION, in another package. A row is a label and a
 * detail, so a third selected field is not extra information: it is dropped in
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

  const select = definition.query?.select ?? [];
  // Keep in step with LIST_RENDERED_FIELDS: this destructure IS the number that
  // constant declares, and a third name here without raising it would let a
  // card select a field the guard still calls undrawable.
  const [labelField, detailField] = select;
  if (!labelField) {
    // Unreachable through the grid, which declines this declaration before it
    // batches. Kept because a body must be safe to call on its own -- a test,
    // or a future caller that has a result in hand -- and because the sentence
    // is one thing said in one place.
    return { ok: false, message: listAccepts(definition) ?? "" };
  }

  if (result.items.length === 0) {
    return {
      ok: true,
      node: (
        <p
          data-testid="widget-list-empty"
          className="text-sm text-muted-foreground"
        >
          Nothing yet.
        </p>
      ),
    };
  }

  const rows = result.items.slice(0, MAX_ROWS);

  return {
    ok: true,
    node: (
      <ul data-testid="widget-list" className="flex flex-col gap-2">
        {rows.map((item, index) => {
          const label = asText(item[labelField]);
          const detail = detailField ? asText(item[detailField]) : undefined;
          return (
            <li
              // The index, because a widget's rows have no identity core can
              // rely on: `select` need not include a key, and two rows may be
              // identical in the fields it did select. The list is replaced
              // wholesale on every refetch and nothing in it is stateful or
              // reorderable, so there is no state for a wrong key to strand.
              key={index}
              data-testid="widget-list-row"
              className="flex min-w-0 flex-col gap-0.5"
            >
              <span className="truncate text-sm text-foreground">
                {/* An em dash rather than an empty line, so a row whose label
                    is absent or unprintable still occupies its place and the
                    count of rows matches the count of results. */}
                {label ?? "—"}
              </span>
              {detail !== undefined && (
                <span className="truncate text-xs text-muted-foreground">
                  {detail}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    ),
  };
};
