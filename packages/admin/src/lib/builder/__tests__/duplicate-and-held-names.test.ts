import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { duplicatedFields } from "../duplicate-field";
import { heldNamesOf } from "../move-words";

function plain(
  id: string,
  name: string,
  extra: Partial<BuilderField> = {}
): BuilderField {
  return { id, name, label: name, type: "text", ...extra } as BuilderField;
}

/** The names on the top level and, for a container, inside it. */
function namesAt(
  fields: readonly BuilderField[],
  containerId?: string
): string[] {
  const list = containerId
    ? (fields.find(field => field.id === containerId)?.fields ?? [])
    : fields;
  return list.map(field => field.name);
}

describe("naming a duplicate as the save will judge it", () => {
  it("passes over a name a sibling holds as the save sends it", () => {
    // A sibling already holds `foo_2`, so the copy takes the next free number.
    const fields = [plain("f-foo", "foo"), plain("f-other", "foo_2")];
    const after = duplicatedFields(fields, "f-foo");
    expect(namesAt(after ?? [])).toEqual(["foo", "foo_3", "foo_2"]);
  });

  it("judges a sibling's name as it is sent, not as a label would derive it", () => {
    // Every name goes to the save as it is, so `foo-2` stays `foo-2` and takes nothing from a
    // copy named `foo_2`; the save refuses `foo-2` itself, naming the field.
    const fields = [plain("f-foo", "foo"), plain("f-other", "foo-2")];
    const after = duplicatedFields(fields, "f-foo");
    expect(namesAt(after ?? [])).toEqual(["foo", "foo_2", "foo-2"]);
  });

  it("names a copy inside a layout group against the level holding it", () => {
    // A nameless group's fields are stored beside the fields around it.
    const fields = [
      plain("f-layout", "", {
        type: "group",
        fields: [plain("f-body", "body")],
      }),
      plain("f-body-2", "body_2"),
    ];
    const after = duplicatedFields(fields, "f-body") ?? [];
    expect(namesAt(after, "f-layout")).toEqual(["body", "body_3"]);
  });

  it("names each field a copied layout group carries against the level holding it", () => {
    // The copy's fields are stored beside the original's, so each needs a free name there.
    const fields = [
      plain("f-layout", "", {
        type: "group",
        fields: [plain("f-body", "body"), plain("f-title", "title")],
      }),
      plain("f-body-2", "body_2"),
    ];
    const after = duplicatedFields(fields, "f-layout") ?? [];
    expect(after.map(field => field.name)).toEqual(["", "", "body_2"]);
    expect(after[1]?.fields?.map(field => field.name)).toEqual([
      "body_3",
      "title_2",
    ]);
  });

  it("keeps a copied layout group's fields clear of each other's new names", () => {
    // `a` passes over the original's `a_2` to `a_3`, so the copy of `a_2` must pass over it too.
    const fields = [
      plain("f-layout", "", {
        type: "group",
        fields: [plain("f-a", "a"), plain("f-a-2", "a_2")],
      }),
    ];
    const after = duplicatedFields(fields, "f-layout") ?? [];
    expect(after[1]?.fields?.map(field => field.name)).toEqual(["a_3", "a_4"]);
  });
});

describe("heldNamesOf", () => {
  it("holds a deleted field's name on the storage level a layout group stands on", () => {
    const saved = [
      plain("f-layout", "", {
        type: "group",
        fields: [plain("f-old", "old")],
      }),
    ];
    const current = [plain("f-layout", "", { type: "group", fields: [] })];
    const held = heldNamesOf(saved, current);
    expect(held.get("")).toEqual(["old"]);
    expect(held.get("f-layout")).toBeUndefined();
  });
});
