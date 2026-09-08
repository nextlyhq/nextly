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

  it("shows a NUMERIC title, which a code-first schema may legitimately declare", () => {
    /*
     * `title` is an ownable system column and core covers a required number
     * one, so a document may hold `42` here. Accepting only strings showed such
     * a title as "Untitled" over saved content — an empty box where the form
     * held a real value, which is the reverse of the defect this control exists
     * to fix.
     */
    function NumericHarness() {
      const methods = useForm({ defaultValues: { title: 42 } });
      return (
        <FormProvider {...methods}>
          <EntrySystemHeader
            mode="edit"
            hasStatus
            entry={{ id: "n", status: "draft", title: 42 }}
            collectionSlug="pages"
            scope="single"
            onSaveDraft={vi.fn()}
            onPublish={vi.fn()}
            onSaveChanges={vi.fn()}
            onUnpublish={vi.fn()}
            onCancel={vi.fn()}
          />
        </FormProvider>
      );
    }

    render(<NumericHarness />);
    expect(headerTitle().value).toBe("42");
  });

  it("shows a BOOLEAN title, which a checkbox owning the column produces", () => {
    /*
     * The second omission of the same shape, which is why the accepted types
     * are now a set rather than a chain. A `checkbox` field may own `title`,
     * and the registered input this replaced displayed `true` — measured, not
     * assumed. Refusing it shows "Untitled" over a saved value, which lies
     * about the document.
     */
    function BooleanHarness() {
      const methods = useForm({ defaultValues: { title: true } });
      return (
        <FormProvider {...methods}>
          <EntrySystemHeader
            mode="edit"
            hasStatus
            entry={{ id: "b", status: "draft" }}
            collectionSlug="pages"
            scope="single"
            onSaveDraft={vi.fn()}
            onPublish={vi.fn()}
            onSaveChanges={vi.fn()}
            onUnpublish={vi.fn()}
            onCancel={vi.fn()}
          />
        </FormProvider>
      );
    }

    render(<BooleanHarness />);
    expect(headerTitle().value).toBe("true");
  });

  it("still shows nothing for a value no text input can draw", () => {
    // The control for the case above. Widening to "any primitive" must not
    // widen to "anything": an object would render as `[object Object]`, which
    // is worse than empty because it looks like content.
    function ObjectHarness() {
      const methods = useForm({
        defaultValues: { title: { nested: "value" } as unknown },
      });
      return (
        <FormProvider {...methods}>
          <EntrySystemHeader
            mode="edit"
            hasStatus
            entry={{ id: "o", status: "draft" }}
            collectionSlug="pages"
            scope="single"
            onSaveDraft={vi.fn()}
            onPublish={vi.fn()}
            onSaveChanges={vi.fn()}
            onUnpublish={vi.fn()}
            onCancel={vi.fn()}
          />
        </FormProvider>
      );
    }

    render(<ObjectHarness />);
    expect(headerTitle().value).toBe("");
  });
});
