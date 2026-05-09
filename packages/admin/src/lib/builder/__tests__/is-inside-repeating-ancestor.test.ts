// Why: lock the predicate that drives the disabled `unique` toggle
// in AdvancedTab. Disable when ancestor is `repeater` OR (`component`
// AND `repeatable: true`). Brainstorm 2026-05-04 Option B.
import { describe, expect, it } from "vitest";

import type { BuilderField } from "../../../components/features/schema-builder/types";
import { isInsideRepeatingAncestor } from "../is-inside-repeating-ancestor";

const baseAdmin = { width: "100%" } as const;

function field(
  id: string,
  type: BuilderField["type"],
  extra: Partial<BuilderField> = {}
): BuilderField {
  return {
    id,
    name: id,
    label: id,
    type,
    isSystem: false,
    validation: {},
    admin: baseAdmin,
    ...extra,
  } as BuilderField;
}

describe("isInsideRepeatingAncestor", () => {
  it("returns false for a top-level field", () => {
    const fields = [field("a", "text"), field("b", "number")];
    expect(isInsideRepeatingAncestor("a", fields)).toBe(false);
    expect(isInsideRepeatingAncestor("b", fields)).toBe(false);
  });

  it("returns false for a field whose id is not in the tree", () => {
    const fields = [field("a", "text")];
    expect(isInsideRepeatingAncestor("missing", fields)).toBe(false);
  });

  it("returns true for a field directly inside a repeater", () => {
    const fields = [
      field("rep", "repeater", { fields: [field("child", "text")] }),
    ];
    expect(isInsideRepeatingAncestor("child", fields)).toBe(true);
  });

  it("returns true for a deeply nested field whose grandparent is a repeater", () => {
    const fields = [
      field("rep", "repeater", {
        fields: [field("grp", "group", { fields: [field("leaf", "text")] })],
      }),
    ];
    expect(isInsideRepeatingAncestor("leaf", fields)).toBe(true);
  });

  it("returns false for a field inside a non-repeating group", () => {
    const fields = [
      field("grp", "group", { fields: [field("child", "text")] }),
    ];
    expect(isInsideRepeatingAncestor("child", fields)).toBe(false);
  });

  it("returns true for a field inside a repeatable component", () => {
    const fields = [
      field("comp", "component", {
        repeatable: true,
        fields: [field("child", "text")],
      }),
    ];
    expect(isInsideRepeatingAncestor("child", fields)).toBe(true);
  });

  it("returns false for a field inside a non-repeatable component", () => {
    const fields = [
      field("comp", "component", {
        repeatable: false,
        fields: [field("child", "text")],
      }),
    ];
    expect(isInsideRepeatingAncestor("child", fields)).toBe(false);
  });

  it("returns false for a field inside a component with no repeatable flag set", () => {
    const fields = [
      field("comp", "component", {
        fields: [field("child", "text")],
      }),
    ];
    expect(isInsideRepeatingAncestor("child", fields)).toBe(false);
  });

  it("returns false for the repeater ancestor itself (only its descendants are nested)", () => {
    const fields = [
      field("rep", "repeater", { fields: [field("child", "text")] }),
    ];
    expect(isInsideRepeatingAncestor("rep", fields)).toBe(false);
  });

  it("handles a tree with multiple parallel branches", () => {
    const fields = [
      field("plain", "text"),
      field("grp", "group", { fields: [field("a", "text")] }),
      field("rep", "repeater", { fields: [field("b", "text")] }),
    ];
    expect(isInsideRepeatingAncestor("plain", fields)).toBe(false);
    expect(isInsideRepeatingAncestor("a", fields)).toBe(false);
    expect(isInsideRepeatingAncestor("b", fields)).toBe(true);
  });
});
