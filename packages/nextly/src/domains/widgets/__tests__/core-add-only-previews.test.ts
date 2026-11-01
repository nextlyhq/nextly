/**
 * The preview cases core's add-only widgets declare, which the add gallery draws each tile from:
 * each widget declares one, of sample data, and its card carries it as it carries a real answer
 * (`cardAnswerResult`, the step the gallery read shapes a case through), so the tile's view is
 * handed exactly what a card of it would be.
 */
import { describe, expect, it } from "vitest";

import { breakdownWidget } from "../core-widgets/breakdown";
import { countWidget } from "../core-widgets/count";
import { noteWidget } from "../core-widgets/note";
import { overTimeWidget } from "../core-widgets/over-time";
import { cardAnswerResult } from "../declaration/card-answer";
import { displayOfView } from "../declaration/displays";

/** A widget's one case, failing the test when it declares none. */
function onlyCase<C>(cases: readonly C[] | undefined): C {
  expect(cases).toHaveLength(1);
  const [first] = cases ?? [];
  if (first === undefined) throw new Error("no preview case declared");
  return first;
}

const WIDGETS = [countWidget, overTimeWidget, breakdownWidget, noteWidget];

describe("core's add-only previews", () => {
  it.each(WIDGETS.map(widget => [widget.id, widget] as const))(
    "%s declares one case its card carries as an answer",
    (id, widget) => {
      const first = onlyCase<{ data: unknown }>(widget.preview);
      const result = cardAnswerResult(displayOfView(widget.view), first.data, {
        widget: id,
        owner: "core",
      });
      expect(result).toEqual({ op: "data", data: first.data });
    }
  );

  it("is plainly sample data: no address or link in any case", () => {
    const text = JSON.stringify(WIDGETS.map(widget => widget.preview));
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/https?:/);
  });

  it("gives Count a total its split adds up to", () => {
    const { data } = onlyCase(countWidget.preview);
    expect(data.total).toBe(
      (data.split?.published ?? 0) + (data.split?.draft ?? 0)
    );
  });

  it("gives Over time a month of days, oldest first, a day apart", () => {
    const { data } = onlyCase(overTimeWidget.preview);
    expect(data.interval).toBe("day");
    expect(data.points).toHaveLength(30);
    const starts = data.points.map(point => Date.parse(point.start));
    const gaps = starts.slice(1).map((at, i) => at - (starts[i] ?? 0));
    expect(new Set(gaps)).toEqual(new Set([86_400_000]));
  });

  it("gives Breakdown its groups largest first, as a read answers them", () => {
    const { data } = onlyCase(breakdownWidget.preview);
    const counts = (data.buckets ?? []).map(bucket => bucket.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("gives Note some text to draw", () => {
    expect(onlyCase(noteWidget.preview).data.text.trim()).not.toBe("");
  });
});
