"use client";

import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";
import { useContext, useMemo } from "react";

import { Link } from "@admin/components/ui/link";

import { CountValue, countLabel } from "../widgets/archetypes/count-value";
import { FrameState } from "../widgets/frame/card-state";
import { EntityRow } from "../widgets/frame/entity-row";
import { CardFigure } from "../widgets/frame/figure";
import { LIST_ROW_HEIGHT_PX, listBodyHeight } from "../widgets/frame/list-rows";
import { CardHeightContext, useCardTier } from "../widgets/frame/tier";

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
  // The room the card's body has, which every kind's row and as many parts as fit share.
  const bodyPx = listBodyHeight({ tier, h: useContext(CardHeightContext) });
  // Built once per answer, so a "this week" link keeps the week it was drawn
  // with rather than moving on every render.
  const view = useMemo(() => attentionView(slot, Date.now()), [slot]);

  if (view.state === "loading") {
    return (
      <FrameState state={{ kind: "loading", skeleton: { shape: "rows" } }} />
    );
  }
  if (view.state === "unavailable") {
    return <FrameState state={{ kind: "no-access" }} />;
  }
  if (view.state === "error") {
    return <FrameState state={{ kind: "error", message: view.message }} />;
  }
  if (view.state === "clear") {
    return (
      <FrameState
        state={{
          kind: "empty",
          empty: { title: "All clear", detail: "Nothing is waiting for you." },
        }}
      />
    );
  }
  if (tier === "small") return <SmallAttention kinds={view.kinds} />;
  const shown = partsShown(view.kinds, tier === "large", bodyPx);
  return (
    <ul className="grid" data-testid="needs-attention">
      {view.kinds.map((kind, index) => (
        <KindRow key={kind.kind} kind={kind} partsShown={shown[index] ?? 0} />
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

/**
 * A kind's name and count as one row of the dashboard's list layout, leading to its one list
 * when it has one.
 */
function KindLink({ kind, tier }: { kind: AttentionKindRow; tier?: "small" }) {
  if (kind.unchecked) {
    // Nothing found, but some lists went unread: no number to show, and no
    // list holds what was not read. Said in words, and in full aloud.
    return (
      <div data-testid={`needs-attention-${kind.kind}-unchecked`}>
        <EntityRow
          density="default"
          title={kind.label}
          trailing={
            <>
              <span aria-hidden="true">Not all checked</span>
              <span className="sr-only">Not all lists were checked</span>
            </>
          }
        />
      </div>
    );
  }
  return (
    <EntityRow
      density="default"
      title={kind.label}
      // Said as a sentence, so the count is not run into the label: "Overdue releases: 3".
      spoken={`${kind.label}: ${countLabel(kind.count, kind.atLeast)}`}
      href={kind.href}
      trailing={
        <span className="tabular-nums text-foreground">
          <CountValue total={kind.count} atLeast={kind.atLeast} tier={tier} />
        </span>
      }
    />
  );
}

/**
 * How many of each kind's parts the card draws: a row for every kind first, so no kind is ever
 * cut, then parts in the kinds' order while whole compact rows still fit the body. A card never
 * scrolls, so a part with no room is left out rather than drawn past the card's edge.
 *
 * Parts are each collection's or Single's share of a kind: every kind's at the large tier, and a
 * kind's spread over several lists at any tier, which has no one link of its own.
 */
function partsShown(
  kinds: readonly AttentionKindRow[],
  breakdown: boolean,
  bodyPx: number
): number[] {
  const kindRows = kinds.length * LIST_ROW_HEIGHT_PX.default;
  let room = Math.floor(
    Math.max(0, bodyPx - kindRows) / LIST_ROW_HEIGHT_PX.compact
  );
  return kinds.map(kind => {
    const wanted = breakdown || kind.href === undefined ? kind.parts.length : 0;
    const given = Math.min(wanted, room);
    room -= given;
    return given;
  });
}

/** One kind, and the parts of it the card has room for (`partsShown`). */
function KindRow({
  kind,
  partsShown: shown,
}: {
  kind: AttentionKindRow;
  partsShown: number;
}) {
  const showParts = shown > 0;
  return (
    <li data-testid={`needs-attention-${kind.kind}`}>
      <KindLink kind={kind} />
      {showParts && (
        <ul className="ml-3 border-l border-border pl-2">
          {kind.parts.slice(0, shown).map(part => (
            <li key={part.key}>
              {/* A part is a row too, set compact under the kind it belongs to. */}
              <EntityRow
                density="compact"
                title={part.label}
                spoken={`${part.label}: ${countLabel(part.count, part.atLeast)}`}
                href={part.href}
                trailing={
                  <span className="tabular-nums">
                    <CountValue total={part.count} atLeast={part.atLeast} />
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
