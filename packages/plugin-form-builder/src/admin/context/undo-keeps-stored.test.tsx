// @vitest-environment jsdom

/**
 * Undo takes back an edit, never what the server stores: a field a save
 * stored stays stored (its type fixed) when an edit made during that save is
 * taken back.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FormBuilderProvider,
  useFieldBookkeeping,
  type FormBuilderInternalValue,
} from "./FormBuilderContext";

afterEach(cleanup);

function mount() {
  let ctx!: FormBuilderInternalValue;
  function Probe() {
    ctx = useFieldBookkeeping();
    return null;
  }
  render(
    <FormBuilderProvider
      initialData={{
        name: "Contact",
        slug: "contact",
        fields: [{ name: "email", label: "Email", type: "email" }],
      }}
    >
      <Probe />
    </FormBuilderProvider>
  );
  return () => ctx;
}

describe("undo after a save", () => {
  it("keeps a field the save stored stored, when it takes back an edit made during the save", () => {
    const form = mount();
    act(() =>
      form().addField({ name: "phone", label: "Phone", type: "phone" })
    );
    expect(form().savedFieldNames.has("phone")).toBe(false);

    // The save begins, and the name is edited while it runs.
    act(() => form().beginSave());
    act(() => form().updateFormData({ name: "Contact us" }));
    // The save lands: it stored both fields, and the edit stays unsaved.
    act(() => {
      form().markAsSaved();
      form().markFieldsSaved(["email", "phone"]);
    });
    expect(form().changeCount).toBe(1);
    expect(form().savedFieldNames.has("phone")).toBe(true);

    act(() => form().undo());

    expect(form().formData.name).toBe("Contact");
    expect(form().changeCount).toBe(0);
    expect(form().savedFieldNames.has("phone")).toBe(true);
  });

  it("still takes a field's rename back to the name it is stored under", () => {
    // The control for the rule above: Undo does restore which names count as
    // stored when an edit moved one, so the rebase must add, not replace.
    const form = mount();
    act(() =>
      form().replaceField("email", {
        name: "work_email",
        label: "Email",
        type: "email",
      })
    );
    expect(form().savedFieldNames.has("work_email")).toBe(true);

    act(() => form().undo());

    expect(form().fields.map(field => field.name)).toEqual(["email"]);
    expect(form().savedFieldNames.has("email")).toBe(true);
    expect(form().savedFieldNames.has("work_email")).toBe(false);
  });
});
