/**
 * What a field's row in the outline says about it without opening it.
 */
import { describe, expect, it } from "vitest";

import type { AnyFormField } from "../../../types";

import { fieldBadges } from "./field-badges";

const labels = new Map([
  ["attendance", "How will you join?"],
  ["plus_one", "I'm bringing a guest"],
]);
const labelOf = (name: string) => labels.get(name) ?? name;

const badges = (field: AnyFormField) =>
  fieldBadges(field, labelOf).map(({ kind, label, title }) => ({
    kind,
    label,
    title,
  }));

describe("fieldBadges", () => {
  it("shows nothing for a plain, optional, full-width field", () => {
    expect(badges({ name: "notes", label: "Notes", type: "text" })).toEqual([]);
  });

  it("marks a required field", () => {
    expect(
      badges({ name: "email", label: "Email", type: "email", required: true })
    ).toEqual([{ kind: "required", label: "Required", title: undefined }]);
  });

  it("shows a width other than full, and not a full one", () => {
    expect(
      badges({
        name: "first",
        label: "First name",
        type: "text",
        admin: { width: "50%" },
      })
    ).toEqual([{ kind: "width", label: "50%", title: "50% of the row" }]);
    expect(
      badges({
        name: "first",
        label: "First name",
        type: "text",
        admin: { width: "100%" },
      })
    ).toEqual([]);
  });

  it("names a condition's fields by their labels", () => {
    expect(
      badges({
        name: "guest_name",
        label: "Guest's name",
        type: "text",
        conditionalLogic: {
          enabled: true,
          action: "show",
          operator: "AND",
          conditions: [
            { field: "plus_one", comparison: "equals", value: "true" },
            { field: "attendance", comparison: "equals", value: "in_person" },
          ],
        },
      })
    ).toEqual([
      {
        kind: "condition",
        label: "Shown if…",
        title:
          "Shown depending on all of I'm bringing a guest, How will you join?",
      },
    ]);
  });

  it("shows no condition badge for logic switched off", () => {
    expect(
      badges({
        name: "guest_name",
        label: "Guest's name",
        type: "text",
        conditionalLogic: {
          enabled: false,
          action: "show",
          operator: "AND",
          conditions: [
            { field: "plus_one", comparison: "equals", value: "true" },
          ],
        },
      })
    ).toEqual([]);
  });

  it("shows a choice's default by its label, not its stored value", () => {
    expect(
      badges({
        name: "attendance",
        label: "How will you join?",
        type: "radio",
        options: [
          { label: "In person", value: "in_person" },
          { label: "Online", value: "online" },
        ],
        defaultValue: "online",
      })
    ).toEqual([
      { kind: "default", label: "= Online", title: "Default: Online" },
    ]);
  });

  it("cuts a long default, keeping the whole in its title", () => {
    const long = "Please describe anything we should know before the day";
    const [badge] = badges({
      name: "notes",
      label: "Notes",
      type: "textarea",
      defaultValue: long,
    });
    expect(badge.label).toBe(`= ${long.slice(0, 23)}…`);
    expect(badge.title).toBe(`Default: ${long}`);
  });

  it("puts the badges in the row's order: required, width, condition, default", () => {
    expect(
      fieldBadges(
        {
          name: "guests",
          label: "Guests",
          type: "number",
          required: true,
          admin: { width: "33%" },
          defaultValue: 1,
          conditionalLogic: {
            enabled: true,
            action: "show",
            operator: "OR",
            conditions: [
              { field: "plus_one", comparison: "equals", value: "true" },
            ],
          },
        },
        labelOf
      ).map(badge => badge.kind)
    ).toEqual(["required", "width", "condition", "default"]);
  });
});
