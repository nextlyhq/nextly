"use client";

/**
 * "View as table" under a chart: a disclosure that swaps the chart for a table of the same values,
 * inside the card, and back.
 *
 * The table is the widget kit's own (`Widget.Table`), so it reads as every list and table card
 * reads: rows on a narrow card, a table of its columns on a wide one, as many as the card holds
 * with "N more" for the rest. Each value is written by the card's one figure (`CardFigure`), as
 * the chart's tooltips and its visually hidden table write it, a floor as "N+".
 *
 * The disclosure is a button, reached by Tab and pressed with Enter or Space, that says whether it
 * is open (`aria-expanded`) and names the table it opens (`aria-controls`). Escape anywhere inside
 * it closes the table and puts focus back on the button, so a keyboard reader is never left on
 * nothing.
 *
 * 🔴 The chart's own visually hidden table is not this one and stays where it is: it is always
 * there for assistive technology, while this one is there only on request.
 *
 * @module components/features/widgets/charts/chart-table-disclosure
 */

import { ChevronDown } from "lucide-react";
import {
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type { ChartRow } from "../archetypes/chart-frame";
import { CardFigure } from "../frame/figure";
import { WidgetTable } from "../kit/list";

export interface ChartTableDisclosureProps {
  /** The chart, drawn while the table is closed. */
  chart: ReactNode;
  /** What the first column holds, as the chart's own table heads it ("Status", "Interval"). */
  labelHeading: string;
  /** One row per value the chart draws, in the chart's order, each with its count. */
  rows: readonly ChartRow[];
}

/** The disclosure's button: a quiet text control under the chart, in the card's own tokens. */
const DISCLOSURE_CLASS =
  "inline-flex w-fit items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

export function ChartTableDisclosure({
  chart,
  labelHeading,
  rows,
}: ChartTableDisclosureProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const tableId = useId();

  // Escape closes the table wherever focus is inside the disclosure, and hands focus back to the
  // button that opened it. Only an open table answers it, so Escape still reaches whatever else
  // listens while the chart is shown.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open || event.key !== "Escape") return;
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
      onKeyDown={onKeyDown}
    >
      {open ? (
        <div
          id={tableId}
          className="min-h-0 min-w-0 flex-1"
          data-testid="chart-disclosed-table"
        >
          <WidgetTable
            rows={rows}
            titleLabel={labelHeading}
            title={row => row.label}
            // The row's spoken name where its drawn text reads badly aloud, as the chart's own
            // table says it ("no value stored" for "(none)").
            spoken={row => row.announce}
            columns={[
              {
                key: "count",
                label: "Count",
                value: row => (
                  <CardFigure value={row.count} floor={row.floor} />
                ),
                place: "trailing",
                align: "end",
              },
            ]}
          />
        </div>
      ) : (
        chart
      )}
      <button
        ref={button}
        type="button"
        className={DISCLOSURE_CLASS}
        aria-expanded={open}
        {...(open ? { "aria-controls": tableId } : {})}
        onClick={() => setOpen(current => !current)}
      >
        View as table
        <ChevronDown
          aria-hidden="true"
          className={open ? "h-3 w-3 rotate-180" : "h-3 w-3"}
        />
      </button>
    </div>
  );
}
