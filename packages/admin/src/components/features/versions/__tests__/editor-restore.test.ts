/**
 * A restore into the editor: the chosen values go into the form as unsaved
 * edits and every other edit stays; Undo puts the earlier values back; and the
 * save that follows names, for each field still holding a restored value, the
 * version it came from. A restored value edited again or undone before the
 * save names none.
 */
import { describe, expect, it } from "vitest";

import { createEditorRestore } from "../editor-restore";

/** A form as the restore sees it: values, and which were set dirty. */
function fakeForm(initial: Record<string, unknown>) {
  const values: Record<string, unknown> = { ...initial };
  const dirty = new Set<string>();
  return {
    values,
    dirty,
    form: {
      getValues: () => ({ ...values }),
      setValue: (
        name: string,
        value: unknown,
        options?: { shouldDirty?: boolean }
      ) => {
        values[name] = value;
        if (options?.shouldDirty) dirty.add(name);
      },
    },
  };
}

describe("createEditorRestore", () => {
  it("puts the chosen values into the form as unsaved edits, and keeps the rest", () => {
    const { values, dirty, form } = fakeForm({
      title: "Now",
      body: "Edited, unsaved",
    });
    const restore = createEditorRestore(form);

    restore.apply({ title: "Then" }, 3);

    expect(values).toEqual({ title: "Then", body: "Edited, unsaved" });
    expect(dirty.has("title")).toBe(true);
  });

  it("puts the earlier values back on Undo, and names no source after it", () => {
    const { values, form } = fakeForm({ title: "Now", body: "B" });
    const restore = createEditorRestore(form);

    const applied = restore.apply({ title: "Then" }, 3);
    applied.undo();

    expect(values).toEqual({ title: "Now", body: "B" });
    expect(restore.restoredFromForSave(form.getValues())).toBeUndefined();
  });

  it("names no source for a value typed back by hand after an Undo", () => {
    const { form } = fakeForm({ title: "Now" });
    const restore = createEditorRestore(form);

    restore.apply({ title: "Then" }, 3).undo();
    // The same text, typed: the person's own edit, not a restored value.
    form.setValue("title", "Then", { shouldDirty: true });

    expect(restore.restoredFromForSave(form.getValues())).toBeUndefined();
  });

  it("names each saved restored field's version, from two versions", () => {
    const { form } = fakeForm({ title: "Now", body: "B now" });
    const restore = createEditorRestore(form);

    restore.apply({ title: "Then" }, 3);
    restore.apply({ body: "B then" }, 5);

    expect(restore.restoredFromForSave(form.getValues())).toEqual({
      title: 3,
      body: 5,
    });
  });

  it("names no source for a restored value edited again before the save", () => {
    const { form } = fakeForm({ title: "Now", body: "B now" });
    const restore = createEditorRestore(form);

    restore.apply({ title: "Then", body: "B then" }, 3);
    form.setValue("title", "Typed over", { shouldDirty: true });

    expect(restore.restoredFromForSave(form.getValues())).toEqual({ body: 3 });
  });

  it("compares structured values by content when deciding what still holds", () => {
    const { form } = fakeForm({ tags: ["x"] });
    const restore = createEditorRestore(form);

    restore.apply({ tags: ["a", "b"] }, 2);
    // The form hands back a fresh array with the same content.
    form.setValue("tags", ["a", "b"]);

    expect(restore.restoredFromForSave(form.getValues())).toEqual({ tags: 2 });
  });

  it("forgets every source once the save is made", () => {
    const { form } = fakeForm({ title: "Now" });
    const restore = createEditorRestore(form);

    restore.apply({ title: "Then" }, 3);
    restore.saved();

    expect(restore.restoredFromForSave(form.getValues())).toBeUndefined();
  });

  it("an older Undo does not take back a later restore of the same field", () => {
    const { values, form } = fakeForm({ title: "Now" });
    const restore = createEditorRestore(form);

    const first = restore.apply({ title: "Then" }, 3);
    restore.apply({ title: "Earlier" }, 2);
    first.undo();

    // The later restore stands: its value and its source.
    expect(values.title).toBe("Earlier");
    expect(restore.restoredFromForSave(form.getValues())).toEqual({ title: 2 });
  });
});
