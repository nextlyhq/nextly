import { describe, it, expect } from "vitest";

import { formBuilder } from "../plugin";

describe("form-builder declarative schema (P2 / R4)", () => {
  it("contributes forms + submissions via contributes.collections", () => {
    const { plugin } = formBuilder();
    const slugs = (plugin.contributes?.collections ?? []).map(c => c.slug);
    expect(slugs).toContain("forms");
    expect(slugs).toContain("form-submissions");
  });

  it("no longer ships a setup() transformer (schema is fully declarative)", () => {
    const { plugin } = formBuilder();
    expect(plugin.setup).toBeUndefined();
  });
});
