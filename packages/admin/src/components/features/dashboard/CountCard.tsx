"use client";

import type { CountWidgetData } from "nextly/core-widget-data";
import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { cn } from "@admin/lib/utils";

import { countLabel } from "../widgets/archetypes/count-value";
import { FrameState } from "../widgets/frame/card-state";
import { CardFigure } from "../widgets/frame/figure";
import { cardNumber } from "../widgets/frame/format";

import {
  changeSentence,
  collectionLabelOf,
  countView,
  type CountLineView,
  type CountPart,
} from "./count-card-model";

/** What the Count card is handed: its declaration's props, with the data its `load` answers. */
export type CountCardProps = Omit<DeclaredComponentProps, "data"> & {
  data: CountWidgetData;
};

/** The label's and the line's text: small and quiet, under and over the number. */
const QUIET = "text-[12.5px] leading-[1.45] text-muted-foreground";

/** A number written whole, in the admin's locale: "12,480", never "12.5k". */
function whole(value: number): string {
  return cardNumber(value, { tier: "medium" }).text;
}

/**
 * Count: what it counts, the number, then one line under it, the same at every width. The
 * number is written whole and large enough to read at a glance, from 0 to tens of thousands,
 * and links to the list it counts; the line is the change this week by default, or the trend
 * over the last 8 weeks, the split by status, or nothing, each about the same set as the number.
 * The frame drew loading, no permission and error before this is reached.
 */
export const CountCard: React.FC<CountCardProps> = ({ data, settings }) => {
  const view = countView(data, settings);
  // Named in the number's accessible name, as the frame's title names it, so
  // two Count cards for different collections can be told apart aloud.
  const subject = collectionLabelOf(settings, useBranding().widgetSources);

  // A card set to no collection: the frame's one "not available" state.
  if (view.state === "unavailable") {
    return <FrameState state={{ kind: "no-access" }} />;
  }
  const spoken =
    data.counted === "people"
      ? `${view.label}: ${countLabel(view.total)}`
      : `${view.label} in ${subject ?? ""}: ${countLabel(view.total)}`;
  const number = (
    <Link
      href={view.href}
      className="block w-fit whitespace-nowrap rounded-sm text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] tabular-nums text-foreground hover:underline"
      aria-label={spoken}
    >
      <CardFigure value={view.total} tier="medium" />
    </Link>
  );

  return (
    <div className="flex min-w-0 flex-col" data-testid="count-card">
      <p className={QUIET} data-testid="count-label">
        {view.label}
      </p>
      {view.line.kind === "trend" ? (
        <div className="flex items-end justify-between gap-3">
          {number}
          <TrendLine values={view.line.values} />
        </div>
      ) : (
        number
      )}
      <CountLine line={view.line} />
    </div>
  );
};

/** The one line under the number, as its data answered it. */
function CountLine({ line }: { line: CountLineView }) {
  switch (line.kind) {
    case "change":
      return (
        <p className={cn(QUIET, "mt-1")} data-testid="count-change">
          {changeSentence(line.change, whole)}
        </p>
      );
    case "trend":
      return (
        <p className={cn(QUIET, "mt-1")} data-testid="count-trend">
          Last 8 weeks
          <span className="sr-only">
            {`: from ${whole(line.values[0] ?? 0)} to ${whole(line.values.at(-1) ?? 0)}`}
          </span>
        </p>
      );
    case "split":
      return <StatusSplit line={line} />;
    default:
      return null;
  }
}

/** The number over the last 8 weeks, as a line ending at now: drawn, and said beside it. */
function TrendLine({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;
  const top = Math.max(...values);
  const bottom = Math.min(...values);
  const range = top - bottom || 1;
  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * 80,
    // A flat line sits in the middle rather than on the floor.
    y: top === bottom ? 15 : 26 - ((value - bottom) / range) * 22,
  }));
  const last = points.at(-1);
  return (
    <svg
      width="80"
      height="30"
      viewBox="-2 0 84 30"
      aria-hidden="true"
      className="mb-1 shrink-0 text-foreground"
      data-testid="count-trend-line"
    >
      <polyline
        points={points
          .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
          .join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {last === undefined ? null : (
        <circle cx={last.x} cy={last.y} r="2.6" fill="currentColor" />
      )}
    </svg>
  );
}

/** One part of the split: its colour in the bar and its dot in the legend. */
const SPLIT_TONE = {
  published: "bg-success-solid",
  draft: "bg-muted-foreground",
  scheduled: "bg-info-solid",
} as const;

/**
 * The split by status: a thin bar of the published and draft entries, and a legend whose every
 * part links to the list holding exactly it. What scheduled releases will publish is a legend
 * entry alone: those entries are already published or drafts, so a third segment would count
 * them twice.
 */
function StatusSplit({
  line,
}: {
  line: Extract<CountLineView, { kind: "split" }>;
}) {
  const parts: {
    key: keyof typeof SPLIT_TONE;
    word: string;
    part: CountPart;
  }[] = [
    { key: "published", word: "published", part: line.published },
    { key: "draft", word: "draft", part: line.draft },
    ...(line.scheduled === undefined || line.scheduled.count === 0
      ? []
      : [
          {
            key: "scheduled" as const,
            word: "scheduled",
            part: line.scheduled,
          },
        ]),
  ];
  // The two statuses that partition the number; scheduled overlaps them.
  const statuses = parts.filter(({ key }) => key !== "scheduled");
  const sum = statuses.reduce((total, { part }) => total + part.count, 0);
  return (
    <div data-testid="count-split">
      {sum === 0 ? null : (
        <div
          className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-[3px]"
          aria-hidden="true"
          data-testid="count-split-bar"
        >
          {statuses
            .filter(({ part }) => part.count > 0)
            .map(({ key, part }) => (
              <span
                key={key}
                data-part={key}
                className={cn("block", SPLIT_TONE[key])}
                style={{ flexGrow: part.count }}
              />
            ))}
        </div>
      )}
      <ul className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
        {parts.map(({ key, word, part }) => (
          <li key={key}>
            <Link
              href={part.href}
              className="inline-flex min-h-6 items-center gap-1.5 rounded-sm hover:text-foreground hover:underline"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  SPLIT_TONE[key]
                )}
              />
              {`${whole(part.count)} ${word}`}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
