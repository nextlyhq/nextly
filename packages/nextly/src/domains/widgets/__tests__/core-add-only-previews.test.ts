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

const WIDGETS = [countWidget, overTimeWidget, breakdownWidget, noteWidget];

describe("core's add-only previews", () => {
  it.each(WIDGETS.map(widget => [widget.id, widget] as const))(
    "%s declares one case its card carries as an answer",
    (id, widget) => {
      const cases = widget.preview ?? [];
      expect(cases).toHaveLength(1);
      const [first] = cases;
      const result = cardAnswerResult(displayOfView(widget.view), first.data, {
        widget: id,
        owner: "core",
      });
      expect(result).toEqual({ op: "data", data: first.data });
    }
  );

  it("is plainly sample data: no address or real name in any case", () => {
    const text = JSON.stringify(WIDGETS.map(widget => widget.preview));
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/https?:/);
  });

  it("draws each case as the widget's view reads it", () => {
    const [count] = countWidget.preview ?? [];
    expect(count.data.total).toBe(
      (count.data.split?.published ?? 0) + (count.data.split?.draft ?? 0)
    );
    const [overTime] = overTimeWidget.preview ?? [];
    expect(overTime.data.interval).toBe("day");
    expect(overTime.data.points).toHaveLength(30);
    // Oldest first, a day apart, as a range's points are answered.
    const starts = overTime.data.points.map(point => Date.parse(point.start));
    expect(
      starts.every((at, i) => i === 0 || at - starts[i - 1] === 86_400_000)
    ).toBe(true);
    const [breakdown] = breakdownWidget.preview ?? [];
    // Largest first, as a read answers groups.
    const counts = (breakdown.data.buckets ?? []).map(bucket => bucket.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const [note] = noteWidget.preview ?? [];
    expect(note.data.text.trim()).not.toBe("");
  });
});
