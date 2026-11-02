"use client";

import { Button } from "@nextlyhq/ui";
import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AlertTriangle } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { EntityRow, ENTITY_LEADING_CLASS } from "../widgets/frame/entity-row";
import { useRowFold } from "../widgets/frame/fold";
import { CardFooterContent } from "../widgets/frame/footer-slot";
import { LIST_ROW_HEIGHT_CLASS } from "../widgets/frame/geometry";
import { useCardTitleCount } from "../widgets/frame/title-count";
import { useRevealedWhileViewed } from "../widgets/hidden-while-empty";

import {
  attentionRows,
  type AttentionRow,
  type AttentionSeverity,
} from "./needs-attention-model";

/**
 * Needs your attention: the open work waiting for this reader, one row per
 * item of the attention digest, most urgent first.
 *
 * A declared widget's view: the frame draws loading, error and the empty card
 * (which leaves the dashboard, so the card never says "All clear"), and this
 * draws the items `load` answered. Each row leads with its severity, by shape
 * as well as colour, then the item's label and count, why it is waiting, and
 * one Review. An item whose count failed says "Not all checked" with a Retry
 * that asks the card again, so a reader is never told all is well while
 * something went unread. Nothing here dismisses an item: it leaves when the
 * work it counts is done.
 *
 * The card never scrolls: it draws the rows its height holds and folds the
 * rest, the least urgent, behind "Show N more", which grows the card in place
 * until "Show less" (`useRowFold`). That control sits in the card's footer,
 * whose room the frame keeps for every card, so the rows have the whole body.
 * The title carries how many items there are ("Needs your attention 2").
 *
 * A card that joins the dashboard while the reader is on it (hidden at first,
 * then found with something waiting) says how many items arrived, politely,
 * so a reader looking elsewhere on the page learns of them.
 */
export const NeedsAttention: React.FC<DeclaredComponentProps> = ({
  data,
  refreshing,
  retry,
  placementId,
}) => {
  const rows = useMemo(() => attentionRows(data), [data]);
  const fold = useRowFold(rows.length);
  useCardTitleCount(rows.length);
  const arrival = useArrivalAnnouncement(
    useRevealedWhileViewed(placementId),
    rows.length
  );
  const listId = useId();
  const listRef = useRef<HTMLUListElement | null>(null);
  // The rows the reader's "Show N more" revealed, while they are shown: focus
  // moves to the first of them, and the live region says how many.
  const [revealed, setRevealed] = useState<{
    from: number;
    count: number;
  } | null>(null);
  useEffect(() => {
    if (!fold.expanded || revealed === null) return;
    listRef.current
      ?.querySelectorAll<HTMLElement>("[data-fold-row]")
      [revealed.from]?.focus();
  }, [fold.expanded, revealed]);

  const toggle = () => {
    setRevealed(
      fold.expanded
        ? null
        : { from: fold.shown, count: rows.length - fold.shown }
    );
    fold.toggle();
  };

  return (
    <div
      ref={fold.listRef}
      className="grid min-w-0 gap-2"
      data-testid="needs-attention"
    >
      {/* min-w-0 down the grid: a grid item is otherwise as wide as its unwrapped text, which
          pushed the Review button out of a narrow card instead of cutting the reason line. */}
      <ul
        id={listId}
        ref={listRef}
        className="grid min-w-0 divide-y divide-border"
      >
        {rows.slice(0, fold.shown).map(row => (
          // Focusable from script only, so "Show N more" can move focus to
          // the first row it revealed.
          <li
            key={row.id}
            data-fold-row
            tabIndex={-1}
            className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="needs-attention-item"
          >
            {row.failed ? (
              <UncheckedItem row={row} refreshing={refreshing} retry={retry} />
            ) : (
              <EntityRow
                density="default"
                leading={<SeverityMark severity={row.severity} />}
                title={row.title}
                spoken={`${severityName(row.severity)}: ${row.spoken}`}
                meta={row.reason === undefined ? [] : [row.reason]}
                {...(row.href === undefined
                  ? {}
                  : {
                      action: {
                        label: "Review",
                        href: row.href,
                        spoken: `Review ${lowerFirst(row.label)}`,
                      },
                    })}
              />
            )}
          </li>
        ))}
      </ul>
      {fold.hasControl && (
        <CardFooterContent>
          <Button
            ref={fold.controlRef}
            variant="ghost"
            size="sm"
            aria-expanded={fold.expanded}
            aria-controls={listId}
            onClick={toggle}
          >
            {fold.expanded
              ? "Show less"
              : `Show ${rows.length - fold.shown} more`}
          </Button>
        </CardFooterContent>
      )}
      <p className="sr-only" aria-live="polite">
        {fold.expanded && revealed !== null
          ? `${revealed.count} more ${revealed.count === 1 ? "item" : "items"} shown`
          : arrival}
      </p>
    </div>
  );
};

NeedsAttention.displayName = "NeedsAttention";

/**
 * What the card says once, after it is drawn, when it joined the dashboard while the reader was
 * on it: how many items need them. Set after the first paint, into a live region already on the
 * page, which is what makes assistive technology read it; empty for a card drawn from the start.
 */
function useArrivalAnnouncement(revealed: boolean, count: number): string {
  const [said, setSaid] = useState("");
  const announced = useRef(false);
  useEffect(() => {
    if (!revealed || count === 0 || announced.current) return;
    announced.current = true;
    setSaid(
      `${count} ${count === 1 ? "item needs" : "items need"} your attention`
    );
  }, [revealed, count]);
  return said;
}

/** A severity's name, as assistive technology hears it before the row. */
function severityName(severity: AttentionSeverity): string {
  return severity === "critical" ? "Critical" : "Warning";
}

/** A label as it reads inside a sentence: "Review overdue releases". */
function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * An item's severity, told apart by shape as well as colour, so a reader who
 * cannot tell red from amber still can: critical is "!" in a filled circle,
 * warning "!" in a triangle. Its name is said in words to assistive technology.
 */
function SeverityMark({ severity }: { severity: AttentionSeverity }) {
  return (
    <span
      data-testid={`needs-attention-${severity}`}
      className={cn(
        "flex items-center justify-center",
        ENTITY_LEADING_CLASS.default
      )}
    >
      {severity === "critical" ? (
        <span
          aria-hidden="true"
          className="flex size-5 items-center justify-center rounded-full bg-destructive-solid text-xs font-bold text-destructive-foreground"
        >
          !
        </span>
      ) : (
        <AlertTriangle aria-hidden="true" className="size-5 text-warning" />
      )}
      <span className="sr-only">{severityName(severity)}</span>
    </span>
  );
}

/**
 * An item whose count could not be read: its label, then "Not all checked"
 * and Retry, which asks the card again. Drawn in a list row's shape, with
 * Retry outside any link, so it is a button of its own to a keyboard and to
 * assistive technology. While the card is asked again Retry keeps its place
 * and its focus, and does nothing more until the answer comes.
 */
function UncheckedItem({
  row,
  refreshing,
  retry,
}: {
  row: AttentionRow;
  refreshing: boolean;
  retry: () => void;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2.5",
        LIST_ROW_HEIGHT_CLASS.default
      )}
    >
      <SeverityMark severity={row.severity} />
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="truncate text-sm font-medium text-foreground">
          {row.label}
        </span>
        <span
          className="flex items-center gap-1 text-xs text-muted-foreground"
          data-testid="needs-attention-unchecked"
        >
          Not all checked
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            aria-label={`Retry ${lowerFirst(row.label)}`}
            aria-disabled={refreshing}
            onClick={() => {
              if (!refreshing) retry();
            }}
          >
            Retry
          </button>
        </span>
      </span>
    </div>
  );
}
