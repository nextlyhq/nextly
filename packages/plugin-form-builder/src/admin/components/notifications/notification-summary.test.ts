import { describe, expect, it } from "vitest";

import type { AnyFormField, FormNotification } from "../../../types";

import { whenSummary } from "./notification-summary";

const fields = [
  { type: "text", name: "name", label: "Name" },
  {
    type: "select",
    name: "join",
    label: "Joining",
    options: [
      { label: "In person", value: "in_person" },
      { label: "Online", value: "online" },
    ],
  },
  {
    type: "radio",
    name: "size",
    label: "Size",
    options: [{ label: "Large", value: "l" }],
  },
] as unknown as AnyFormField[];

function onlyWhen(field: string, value: unknown): FormNotification {
  return {
    id: "team",
    name: "Team",
    enabled: true,
    recipientType: "static",
    to: "team@example.com",
    conditions: {
      match: "all",
      list: [{ field, comparison: "equals", value }],
    },
  } as unknown as FormNotification;
}

describe("whenSummary", () => {
  it("names a choice by its option's label, not its stored value", () => {
    expect(whenSummary(onlyWhen("join", "in_person"), fields)).toBe(
      "Only when Joining is In person"
    );
    expect(whenSummary(onlyWhen("size", "l"), fields)).toBe(
      "Only when Size is Large"
    );
  });

  it("keeps a value no option holds, and a text field's value, as written", () => {
    expect(whenSummary(onlyWhen("join", "hybrid"), fields)).toBe(
      "Only when Joining is hybrid"
    );
    expect(whenSummary(onlyWhen("name", "in_person"), fields)).toBe(
      "Only when Name is in_person"
    );
  });

  it("keeps a condition on a field the form no longer has readable", () => {
    expect(whenSummary(onlyWhen("gone", "x"), fields)).toBe(
      "Only when gone is x"
    );
  });
});
