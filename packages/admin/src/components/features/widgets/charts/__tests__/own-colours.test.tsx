/**
 * No chart paints a colour of its own: every mark is a shared chart slot, and every other line
 * or label a text or border token, so a theme or a brand recolours every chart at once.
 *
 * Read from what the charts actually render, the chart engine's marks included, so a colour added
 * by a later change, or one of the engine's own defaults left in place, is caught wherever it is
 * written.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CardTierContext } from "../../frame/tier";
import { GroupsChart } from "../groups-chart";
import { OverTimeChart } from "../over-time-chart";

import { sizeChartsInTests } from "./chart-env";

// Sized, so the engine draws its marks, axes and points: at no width it draws nothing, and a
// check over nothing passes whatever colours the marks would take.
sizeChartsInTests();
afterEach(() => cleanup());

/** The colours an element sets inline: its text and background colour. */
function inlineColours(element: Element): string[] {
  const style = (element as HTMLElement).style;
  return [style?.color, style?.backgroundColor].filter(Boolean) as string[];
}

/** The series variables an element sets, `--color-<key>`, by their values. */
function seriesVariables(element: Element): string[] {
  const style = (element as HTMLElement).style;
  if (!style) return [];
  return Array.from(style)
    .filter(name => name.startsWith("--color-"))
    .map(name => style.getPropertyValue(name));
}

/** The colours an element paints by attribute: its fill and stroke, unless none. */
function paintColours(element: Element): string[] {
  return ["fill", "stroke"]
    .map(attribute => element.getAttribute(attribute))
    .filter((value): value is string => Boolean(value) && value !== "none");
}

/** Every colour a rendered chart sets inline or by attribute, its series' own variables too. */
function coloursIn(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("*")).flatMap(element => [
    ...inlineColours(element),
    ...seriesVariables(element),
    ...paintColours(element),
  ]);
}

/**
 * A shared chart slot; a series' own variable, which its container sets to a slot and which is
 * itself read above; the surface, track, border and text tokens a chart's axes, gridlines,
 * labels and points are drawn in; or the inherited colour a slot or a token class sets.
 */
const ALLOWED =
  /^(var\(--nx-chart-[1-5]\)|var\(--color-[sg]\d+\)|var\(--nx-(border|card|muted|muted-foreground|foreground)\)|currentColor)$/;

/** A series' variable may hold a chart slot and nothing else. */
const SERIES_VALUE = /^var\(--nx-chart-[1-5]\)$/;

/** A palette class naming a hue directly, rather than a token. */
const PALETTE_CLASS =
  /\b(?:bg|text|fill|stroke|border)-(?:red|green|blue|amber|cyan|slate|gray)-\d{2,3}\b/;

describe("a chart's colours", () => {
  it.each(["medium", "small"] as const)(
    "are shared slots or tokens only, at %s",
    async tier => {
      const { container } = render(
        <CardTierContext.Provider value={tier}>
          <GroupsChart
            title="By status"
            labelHeading="Status"
            groups={[
              { key: "a", value: "published", label: "Published", count: 3 },
              { key: "b", value: "draft", label: "Draft", count: 2 },
            ]}
          />
          <OverTimeChart
            title="Over time"
            intervals={[
              { key: "1", label: "Day 1" },
              { key: "2", label: "Day 2" },
            ]}
            series={[
              {
                key: "x",
                name: "Posts",
                points: [
                  { key: "1", value: 2 },
                  { key: "2", value: 5 },
                ],
              },
              {
                key: "y",
                name: "Pages",
                points: [
                  { key: "1", value: 1 },
                  { key: "2", value: 3 },
                ],
              },
            ]}
          />
        </CardTierContext.Provider>
      );
      expect(await screen.findAllByTestId("chart-drawing")).toHaveLength(2);
      // The point in view too: the rule through it and its ring are the engine's to colour.
      act(() => screen.getByRole("group", { name: /Over time/ }).focus());
      expect(container.querySelector(".chart-rule line")).not.toBeNull();
      expect(container.querySelector(".recharts-line-curve")).not.toBeNull();
      const colours = coloursIn(container);
      const seriesValues = Array.from(
        container.querySelectorAll("[data-testid=chart-drawing]")
      ).flatMap(seriesVariables);
      expect(seriesValues.length).toBeGreaterThan(0);
      expect(seriesValues.filter(value => !SERIES_VALUE.test(value))).toEqual(
        []
      );
      expect(colours.length).toBeGreaterThan(0);
      expect(colours.filter(colour => !ALLOWED.test(colour))).toEqual([]);
      expect(container.innerHTML).not.toMatch(PALETTE_CLASS);
    }
  );
});
