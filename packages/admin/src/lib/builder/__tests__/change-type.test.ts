/**
 * A field's type changed: it keeps its identity and the settings every type has, and of the rest
 * only what the new type shows in the settings panel, read from the panel's own rules. The user
 * fields' form asks the same question of its surface.
 */
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { usersFieldSurface } from "@admin/components/features/settings/UserFieldForm/users-field-surface";

import {
  changeTypeOffered,
  containerChangeRefused,
  settingsFittingType,
  withSavedTypeRestored,
  withTypeChanged,
} from "../change-type";
import { builderFieldErrors } from "../field-validators";

const ENTRIES = {
  surface: { surface: "entries" as const },
  plugins: undefined,
};
const USERS = { surface: usersFieldSurface(false), plugins: undefined };

const fits = (type: string) => settingsFittingType(type, ENTRIES);
const changed = (field: Partial<BuilderField>, type: string) =>
  withTypeChanged(
    { id: "f-1", name: "kind", label: "Kind", ...field } as BuilderField,
    type,
    fits(type)
  );

describe("the settings a type shows", () => {
  it("in the Builder: a dropdown's options and several picks, radio buttons' options alone, a checkbox's set of choices", () => {
    expect(fits("select")).toMatchObject({ options: true, hasMany: true });
    expect(fits("radio")).toMatchObject({ options: true, hasMany: false });
    expect(fits("checkbox")).toMatchObject({ options: true });
    expect(fits("text")).toMatchObject({ options: false, hasMany: false });
  });

  it("a placeholder where the input shows one, and the validation rules the panel offers", () => {
    expect(fits("number").placeholder).toBe(true);
    expect(fits("date").placeholder).toBe(false);
    expect([...fits("number").validation]).toEqual(
      expect.arrayContaining(["min", "max"])
    );
    expect(fits("number").validation.has("minLength")).toBe(false);
    expect([...fits("text").validation]).toEqual(
      expect.arrayContaining(["minLength", "maxLength", "pattern"])
    );
  });

  it("for a user field, by its surface: a yes/no checkbox has no choices, and length bounds only where the surface keeps them", () => {
    const user = (type: string) => settingsFittingType(type, USERS);
    expect(user("checkbox").options).toBe(false);
    expect(user("select")).toMatchObject({ options: true, hasMany: true });
    expect(user("radio")).toMatchObject({ options: true, hasMany: false });
    expect([...user("text").validation].sort()).toEqual([
      "maxLength",
      "minLength",
    ]);
    expect([...user("number").validation].sort()).toEqual(["max", "min"]);
  });
});

describe("a field changed to another type", () => {
  it("keeps its id, name, label, help text, where and when it shows, and Required", () => {
    const next = changed(
      {
        type: "select",
        description: "Pick one",
        options: [{ label: "A", value: "a" }],
        hasMany: true,
        validation: { required: true },
        admin: {
          width: "50%",
          hidden: true,
          condition: { field: "status", equals: "live" },
          isClearable: true,
          placeholder: "Choose…",
        },
        defaultValue: "a",
      },
      "number"
    );
    expect(next).toEqual({
      id: "f-1",
      name: "kind",
      label: "Kind",
      type: "number",
      description: "Pick one",
      validation: { required: true },
      admin: {
        width: "50%",
        hidden: true,
        condition: { field: "status", equals: "live" },
        // A number's input shows a placeholder too.
        placeholder: "Choose…",
      },
    });
  });

  it("a dropdown becoming radio buttons keeps its options, not what only a dropdown shows", () => {
    const next = changed(
      {
        type: "select",
        options: [{ label: "A", value: "a" }],
        hasMany: true,
        admin: { isClearable: false, placeholder: "Choose…" },
      },
      "radio"
    );
    expect(next.options).toEqual([{ label: "A", value: "a" }]);
    expect(next.hasMany).toBeUndefined();
    expect(next.admin).toEqual({});
  });

  it("a dropdown becoming a set of choices keeps what a dropdown shows beside its options", () => {
    expect(
      changed(
        {
          type: "select",
          admin: { isClearable: false, placeholder: "Choose…" },
        },
        "checkbox"
      ).admin
    ).toEqual({ isClearable: false, placeholder: "Choose…" });
  });

  it("radio buttons keep how they are laid out only as radio buttons", () => {
    expect(
      changed({ type: "radio", admin: { layout: "vertical" } }, "select").admin
    ).toEqual({});
    expect(
      changed({ type: "select", admin: { layout: "vertical" } }, "radio").admin
    ).toEqual({ layout: "vertical" });
  });

  it("a number becoming a text drops its numeric bounds and keeps what a text has", () => {
    const next = changed(
      {
        type: "number",
        validation: { required: true, min: 1, max: 9, message: "1 to 9" },
      },
      "text"
    );
    expect(next.validation).toEqual({ required: true, message: "1 to 9" });
  });

  it("a text becoming a long text keeps its length bounds", () => {
    expect(
      changed(
        { type: "text", validation: { minLength: 2, maxLength: 80 } },
        "textarea"
      ).validation
    ).toEqual({ minLength: 2, maxLength: 80 });
  });

  it("a link becoming a text keeps nothing of the link", () => {
    const next = changed(
      { type: "relationship", relationTo: "posts", maxDepth: 2 },
      "text"
    );
    expect(next).not.toHaveProperty("relationTo");
    expect(next).not.toHaveProperty("maxDepth");
  });

  // As often as wanted before the first save: nothing of the types between is left behind, and what
  // the new type needs is asked for at the field.
  it("from text to number to dropdown and back keeps its name and label, its missing options marked while it is a dropdown", () => {
    const text: BuilderField = {
      id: "f-1",
      name: "kind",
      label: "Kind",
      type: "text",
      validation: {},
    } as BuilderField;
    const asNumber = withTypeChanged(text, "number", fits("number"));
    const asSelect = withTypeChanged(asNumber, "select", fits("select"));
    const back = withTypeChanged(asSelect, "text", fits("text"));
    for (const [each, type] of [
      [asNumber, "number"],
      [asSelect, "select"],
      [back, "text"],
    ] as const) {
      expect(each).toMatchObject({
        id: "f-1",
        name: "kind",
        label: "Kind",
        type,
      });
    }
    expect(builderFieldErrors([asSelect]).get("f-1")?.message).toMatch(
      /at least one option/
    );
    expect(builderFieldErrors([asNumber]).has("f-1")).toBe(false);
    expect(back).toEqual(text);
  });

  // A group or repeating rows keep one structure in every language, and what is inside chooses what is
  // translated: a container has no Localized of its own to keep.
  it("a field becoming a group or repeating rows keeps Unique and Index, and no Localized", () => {
    for (const localized of [true, false]) {
      for (const [from, to] of [
        ["text", "group"],
        ["text", "repeater"],
        ["group", "repeater"],
      ] as const) {
        expect(
          changed(
            { type: from, advanced: { unique: true, index: true, localized } },
            to
          ).advanced,
          `${from} to ${to}`
        ).toEqual({ unique: true, index: true });
      }
    }
    // Any other type keeps it as it is set.
    expect(
      changed(
        {
          type: "text",
          advanced: { unique: false, index: false, localized: true },
        },
        "number"
      ).advanced
    ).toEqual({ unique: false, index: false, localized: true });
  });

  it("a group becoming repeating rows keeps the fields it holds", () => {
    const inside = [{ id: "f-2", name: "a", label: "A", type: "text" }];
    expect(changed({ type: "group", fields: inside }, "repeater").fields).toBe(
      inside
    );
  });
});

describe("a field back to the type it was saved as", () => {
  const saved: BuilderField = {
    id: "f-1",
    name: "link",
    label: "Link",
    type: "relationship",
    relationTo: "posts",
    maxDepth: 2,
    description: "Where it points",
    validation: { required: true },
    admin: { width: "50%", placeholder: "Pick" },
  } as BuilderField;
  // The draft changed it to a text, relabelled it, cleared its help text and moved it.
  const draft: BuilderField = {
    id: "f-1",
    name: "link",
    label: "Where to",
    type: "text",
    validation: { required: true },
    admin: { width: "100%" },
  } as BuilderField;

  it("has every setting of its own it was saved with, and what the person has given it since", () => {
    expect(withSavedTypeRestored(draft, saved)).toEqual({
      id: "f-1",
      name: "link",
      label: "Where to",
      type: "relationship",
      relationTo: "posts",
      maxDepth: 2,
      validation: { required: true },
      // The help text the person cleared stays cleared; the width they set stands.
      admin: { width: "100%", placeholder: "Pick" },
    });
  });

  // Set while it was a text, Localized does not come back onto the group with it.
  it("a group has no Localized but the one it was saved with", () => {
    const back = (savedAdvanced?: BuilderField["advanced"]) =>
      withSavedTypeRestored(
        {
          ...draft,
          advanced: { unique: true, index: false, localized: true },
        },
        {
          id: "f-1",
          name: "link",
          label: "Link",
          type: "group",
          fields: [],
          ...(savedAdvanced === undefined ? {} : { advanced: savedAdvanced }),
        }
      ).advanced;
    expect(back()).toEqual({ unique: true, index: false });
    expect(back({ unique: false, index: false, localized: false })).toEqual({
      unique: true,
      index: false,
      localized: false,
    });
  });

  it("Required is as the person has it now", () => {
    expect(
      withSavedTypeRestored(
        { ...draft, validation: { required: false } },
        saved
      ).validation
    ).toEqual({ required: false });
  });
});

describe("a field holding fields", () => {
  const holding: BuilderField = {
    id: "f-g",
    name: "meta",
    label: "Meta",
    type: "group",
    fields: [
      { id: "f-a", name: "a", label: "A", type: "text" },
      {
        id: "f-b",
        name: "b",
        label: "B",
        type: "group",
        fields: [{ id: "f-c", name: "c", label: "C", type: "text" }],
      },
    ],
  } as BuilderField;

  it("becomes only the other container, counting every field it holds", () => {
    expect(containerChangeRefused(holding, "repeater")).toBeNull();
    expect(containerChangeRefused(holding, "text")).toEqual({ holds: 3 });
  });

  it("an empty group may become anything", () => {
    expect(
      containerChangeRefused({ ...holding, fields: [] }, "text")
    ).toBeNull();
  });
});

describe("where Change type… is offered", () => {
  const field = { id: "f-1", name: "kind", label: "Kind", type: "text" };
  it("on a field that can be changed, not a read-only one or a built-in one", () => {
    expect(changeTypeOffered(field as BuilderField, false)).toBe(true);
    expect(changeTypeOffered(field as BuilderField, true)).toBe(false);
    expect(
      changeTypeOffered({ ...field, isSystem: true } as BuilderField, false)
    ).toBe(false);
  });
});
