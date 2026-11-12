/**
 * The changes bar counts the cells Save all sends, read from the changes
 * themselves, so the count and what is saved never part.
 */
import { describe, expect, it } from "vitest";

import { changeCount } from "../bulk-view";

describe("changeCount", () => {
  it("counts each title and description a save sends", () => {
    expect(
      changeCount([
        { id: "p1", rev: "3", title: "New" },
        { id: "p2", title: "", description: "Typed" },
        { id: "p3" },
      ])
    ).toBe(3);
  });
});
