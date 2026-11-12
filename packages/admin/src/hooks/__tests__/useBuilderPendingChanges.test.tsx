// The Builder's pending changes, through the hooks a builder page uses: the
// real field builder, holding the undo history, and the entity state, holding
// what was saved. The fixture avoids "title" and "slug", which are the
// builder's own system rows and never a change. Every edit waits as a pending change; undo and redo step
// through states of the fields; Discard all puts back what was saved.
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderHook } from "@admin/__tests__/utils";
import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import type { FieldDefinition } from "@admin/types/collection";

import { useBuilderEntityState } from "../useBuilderEntityState";
import { useFieldBuilder } from "../useFieldBuilder";

type Entity = { slug: string; name: string; fields: FieldDefinition[] };

const definition = (
  name: string,
  extra: Partial<FieldDefinition> = {}
): FieldDefinition => ({
  name,
  label: name[0]?.toUpperCase() + name.slice(1),
  type: "text",
  required: false,
  unique: false,
  index: false,
  ...extra,
});

const entity: Entity = {
  slug: "posts",
  name: "Post",
  fields: [
    definition("headline"),
    definition("summary"),
    definition("address", {
      type: "group",
      fields: [definition("street"), definition("city"), definition("zip")],
    }),
  ],
};

const settingsOf = (loaded: Entity): BuilderSettingsValues => ({
  singularName: loaded.name,
  slug: loaded.slug,
  icon: "Database",
});

function setup() {
  const rendered = renderHook(() => {
    const builder = useFieldBuilder({
      resolver: async values => ({ values, errors: {} }),
      defaultValues: {},
    });
    const state = useBuilderEntityState({
      entity,
      builder,
      toFields: loaded => loaded.fields,
      toSettings: settingsOf,
      isDirty: (a, b) => !!a && !!b && a.singularName !== b.singularName,
      onLoad: () => {},
      identity: loaded => loaded.slug,
    });
    return { builder, state };
  });
  const field = (name: string): BuilderField => {
    const find = (fields: BuilderField[]): BuilderField | undefined =>
      fields.flatMap(f => [f, ...(f.fields ?? [])]).find(f => f.name === name);
    const found = find(rendered.result.current.builder.fields);
    if (!found) throw new Error(`no field named ${name}`);
    return found;
  };
  return { ...rendered, field };
}

describe("builder pending changes", () => {
  it("starts with none, and nothing to undo", () => {
    const { result } = setup();
    expect(result.current.state.pending.changes).toEqual([]);
    expect(result.current.state.unsavedCount).toBe(0);
    expect(result.current.state.pending.canUndo).toBe(false);
  });

  it("typing a field's setting is one change and one undo step", () => {
    const { result, field } = setup();
    const title = field("headline");
    for (const label of ["H", "He", "Hea", "Head"]) {
      act(() => result.current.builder.handleFieldUpdate({ ...title, label }));
    }
    expect(result.current.state.unsavedCount).toBe(1);
    act(() => {
      result.current.state.pending.undo();
    });
    expect(field("headline").label).toBe("Headline");
    expect(result.current.state.unsavedCount).toBe(0);
    act(() => {
      result.current.state.pending.redo();
    });
    expect(field("headline").label).toBe("Head");
  });

  it("each edit of another field, an add and a delete are steps of their own", () => {
    const { result, field } = setup();
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("headline"),
        label: "A",
      })
    );
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("summary"),
        label: "B",
      })
    );
    act(() => result.current.builder.handleFieldAdd("text"));
    act(() => result.current.builder.handleFieldDelete(field("address").id));
    expect(result.current.state.unsavedCount).toBe(4);
    for (let step = 0; step < 4; step += 1) {
      act(() => {
        result.current.state.pending.undo();
      });
    }
    expect(result.current.state.unsavedCount).toBe(0);
    expect(result.current.state.pending.canUndo).toBe(false);
  });

  it("a deleted container is one pending delete naming the fields inside, and undo brings them back", () => {
    const { result, field } = setup();
    act(() => result.current.builder.handleFieldDelete(field("address").id));
    expect(result.current.state.pending.changes).toMatchObject([
      { kind: "deleted", name: "address", inside: 3 },
    ]);
    let announced: string | null = null;
    act(() => {
      announced = result.current.state.pending.undo();
    });
    expect(announced).toBe("Undid: deleted Address and 3 fields inside");
    expect(field("street").name).toBe("street");
    expect(result.current.state.pending.changes).toEqual([]);
  });

  it("undo and redo say what they did", () => {
    const { result, field } = setup();
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("summary"),
        name: "excerpt",
      })
    );
    let announced: string | null = null;
    act(() => {
      announced = result.current.state.pending.undo();
    });
    expect(announced).toBe("Undid: renamed summary to excerpt");
    act(() => {
      announced = result.current.state.pending.redo();
    });
    expect(announced).toBe("Redid: renamed summary to excerpt");
  });

  it("discard all puts back the saved fields and settings, and leaves nothing to undo", () => {
    const { result, field } = setup();
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("headline"),
        label: "X",
      })
    );
    act(() => result.current.builder.handleFieldAdd("text"));
    act(() =>
      result.current.state.setSettings({
        ...settingsOf(entity),
        singularName: "Article",
      })
    );
    expect(result.current.state.unsavedCount).toBe(3);
    act(() => result.current.state.pending.discardAll());
    expect(result.current.state.unsavedCount).toBe(0);
    expect(field("headline").label).toBe("Headline");
    expect(result.current.state.settings?.singularName).toBe("Post");
    expect(result.current.state.pending.canUndo).toBe(false);
    expect(result.current.builder.fields.some(f => f.isSystem)).toBe(true);
  });

  it("after a save, what was changed is the saved state, with nothing to undo", () => {
    const { result, field } = setup();
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("headline"),
        label: "X",
      })
    );
    act(() => result.current.state.pinFields());
    expect(result.current.state.unsavedCount).toBe(0);
    expect(result.current.state.pending.canUndo).toBe(false);
    expect(field("headline").label).toBe("X");
  });

  it("an edit made while a save is in flight stays pending and undoable once it lands", () => {
    const { result, field } = setup();
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("headline"),
        label: "A",
      })
    );
    // The save is sent with the fields as they are now…
    const pinWhenSaved = result.current.state.pinFields;
    // …and another edit is made before it lands.
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("summary"),
        label: "B",
      })
    );
    act(() => pinWhenSaved());
    expect(result.current.state.pending.changes).toMatchObject([
      { kind: "settings", name: "summary" },
    ]);
    expect(result.current.state.pending.canUndo).toBe(true);
    act(() => {
      result.current.state.pending.undo();
    });
    expect(field("summary").label).toBe("Summary");
    expect(field("headline").label).toBe("A");
    expect(result.current.state.unsavedCount).toBe(0);
    expect(result.current.state.pending.canUndo).toBe(false);
  });

  it("an edit of the same field made while a save is in flight undoes back to what was saved", () => {
    const { result, field } = setup();
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("headline"),
        label: "A",
      })
    );
    const pinWhenSaved = result.current.state.pinFields;
    // The same field again: one step with the edit the save sent, as typing is.
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("headline"),
        label: "AB",
      })
    );
    act(() => pinWhenSaved());
    expect(result.current.state.unsavedCount).toBe(1);
    act(() => {
      result.current.state.pending.undo();
    });
    // Back to the saved value, not past it.
    expect(field("headline").label).toBe("A");
    expect(result.current.state.unsavedCount).toBe(0);
    expect(result.current.state.pending.canUndo).toBe(false);
  });

  it("edits made after a same-field edit during a save stay steps of their own", () => {
    const { result, field } = setup();
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("headline"),
        label: "A",
      })
    );
    const pinWhenSaved = result.current.state.pinFields;
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("headline"),
        label: "AB",
      })
    );
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("summary"),
        label: "S",
      })
    );
    act(() => pinWhenSaved());
    // One undo takes back the last edit only.
    act(() => {
      result.current.state.pending.undo();
    });
    expect(field("summary").label).toBe("Summary");
    expect(field("headline").label).toBe("AB");
    act(() => {
      result.current.state.pending.undo();
    });
    expect(field("headline").label).toBe("A");
    expect(result.current.state.unsavedCount).toBe(0);
    expect(result.current.state.pending.canUndo).toBe(false);
  });

  it("the count is the changes plus one for the settings", () => {
    const { result, field } = setup();
    act(() =>
      result.current.builder.handleFieldUpdate({
        ...field("summary"),
        name: "excerpt",
        label: "Excerpt",
      })
    );
    act(() =>
      result.current.state.setSettings({
        ...settingsOf(entity),
        singularName: "Article",
      })
    );
    // A rename and a change of settings on one field, and the entity's own.
    expect(result.current.state.pending.changes).toHaveLength(2);
    expect(result.current.state.unsavedCount).toBe(3);
  });
});
