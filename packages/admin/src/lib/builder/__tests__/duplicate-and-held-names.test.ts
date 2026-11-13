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
  it("passes over a name a sibling holds once the save normalises it", () => {
    // `foo-2` is sent as `foo_2`, so a copy named `foo_2` would clash at save.
    const fields = [plain("f-foo", "foo"), plain("f-other", "foo-2")];
    const after = duplicatedFields(fields, "f-foo");
    expect(namesAt(after ?? [])).toEqual(["foo", "foo_3", "foo-2"]);
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
