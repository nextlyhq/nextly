/**
 * The header's title shows what the FORM holds, not a copy it keeps itself.
 *
 * A takeover surface — the page builder — covers this header while editing, and
 * its settings panel can rename the document. The header stays mounted behind
 * it. While this input kept its own copy of the value, a rename made through
 * that panel never reached it: the author left the editor, saw the old name,
 * and the next keystroke here saved the old name back over the rename.
 *
 * Two surfaces render one field, so the property under test is that they cannot
 * disagree. The other surface is stood in for by a plain controlled input on
 * the same form rather than by mounting the whole page builder — what matters
 * is that the edit arrives through the form rather than through this input, and
 * a second control is the smallest thing that does that faithfully.
 *
 * @module components/features/entries/EntryForm/__tests__/EntrySystemHeader.title-sync.test
 */
import { useForm, FormProvider, Controller } from "react-hook-form";
import { describe, it, expect, vi } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";

import { EntrySystemHeader } from "../EntrySystemHeader";

/** The header, plus a second surface editing the same field through the form. */
function Harness() {
  const methods = useForm({ defaultValues: { title: "About Us" } });
  return (
    <FormProvider {...methods}>
      <EntrySystemHeader
        mode="edit"
        hasStatus
        entry={{ id: "about", status: "draft", title: "About Us" }}
        collectionSlug="pages"
        scope="single"
        onSaveDraft={vi.fn()}
        onPublish={vi.fn()}
        onSaveChanges={vi.fn()}
        onUnpublish={vi.fn()}
        onCancel={vi.fn()}
      />
      <Controller
        name="title"
        control={methods.control}
        render={({ field }) => (
          <input
            aria-label="settings panel title"
            value={typeof field.value === "string" ? field.value : ""}
            onChange={event => field.onChange(event.target.value)}
          />
        )}
      />
    </FormProvider>
  );
}

const headerTitle = () => screen.getByLabelText("Title") as HTMLInputElement;

describe("the header's title and another surface editing the same field", () => {
  it("shows a rename made through the OTHER surface", () => {
    /*
     * The defect, stated as the property it violated. Before this input read
     * from the form, it answered `About Us` here — the value it was seeded
     * with — while the form already held the new one.
     */
    render(<Harness />);
    expect(headerTitle().value).toBe("About Us");

    fireEvent.change(screen.getByLabelText("settings panel title"), {
      target: { value: "Our Story" },
    });

    expect(headerTitle().value).toBe("Our Story");
  });

  it("sends its own edits the other way", () => {
    /*
     * The control, and it has to come out different or the case above says only
     * that both inputs render the same initial value. An input that read the
     * form but never wrote to it would satisfy the first test completely.
     */
    render(<Harness />);
    const other = screen.getByLabelText(
      "settings panel title"
    ) as HTMLInputElement;

    fireEvent.change(headerTitle(), { target: { value: "Renamed Here" } });

    expect(other.value).toBe("Renamed Here");
    expect(headerTitle().value).toBe("Renamed Here");
  });

  it("still reports an empty title as empty rather than as the seeded value", () => {
    // Clearing is an edit like any other, and a controlled input that fell back
    // to its default when handed an empty string would refuse to be cleared —
    // the failure mode a `value ?? initial` fallback produces.
    render(<Harness />);

    fireEvent.change(headerTitle(), { target: { value: "" } });

    expect(headerTitle().value).toBe("");
  });
});
