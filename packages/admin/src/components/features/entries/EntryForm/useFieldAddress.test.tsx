/**
 * The address a field's way into a document view is built from: inside a
 * repeater's row, the row's saved id rather than its position, and none for
 * a row not saved yet, with the reason the field's card says.
 */
import { act, renderHook } from "@testing-library/react";
import type { FieldConfig } from "nextly/config";
import type { ReactNode } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { EntryFormContextProvider } from "./EntryFormContext";
import { useFieldAddress, type FieldAddress } from "./useFieldAddress";

const fields = [
  { name: "title", type: "text" },
  {
    name: "sections",
    type: "repeater",
    fields: [
      { name: "heading", type: "text" },
      { name: "body", type: "blocks" },
    ],
  },
  {
    name: "slides",
    type: "repeater",
    fields: [
      { name: "id", type: "text" },
      { name: "body", type: "blocks" },
    ],
  },
] as unknown as FieldConfig[];

const stored = {
  title: "Home",
  sections: [
    { id: "row-a", heading: "Intro", body: null },
    { id: "row-b", heading: "Hero banner", body: null },
  ],
  slides: [{ id: "mine", body: null }],
};

/** The form as the entry editor holds it, with the document's fields. */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <EntryFormContextProvider
      collectionSlug="pages"
      entryId="p1"
      fields={fields}
    >
      {children}
    </EntryFormContextProvider>
  );
}

/** Renders the hook for `path` on a form loaded with the stored document. */
function addressOf(path: string) {
  return renderHook(
    () => {
      const form: UseFormReturn<Record<string, unknown>> = useForm<
        Record<string, unknown>
      >({ defaultValues: stored });
      return { form, address: useFieldAddress(form.control, path) };
    },
    { wrapper }
  );
}

describe("useFieldAddress", () => {
  it("names a saved row by its id, not its position", () => {
    const { result } = addressOf("sections.1.body");
    expect(result.current.address).toEqual<FieldAddress>({
      address: "sections.row-b.body",
    });
  });

  it("follows the row when the rows are reordered", () => {
    // The field now at position 1 is `row-a`'s: its address names `row-a`.
    const { result } = addressOf("sections.1.body");
    act(() => {
      result.current.form.setValue("sections", [
        stored.sections[1],
        stored.sections[0],
      ]);
    });
    expect(result.current.address).toEqual<FieldAddress>({
      address: "sections.row-a.body",
    });
  });

  it("has none for a row added since the last save, saying to save once", () => {
    // The admin gives a new row an id at once, but the stored document does
    // not have it, so an address to it would find nothing after a reload.
    const { result } = addressOf("sections.2.body");
    act(() => {
      result.current.form.setValue("sections", [
        ...stored.sections,
        { id: "row-new", heading: "", body: null },
      ]);
    });
    expect(result.current.address).toEqual<FieldAddress>({
      unavailable: "unsavedRow",
    });
  });

  it("has none in a repeater whose rows declare their own id", () => {
    const { result } = addressOf("slides.0.body");
    expect(result.current.address).toEqual<FieldAddress>({
      unavailable: "ownIds",
    });
  });

  it("is the form path itself outside repeaters", () => {
    const { result } = addressOf("title");
    expect(result.current.address).toEqual<FieldAddress>({ address: "title" });
  });
});
