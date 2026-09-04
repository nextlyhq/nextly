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

import { Link } from "@admin/components/ui/link";
import type { WidgetSlot } from "@admin/types/dashboard/widgets";

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
  text: string;
  muted: boolean;
} {
  if (!slot) return { text: "…", muted: true };
  if (!slot.ok) return { text: "—", muted: true };
  if (slot.result.op !== "count") return { text: "—", muted: true };
  return { text: slot.result.total.toLocaleString(), muted: false };
}

export const statsBody: CellsBody = (definition, slotFor: CellSlotLookup) => {
  const cells = definition.cells ?? [];
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
          const { text, muted } = cellValue(slotFor(cell.key));
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
                    // The number is the target, and the accessible name says
                    // where it goes -- "1,204" alone tells a screen-reader user
                    // nothing about what activating it does.
                    aria-label={cell.link.label}
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
