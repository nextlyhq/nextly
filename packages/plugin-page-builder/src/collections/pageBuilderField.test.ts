import { describe, expect, it } from "vitest";

import { FIELD_COMPONENT_PATH, pageBuilderField } from "./pageBuilderField";

describe("pageBuilderField", () => {
  it("is a json field wired to the PageBuilderField component", () => {
    const f = pageBuilderField("layout") as Record<string, unknown>;
    expect(f.name).toBe("layout");
    expect(f.type).toBe("json");
    expect((f.admin as { component?: string }).component).toBe(
      FIELD_COMPONENT_PATH
    );
  });

  it("passes through a custom label and keeps document validation", () => {
    const f = pageBuilderField("body", { label: "Body" }) as Record<
      string,
      unknown
    >;
    expect(f.label).toBe("Body");
    expect(typeof f.validate).toBe("function");
  });
});
