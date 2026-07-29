/**
 * Guards list reconciliation. The headline is that inserting a row must not
 * mark the rows around it changed (the index-matching bug we beat), and that
 * unusable ids degrade to positional matching instead of a wrong diff.
 */
import { describe, expect, it } from "vitest";

import { reconcileById } from "../reconcile-list";

describe("reconcileById", () => {
  it("marks only the inserted row added, not the rows after it", () => {
    const before = [{ id: "a" }, { id: "c" }];
    const after = [{ id: "a" }, { id: "b" }, { id: "c" }];

    const result = reconcileById(before, after);

    expect(result.strategy).toBe("id");
    const added = result.items.filter(m => m.presence === "added");
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe("b");
    // "c" survives as a matched item (moved 1 -> 2), never re-reported as added.
    const c = result.items.find(m => m.id === "c");
    expect(c?.presence).toBe("both");
    expect(c).toMatchObject({ fromIndex: 1, toIndex: 2 });
  });

  it("reports a reorder as matched items with changed indices", () => {
    const before = [{ id: "a" }, { id: "b" }];
    const after = [{ id: "b" }, { id: "a" }];

    const result = reconcileById(before, after);

    const a = result.items.find(m => m.id === "a");
    const b = result.items.find(m => m.id === "b");
    expect(a).toMatchObject({ presence: "both", fromIndex: 0, toIndex: 1 });
    expect(b).toMatchObject({ presence: "both", fromIndex: 1, toIndex: 0 });
  });

  it("reports a removed row with its prior index", () => {
    const before = [{ id: "a" }, { id: "b" }];
    const after = [{ id: "a" }];

    const removed = reconcileById(before, after).items.filter(
      m => m.presence === "removed"
    );
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ id: "b", fromIndex: 1 });
  });

  it("carries the item bodies so the engine can recurse", () => {
    const before = [{ id: "a", _componentType: "hero", heading: "Old" }];
    const after = [{ id: "a", _componentType: "hero", heading: "New" }];

    const [match] = reconcileById(before, after).items;
    expect(match.presence).toBe("both");
    if (match.presence === "both") {
      expect(match.beforeItem.heading).toBe("Old");
      expect(match.afterItem.heading).toBe("New");
      expect(match.afterItem._componentType).toBe("hero");
    }
  });

  it("degrades to positional matching when ids are duplicated", () => {
    const before = [{ id: "a" }, { id: "a" }];
    const after = [{ id: "a" }, { id: "a" }, { id: "b" }];

    const result = reconcileById(before, after);

    expect(result.strategy).toBe("positional");
    expect(result.items).toHaveLength(3);
    expect(result.items[2]).toMatchObject({ presence: "added", toIndex: 2 });
  });

  it("gives duplicate-id positional items unique synthetic ids", () => {
    const before = [{ id: "a" }, { id: "a" }];
    const after = [{ id: "a" }, { id: "a" }];

    const result = reconcileById(before, after);

    expect(result.strategy).toBe("positional");
    const ids = result.items.map(m => m.id);
    // The real ids are unusable (that is why we fell back), so every item gets
    // a distinct synthetic id rather than a reused duplicate.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["$index:0", "$index:1"]);
  });

  it("degrades to positional matching when an id is missing", () => {
    const before = [{ heading: "x" }];
    const after = [{ heading: "y" }];

    const result = reconcileById(before, after);
    expect(result.strategy).toBe("positional");
    expect(result.items[0]).toMatchObject({ presence: "both", id: "$index:0" });
  });
});
