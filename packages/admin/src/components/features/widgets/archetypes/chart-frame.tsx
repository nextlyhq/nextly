/**
 * The chrome every core-drawn chart shares: a labelled graphic and its table.
 *
 * A chart is a picture of numbers, and a picture is not readable by everyone
 * looking at the card. Two things carry the same data, and both are needed
 * because neither replaces the other:
 *
 * - The SVG is `role="img"` with a `<title>` and a `<desc>`, so a screen reader
 *   announces WHAT the chart shows and its headline shape instead of walking
 *   into a bag of unlabelled `<path>` elements. `role="img"` also prunes the
 *   children from the accessibility tree, which is the point: the shapes are
 *   decoration once the text alternative exists.
 * - The DISCLOSURE holds the real numbers as an HTML table, which is the only
 *   form that can be navigated cell by cell, compared, and copied.
 *
 * The table is behind a disclosure rather than always shown so a dashboard of
 * several cards stays scannable — a 30-point window would otherwise add thirty
 * rows under one chart. That is a presentation choice and not an access one:
 * `<details>` is operated identically by a mouse, a keyboard and a screen
 * reader, so nobody is asked to take a longer route to the numbers. The `<desc>`
 * is what keeps the chart itself meaningful while the table is closed.
 *
 * `role="img"` and not `role="application"`, which is what the popular chart
 * libraries emit: `application` puts a screen reader into forms mode and hands
 * every keystroke to a widget that has no keyboard interface to receive them.
 *
 * @module components/features/widgets/archetypes/chart-frame
 */

import { useId, type ReactNode } from "react";

/**
 * One row behind a chart: its identity, its label, and its number.
 *
 * `key` is kept APART from `label` because a grouped column holds arbitrary
 * strings, so no label is safe to identify a row by. A bucket whose value is
 * literally the placeholder text would share a React key with the null bucket,
 * and two rows under one key is a reconciliation defect rather than a cosmetic
 * one — React keeps one of them and the counts stop belonging to the rows they
 * are drawn beside.
 */
export interface ChartRow {
  /** Unique within one result, derived from the bucket rather than its text. */
  key: string;
  label: string;
  count: number;
  /**
   * What a placeholder row is ANNOUNCED as, when it stands in for a value.
   *
   * Present only for a row whose label names the absence of a value rather than
   * a value. Styling alone was not enough and reads as if it were: italic and
   * muted separate the null bucket from a stored `(none)` on screen, and a
   * screen reader announces both as "(none)" — so the readers who most need the
   * distinction were the ones not given it.
   *
   * Spoken as a description instead — "no value stored" — which is a different
   * utterance from any label a column is likely to hold. Not a guarantee: no
   * string can be reserved from a column of arbitrary text, so a stored value
   * spelled exactly like this description would still coincide. That case is
   * accepted rather than papered over; what is fixed is that the placeholder
   * now says what it is instead of relying on a colour.
   */
  announce?: string;
}

export interface ChartFrameProps {
  /** What the chart shows, announced in place of the shapes. */
  title: string;
  /** The headline the picture makes, in words. Read after the title. */
  description: string;
  /** Heading for the label column of the table. */
  labelHeading: string;
  /** The rows behind the picture, in the order they are drawn. */
  rows: ReadonlyArray<ChartRow>;
  /** Said above the table when the series is not the whole answer. */
  note?: string;
  /**
   * The graphic, handed the ids it must reference AND the strings they hold.
   *
   * The text comes back through this callback rather than being composed again
   * inside the graphic: written twice, the two drifted on their first outing —
   * one pluralised a single bucket as "categories" and the frame did not — so
   * the caption and the chart's own description described the same data
   * differently.
   */
  children: (chart: {
    titleId: string;
    descId: string;
    title: string;
    description: string;
  }) => ReactNode;
}

export function ChartFrame({
  title,
  description,
  labelHeading,
  rows,
  note,
  children,
}: ChartFrameProps) {
  const base = useId();
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      {children({ titleId, descId, title, description })}

      {/* A cap is DISCLOSED rather than silently applied. A chart drawn from a
          capped set is not the whole picture, and a reader comparing bars has
          no way to tell unless the card says so. */}
      {note ? (
        <p className="text-xs leading-tight text-muted-foreground">{note}</p>
      ) : null}

      <details className="group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          {/* Rotated with the disclosure's own open state rather than with
              React state, so the marker cannot disagree with the element. */}
          <span
            aria-hidden="true"
            className="transition-transform group-open:rotate-90"
          >
            ▸
          </span>
          View as table
        </summary>
        {/* Its own scroll container: a long window must not make the card the
            thing that scrolls sideways. */}
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-border">
                <th
                  scope="col"
                  className="py-1 pr-2 text-left font-medium text-muted-foreground"
                >
                  {labelHeading}
                </th>
                <th
                  scope="col"
                  className="py-1 text-right font-medium text-muted-foreground"
                >
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              {/* The separator token at full strength, matching the shared table
                  primitive every other table already uses. Drawn at half alpha
                  it was a call-site variant the contrast suite flags: faint
                  alpha borders are what that guard polices, and this one
                  measured 1.11:1 against the page surface.

                  Full strength is NOT a claim that the line clears 3:1 —
                  `theme.css` records `--nx-border` as deliberately below that
                  minimum to keep the palette's light border weight, and
                  `contrast/accepted.ts` is where those pairings are held. What
                  this fixes is a one-off that was both fainter than the token
                  and inconsistent with every other table in the product. */}
              {rows.map(row => (
                <tr key={row.key} className="border-b border-border">
                  {/* A row header, so a screen reader announces which row a
                      number belongs to when reading the count cell. */}
                  <th
                    scope="row"
                    className={
                      row.announce
                        ? "py-1 pr-2 text-left font-normal italic text-muted-foreground"
                        : "py-1 pr-2 text-left font-normal text-foreground"
                    }
                  >
                    {row.announce ? (
                      <>
                        {/* The drawn text is hidden from the reader and the
                            spoken one from the screen, so the row has ONE name
                            in each medium rather than both read in sequence. */}
                        <span aria-hidden="true">{row.label}</span>
                        <span className="sr-only">{row.announce}</span>
                      </>
                    ) : (
                      row.label
                    )}
                  </th>
                  <td className="py-1 text-right tabular-nums text-foreground">
                    {row.count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
