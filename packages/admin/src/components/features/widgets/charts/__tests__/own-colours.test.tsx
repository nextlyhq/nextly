/**
 * No chart paints a colour of its own: every mark is a shared chart slot, and every other line
 * or label a text or border token, so a theme or a brand recolours every chart at once.
 *
 * Read from what the charts actually render, so a colour added by a later change is caught
 * wherever it is written.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CardTierContext } from "../../frame/tier";
import { GroupsChart } from "../groups-chart";
import { OverTimeChart } from "../over-time-chart";

afterEach(() => cleanup());

/** Every colour a rendered chart sets inline or by attribute. */
function coloursIn(root: HTMLElement): string[] {
  const found: string[] = [];
  for (const element of root.querySelectorAll<HTMLElement | SVGElement>("*")) {
    const style = (element as HTMLElement).style;
    if (style?.color) found.push(style.color);
    if (style?.backgroundColor) found.push(style.backgroundColor);
    for (const attribute of ["fill", "stroke"]) {
      const value = element.getAttribute(attribute);
      if (value && value !== "none") found.push(value);
    }
  }
  return found;
}

/** A shared chart slot, or the inherited colour a slot or a token class sets. */
const ALLOWED = /^(var\(--nx-chart-[1-5]\)|currentColor)$/;

/** A palette class naming a hue directly, rather than a token. */
const PALETTE_CLASS =
  /\b(?:bg|text|fill|stroke|border)-(?:red|green|blue|amber|cyan|slate|gray)-\d{2,3}\b/;

describe("a chart's colours", () => {
  it.each(["medium", "small"] as const)(
    "are shared slots or tokens only, at %s",
    tier => {
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
            series={[
              {
                key: "x",
                name: "Posts",
                points: [{ key: "1", label: "Day 1", value: 2 }],
              },
              {
                key: "y",
                name: "Pages",
                points: [{ key: "1", label: "Day 1", value: 1 }],
              },
            ]}
          />
        </CardTierContext.Provider>
      );
      const colours = coloursIn(container);
      expect(colours.length).toBeGreaterThan(0);
      expect(colours.filter(colour => !ALLOWED.test(colour))).toEqual([]);
      expect(container.innerHTML).not.toMatch(PALETTE_CLASS);
    }
  );
});
