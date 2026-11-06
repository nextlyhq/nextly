/**
 * The row under the pointer in a chart of groups, read through the chart engine's scale: the band
 * the pointer is in, from its top edge to its bottom edge, and named as soon as the engine has a
 * scale, whether or not the axis has drawn its ticks.
 *
 * Drawn here at a fixed size, three rows of 22 px, with an axis that draws no ticks at all.
 */
import { render, waitFor } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { describe, expect, it } from "vitest";

import { PointerIndex } from "../drawn/pointer-index";

type IndexAt = (x: number, y: number) => number | undefined;

const KEYS = ["published", "draft", "archived"];

/** The reading `PointerIndex` keeps, once the engine has drawn the chart. */
async function rowReader(): Promise<IndexAt> {
  const into: MutableRefObject<IndexAt | undefined> = { current: undefined };
  render(
    <BarChart
      width={320}
      height={66}
      layout="vertical"
      data={KEYS.map((key, index) => ({ key, value: 3 - index }))}
      margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
    >
      <XAxis type="number" hide />
      <YAxis
        yAxisId="name"
        type="category"
        dataKey="key"
        width={0}
        tick={false}
        axisLine={false}
      />
      <PointerIndex axis="y" axisId="name" keys={KEYS} into={into} />
      <Bar yAxisId="name" dataKey="value" isAnimationActive={false} />
    </BarChart>
  );
  await waitFor(() => expect(into.current).toBeDefined());
  return (x, y) => into.current?.(x, y);
}

describe("the row under the pointer", () => {
  it("is named with no ticks drawn, as when the pointer arrives before them", async () => {
    const rowAt = await rowReader();
    expect(rowAt(100, 11)).toBe(0);
  });

  it("is the row the pointer is in, from its top edge to its bottom edge", async () => {
    const rowAt = await rowReader();
    expect([1, 21, 23, 43, 45, 65].map(y => rowAt(100, y))).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
  });

  it("is the first row above them all, and the last below", async () => {
    const rowAt = await rowReader();
    expect(rowAt(100, -5)).toBe(0);
    expect(rowAt(100, 90)).toBe(2);
  });
});
