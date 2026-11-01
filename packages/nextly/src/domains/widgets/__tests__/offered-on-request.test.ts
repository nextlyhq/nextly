/**
 * A widget offered on request: several cards allowed, and offered in the add
 * panel as one row, not once per collection. Read through the same functions
 * every widget is. (Core's Note, once offered this way, is now declared with
 * `defineWidget`: `note-declaration.test.ts`.) No widget is placed on the
 * default dashboard by being declared, whatever it offers: the default is
 * only what its `defaultLayout` names (`default-layout.test.ts`).
 */
import { describe, expect, it } from "vitest";

import { addPanelFacts } from "../add-panel";
import { type CanonicalWidget, sizeFacts } from "../canonical";

const widget = (patch: Partial<CanonicalWidget>): CanonicalWidget => ({
  id: "core/note",
  archetype: "custom",
  size: { default: { w: 4, h: 3 } },
  ...patch,
});

describe("a widget offered on request", () => {
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
    expect(facts.group).toBe("overview");
    expect(facts).not.toHaveProperty("perCollection");
  });
});
