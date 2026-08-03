import { describe, expect, it } from "vitest";

import { buildDesiredTableFromFields } from "../../pipeline/diff/build-from-fields";
import { resolveBuilderTextWidths } from "../builder-text-width";

/** Widened past the literal so a test can read back the modifiers the resolver writes. */
function textField(extra: Record<string, unknown> = {}): {
  name: string;
  type: string;
  options?: unknown;
} {
  return { name: "body", type: "text", ...extra };
}

function bodyType(
  fields: Parameters<typeof buildDesiredTableFromFields>[1],
  builderOwned: boolean
): string | undefined {
  return buildDesiredTableFromFields("single_page", fields, "mysql", {
    builderOwned,
  }).columns.find(c => c.name === "body")?.type;
}

// The seam matters as much as the rule: preview and apply each build their own desired schema, and
// resolving in only one of them reported a destructive type change against an untouched table.
describe("buildDesiredTableFromFields — builder text width", () => {
  it("gives a builder-owned text field an unbounded column on MySQL", () => {
    expect(bodyType([textField()], true)).toBe("text");
  });

  it("leaves a code-first text field on the bounded default", () => {
    expect(bodyType([textField()], false)).toBe("varchar(255)");
  });

  it("keeps a stated short variant bounded", () => {
    expect(bodyType([textField({ options: { variant: "short" } })], true)).toBe(
      "varchar(255)"
    );
  });

  // A width the descriptor cannot render must not be read as a decision to stay bounded: doing so
  // left a field declaring 500 characters in a varchar(255) column, rejecting values its own stored
  // validation limit accepts.
  it.each([
    ["a validation maxLength", { validation: { maxLength: 500 } }],
    ["a top-level length", { length: 500 }],
  ])("does not treat %s as a reason to stay bounded", (_, extra) => {
    expect(bodyType([textField(extra)], true)).toBe("text");
  });

  it("does not widen a type whose width is settled by what it holds", () => {
    const table = buildDesiredTableFromFields(
      "single_page",
      [
        { name: "email", type: "email" },
        { name: "choice", type: "select" },
      ],
      "mysql",
      { builderOwned: true }
    );

    for (const name of ["email", "choice"]) {
      expect(table.columns.find(c => c.name === name)?.type).toBe(
        "varchar(255)"
      );
    }
  });
});

describe("resolveBuilderTextWidths", () => {
  it("returns the original array when nothing needs resolving", () => {
    const fields = [{ name: "n", type: "number" }];

    expect(resolveBuilderTextWidths(fields)).toBe(fields);
  });

  // Running twice must not differ from running once: the resolved field states a variant, which the
  // second pass reads as already answered.
  it("is idempotent", () => {
    const once = resolveBuilderTextWidths([textField()]);

    expect(resolveBuilderTextWidths(once)).toBe(once);
  });

  // An array cannot carry a variant, and overwriting it with one would discard whatever it held.
  it("leaves a text field whose options is an array untouched", () => {
    const fields = [textField({ options: [{ label: "A", value: "a" }] })];

    expect(resolveBuilderTextWidths(fields)).toBe(fields);
  });

  it("preserves other modifiers on the field it resolves", () => {
    const [field] = resolveBuilderTextWidths([
      textField({ options: { target: "posts" } }),
    ]);

    expect(field.options).toEqual({ target: "posts", variant: "long" });
  });
});
