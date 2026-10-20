/**
 * A chart's values within reach of every reader: one tab stop, the arrow keys, a polite live
 * region, and a tooltip a pointer or the keyboard opens.
 *
 * The chart is ONE tab stop. Inside it the arrow keys move a current point (`chart-keys`), which
 * a polite live region reads and a tooltip shows; Escape dismisses the tooltip until the next
 * move or hover. A hovered mark shows its tooltip while the mark or the tooltip is under the
 * pointer, so the tooltip can be read and reached (WCAG 2.2 1.4.13), and leaving the chart hides
 * it.
 *
 * The focusable area WRAPS the chart's picture rather than sitting inside it: the picture is
 * `role="img"`, which hides its children from assistive tech, so a focusable element inside it
 * could never be reached.
 *
 * @module components/features/widgets/charts/chart-reach
 */

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { useKeyboardShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import { cn } from "@admin/lib/utils";

import { chartColour, type ChartSlot } from "./chart-colour";
import {
  clampPosition,
  firstPosition,
  inShape,
  moveInChart,
  type ChartPosition,
  type ChartShape,
} from "./chart-keys";

export interface ChartReach {
  /** The point the keyboard is on, while the chart has focus; `undefined` otherwise. */
  keyed: ChartPosition | undefined;
  /** The point whose tooltip shows, from the pointer or the keyboard; `undefined` for none. */
  shown: ChartPosition | undefined;
  /** A mark under the pointer. */
  hover: (at: ChartPosition) => void;
  /** Whether a tooltip the pointer opened shows, which Escape dismisses wherever focus is. */
  pointerTip: boolean;
  /** Hides the tooltip until the next move or hover. */
  dismiss: () => void;
  /** Props for the chart's one focusable area. */
  area: {
    tabIndex: 0;
    onFocus: () => void;
    onBlur: (event: FocusEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
  };
}

/** Whether two positions name the same point. */
function samePoint(
  a: ChartPosition | undefined,
  b: ChartPosition | undefined
): boolean {
  return a?.series === b?.series && a?.index === b?.index;
}

/** The keyboard and pointer state of one chart of `shape`. */
export function useChartReach(shape: ChartShape): ChartReach {
  const [position, setPosition] = useState<ChartPosition | undefined>();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState<ChartPosition | undefined>();
  // Escape hides the tooltip until the reader moves or hovers again.
  const [dismissed, setDismissed] = useState(false);

  // Read against the chart's shape as it is now, which can shrink under a saved position: the
  // keyboard's point moves to the nearest one left, and a hovered mark that is gone is forgotten
  // rather than moved onto a mark the pointer is not over.
  const at =
    (position === undefined ? undefined : clampPosition(position, shape)) ??
    firstPosition(shape);
  const hoverGone = hovered !== undefined && !inShape(hovered, shape);
  const hoveredNow = hoverGone ? undefined : hovered;
  // And forgotten for good: were the chart to grow back, the pointer is no longer over that mark.
  useEffect(() => {
    if (hoverGone) setHovered(undefined);
  }, [hoverGone]);
  const keyed = focused ? at : undefined;
  const shown = dismissed ? undefined : (hoveredNow ?? keyed);

  // A tooltip the pointer opened, which `ChartReachArea` lets Escape dismiss wherever focus is.
  const pointerTip = hoveredNow !== undefined && !dismissed;

  const hover = useCallback((next: ChartPosition) => {
    setHovered(current => (samePoint(current, next) ? current : next));
    setDismissed(false);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      if (shown) {
        event.preventDefault();
        setDismissed(true);
      }
      return;
    }
    if (!at) return;
    const next = moveInChart(at, event.key, shape);
    if (!next) return;
    event.preventDefault();
    setPosition(next);
    setHovered(undefined);
    setDismissed(false);
  };

  return {
    keyed,
    shown,
    hover,
    pointerTip,
    dismiss: () => setDismissed(true),
    area: {
      tabIndex: 0,
      onFocus: () => {
        setFocused(true);
        setDismissed(false);
      },
      onBlur: event => {
        // Focus moving within the chart is not focus leaving it.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setFocused(false);
      },
      onKeyDown,
      onPointerLeave: () => setHovered(undefined),
    },
  };
}

/**
 * The chart's one focusable area: named by what it shows and how to read it, described by the
 * chart's text alternative, and holding the polite live region that reads the current point.
 */
export function ChartReachArea({
  reach,
  name,
  describedBy,
  announcement,
  children,
}: {
  reach: ChartReach;
  name: string;
  describedBy: string;
  announcement: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={name}
      aria-describedby={describedBy}
      className="relative rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      {...reach.area}
    >
      {children}
      {reach.pointerTip ? <EscapeDismisses dismiss={reach.dismiss} /> : null}
      <span data-testid="chart-live" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

/**
 * Escape, bound while a tooltip the pointer opened shows, so it can be dismissed without moving
 * the pointer or focus (WCAG 2.2 1.4.13); a focused chart handles its own keys. Through the
 * admin's one shortcut owner, and mounted only while there is something to dismiss, so Escape is
 * the chart's for no longer than that and a chart drawn without the admin shell needs no owner
 * until it is hovered.
 */
function EscapeDismisses({ dismiss }: { dismiss: () => void }) {
  useKeyboardShortcuts(
    [
      {
        key: "Escape",
        action: dismiss,
        description: "Dismiss the chart's tooltip",
        // Wherever focus is, a text field included: the admin's default keeps a shortcut out of
        // a field, but Escape here only hides a tooltip, and a reader typing must be able to.
        whenTyping: true,
      },
    ],
    { name: "chart-tooltip" }
  );
  return null;
}

/** One line of a tooltip: the mark's colour, what it is, and its value as the table writes it. */
export interface ChartTooltipLine {
  key: string;
  slot: ChartSlot;
  name?: string;
  value: ReactNode;
}

/**
 * A mark's tooltip, on the popover surface. Hidden from assistive tech: the live region reads
 * the same point, and the table holds every value.
 */
export function ChartTooltip({
  title,
  lines,
  className,
  style,
}: {
  title: string;
  lines: readonly ChartTooltipLine[];
  /** Where it sits, as utility classes, for a place fixed by the layout. */
  className?: string;
  /** Where it sits, for a place set by the data. */
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      data-testid="chart-tooltip"
      className={cn(
        // As wide as its text, but never wider than the chart it sits in: a group's name or a
        // series' name is a stored value of any length, and wraps here as it does in the chart.
        "absolute z-10 flex w-max max-w-full flex-col gap-0.5 break-words rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm",
        className
      )}
      // design-lint-ok: placed beside the mark it describes.
      style={style}
    >
      <span className="min-w-0 font-medium">{title}</span>
      {lines.map(line => (
        <span key={line.key} className="flex items-center gap-1.5">
          <span
            data-testid="chart-tooltip-swatch"
            className="size-2 shrink-0 rounded-full"
            // design-lint-ok: the swatch IS the mark's chart colour.
            style={{ backgroundColor: chartColour(line.slot) }}
          />
          {line.name ? (
            <span className="min-w-0 text-muted-foreground">{line.name}</span>
          ) : null}
          <span className="font-medium tabular-nums">{line.value}</span>
        </span>
      ))}
    </div>
  );
}
