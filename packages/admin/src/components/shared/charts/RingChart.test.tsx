/**
 * The ring's segments are separated by something other than their colours.
 *
 * jsdom performs no layout, so nothing here can observe a gap on screen. What
 * it CAN observe is the cause: a wider under-stroke in the surface colour,
 * sharing the segment's dash geometry, drawn before it. Asserting the cause is
 * the only honest option — an assertion on the rendered geometry would pass
 * against a viewport that never laid anything out.
 *
 * @module components/shared/charts/RingChart.test
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RingChart, SEGMENT_SEPARATION } from "./RingChart";

const SEGMENTS = [
  { label: "Published", value: 3, color: "var(--nx-primary)" },
  { label: "Draft", value: 1, color: "var(--nx-chart-4)" },
];

const STROKE = 16;

function circlesFor(segments: typeof SEGMENTS, total: number) {
  const { container } = render(
    <RingChart segments={segments} total={total} strokeWidth={STROKE} />
  );
  // The first circle is the background track, which is not a segment.
  return [...container.querySelectorAll("circle")].slice(1);
}

describe("ring segment separation", () => {
  it("draws a surface-coloured separator under every segment", () => {
    // 🔴 Two arcs of a ring touch, so each is an adjacent colour of the other.
    // This ring's own pair measures 2.15:1 in dark mode, and the legend beside
    // it names the values without locating where one arc ends -- so without a
    // separator there is nothing telling the reader that boundary is there.
    const circles = circlesFor(SEGMENTS, 4);

    expect(circles).toHaveLength(SEGMENTS.length * 2);

    for (let i = 0; i < SEGMENTS.length; i++) {
      const separator = circles[i * 2];
      const segment = circles[i * 2 + 1];

      expect(separator.getAttribute("stroke")).toBe("var(--nx-card)");
      expect(segment.getAttribute("stroke")).toBe(SEGMENTS[i].color);
    }
  });

  it("makes the separator wider than the arc it separates", () => {
    // The property that produces a visible gap rather than a coincident edge.
    // Derived from the exported constant rather than restated, so the test
    // cannot go on passing against a separation that was reduced to zero.
    const circles = circlesFor(SEGMENTS, 4);

    for (let i = 0; i < SEGMENTS.length; i++) {
      const separatorWidth = Number(
        circles[i * 2].getAttribute("stroke-width")
      );
      const segmentWidth = Number(
        circles[i * 2 + 1].getAttribute("stroke-width")
      );

      expect(separatorWidth - segmentWidth).toBe(SEGMENT_SEPARATION * 2);
      expect(separatorWidth).toBeGreaterThan(segmentWidth);
    }
  });

  it("gives the separator the same arc as the segment it carves from", () => {
    // A separator on a different arc would cut a gap somewhere the boundary is
    // not, which is worse than no separator: it reads as a third segment.
    const circles = circlesFor(SEGMENTS, 4);

    for (let i = 0; i < SEGMENTS.length; i++) {
      const separator = circles[i * 2];
      const segment = circles[i * 2 + 1];

      expect(separator.getAttribute("stroke-dasharray")).toBe(
        segment.getAttribute("stroke-dasharray")
      );
      expect(separator.getAttribute("stroke-dashoffset")).toBe(
        segment.getAttribute("stroke-dashoffset")
      );
    }
  });

  it("separates the round caps it has to clear", () => {
    // `strokeLinecap="round"` overhangs the dash by half the stroke at each
    // end, so a separation at or below zero would leave the caps overlapping
    // and the boundary invisible however the colours fall.
    expect(SEGMENT_SEPARATION).toBeGreaterThan(0);
    expect(circlesFor(SEGMENTS, 4)[0].getAttribute("stroke-linecap")).toBe(
      "round"
    );
  });
});
