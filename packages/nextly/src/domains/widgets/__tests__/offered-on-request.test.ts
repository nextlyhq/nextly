/**
 * A widget offered on request: never placed on the default dashboard, several
 * cards allowed, and offered in the add panel as one row, not once per
 * collection. Read through the same functions every widget is. (Core's Note,
 * once offered this way, is now declared with `defineWidget`, which keeps it
 * off the default dashboard by being answered on the server:
 * `note-declaration.test.ts`.)
 */
import { describe, expect, it } from "vitest";

import { addPanelFacts } from "../add-panel";
import { type CanonicalWidget, placedByDefault, sizeFacts } from "../canonical";

const widget = (patch: Partial<CanonicalWidget>): CanonicalWidget => ({
  id: "core/note",
  archetype: "custom",
  size: { default: { w: 4, h: 3 } },
  ...patch,
});

describe("a widget offered on request", () => {
  it("is never placed on the default dashboard, as one offered per collection is not", () => {
    expect(placedByDefault(widget({ offered: "on-request" }))).toBe(false);
    expect(placedByDefault(widget({ offered: "per-collection" }))).toBe(false);
    // The must-differ case: a widget that says nothing is placed.
    expect(placedByDefault(widget({}))).toBe(true);
  });

  it("allows several cards unless it says otherwise", () => {
    expect(sizeFacts(widget({ offered: "on-request" })).allowsSeveral).toBe(
      true
    );
    expect(
      sizeFacts(widget({ offered: "on-request", allowsSeveral: false }))
        .allowsSeveral
    ).toBe(false);
    expect(sizeFacts(widget({})).allowsSeveral).toBe(false);
  });

  it("is one row of the add panel's Overview, not a row per collection", () => {
    const facts = addPanelFacts(widget({ offered: "on-request" }));
    expect(facts?.group).toBe("overview");
    expect(facts).not.toHaveProperty("perCollection");
  });
});
