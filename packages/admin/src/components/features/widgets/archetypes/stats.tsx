/**
 * The `stats` archetype: several labelled numbers, each one a link.
 *
 * The card exists to NAVIGATE. A dashboard number that cannot be acted on is
 * decoration -- the reader learns there are fourteen drafts and still has to go
 * and find them -- so each cell that declares a link is rendered as one, and the
 * number itself is the target rather than a chevron beside it.
 *
 * @module components/features/widgets/archetypes/stats
 */

import type { ReactNode } from "react";

import { Link } from "@admin/components/ui/link";
import type { WidgetSlot } from "@admin/types/dashboard/widgets";

import { CountValue, countLabel } from "./count-value";
import type { ArchetypeAccepts, CellsBody, CellSlotLookup } from "./types";

/** A stats card is its cells, so a declaration without them draws nothing. */
export const statsAccepts: ArchetypeAccepts = definition => {
  if (definition.cells?.length) return undefined;
  const name = definition.title ?? "This stats widget";
  return `"${name}" is drawn from cells, and this widget declares none.`;
};

/**
 * What one cell shows, from its slot.
 *
 * 🔴 Each cell resolves INDEPENDENTLY. One number failing or still loading must
 * not blank the other five: the card's value is the comparison between them,
 * and a reader who can see four of six numbers is better served than one who
 * sees an error box. The same refusal `metric` makes is made per cell -- a
 * result that is not a `count` is a declaration bug and reads as one -- rather
 * than coercing `items.length`, which would invent a number capped at the
 * query's limit.
 */
function cellValue(slot: WidgetSlot | undefined): {
  text: ReactNode;
  muted: boolean;
  /** The spoken form, present only when there is a real number to speak. */
  spoken?: string;
} {
  if (!slot) return { text: "…", muted: true };
  if (!slot.ok) return { text: "—", muted: true };
  if (slot.result.op !== "count") return { text: "—", muted: true };
  // 🔴 Through the shared renderer, so a cell cannot present as exact a count
  // its source reported as a floor. Formatting `total` alone here is what let
  // one query render `2,000+` on a metric card and `2,000` in a stats cell.
  return {
    text: (
      <CountValue total={slot.result.total} atLeast={slot.result.atLeast} />
    ),
    muted: false,
    spoken: countLabel(slot.result.total, slot.result.atLeast),
  };
}

export const statsBody: CellsBody = (definition, slotFor: CellSlotLookup) => {
  const cells = definition.cells ?? [];

  // 🔴 Every cell settled and every one refused is a FAILED card, not a
  // successful one drawn as dashes. Partial success is the reason this body
  // renders what it has -- but when there is nothing to show, reporting `ok`
  // makes the grid count the card as updated, stamp it with a fresh time
  // (the HTTP batch did succeed) and announce success, while the reader sees a
  // row of dashes and no error anywhere. The distinguishing case is ALL cells
  // failing; one survivor is still a card worth drawing.
  const answered = cells.map(cell => slotFor(cell.key));
  const settled = answered.filter(slot => slot !== undefined);
  if (
    cells.length > 0 &&
    settled.length === cells.length &&
    settled.every(slot => !slot?.ok)
  ) {
    return {
      ok: false,
      message:
        settled[0]?.ok === false
          ? settled[0].error
          : `"${definition.title}" could not read any of its numbers.`,
    };
  }

  if (cells.length === 0) {
    return {
      ok: false,
      message: `"${definition.title}" is drawn from cells, and this widget declares none.`,
    };
  }

  return {
    ok: true,
    node: (
      // `auto-fit` rather than a fixed column count: the same card carries three
      // numbers for one collection and six for another, and a fixed grid would
      // leave the three-cell card with three empty columns.
      <dl
        data-testid="widget-stats"
        className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-4"
      >
        {cells.map(cell => {
          const { text, muted, spoken } = cellValue(slotFor(cell.key));
          const value = (
            <span
              // `tabular-nums` for the reason `metric` uses it: the grid
              // refetches on focus, and proportional digits reflow the whole
              // number when they change.
              className="text-2xl font-bold leading-none tabular-nums tracking-tight"
            >
              {text}
            </span>
          );
          return (
            <div key={cell.key} className="flex flex-col gap-1">
              <dd
                className={muted ? "text-muted-foreground" : "text-foreground"}
              >
                {cell.link ? (
                  <Link
                    href={cell.link.href}
                    // 🔴 The NUMBER as well as the destination. An
                    // `aria-label` replaces the element's descendants as its
                    // accessible name, so naming only the destination meant a
                    // screen reader announced "Draft posts" and neither the
                    // count nor, when the count was a floor, that it was one.
                    // The label still ends with the destination, because
                    // "1,204" alone says nothing about what activating it does.
                    aria-label={
                      spoken ? `${spoken}, ${cell.link.label}` : cell.link.label
                    }
                    className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {value}
                  </Link>
                ) : (
                  value
                )}
              </dd>
              <dt className="text-xs font-medium text-muted-foreground">
                {cell.label}
              </dt>
            </div>
          );
        })}
      </dl>
    ),
  };
};
