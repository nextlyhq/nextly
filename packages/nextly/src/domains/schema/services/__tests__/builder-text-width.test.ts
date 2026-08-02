import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { withDeclaredTextWidth } from "../builder-text-width";
import { getColumnDescriptor } from "../field-column-descriptor";

describe("withDeclaredTextWidth", () => {
  it("states long for a text field that declares no width", () => {
    const [field] = withDeclaredTextWidth([{ name: "body", type: "text" }]);

    expect(field.options?.variant).toBe("long");
  });

  it("leaves a text field that already states a variant alone", () => {
    const [field] = withDeclaredTextWidth([
      { name: "slug", type: "text", options: { variant: "short" } },
    ]);

    expect(field.options?.variant).toBe("short");
  });

  it.each([
    ["a top-level length", { length: 80 }],
    ["a validation maxLength", { validation: { maxLength: 80 } }],
  ])(
    "treats %s as the author's answer and does not overrule it",
    (_, extra) => {
      const [field] = withDeclaredTextWidth([
        { name: "title", type: "text", ...extra },
      ]);

      expect(field.options?.variant).toBeUndefined();
    }
  );

  it("does not widen a type whose width is settled by what it holds", () => {
    const fields: FieldDefinition[] = [
      { name: "email", type: "email" },
      { name: "password", type: "password" },
      { name: "choice", type: "select" },
    ];

    for (const field of withDeclaredTextWidth(fields)) {
      expect(field.options?.variant).toBeUndefined();
    }
  });

  it("preserves other options on the field it stamps", () => {
    const [field] = withDeclaredTextWidth([
      { name: "body", type: "text", options: { target: "posts" } },
    ]);

    expect(field.options).toEqual({ target: "posts", variant: "long" });
  });

  // The reason this function exists: MySQL renders the two kinds 255 characters apart, so an
  // unstated width decides how much text the column can hold.
  it("keeps a Builder text column unbounded on MySQL", () => {
    const raw = getColumnDescriptor({ name: "body", type: "text" }, "mysql");
    expect(raw?.dialectType).toBe("varchar(255)");

    const [stamped] = withDeclaredTextWidth([{ name: "body", type: "text" }]);
    expect(getColumnDescriptor(stamped, "mysql")?.dialectType).toBe("text");
  });
});

describe("getColumnDescriptor — declared width", () => {
  it.each([
    ["a top-level length", { length: 500 }],
    ["a validation maxLength", { validation: { maxLength: 500 } }],
  ])("renders %s rather than the fallback on MySQL", (_, extra) => {
    const descriptor = getColumnDescriptor(
      { name: "title", type: "text", ...extra },
      "mysql"
    );

    expect(descriptor?.dialectType).toBe("varchar(500)");
    expect(descriptor?.length).toBe(500);
  });

  it("falls back to 255 when the field declares no width", () => {
    const descriptor = getColumnDescriptor(
      { name: "title", type: "text" },
      "mysql"
    );

    expect(descriptor?.dialectType).toBe("varchar(255)");
  });

  it("carries a declared width on PostgreSQL, whose text type takes no length", () => {
    const descriptor = getColumnDescriptor(
      { name: "title", type: "text", length: 500 },
      "postgresql"
    );

    expect(descriptor?.dialectType).toBe("text");
    expect(descriptor?.length).toBe(500);
  });
});
