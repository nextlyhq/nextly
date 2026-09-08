/**
 * A stats card is SETTLING while its numbers are still arriving.
 */
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { resolveWidgetOutcome } from "../outcome";
import { widgetOutcome } from "../useWidgetBatch";

const card: DashboardWidget = {
  id: "collection/posts-stats",
  title: "posts health",
  archetype: "stats",
  size: "md",
  cells: [
    {
      key: "total",
      label: "Total",
      query: { source: "collection:posts", op: "count" },
    },
    {
      key: "draft",
      label: "Draft",
      query: { source: "collection:posts", op: "count" },
    },
  ],
};

const count = (total: number): WidgetSlot => ({
  ok: true,
  result: { op: "count", total },
});

describe("what the BATCH reports while a stats card's cells arrive", () => {
  it("is LOADING while any requested cell is still absent", () => {
    // 🔴 The card draws partially on purpose, so its body answers `ready` on
    // the first render -- and the grid announced "1 widget updated" before a
    // single number had arrived. The same sentence was then deduplicated when
    // they actually did, so real completion was never announced at all. The two
    // consumers want different things: the card renders, the batch waits.
    expect(widgetOutcome(card, undefined, { total: count(3) }).state).toBe(
      "loading"
    );
    expect(widgetOutcome(card, undefined, undefined).state).toBe("loading");
  });

  it("is READY once every cell has answered", () => {
    // The control: a rule that simply always reported loading would satisfy the
    // case above and leave the card announcing nothing, ever.
    expect(
      widgetOutcome(card, undefined, { total: count(3), draft: count(1) }).state
    ).toBe("ready");
  });
});

describe("what a stats card reports while its cells arrive", () => {
  it("still DRAWS with the numbers it has", () => {
    // The card's own behaviour is unchanged: partial rendering is the point,
    // and this is the control that the settling rule below did not remove it.
    const answers: Record<string, WidgetSlot> = { total: count(3) };
    const outcome = resolveWidgetOutcome(card, undefined, k => answers[k]);
    expect(outcome.state).toBe("ready");
  });

  it("is ready once every cell has answered", () => {
    const answers: Record<string, WidgetSlot> = {
      total: count(3),
      draft: count(1),
    };
    const outcome = resolveWidgetOutcome(card, undefined, k => answers[k]);
    expect(outcome.state).toBe("ready");
  });
});
