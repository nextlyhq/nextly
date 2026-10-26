"use client";

import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";
import { useMemo } from "react";

import { Link } from "@admin/components/ui/link";

import { CountValue, countLabel } from "../widgets/archetypes/count-value";
import { CardFigure } from "../widgets/frame/figure";
import {
  CardEmpty,
  CardError,
  CardSkeleton,
  CardUnavailable,
} from "../widgets/frame/states";
import { useCardTier } from "../widgets/frame/tier";

import {
  attentionTotal,
  attentionView,
  type AttentionKindRow,
} from "./needs-attention-model";

/**
 * Needs attention: what is waiting for this reader, one row per kind, each
 * linking to exactly what it counts.
 *
 * Drawn from the card's own slot, which the dashboard batch fills. Only kinds
 * with something waiting are shown, a kind whose lists were not all read says
 * so, and "All clear" only when nothing is waiting in any list read; a reader
 * who may read none of the kinds is told the card is not available to them
 * rather than that all is clear. Floors read "N+", and "N or more" aloud.
 *
 * By the card's own width: small draws the total and a short link per kind,
 * medium a row per kind, and large breaks each kind down per collection.
 */
export const NeedsAttention: React.FC<WidgetComponentProps> = ({ slot }) => {
  const tier = useCardTier() ?? "medium";
  // Built once per answer, so a "this week" link keeps the week it was drawn
  // with rather than moving on every render.
  const view = useMemo(() => attentionView(slot, Date.now()), [slot]);

  if (view.state === "loading") return <CardSkeleton shape="rows" />;
  if (view.state === "unavailable") return <CardUnavailable />;
  if (view.state === "error") {
    return <CardError title="Needs attention" message={view.message} />;
  }
  if (view.state === "clear") {
    return <CardEmpty title="All clear" detail="Nothing is waiting for you." />;
  }
  if (tier === "small") return <SmallAttention kinds={view.kinds} />;
  return (
    <ul className="grid gap-1" data-testid="needs-attention">
      {view.kinds.map(kind => (
        <KindRow key={kind.kind} kind={kind} breakdown={tier === "large"} />
      ))}
    </ul>
  );
};

/** The total, then each kind as a short link with its count. */
function SmallAttention({ kinds }: { kinds: AttentionKindRow[] }) {
  const total = attentionTotal(kinds);
  return (
    <div className="grid gap-2" data-testid="needs-attention">
      <span
        className="text-2xl font-semibold tabular-nums tracking-tight text-foreground leading-none"
        data-testid="needs-attention-total"
      >
        <CardFigure value={total.count} floor={total.atLeast} tier="small" />
      </span>
      <ul className="grid gap-1">
        {kinds.map(kind => (
          <li key={kind.kind}>
            <KindLink kind={kind} tier="small" />
            {kind.href === undefined && kind.parts.length > 0 && (
              <SmallParts kind={kind} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How many of a kind's lists the small card links inline before "+N more". */
const SMALL_PARTS = 2;

/**
 * A kind spread over several lists, at the small tier: its largest lists as
 * short inline links, then how many more there are, so the kind still leads
 * somewhere and the line cannot wrap.
 */
function SmallParts({ kind }: { kind: AttentionKindRow }) {
  const shown = kind.parts.slice(0, SMALL_PARTS);
  const more = kind.parts.length - shown.length;
  return (
    <p
      className="flex items-center gap-1.5 truncate px-2 text-xs text-muted-foreground"
      data-testid={`needs-attention-${kind.kind}-parts`}
    >
      {shown.map((part, index) => (
        <span key={part.key} className="flex items-center gap-1.5">
          {index > 0 && <span aria-hidden="true">·</span>}
          <Link
            href={part.href}
            className="hover:text-foreground hover:underline"
            aria-label={`${part.label}: ${countLabel(part.count, part.atLeast)}`}
          >
            {part.label}{" "}
            <CountValue
              total={part.count}
              atLeast={part.atLeast}
              tier="small"
            />
          </Link>
        </span>
      ))}
      {more > 0 && <span>+{more} more</span>}
    </p>
  );
}

/** A kind's name and count, linking to its one list when it has one. */
function KindLink({ kind, tier }: { kind: AttentionKindRow; tier?: "small" }) {
  const className =
    "flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm text-muted-foreground";
  if (kind.unchecked) {
    // Nothing found, but some lists went unread: no number to show, and no
    // list holds what was not read. Said in words, and in full aloud.
    return (
      <div
        className={className}
        data-testid={`needs-attention-${kind.kind}-unchecked`}
      >
        <span className="truncate">{kind.label}</span>
        <span aria-hidden="true">Not all checked</span>
        <span className="sr-only">Not all lists were checked</span>
      </div>
    );
  }
  const body = (
    <>
      <span className="truncate">{kind.label}</span>
      <span className="tabular-nums text-foreground">
        <CountValue total={kind.count} atLeast={kind.atLeast} tier={tier} />
      </span>
    </>
  );
  if (kind.href === undefined) return <div className={className}>{body}</div>;
  return (
    <Link
      href={kind.href}
      className={`${className} hover-subtle-row hover:text-foreground`}
      aria-label={`${kind.label}: ${countLabel(kind.count, kind.atLeast)}`}
    >
      {body}
    </Link>
  );
}

/** One kind, and at the large tier each collection's or Single's share of it. */
function KindRow({
  kind,
  breakdown,
}: {
  kind: AttentionKindRow;
  breakdown: boolean;
}) {
  // A kind spread over several lists has no one link, so at the medium tier its
  // parts are still offered, or the row would lead nowhere.
  const showParts =
    kind.parts.length > 0 && (breakdown || kind.href === undefined);
  return (
    <li data-testid={`needs-attention-${kind.kind}`}>
      <KindLink kind={kind} />
      {showParts && (
        <ul className="ml-3 grid gap-0.5 border-l border-border pl-2">
          {kind.parts.map(part => (
            <li key={part.key}>
              <Link
                href={part.href}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-xs text-muted-foreground hover-subtle-row hover:text-foreground"
                aria-label={`${part.label}: ${countLabel(part.count, part.atLeast)}`}
              >
                <span className="truncate">{part.label}</span>
                <span className="tabular-nums">
                  <CountValue total={part.count} atLeast={part.atLeast} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
