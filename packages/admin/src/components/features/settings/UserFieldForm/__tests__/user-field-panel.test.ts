/**
 * A user field's form values moved into the shared settings panel's shape and
 * back must come back as they went in, for every user-field type, with every
 * setting the type keeps: a setting the mapping forgets would be cleared by
 * the first edit and saved without it.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_VALUES,
  type UserFieldFormValues,
} from "../schemas/userFieldSchema";
import {
  afterPanelEdit,
  panelFieldToValues,
  valuesToPanelField,
} from "../user-field-panel";

const base: UserFieldFormValues = {
  ...DEFAULT_VALUES,
  label: "Thing",
  name: "thing",
  required: true,
  description: "Said under it",
  isActive: false,
};

const EVERY_TYPE: UserFieldFormValues[] = [
  {
    ...base,
    type: "text",
    placeholder: "Type",
    minLength: "2",
    maxLength: "40",
    defaultValue: "Hi",
  },
  { ...base, type: "textarea", placeholder: "More", maxLength: "500" },
  { ...base, type: "email", placeholder: "a@b.co", defaultValue: "a@b.co" },
  {
    ...base,
    type: "url",
    placeholder: "https://",
    minLength: "8",
    defaultValue: "https://a.b",
  },
  {
    ...base,
    type: "phone",
    placeholder: "+1",
    maxLength: "20",
    defaultValue: "+100",
  },
  { ...base, type: "number", minValue: "0", maxValue: "9", defaultValue: "3" },
  { ...base, type: "date", defaultValue: "2026-03-04" },
  { ...base, type: "checkbox", defaultValue: "true" },
  {
    ...base,
    type: "select",
    hasMany: true,
    options: [
      { label: "One", value: "one" },
      { label: "Two", value: "two" },
    ],
    defaultValue: "one",
  },
  {
    ...base,
    type: "radio",
    options: [{ label: "Yes", value: "yes" }],
    defaultValue: "yes",
  },
  // A plugin's type: the base settings, and a default kept as typed.
  { ...base, type: "star-rating", defaultValue: "4" },
];

describe("a user field in the panel and back", () => {
  it.each(EVERY_TYPE.map(values => [values.type, values] as const))(
    "keeps every %s setting",
    (_, values) => {
      expect(panelFieldToValues(valuesToPanelField(values), values)).toEqual(
        values
      );
    }
  );

  it("stores a date picked in the panel as the day alone", () => {
    const date = valuesToPanelField({ ...base, type: "date" });
    expect(
      panelFieldToValues(
        { ...date, defaultValue: "2026-03-04T00:00:00.000Z" },
        base
      ).defaultValue
    ).toBe("2026-03-04");
  });

  it("strips the ids the options editor adds", () => {
    const select = valuesToPanelField(EVERY_TYPE[8]!);
    expect(
      panelFieldToValues(
        { ...select, options: [{ id: "drag-1", label: "One", value: "one" }] },
        EVERY_TYPE[8]!
      ).options
    ).toStrictEqual([{ label: "One", value: "one" }]);
  });

  it("hands the panel a default in the shape its editor takes", () => {
    // A round trip alone cannot see this: "true" comes back "true" either way,
    // but the panel's checkbox and number editors read a boolean and a number.
    expect(valuesToPanelField(EVERY_TYPE[7]!).defaultValue).toBe(true);
    expect(valuesToPanelField(EVERY_TYPE[5]!).defaultValue).toBe(3);
  });

  it("clears a choice default whose option is gone, as the panel says", () => {
    const select = valuesToPanelField(EVERY_TYPE[8]!);
    expect(
      panelFieldToValues(
        { ...select, options: [{ label: "Two", value: "two" }] },
        EVERY_TYPE[8]!
      ).defaultValue
    ).toBe("");
  });

  it.each([
    ["number", "about ten"],
    ["checkbox", "yes"],
  ])(
    "keeps a stored %s default the panel cannot show through another edit",
    (type, stored) => {
      const values = { ...base, type, defaultValue: stored };
      const panel = valuesToPanelField(values);
      // Nothing the panel's editor could show, and nothing lost by a relabel.
      expect(panel.defaultValue).toBeUndefined();
      expect(
        panelFieldToValues({ ...panel, label: "Renamed" }, values).defaultValue
      ).toBe(stored);
    }
  );

  it("lets the default control clear a default it could not show", () => {
    const values = { ...base, type: "number", defaultValue: "about ten" };
    const shown = valuesToPanelField(values);
    // The person types a number, then clears it again.
    const typed = afterPanelEdit(shown, { ...shown, defaultValue: 5 });
    const { defaultValue: _five, ...withoutDefault } = typed;
    const cleared = afterPanelEdit(typed, withoutDefault);
    expect(panelFieldToValues(cleared, values).defaultValue).toBe("");
    // A relabel alone still keeps it.
    expect(
      panelFieldToValues(
        afterPanelEdit(shown, { ...shown, label: "Renamed" }),
        values
      ).defaultValue
    ).toBe("about ten");
  });
});
