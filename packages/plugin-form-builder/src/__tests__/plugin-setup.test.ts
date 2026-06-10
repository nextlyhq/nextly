import { describe, it, expect } from "vitest";
import { formBuilder } from "../plugin";

describe("form-builder setup() transformer", () => {
  it("merges plugin collections via setup (renamed from config)", () => {
    const { plugin } = formBuilder();
    expect(typeof plugin.setup).toBe("function");

    const out = plugin.setup!({ collections: [] } as never);
    const slugs = (out.collections ?? []).map((c: { slug: string }) => c.slug);
    expect(slugs).toContain("forms");
    expect(slugs).toContain("form-submissions");
  });
});
