/**
 * The gate a document view applies to the field it edits, from every
 * container around it.
 *
 * A field inside a named group sits one level down, and so does the field a
 * condition on its group or on itself names: a condition reads the value
 * BESIDE the field it is declared on. Read at the top level instead, a
 * `hero` group shown only while `hero.mode` is "visual" would be judged by a
 * top-level `mode` — another field, or none.
 *
 * @module components/features/entries/EntryForm/__tests__/document-view-field-refusal.test
 */
import { describe, expect, it } from "vitest";

import { viewFieldRefusal } from "../document-view-field-refusal";

const shownWhenVisual = {
  condition: { field: "mode", operator: "equals", value: "visual" },
};

describe("viewFieldRefusal for a field inside a named group", () => {
  const hero = { name: "hero", type: "group", admin: shownWhenVisual };
  const body = { name: "body", type: "blocks", admin: shownWhenVisual };
  // The group reads at the top level; the field inside it reads under `hero`.
  const nested = { declaration: body, within: [hero], bases: ["", "hero"] };

  it("reads each condition beside the step it is declared on", () => {
    const values: Record<string, unknown> = {
      mode: "visual",
      "hero.mode": "visual",
    };
    expect(viewFieldRefusal(nested, path => values[path])).toBeNull();
  });

  it("hides the field when its own condition fails at its own level", () => {
    // The top-level `mode` says visual; the field's own sibling does not.
    const values: Record<string, unknown> = {
      mode: "visual",
      "hero.mode": "code",
    };
    expect(viewFieldRefusal(nested, path => values[path])).toBe("hidden");
  });

  it("hides the field when its group's condition fails at the group's level", () => {
    const values: Record<string, unknown> = {
      mode: "code",
      "hero.mode": "visual",
    };
    expect(viewFieldRefusal(nested, path => values[path])).toBe("hidden");
  });

  it("makes the field read-only when a group around it is", () => {
    const locked = { name: "hero", type: "group", admin: { readOnly: true } };
    const field = { name: "body", type: "blocks" };
    expect(
      viewFieldRefusal(
        { declaration: field, within: [locked], bases: ["", "hero"] },
        () => undefined
      )
    ).toBe("readOnly");
  });
});
