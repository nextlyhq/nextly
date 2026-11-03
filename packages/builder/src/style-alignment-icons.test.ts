import { describe, expect, it } from "vitest";

import { BASE_BREAKPOINT, type NodeStyles } from "@nextlyhq/blocks-engine";

import { alignmentGroupFor, flowOf, type Flow } from "./style-alignment-icons";

const ROW: Flow = { axis: "row", reversed: false, rtl: false };
const COLUMN: Flow = { axis: "column", reversed: false, rtl: false };

const JUSTIFY = [
  "normal",
  "space-between",
  "space-around",
  "space-evenly",
  "stretch",
  "center",
  "start",
  "end",
  "flex-start",
  "flex-end",
  "safe center",
];

const icons = (property: string, values: readonly string[], flow: Flow) =>
  alignmentGroupFor(property, values, flow)?.options.map(
    option => `${option.value}:${option.icon}`
  );

describe("alignmentGroupFor", () => {
  it("draws justify-content's primary values along a row, and leaves the rest", () => {
    const group = alignmentGroupFor("justify-content", JUSTIFY, ROW);

    expect(group?.options.map(option => option.label)).toEqual([
      "Start",
      "Center",
      "End",
      "Space between",
      "Space around",
      "Space evenly",
    ]);
    expect(group?.options[0]?.icon).toBe("AlignHorizontalJustifyStart");
    // Every value without an icon stays reachable beside the group.
    expect(group?.rest).toEqual([
      "normal",
      "stretch",
      "flex-start",
      "flex-end",
      "safe center",
    ]);
  });

  it("turns the main-axis icons upright in a column", () => {
    expect(icons("justify-content", JUSTIFY, COLUMN)?.slice(0, 3)).toEqual([
      "start:AlignVerticalJustifyStart",
      "center:AlignVerticalJustifyCenter",
      "end:AlignVerticalJustifyEnd",
    ]);
  });

  it("swaps start and end along a reversed main axis", () => {
    expect(
      icons("justify-content", JUSTIFY, { ...ROW, reversed: true })?.slice(0, 3)
    ).toEqual([
      "start:AlignHorizontalJustifyEnd",
      "center:AlignHorizontalJustifyCenter",
      "end:AlignHorizontalJustifyStart",
    ]);
  });

  it("aligns items across the axis: top to bottom in a row, side to side in a column", () => {
    const values = ["normal", "stretch", "baseline", "center", "start", "end"];
    expect(icons("align-items", values, ROW)).toEqual([
      "start:AlignStartHorizontal",
      "center:AlignCenterHorizontal",
      "end:AlignEndHorizontal",
      "stretch:StretchVertical",
      "baseline:Baseline",
    ]);
    expect(icons("align-items", values, COLUMN)?.[0]).toBe(
      "start:AlignStartVertical"
    );
  });

  it("mirrors a horizontal start in a right-to-left element", () => {
    const values = ["start", "center", "end", "justify"];
    expect(icons("text-align", values, ROW)).toEqual([
      "start:AlignLeft",
      "center:AlignCenter",
      "end:AlignRight",
      "justify:AlignJustify",
    ]);
    expect(icons("text-align", values, { ...ROW, rtl: true })?.[0]).toBe(
      "start:AlignRight"
    );
    // A reversed flex row does not move text.
    expect(icons("text-align", values, { ...ROW, reversed: true })?.[0]).toBe(
      "start:AlignLeft"
    );
  });

  it("points each direction the way it runs", () => {
    const values = ["row", "row-reverse", "column", "column-reverse"];
    expect(icons("flex-direction", values, ROW)).toEqual([
      "row:ArrowRight",
      "row-reverse:ArrowLeft",
      "column:ArrowDown",
      "column-reverse:ArrowUp",
    ]);
    expect(icons("flex-direction", values, { ...ROW, rtl: true })?.[0]).toBe(
      "row:ArrowLeft"
    );
  });

  it("answers nothing for a property it does not draw as icons", () => {
    expect(alignmentGroupFor("font-weight", ["bold"], ROW)).toBeUndefined();
  });
});

describe("flowOf", () => {
  it("reads the container's direction where it is edited, else where it is set wider", () => {
    const styles = {
      base: {
        [BASE_BREAKPOINT]: { flexDirection: "column-reverse" },
        tablet: { flexDirection: "row" },
      },
    } as unknown as NodeStyles;

    expect(flowOf(styles, "base", BASE_BREAKPOINT, false)).toEqual({
      axis: "column",
      reversed: true,
      rtl: false,
    });
    expect(flowOf(styles, "base", "tablet", true)).toEqual({
      axis: "row",
      reversed: false,
      rtl: true,
    });
    // Hovered, at a breakpoint with nothing of its own: the base direction.
    expect(flowOf(styles, "hover", "mobile", false).axis).toBe("column");
  });

  it("is a row when nothing sets a direction, as CSS's default is", () => {
    expect(flowOf(undefined, "base", BASE_BREAKPOINT, false)).toEqual({
      axis: "row",
      reversed: false,
      rtl: false,
    });
  });
});
