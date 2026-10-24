/**
 * A widget offered on request, the Note: never placed on the default
 * dashboard, several cards allowed, and offered in the add panel as one row,
 * not once per collection. Read through the same functions every widget is.
 */
import { describe, expect, it } from "vitest";

import { addPanelFacts } from "../add-panel";
import {
  type CanonicalWidget,
  placedByDefault,
  widthFacts,
} from "../canonical";
import { CORE_WIDGETS } from "../core-widgets";

const widget = (patch: Partial<CanonicalWidget>): CanonicalWidget => ({
  id: "core/note",
  archetype: "custom",
  defaultSize: "md",
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
    expect(widthFacts(widget({ offered: "on-request" })).allowsSeveral).toBe(
      true
    );
    expect(
      widthFacts(widget({ offered: "on-request", allowsSeveral: false }))
        .allowsSeveral
    ).toBe(false);
    expect(widthFacts(widget({})).allowsSeveral).toBe(false);
  });

  it("is one row of the add panel's Overview, not a row per collection", () => {
    const facts = addPanelFacts(widget({ offered: "on-request" }));
    expect(facts?.group).toBe("overview");
    expect(facts).not.toHaveProperty("perCollection");
  });
});

describe("the Note", () => {
  it("is core's widget offered on request, with its text as its one setting", () => {
    const note = CORE_WIDGETS.find(w => w.id === "core/note");
    expect(note).toMatchObject({
      offered: "on-request",
      component: "core#Note",
      settings: [{ name: "text", type: "textarea", maxLength: 2000 }],
    });
  });
});
