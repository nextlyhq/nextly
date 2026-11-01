/**
 * The dashboard header's summary line, worded: each part the reader has
 * something in, in a fixed order, with the card it names and the list it
 * opens when that card is not on the dashboard.
 *
 * Pure, so each wording and each combination is tested without a render. The
 * reader's own clock decides "today" and "tomorrow".
 *
 * @module components/features/dashboard/header/summary-wording
 */

import { adminHref, ROUTES } from "@admin/constants/routes";
import type {
  DashboardSummary,
  DashboardSummaryPart,
} from "@admin/types/dashboard/summary";

/** The widgets whose cards the attention and releases parts name. */
const ATTENTION_WIDGET = "core/needs-attention";
const RELEASES_WIDGET = "core/upcoming-releases";

/** One part of the line, as a link. */
export interface SummaryLinePart {
  key: string;
  text: string;
  /** The widget whose card the part names, followed to when it is on the dashboard. */
  widget: string;
  /**
   * The very card the part names, where the server named one: the card of a
   * widget placed more than once that is shown to the reader, which need not
   * be its first.
   */
  card?: string;
  /** Where the part goes when that card is not on the dashboard. */
  href?: string;
}

/**
 * The line: the parts, or "You're all caught up" when every part was read and
 * none has anything, or nothing at all when some part could not be read and
 * none has anything, since "caught up" would then be a guess.
 */
export type SummaryLine =
  | { kind: "parts"; parts: SummaryLinePart[] }
  | { kind: "caught-up" }
  | { kind: "none" };

const ORDER: Record<DashboardSummaryPart["kind"], number> = {
  attention: 0,
  releases: 1,
  widget: 2,
};

export function summaryLine(summary: DashboardSummary, now: Date): SummaryLine {
  const parts = [...summary.parts]
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
    .map(part => linePart(part, now));
  if (parts.length > 0) return { kind: "parts", parts };
  return summary.failed === 0 ? { kind: "caught-up" } : { kind: "none" };
}

/** A count as drawn: a floor reads "N+". */
function counted(count: number, atLeast: true | undefined): string {
  return atLeast ? `${count}+` : String(count);
}

/** A count and its noun, singular only for exactly one: a floor of one is "1+ things". */
function countOf(
  part: { count: number; atLeast?: true },
  singular: string,
  plural: string
): string {
  const one = part.count === 1 && !part.atLeast;
  return `${counted(part.count, part.atLeast)} ${one ? singular : plural}`;
}

type PartOf<K extends DashboardSummaryPart["kind"]> = Extract<
  DashboardSummaryPart,
  { kind: K }
>;

function attentionPart(part: PartOf<"attention">): SummaryLinePart {
  const href = part.link === undefined ? undefined : adminHref(part.link);
  return {
    key: "attention",
    text: `${countOf(part, "thing needs", "things need")} you`,
    widget: ATTENTION_WIDGET,
    ...(href === undefined ? {} : { href }),
  };
}

function releasesPart(part: PartOf<"releases">, now: Date): SummaryLinePart {
  return {
    key: "releases",
    text: `${countOf(part, "release", "releases")} ${whenDue(new Date(part.nearest), now)}`,
    widget: RELEASES_WIDGET,
    href: ROUTES.RELEASES,
  };
}

function linePart(part: DashboardSummaryPart, now: Date): SummaryLinePart {
  switch (part.kind) {
    case "attention":
      return attentionPart(part);
    case "releases":
      return releasesPart(part, now);
    case "widget":
      return {
        key: `widget:${part.widget}`,
        text: `${counted(part.count, part.atLeast)} ${part.label}`,
        widget: part.widget,
        card: part.card,
      };
  }
}

/** The soonest release's day, on the reader's own calendar. */
function whenDue(nearest: Date, now: Date): "today" | "tomorrow" | "this week" {
  const day = (at: Date) =>
    new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const days = Math.round((day(nearest) - day(now)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  return days === 1 ? "tomorrow" : "this week";
}
