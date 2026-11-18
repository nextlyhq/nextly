// @vitest-environment jsdom
/**
 * Escape in a field being edited puts back the value from before the edit and
 * records nothing; pressed again in that field, it leaves it. Driven through
 * `useStoredDraft`, the hook every inspector text field holds its draft in,
 * with a field that writes on blur as the inspector's do.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { escapeFieldEdit } from "./field-edit";
import { useStoredDraft } from "./stored-draft";
import { useDraft } from "./style-text-field";

afterEach(cleanup);

/** A text field holding its draft, writing it on blur as the inspector's do. */
function Field(props: {
  readonly label: string;
  readonly stored: string;
  readonly onCommit: (value: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useStoredDraft(props.stored);
  return (
    <input
      aria-label={props.label}
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== props.stored) props.onCommit(draft);
      }}
    />
  );
}

/** Focus `field` and type `words` into it, as a person does. */
function typeInto(field: HTMLInputElement, words: string): void {
  act(() => field.focus());
  fireEvent.change(field, { target: { value: words } });
}

describe("Escape in a field being edited", () => {
  it("puts back the stored value, and the field then writes nothing when left", () => {
    const onCommit = vi.fn();
    render(<Field label="Text" stored="Before" onCommit={onCommit} />);
    const field = screen.getByLabelText<HTMLInputElement>("Text");
    typeInto(field, "Half typed");

    let outcome = "";
    act(() => {
      outcome = escapeFieldEdit(field);
    });
    expect(outcome).toBe("put-back");
    expect(field.value).toBe("Before");

    act(() => field.blur());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("leaves the field on the next press, and does nothing on the one after", () => {
    render(<Field label="Text" stored="Before" onCommit={() => undefined} />);
    const field = screen.getByLabelText<HTMLInputElement>("Text");
    typeInto(field, "Half typed");
    act(() => {
      escapeFieldEdit(field);
    });
    expect(escapeFieldEdit(field)).toBe("leave-field");
    expect(escapeFieldEdit(field)).toBe("none");
  });

  it("never puts back a field the press was not in", () => {
    render(
      <>
        <Field label="Edited" stored="Before" onCommit={() => undefined} />
        <Field label="Other" stored="Other" onCommit={() => undefined} />
      </>
    );
    const edited = screen.getByLabelText<HTMLInputElement>("Edited");
    typeInto(edited, "Half typed");
    expect(escapeFieldEdit(screen.getByLabelText("Other"))).toBe("none");
    expect(edited.value).toBe("Half typed");
  });

  it("has nothing to put back once the draft is stored", () => {
    const { rerender } = render(
      <Field label="Text" stored="Before" onCommit={() => undefined} />
    );
    const field = screen.getByLabelText<HTMLInputElement>("Text");
    typeInto(field, "Stored now");
    // The document takes the value, as a commit's write does.
    rerender(
      <Field label="Text" stored="Stored now" onCommit={() => undefined} />
    );
    expect(escapeFieldEdit(field)).toBe("none");
    expect(field.value).toBe("Stored now");
  });

  it("has nothing to put back for a field typed back to its stored value", () => {
    render(<Field label="Text" stored="Same" onCommit={() => undefined} />);
    const field = screen.getByLabelText<HTMLInputElement>("Text");
    typeInto(field, "Sam");
    fireEvent.change(field, { target: { value: "Same" } });
    expect(escapeFieldEdit(field)).toBe("none");
  });

  it("puts back an edit again after another field's edit displaced it", () => {
    // A field whose write was refused keeps its draft, the stored value
    // unchanged, as a field holding an invalid link does.
    render(
      <>
        <Field label="Refused" stored="Before" onCommit={() => undefined} />
        <Field label="Other" stored="Other" onCommit={() => undefined} />
      </>
    );
    const refused = screen.getByLabelText<HTMLInputElement>("Refused");
    typeInto(refused, "Kept draft");
    typeInto(screen.getByLabelText<HTMLInputElement>("Other"), "Other edit");
    typeInto(refused, "Kept draft, more");
    let outcome = "";
    act(() => {
      outcome = escapeFieldEdit(refused);
    });
    expect(outcome).toBe("put-back");
    expect(refused.value).toBe("Before");
  });
});

/** A Style tab field, holding its draft as the Style tab's text fields do. */
function StyleField(): React.JSX.Element {
  const { draft, setDraft } = useDraft("16px");
  return (
    <input
      aria-label="Font size"
      value={draft}
      onChange={event => setDraft(event.target.value)}
    />
  );
}

describe("Escape in a Style field being edited", () => {
  it("puts back the stored value, as in a Content field", () => {
    render(<StyleField />);
    const field = screen.getByLabelText<HTMLInputElement>("Font size");
    typeInto(field, "24px");
    let outcome = "";
    act(() => {
      outcome = escapeFieldEdit(field);
    });
    expect(outcome).toBe("put-back");
    expect(field.value).toBe("16px");
  });
});
