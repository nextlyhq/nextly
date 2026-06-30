import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "./legacy-types";

describe("FieldDefinition field-level ownership", () => {
  it("accepts source/owner/locked on a field", () => {
    const f: FieldDefinition = {
      name: "meta_title",
      type: "text",
      source: "plugin",
      owner: "@acme/plugin-example",
      locked: true,
    };
    expect(f.source).toBe("plugin");
    expect(f.owner).toBe("@acme/plugin-example");
    expect(f.locked).toBe(true);
  });
});
