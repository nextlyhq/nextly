"use client";

import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AlertCircle, AlertTriangle } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { EntityRow, ENTITY_LEADING_CLASS } from "../widgets/frame/entity-row";
import { LIST_ROW_HEIGHT_CLASS } from "../widgets/frame/geometry";
import { useCardTitleCount } from "../widgets/frame/title-count";
import { useRevealedWhileViewed } from "../widgets/hidden-while-empty";

import { AttentionReleaseNames } from "./AttentionReleaseNames";
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
 * The card draws every item, as tall as they are: an item is one kind of
 * waiting work, not a document, so there are few of them and no list page to
 * send the rest to, and nothing is folded behind "Show N more". The title
 * carries how many items there are ("Needs your attention 2"). Its rows are
 * drawn at the default density.
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
  useCardTitleCount(rows.length);
  const arrival = useArrivalAnnouncement(
    useRevealedWhileViewed(placementId),
    rows.length
  );
  return (
    <div className="grid min-w-0 gap-2" data-testid="needs-attention">
      {/* min-w-0 down the grid: a grid item is otherwise as wide as its unwrapped text, which
          pushed the Review button out of a narrow card instead of cutting the reason line. */}
      <ul className="grid min-w-0 divide-y divide-border">
        {rows.map(row => (
          <li
            key={row.id}
            className="min-w-0"
            data-testid="needs-attention-item"
          >
            <AttentionItem row={row} refreshing={refreshing} retry={retry} />
            {/* A stopped or overdue release row names those releases, so the
                card says which as well as how many. */}
            {row.releases !== undefined && (
              <AttentionReleaseNames reason={row.releases} />
            )}
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">
        {arrival}
      </p>
    </div>
  );
};

NeedsAttention.displayName = "NeedsAttention";

/**
 * One item's row: its severity, label and count, why it is waiting and its Review, or, for an
 * item whose count failed, "Not all checked" with a Retry.
 */
function AttentionItem({
  row,
  refreshing,
  retry,
}: {
  row: AttentionRow;
  refreshing: boolean;
  retry: () => void;
}) {
  if (row.failed) {
    return <UncheckedItem row={row} refreshing={refreshing} retry={retry} />;
  }
  return (
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
  );
}

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
 * cannot tell red from amber still can: critical is "!" in a circle, warning
 * "!" in a triangle, each in its status's solid colour. Its name is said in
 * words to assistive technology.
 */
function SeverityMark({ severity }: { severity: AttentionSeverity }) {
  const Icon = severity === "critical" ? AlertCircle : AlertTriangle;
  return (
    <span
      data-testid={`needs-attention-${severity}`}
      className={cn(
        "flex items-center justify-center",
        ENTITY_LEADING_CLASS.default
      )}
    >
      <Icon
        aria-hidden="true"
        data-testid="needs-attention-mark"
        className={cn(
          "size-5",
          severity === "critical" ? "text-danger-solid" : "text-warning-solid"
        )}
      />
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
