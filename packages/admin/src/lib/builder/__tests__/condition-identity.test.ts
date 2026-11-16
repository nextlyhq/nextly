/**
 * Which conditions a pending change leaves broken: one whose source is no
 * longer a field the entry form can read beside it (moved away, deleted, or no
 * longer a type a condition reads), or one comparing a dropdown with an option
 * it no longer has. A broken condition stays on its field, marked, and is
 * never dropped; the check is made on the fields as they stand, so it holds
 * after any change, undo or redo alike.
 */
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { brokenConditions } from "../condition-identity";

function field(name: string, extra: Partial<BuilderField> = {}): BuilderField {
  return {
    id: `f-${name || String(extra.label)}`,
    name,
    label: name ? name[0].toUpperCase() + name.slice(1) : "",
    type: "text",
    ...extra,
  } as BuilderField;
}

/** A field shown only while `source` equals `value`. */
function gated(name: string, source: string, value = "yes"): BuilderField {
  return field(name, {
    admin: { condition: { field: source, operator: "equals", value } },
  });
}

const status = (options: string[]) =>
  field("status", {
    type: "select",
    options: options.map(value => ({ label: value, value })),
  });

describe("a broken condition", () => {
  it("a move: its source moved into a group, out of the level it is read on", () => {
    const fields = [
      gated("teaser", "summary"),
      field("details", { type: "group", fields: [field("summary")] }),
    ];
    const broken = brokenConditions(fields);
    expect(broken.get("f-teaser")).toEqual({
      reason: "no-source",
      message:
        "Teaser's condition reads summary, which is no longer beside it. Choose another field for it, or remove the condition.",
    });
    // Marked, never dropped: the condition is still on the field.
    expect(fields[0].admin?.condition?.field).toBe("summary");
  });

  it("a delete: its source is gone", () => {
    const broken = brokenConditions([gated("teaser", "summary")]);
    expect(broken.get("f-teaser")?.reason).toBe("no-source");
  });

  it("a removed option: a dropdown compared with an option it no longer has", () => {
    const broken = brokenConditions([
      gated("teaser", "status", "archived"),
      status(["draft", "published"]),
    ]);
    expect(broken.get("f-teaser")).toEqual({
      reason: "option-removed",
      message:
        'Teaser\'s condition compares Status with "archived", which is no longer one of its options. Choose another value, or remove the condition.',
    });
  });

  it("a source no longer of a type a condition reads", () => {
    const broken = brokenConditions([
      gated("teaser", "author"),
      field("author", { type: "relationship" }),
    ]);
    expect(broken.get("f-teaser")).toEqual({
      reason: "not-a-source",
      message:
        "Teaser's condition reads Author, which a condition cannot compare. Choose another field for it, or remove the condition.",
    });
  });

  it("at any depth: a nested field's source moved out of its group", () => {
    const fields = [
      field("summary"),
      field("details", { type: "group", fields: [gated("teaser", "summary")] }),
    ];
    expect(brokenConditions(fields).get("f-teaser")?.reason).toBe("no-source");
  });
});

describe("a condition that still reads its source", () => {
  it("a source beside it, or on its level through a group with no name", () => {
    const fields = [
      gated("teaser", "summary"),
      field("", { label: "Layout", type: "group", fields: [field("summary")] }),
      field("details", {
        type: "group",
        fields: [
          gated("caption", "headline"),
          field("", {
            label: "Inner",
            type: "group",
            fields: [field("headline")],
          }),
        ],
      }),
    ];
    expect(brokenConditions(fields).size).toBe(0);
  });

  it("a dropdown compared with an option it has, or with nothing at all", () => {
    const fields = [
      gated("teaser", "status", "published"),
      field("caption", {
        admin: { condition: { field: "status", operator: "isEmpty" } },
      }),
      status(["draft", "published"]),
    ];
    expect(brokenConditions(fields).size).toBe(0);
  });

  it("a built-in field as the source, and the older { field, equals } shape", () => {
    const fields = [
      field("title", { isSystem: true }),
      field("teaser", {
        admin: { condition: { field: "title", equals: "x" } },
      }),
    ];
    expect(brokenConditions(fields).size).toBe(0);
  });

  it("a condition not yet given a source is unfinished, not broken", () => {
    const fields = [
      field("teaser", {
        admin: { condition: { field: "", operator: "equals", value: "" } },
      }),
    ];
    expect(brokenConditions(fields).size).toBe(0);
  });
});
