// @vitest-environment jsdom

/**
 * What the builder's state refuses while a colleague holds the document.
 *
 * The page above renders a strip saying the editor may read this document and
 * not change it. The builder has dozens of controls across four tabs, so the
 * refusal lives once at the state they all reach rather than at each of them.
 *
 * @module admin/context/read-only.test
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FormBuilderProvider,
  useFormBuilder,
  createNotification,
  type FieldBookkeeping,
  type FormBuilderContextValue,
} from "./FormBuilderContext";

afterEach(cleanup);

const FIELD = {
  id: "f2",
  name: "phone",
  label: "Phone",
  type: "text",
} as never;

/**
 * One representative call per action that changes the document.
 *
 * Every action the context publishes is either here or named as one that reads.
 * The completeness case below derives that from the context's own keys, so an
 * action added later fails this file rather than slipping through untested.
 */
const CHANGES_THE_DOCUMENT: Record<
  string,
  (ctx: FormBuilderContextValue) => void
> = {
  setFields: c => c.setFields([FIELD]),
  addField: c => c.addField(FIELD),
  updateField: c => c.updateField("email", { label: "Changed" }),
  // The builder's own bookkeeping, on the same value though off its type.
  replaceField: c =>
    (c as FormBuilderContextValue & FieldBookkeeping).replaceField("email", {
      type: "email",
      name: "email",
      label: "Changed",
    }),
  deleteField: c => c.deleteField("email"),
  moveField: c => c.moveField(0, 1),
  duplicateField: c => c.duplicateField("email"),
  updateFormData: c => c.updateFormData({ name: "Changed" }),
  updateSettings: c => c.updateSettings({ submitButtonText: "Changed" }),
  addNotification: c => c.addNotification(createNotification()),
  duplicateNotification: c => c.duplicateNotification("n1"),
  updateNotification: c => c.updateNotification("n1", { subject: "Changed" }),
  deleteNotification: c => c.deleteNotification("n1"),
  seedNotifications: c => c.seedNotifications([createNotification()]),
  // Takes the last change back, which changes the document as much as making
  // it did.
  undo: c => (c as FormBuilderContextValue & FieldBookkeeping).undo(),
  editField: c => {
    const field = c.fields[0];
    (c as FormBuilderContextValue & FieldBookkeeping).editField(
      field,
      { ...field, label: "Changed" },
      c.fields
    );
  },
};

/** The actions that are navigation or bookkeeping rather than an edit. */
const READS = [
  "selectField",
  "fieldKey",
  "setActiveTab",
  "markAsSaved",
  "beginSave",
  "saveFailed",
  "markFieldsSaved",
];

/**
 * What an action needs done first for it to have anything to do: Undo takes
 * back a change, so a change is made before it, while the editor still holds
 * the document.
 */
const PREPARE: Partial<Record<string, (ctx: FormBuilderContextValue) => void>> =
  { undo: c => c.updateFormData({ name: "Changed" }) };

function mount(readOnly: boolean) {
  let ctx!: FormBuilderContextValue;
  function Probe() {
    ctx = useFormBuilder();
    return null;
  }
  const tree = (held: boolean) => (
    <FormBuilderProvider
      readOnly={held}
      initialData={{
        name: "Contact",
        slug: "contact",
        fields: [
          { id: "f1", name: "email", label: "Email", type: "email" } as never,
        ],
      }}
    >
      <Probe />
    </FormBuilderProvider>
  );
  const { rerender } = render(tree(readOnly));
  const read = () => ctx;
  /** A colleague takes the document, with whatever the editor changed. */
  read.claim = () => rerender(tree(true));
  return read;
}

/**
 * The context with `name`'s preparation made while the editor held the
 * document, then held by a colleague when `held`.
 */
function prepared(name: string, held: boolean) {
  const prepare = PREPARE[name];
  const ctx = mount(held && prepare === undefined);
  if (prepare !== undefined) {
    act(() => prepare(ctx()));
    if (held) act(() => ctx.claim());
  }
  return ctx;
}

/** Everything about the document, as one comparable value. */
const document = (c: FormBuilderContextValue) =>
  JSON.stringify({
    fields: c.fields,
    formData: c.formData,
    settings: c.settings,
    notifications: c.notifications,
    isDirty: c.isDirty,
  });

describe("the form builder's state under a colleague's claim", () => {
  it("covers every action the context publishes", () => {
    // 🔴 Derived from the context itself, not from a list written once. An
    // action added later is in neither table, and this is where that is said.
    const ctx = mount(false)();
    const published = Object.entries(ctx)
      .filter(([, member]) => typeof member === "function")
      .map(([name]) => name);

    expect(published.length).toBeGreaterThan(10);
    expect(
      published.filter(
        name => !(name in CHANGES_THE_DOCUMENT) && !READS.includes(name)
      )
    ).toEqual([]);
  });

  for (const [name, call] of Object.entries(CHANGES_THE_DOCUMENT)) {
    it(`withholds ${name}`, () => {
      const read = prepared(name, true);
      const before = document(read());

      act(() => {
        call(read());
      });

      expect(document(read())).toBe(before);
    });

    it(`allows ${name} when nobody else holds the document`, () => {
      // The control for the case above. Without it "nothing changed" is
      // satisfied by a call that never does anything, and every refusal here
      // would pass against a builder that cannot edit at all.
      const write = prepared(name, false);
      const before = document(write());

      act(() => {
        call(write());
      });

      expect(document(write())).not.toBe(before);
    });
  }

  it("still lets the editor move around the document", () => {
    const read = mount(true);

    act(() => {
      read().selectField("email");
      read().setActiveTab("settings");
    });

    expect(read().selectedFieldId).toBe("email");
    expect(read().activeTab).toBe("settings");
  });
});
