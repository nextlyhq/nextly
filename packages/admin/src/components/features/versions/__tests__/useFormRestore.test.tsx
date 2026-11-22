/**
 * A form's restore, wired to the form: a reset of the form (another language,
 * document or loaded version) forgets each restore it replaced, so the save
 * after it names no source from before it and the restore's Undo writes
 * nothing into what was loaded.
 */
import { act } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { renderHook } from "@admin/__tests__/utils";

import { useFormRestore } from "../useEditorRestoreSurface";

function useRestorableForm() {
  const form = useForm<Record<string, unknown>>({
    defaultValues: { title: "Now" },
  });
  return { form, restore: useFormRestore(form) };
}

describe("useFormRestore", () => {
  it("forgets a restore once the form is reset to other values", () => {
    const { result } = renderHook(() => useRestorableForm());

    let undo = (): void => undefined;
    act(() => {
      undo = result.current.restore.apply({ title: "Then" }, 3).undo;
    });
    // The document loaded holds the restored value too: it is still not the
    // restore's, and nothing in the form is unsaved.
    act(() => {
      result.current.form.reset({ title: "Then" });
    });
    act(() => undo());

    const { form, restore } = result.current;
    expect(form.getValues("title")).toBe("Then");
    expect(restore.restoredFromForSave(form.getValues())).toBeUndefined();
  });

  it("keeps a restore a reset keeps as an unsaved edit", () => {
    const { result } = renderHook(() => useRestorableForm());

    act(() => {
      result.current.restore.apply({ title: "Then" }, 3);
    });
    act(() => {
      result.current.form.reset({ title: "Stored" }, { keepDirtyValues: true });
    });

    const { form, restore } = result.current;
    expect(form.getValues("title")).toBe("Then");
    expect(restore.restoredFromForSave(form.getValues())).toEqual({ title: 3 });
  });
});
