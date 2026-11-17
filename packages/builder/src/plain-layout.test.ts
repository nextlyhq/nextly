/**
 * The plain layout layer: every plain choice written and read back gives
 * itself, at every device, by the arrangement in force there.
 */
import { describe, expect, it } from "vitest";

import {
  planAlign,
  planArrange,
  planColumns,
  planReverse,
  planRows,
  planSpread,
  planStackOn,
  planWrap,
  normalBeneath,
  ownCascade,
  planPlain,
  readArrange,
  unusedSettings,
  type AlignPoint,
  type LayoutTiers,
  type LayoutValues,
  type LayoutWrite,
  type PlainFlow,
} from "./plain-layout";

const ORDER = ["base", "md", "sm"] as const;
type Device = (typeof ORDER)[number];

/** A block's own layout values by device, cascading widest first. */
class Block {
  own: Record<Device, Record<string, string>> = { base: {}, md: {}, sm: {} };
  /** A shared style's values the block wears, beneath its own. */
  shared: Record<Device, Record<string, string>> = { base: {}, md: {}, sm: {} };
  flow: PlainFlow | undefined;

  constructor(base: LayoutValues = {}) {
    this.own.base = { ...base } as Record<string, string>;
  }

  /** Values cascading widest first, a layer's own over those beneath it. */
  private merged(
    device: string,
    layers: readonly Record<Device, Record<string, string>>[]
  ): LayoutValues {
    const merged: Record<string, string> = {};
    for (const each of ORDER) {
      for (const layer of layers) Object.assign(merged, layer[each]);
      if (each === device) break;
    }
    return merged as LayoutValues;
  }

  tiers(): LayoutTiers {
    return {
      order: ORDER,
      own: device => this.own[device as Device] as LayoutValues,
      inForce: device => this.merged(device, [this.shared, this.own]),
      beneath: device => this.merged(device, [this.shared]),
      ...(this.flow === undefined ? {} : { flow: this.flow }),
    };
  }

  apply(writes: readonly LayoutWrite[]): this {
    for (const { device, property, value } of writes) {
      const at = this.own[device as Device];
      if (value === null) delete at[property];
      else at[property] = value;
    }
    return this;
  }

  read(device: Device = "base") {
    return readArrange(this.tiers(), device);
  }
}

const POINTS: readonly AlignPoint[] = (
  ["top", "middle", "bottom"] as const
).flatMap(y => (["left", "center", "right"] as const).map(x => ({ x, y })));

describe("Arrange reads back as it was chosen", () => {
  it("reads a new container as a Stack, with nothing written", () => {
    expect(new Block().read()).toEqual({
      mode: "stack",
      flex: false,
      align: undefined,
      reverse: false,
    });
  });

  it.each(["stack", "row", "grid"] as const)(
    "reads %s back after choosing it at every device",
    mode => {
      for (const device of ORDER) {
        const block = new Block();
        block.apply(planArrange(block.tiers(), device, mode));
        expect(block.read(device).mode).toBe(mode);
      }
    }
  );

  it("writes Row as a flex row", () => {
    const block = new Block();
    block.apply(planArrange(block.tiers(), "base", "row"));
    expect(block.own.base).toEqual({ display: "flex" });
  });
});

describe("a Stack with its own settings", () => {
  it.each(POINTS)("stays a Stack with Align %o, as a flex column", point => {
    const block = new Block();
    block.apply(planAlign(block.tiers(), "base", point));
    const read = block.read();
    expect(read).toMatchObject({ mode: "stack", flex: true, align: point });
    expect(block.own.base.flexDirection).toBe("column");
  });

  it("stays a Stack with Reverse order", () => {
    const block = new Block();
    block.apply(planReverse(block.tiers(), "base", true));
    expect(block.read()).toMatchObject({ mode: "stack", reverse: true });
    expect(block.own.base.flexDirection).toBe("column-reverse");
  });

  it("stays a Stack with Space between", () => {
    const block = new Block();
    block.own.base.gap = "1rem";
    expect(block.read().mode).toBe("stack");
  });
});

describe("a Row that stacks on a device", () => {
  it.each(["md", "sm"] as const)(
    "reads as a Row at every device when it stacks on %s",
    stackOn => {
      const block = new Block({ display: "flex" });
      block.apply(planStackOn(block.tiers(), stackOn));
      for (const device of ORDER) {
        const read = block.read(device);
        expect(read).toMatchObject({ mode: "row", stackOn });
        if (read.mode === "row") {
          expect(read.stacked).toBe(
            ORDER.indexOf(device) >= ORDER.indexOf(stackOn)
          );
        }
      }
    }
  );

  it("offers Stack at a narrower device of a Row as its Stack on", () => {
    const block = new Block({ display: "flex" });
    block.apply(planArrange(block.tiers(), "sm", "stack"));
    expect(block.read("sm")).toMatchObject({ mode: "row", stackOn: "sm" });
    expect(block.read("base")).toMatchObject({ mode: "row", stacked: false });
  });

  it.each(POINTS)(
    "maps Align %o by the column in force where it is stacked",
    point => {
      const block = new Block({ display: "flex" });
      block.apply(planStackOn(block.tiers(), "sm"));
      block.apply(planAlign(block.tiers(), "sm", point));
      // A column: x is the cross axis, y the main one.
      const at = block.own.sm;
      const place = { left: "start", center: "center", right: "end" }[point.x];
      const run = { top: "start", middle: "center", bottom: "end" }[point.y];
      expect(at.alignItems).toBe(place);
      expect(at.justifyContent).toBe(run);
      expect(block.read("sm")).toMatchObject({ mode: "row", align: point });
    }
  );

  it("writes Spread down the column where it is stacked", () => {
    const block = new Block({ display: "flex" });
    block.apply(planStackOn(block.tiers(), "sm"));
    block.apply(planSpread(block.tiers(), "sm", "between"));
    expect(block.own.sm.justifyContent).toBe("space-between");
    expect(block.read("sm")).toMatchObject({ spread: "between" });
  });

  it("keeps Reverse order at the stacked device when turned on wider", () => {
    const block = new Block({ display: "flex" });
    block.apply(planStackOn(block.tiers(), "sm"));
    block.apply(planReverse(block.tiers(), "base", true));
    expect(block.own.base.flexDirection).toBe("row-reverse");
    expect(block.own.sm.flexDirection).toBe("column-reverse");
    expect(block.read("base")).toMatchObject({ reverse: true });
    expect(block.read("sm")).toMatchObject({ reverse: true, stacked: true });
  });

  it("does not list a wider device's wrap as unused where it is stacked", () => {
    const block = new Block({ display: "flex", flexWrap: "wrap" });
    block.apply(planStackOn(block.tiers(), "sm"));
    expect(unusedSettings(block.tiers(), "sm")).toEqual([]);
  });
});

describe("a Row's own rows", () => {
  it.each(["packed", "between", "around", "even"] as const)(
    "reads Spread %s back",
    spread => {
      const block = new Block({ display: "flex" });
      block.apply(planSpread(block.tiers(), "base", spread));
      expect(block.read()).toMatchObject({ mode: "row", spread });
    }
  );

  it("reads Wrap onto new lines back", () => {
    const block = new Block({ display: "flex" });
    block.apply(planWrap(block.tiers(), "base", true));
    expect(block.read()).toMatchObject({ wrap: true });
    block.apply(planWrap(block.tiers(), "base", false));
    expect(block.read()).toMatchObject({ wrap: false });
  });
});

describe("a Grid", () => {
  it("reads a column count per device back", () => {
    const block = new Block({ display: "grid" });
    block.apply(
      planColumns(block.tiers(), "base", { kind: "count", count: 3 })
    );
    block.apply(planColumns(block.tiers(), "sm", { kind: "count", count: 1 }));
    expect(block.read("base")).toMatchObject({
      columns: { kind: "count", count: 3 },
    });
    expect(block.read("sm")).toMatchObject({
      columns: { kind: "count", count: 1 },
    });
  });

  it("reads As many as fit back, with its minimum width", () => {
    const block = new Block({ display: "grid" });
    block.apply(
      planColumns(block.tiers(), "base", { kind: "fit", min: "12rem" })
    );
    expect(block.read()).toMatchObject({
      columns: { kind: "fit", min: "12rem" },
    });
  });

  it("reads Rows back, and Auto as none", () => {
    const block = new Block({ display: "grid" });
    block.apply(planRows(block.tiers(), "base", 2));
    expect(block.read()).toMatchObject({ rows: 2 });
    block.apply(planRows(block.tiers(), "base", undefined));
    expect(block.read()).toMatchObject({ rows: undefined });
  });
});

describe("a combination with no plain words", () => {
  it.each([
    ["inline-flex", { display: "inline-flex" }],
    ["contents", { display: "contents" }],
    [
      "a grid template of its own",
      { display: "grid", gridTemplateColumns: "1fr 2fr" },
    ],
    ["an alignment with no point", { display: "flex", alignItems: "baseline" }],
  ] as const)("reads %s as Custom", (_what, values) => {
    expect(new Block(values as LayoutValues).read().mode).toBe("custom");
  });
});

describe("values a change stops using", () => {
  it("keeps a Row's wrap once it is a Grid, and says it isn't used", () => {
    const block = new Block({ display: "flex" });
    block.apply(planWrap(block.tiers(), "base", true));
    block.apply(planArrange(block.tiers(), "base", "grid"));
    expect(block.own.base.flexWrap).toBe("wrap");
    expect(unusedSettings(block.tiers(), "base")).toEqual(["flexWrap"]);
  });
});

describe("clearing a value a wider device or a shared style sets", () => {
  it("reads a narrower device's reset rows as Auto, not Custom", () => {
    const block = new Block({ display: "grid" }).apply(
      planRows(new Block().tiers(), "base", 2)
    );
    block.apply(planRows(block.tiers(), "sm", undefined));
    expect(block.own.sm.gridTemplateRows).toBe("none");
    expect(block.read("sm")).toMatchObject({ mode: "grid", rows: undefined });
  });

  it("reads a narrower device's reset Align as the default stretch", () => {
    const block = new Block({ display: "flex" });
    block.apply(planAlign(block.tiers(), "base", { x: "center", y: "top" }));
    block.apply(planAlign(block.tiers(), "sm", null));
    expect(block.own.sm).toMatchObject({
      justifyContent: "normal",
      alignItems: "normal",
    });
    expect(block.read("sm")).toMatchObject({ mode: "row", align: undefined });
  });

  it("turns a wider device's Reverse order off at a narrower one", () => {
    const block = new Block({ display: "flex", flexDirection: "row-reverse" });
    block.apply(planReverse(block.tiers(), "sm", false));
    expect(block.own.sm.flexDirection).toBe("row");
    expect(block.read("sm")).toMatchObject({ mode: "row", reverse: false });
    expect(block.read("base")).toMatchObject({ mode: "row", reverse: true });
  });

  it("makes a block wearing a flex shared style a Stack when asked", () => {
    const block = new Block();
    block.shared.base = { display: "flex" };
    expect(block.read()).toMatchObject({ mode: "row" });
    block.apply(planArrange(block.tiers(), "base", "stack"));
    expect(block.own.base.display).toBe("block");
    expect(block.read()).toMatchObject({ mode: "stack", flex: false });
  });
});

describe("a point on screen in another writing direction", () => {
  it("puts a right-to-left Row's Top left at the inline end", () => {
    const block = new Block({ display: "flex" });
    block.flow = { writingMode: "horizontal-tb", rtl: true };
    block.apply(planAlign(block.tiers(), "base", { x: "left", y: "top" }));
    expect(block.own.base).toMatchObject({
      justifyContent: "end",
      alignItems: "start",
    });
    expect(block.read()).toMatchObject({ align: { x: "left", y: "top" } });
  });

  it("places every point of a vertical Row where it is drawn, and reads it back", () => {
    for (const writingMode of ["vertical-rl", "vertical-lr"]) {
      for (const point of POINTS) {
        const block = new Block({ display: "flex" });
        block.flow = { writingMode, rtl: false };
        block.apply(planAlign(block.tiers(), "base", point));
        expect(block.read()).toMatchObject({ align: point });
      }
    }
  });

  it("puts a vertical-rl Row's Top right at the start of both axes", () => {
    const block = new Block({ display: "flex" });
    block.flow = { writingMode: "vertical-rl", rtl: false };
    block.apply(planAlign(block.tiers(), "base", { x: "right", y: "top" }));
    expect(block.own.base).toMatchObject({
      justifyContent: "start",
      alignItems: "start",
    });
  });
});

describe("a Row spreading its blocks", () => {
  it("keeps its Spread when a point is chosen, placing the other axis", () => {
    const block = new Block({
      display: "flex",
      justifyContent: "space-between",
    });
    block.apply(planAlign(block.tiers(), "base", { x: "right", y: "bottom" }));
    expect(block.own.base).toMatchObject({
      justifyContent: "space-between",
      alignItems: "end",
    });
    expect(block.read()).toMatchObject({ spread: "between" });
  });

  it("keeps it on a stacked device too, where it runs down the column", () => {
    const block = new Block({ display: "flex" });
    block.apply(planStackOn(block.tiers(), "sm"));
    block.own.sm.justifyContent = "space-around";
    block.apply(planAlign(block.tiers(), "sm", { x: "right", y: "top" }));
    expect(block.own.sm).toMatchObject({
      justifyContent: "space-around",
      alignItems: "end",
    });
  });
});

describe("a Grid's columns emptied", () => {
  it("clears its own template, back to Auto", () => {
    const block = new Block({ display: "grid" });
    block.apply(
      planColumns(block.tiers(), "base", { kind: "count", count: 3 })
    );
    block.apply(planColumns(block.tiers(), "base", undefined));
    expect(block.own.base.gridTemplateColumns).toBeUndefined();
    expect(block.read()).toMatchObject({ mode: "grid", columns: undefined });
  });

  it("undoes a wider device's template at a narrower one", () => {
    const block = new Block({ display: "grid" });
    block.apply(
      planColumns(block.tiers(), "base", { kind: "count", count: 3 })
    );
    block.apply(planColumns(block.tiers(), "sm", undefined));
    expect(block.own.sm.gridTemplateColumns).toBe("none");
    expect(block.read("sm")).toMatchObject({
      mode: "grid",
      columns: undefined,
    });
  });
});

describe("Reverse order beside a narrower Row", () => {
  it("leaves a wider stacked device alone when reversed at a narrower one", () => {
    const block = new Block({ display: "flex" });
    block.apply(planStackOn(block.tiers(), "md"));
    block.own.sm.flexDirection = "row";
    block.apply(planReverse(block.tiers(), "sm", true));
    expect(block.own.md.flexDirection).toBe("column");
    expect(block.own.sm.flexDirection).toBe("row-reverse");
  });
});

describe("a shared style read at an interaction state", () => {
  it("puts its Normal values beneath the state's own", () => {
    const normal: Record<string, LayoutValues> = {
      base: { display: "flex" },
      md: {},
      sm: {},
    };
    const hover: Record<string, LayoutValues> = { base: {}, md: {}, sm: {} };
    const inForce = ownCascade(
      ORDER,
      device => hover[device] ?? {},
      device => normal[device] ?? {}
    );
    const tiers: LayoutTiers = {
      order: ORDER,
      own: device => hover[device] ?? {},
      inForce,
    };
    expect(readArrange(tiers, "base")).toMatchObject({ mode: "row" });
  });
});

describe("a shared style at an interaction state, as the page applies it", () => {
  const at = (values: Record<string, LayoutValues>) => (device: string) =>
    values[device] ?? {};

  it("lets a Hover value at a wider device beat a Normal one at this device", () => {
    const normal = at({ sm: { display: "grid" } });
    const hover = at({ base: { display: "flex" } });
    const tiers: LayoutTiers = {
      order: ORDER,
      own: hover,
      inForce: ownCascade(ORDER, hover, normal),
    };
    expect(readArrange(tiers, "sm")).toMatchObject({ mode: "row" });
  });

  it("undoes a Normal wrap when Wrap is turned off at Hover", () => {
    const normal = at({ base: { display: "flex", flexWrap: "wrap" } });
    const hover = at({});
    const tiers: LayoutTiers = {
      order: ORDER,
      own: hover,
      inForce: ownCascade(ORDER, hover, normal),
      beneath: normalBeneath(ORDER, normal),
    };
    expect(planWrap(tiers, "base", false)).toEqual([
      { device: "base", property: "flexWrap", value: "nowrap" },
    ]);
  });
});

describe("Stack on: Never over a shared style's stacking", () => {
  it("writes the row back where the shared style stacks it", () => {
    const block = new Block({ display: "flex" });
    block.shared.sm = { flexDirection: "column" };
    expect(block.read("sm")).toMatchObject({ mode: "row", stackOn: "sm" });
    block.apply(planStackOn(block.tiers(), null));
    expect(block.own.sm.flexDirection).toBe("row");
    expect(block.read("sm")).toMatchObject({ mode: "row", stacked: false });
  });
});

describe("wrapping in reverse", () => {
  it("reads as Custom, and plain controls take the reverse wrap away", () => {
    const block = new Block({ display: "flex", flexWrap: "wrap-reverse" });
    expect(block.read()).toEqual({ mode: "custom" });
    block.apply(planPlain(block.tiers(), "base"));
    expect(block.own.base.flexWrap).toBeUndefined();
    expect(block.read()).toMatchObject({ mode: "row", wrap: false });
  });
});

describe("a flex Stack spreading its blocks", () => {
  it("reads as Custom, since a Stack has no Spread to show it", () => {
    const block = new Block({
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    });
    expect(block.read()).toEqual({ mode: "custom" });
  });
});

describe("Stack on moved to a wider device", () => {
  it("leaves the narrower device stacked under the new column", () => {
    const block = new Block({ display: "flex" });
    block.shared.sm = { flexDirection: "column" };
    block.apply(planStackOn(block.tiers(), "md"));
    expect(block.own.md.flexDirection).toBe("column");
    expect(block.own.sm.flexDirection).toBeUndefined();
    expect(block.read("sm")).toMatchObject({ stackOn: "md", stacked: true });
  });
});

describe("flex-relative and physical alignment keywords", () => {
  it("reads flex-start as the start of a Row running its own way", () => {
    const block = new Block({ display: "flex", justifyContent: "flex-start" });
    expect(block.read()).toMatchObject({ align: { x: "left", y: "top" } });
  });

  it("reads flex-start in a reversed Row as Custom, not as a point", () => {
    const block = new Block({
      display: "flex",
      flexDirection: "row-reverse",
      justifyContent: "flex-start",
    });
    expect(block.read()).toEqual({ mode: "custom" });
  });

  it("reads a physical left as Custom", () => {
    const block = new Block({ display: "flex", justifyContent: "left" });
    expect(block.read()).toEqual({ mode: "custom" });
  });
});
