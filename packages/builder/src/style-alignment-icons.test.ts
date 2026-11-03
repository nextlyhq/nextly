import { describe, expect, it } from "vitest";

import { BASE_BREAKPOINT, type NodeStyles } from "@nextlyhq/blocks-engine";

import { alignmentGroupFor, flowOf, type Flow } from "./style-alignment-icons";

/** A flow, horizontal and left to right unless the test says otherwise. */
function flow(over: Partial<Flow> = {}): Flow {
  return {
    writingMode: "horizontal-tb",
    rtl: false,
    flex: true,
    direction: "row",
    ...over,
  };
}

const ROW = flow();
const COLUMN = flow({ direction: "column" });

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

const icons = (property: string, values: readonly string[], at: Flow) =>
  alignmentGroupFor(property, values, at)?.options.map(
    option => `${option.value}:${option.icon}${option.rotated ? "@90" : ""}`
  );

describe("alignmentGroupFor", () => {
  it("draws justify-content's primary values along a row, and leaves the rest", () => {
    const group = alignmentGroupFor("justify-content", JUSTIFY, ROW);

    // Four icons and More fit the field's width beside its label; the rarer
    // distributions sit in More with the other values.
    expect(group?.options.map(option => option.label)).toEqual([
      "Start",
      "Center",
      "End",
      "Space between",
    ]);
    expect(group?.options[0]?.icon).toBe("AlignHorizontalJustifyStart");
    expect(group?.rest).toEqual([
      "normal",
      "space-around",
      "space-evenly",
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

  it("keeps start and end on the writing mode's edges in a reversed flow", () => {
    // CSS Box Alignment ties `start` and `end` to the writing mode; only
    // `flex-start` and `flex-end` follow a reversed direction, and those sit
    // in More. So a reversed row still starts at the left.
    expect(
      icons(
        "justify-content",
        JUSTIFY,
        flow({ direction: "row-reverse" })
      )?.slice(0, 3)
    ).toEqual([
      "start:AlignHorizontalJustifyStart",
      "center:AlignHorizontalJustifyCenter",
      "end:AlignHorizontalJustifyEnd",
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

  it("draws wrapping along the container's own main and cross directions", () => {
    // The wrap icon's lines run right and wrap downward. Each option carries
    // the matrix that maps those two directions onto the container's main
    // direction and the way its lines advance: absent where they already
    // match, a left-to-right row wrapping down.
    const values = ["nowrap", "wrap", "wrap-reverse"];
    const matrices = (at: Flow) =>
      alignmentGroupFor("flex-wrap", values, at)?.options.map(option =>
        option.matrix === undefined ? "same" : option.matrix.join(",")
      );
    expect(matrices(ROW)).toEqual(["same", "same", "1,0,0,-1"]);
    // A left-to-right column runs down and its lines advance rightward.
    expect(matrices(COLUMN)).toEqual(["0,1,1,0", "0,1,1,0", "0,1,-1,0"]);
    // Right to left, a row runs left and still wraps down.
    expect(matrices(flow({ rtl: true }))).toEqual([
      "-1,0,0,1",
      "-1,0,0,1",
      "-1,0,0,-1",
    ]);
  });

  it("ignores a stored reversed direction once the element is not flex", () => {
    // A block or grid keeps a stored column-reverse it no longer lays out by:
    // its axes come from the writing mode, so reversing the main one drew a
    // hybrid of the old layout and the new.
    const values = ["nowrap", "wrap", "wrap-reverse"];
    const matrices = (at: Flow) =>
      alignmentGroupFor("flex-wrap", values, at)?.options.map(option =>
        option.matrix === undefined ? "same" : option.matrix.join(",")
      );
    expect(
      matrices(flow({ flex: false, direction: "column-reverse" }))
    ).toEqual(matrices(ROW));
    expect(matrices(flow({ flex: false, direction: "row-reverse" }))).toEqual(
      matrices(ROW)
    );
  });

  it("ignores a flex direction the element does not lay out by", () => {
    // A grid keeps a stored column direction it no longer uses: justify runs
    // along the inline axis, as in a row.
    expect(
      icons(
        "justify-content",
        JUSTIFY,
        flow({ flex: false, direction: "column" })
      )?.[0]
    ).toBe("start:AlignHorizontalJustifyStart");
  });

  it("mirrors a horizontal start in a right-to-left element", () => {
    const values = ["start", "center", "end", "justify"];
    expect(icons("text-align", values, ROW)).toEqual([
      "start:AlignLeft",
      "center:AlignCenter",
      "end:AlignRight",
      "justify:AlignJustify",
    ]);
    expect(icons("text-align", values, flow({ rtl: true }))?.[0]).toBe(
      "start:AlignRight"
    );
    // A reversed flex row does not move text.
    expect(
      icons("text-align", values, flow({ direction: "row-reverse" }))?.[0]
    ).toBe("start:AlignLeft");
  });

  it("stands the axes up in a vertical writing mode", () => {
    // In vertical-rl the inline axis runs down the page and lines stack right
    // to left: a flex row is vertical, a column horizontal from the right.
    const vertical = flow({ writingMode: "vertical-rl" });
    expect(icons("justify-content", JUSTIFY, vertical)?.[0]).toBe(
      "start:AlignVerticalJustifyStart"
    );
    expect(
      icons(
        "justify-content",
        JUSTIFY,
        flow({ writingMode: "vertical-rl", direction: "column" })
      )?.[0]
    ).toBe("start:AlignHorizontalJustifyEnd");
    expect(icons("text-align", ["start"], vertical)).toEqual([
      "start:AlignLeft@90",
    ]);
  });

  it("points each direction the way it runs", () => {
    const values = ["row", "row-reverse", "column", "column-reverse"];
    expect(icons("flex-direction", values, ROW)).toEqual([
      "row:ArrowRight",
      "row-reverse:ArrowLeft",
      "column:ArrowDown",
      "column-reverse:ArrowUp",
    ]);
    expect(icons("flex-direction", values, flow({ rtl: true }))?.[0]).toBe(
      "row:ArrowLeft"
    );
    expect(
      icons("flex-direction", values, flow({ writingMode: "vertical-rl" }))
    ).toEqual([
      "row:ArrowDown",
      "row-reverse:ArrowUp",
      "column:ArrowLeft",
      "column-reverse:ArrowRight",
    ]);
  });

  it("answers nothing for a property it does not draw as icons", () => {
    expect(alignmentGroupFor("font-weight", ["bold"], ROW)).toBeUndefined();
  });
});

describe("flowOf", () => {
  it("reads the element as the canvas lays it out, when measured", () => {
    // Measured, it answers for classes and intermediate breakpoints too.
    expect(
      flowOf(undefined, "base", BASE_BREAKPOINT, {
        writingMode: "horizontal-tb",
        direction: "rtl",
        display: "inline-flex",
        flexDirection: "column-reverse",
      })
    ).toEqual({
      writingMode: "horizontal-tb",
      rtl: true,
      flex: true,
      direction: "column-reverse",
    });
  });

  it("falls back to what is stored, where it is edited, else wider", () => {
    const styles = {
      base: {
        [BASE_BREAKPOINT]: { display: "flex", flexDirection: "column" },
        tablet: { flexDirection: "row" },
      },
    } as unknown as NodeStyles;

    expect(flowOf(styles, "base", "tablet", undefined)).toMatchObject({
      flex: true,
      direction: "row",
    });
    expect(flowOf(styles, "hover", "mobile", undefined).direction).toBe(
      "column"
    );
  });

  it("is a horizontal row when nothing says otherwise", () => {
    expect(flowOf(undefined, "base", BASE_BREAKPOINT, undefined)).toEqual({
      writingMode: "horizontal-tb",
      rtl: false,
      flex: false,
      direction: "row",
    });
  });
});
