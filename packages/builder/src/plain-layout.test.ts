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
  readArrange,
  unusedSettings,
  type AlignPoint,
  type LayoutTiers,
  type LayoutValues,
  type LayoutWrite,
} from "./plain-layout";

const ORDER = ["base", "md", "sm"] as const;
type Device = (typeof ORDER)[number];

/** A block's own layout values by device, cascading widest first. */
class Block {
  own: Record<Device, Record<string, string>> = { base: {}, md: {}, sm: {} };

  constructor(base: LayoutValues = {}) {
    this.own.base = { ...base } as Record<string, string>;
  }

  tiers(): LayoutTiers {
    return {
      order: ORDER,
      own: device => this.own[device as Device] as LayoutValues,
      inForce: device => {
        const merged: Record<string, string> = {};
        for (const each of ORDER) {
          Object.assign(merged, this.own[each]);
          if (each === device) break;
        }
        return merged as LayoutValues;
      },
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
    block.apply(planColumns("base", { kind: "count", count: 3 }));
    block.apply(planColumns("sm", { kind: "count", count: 1 }));
    expect(block.read("base")).toMatchObject({
      columns: { kind: "count", count: 3 },
    });
    expect(block.read("sm")).toMatchObject({
      columns: { kind: "count", count: 1 },
    });
  });

  it("reads As many as fit back, with its minimum width", () => {
    const block = new Block({ display: "grid" });
    block.apply(planColumns("base", { kind: "fit", min: "12rem" }));
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
