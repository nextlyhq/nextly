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
  withTypeChanged,
} from "../change-type";

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

  it("a group becoming repeating rows keeps the fields it holds", () => {
    const inside = [{ id: "f-2", name: "a", label: "A", type: "text" }];
    expect(changed({ type: "group", fields: inside }, "repeater").fields).toBe(
      inside
    );
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
