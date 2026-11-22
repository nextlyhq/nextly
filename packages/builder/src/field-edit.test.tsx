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

import {
  escapeFieldEdit,
  FieldsOfDocument,
  finishFieldEdit,
  useFieldDraftHeld,
} from "./field-edit";
import { useLiveDraft } from "./live-draft";
import { useStoredDraft } from "./stored-draft";
import { useDraft } from "./inspector/style-inspector/style-text-field";

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

/**
 * A field of the document, as the block settings panel draws its fields:
 * its write moves the stored value, as an editor answering the write does.
 */
function DocumentField(props: {
  readonly onCommit: (value: string) => void;
}): React.JSX.Element {
  const [stored, setStored] = React.useState("Before");
  return (
    <FieldsOfDocument.Provider value={true}>
      <Field
        label="Text"
        stored={stored}
        onCommit={value => {
          props.onCommit(value);
          setStored(value);
        }}
      />
    </FieldsOfDocument.Provider>
  );
}

/** Whether a field of the document holds a draft, as the editor reads it. */
function Held(): React.JSX.Element {
  return <output aria-label="Held">{String(useFieldDraftHeld())}</output>;
}

const held = (): string | null => screen.getByLabelText("Held").textContent;

describe("a draft in a field of the document, before the page is stored", () => {
  it("is written as leaving the field writes it, and the field keeps focus", () => {
    const onCommit = vi.fn();
    render(<DocumentField onCommit={onCommit} />);
    const field = screen.getByLabelText<HTMLInputElement>("Text");
    typeInto(field, "Typed");

    act(() => finishFieldEdit());

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Typed");
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("Typed");
  });

  it("is unsaved work from its first keystroke until it is written", () => {
    render(
      <>
        <DocumentField onCommit={() => undefined} />
        <Held />
      </>
    );
    expect(held()).toBe("false");
    const field = screen.getByLabelText<HTMLInputElement>("Text");
    typeInto(field, "B");
    expect(held()).toBe("true");

    act(() => finishFieldEdit());
    expect(held()).toBe("false");
  });

  it("is no unsaved work once Escape puts it back", () => {
    render(
      <>
        <DocumentField onCommit={() => undefined} />
        <Held />
      </>
    );
    const field = screen.getByLabelText<HTMLInputElement>("Text");
    typeInto(field, "Half typed");
    act(() => {
      escapeFieldEdit(field);
    });
    expect(held()).toBe("false");
  });

  it("is written once: a field already left has nothing more to write", () => {
    const onCommit = vi.fn();
    render(<DocumentField onCommit={onCommit} />);
    const field = screen.getByLabelText<HTMLInputElement>("Text");
    typeInto(field, "Typed");
    act(() => field.blur());

    act(() => finishFieldEdit());
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("is neither written nor counted in a field outside the document's", () => {
    // A site variable's field, say, which writes to the site when it is
    // left: the page holds none of it.
    const onCommit = vi.fn();
    render(
      <>
        <Field label="Text" stored="Before" onCommit={onCommit} />
        <Held />
      </>
    );
    typeInto(screen.getByLabelText<HTMLInputElement>("Text"), "Typed");
    expect(held()).toBe("false");

    act(() => finishFieldEdit());
    expect(onCommit).not.toHaveBeenCalled();
  });
});

/**
 * A field of the document whose commit trims what was typed, as a length's
 * does: `2px ` is written as nothing, since `2px` is stored already.
 */
function TrimmingField(props: {
  readonly onCommit: (value: string) => void;
}): React.JSX.Element {
  const stored = "2px";
  const [draft, setDraft] = useStoredDraft(stored);
  return (
    <input
      aria-label="Thickness"
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next !== stored) props.onCommit(next);
      }}
    />
  );
}

describe("a draft that settles to what is stored", () => {
  it("is no unsaved work once a store has finished it, though nothing was written", () => {
    const onCommit = vi.fn();
    render(
      <FieldsOfDocument.Provider value={true}>
        <TrimmingField onCommit={onCommit} />
        <Held />
      </FieldsOfDocument.Provider>
    );
    typeInto(screen.getByLabelText<HTMLInputElement>("Thickness"), "2px ");
    expect(held()).toBe("true");

    act(() => finishFieldEdit());
    expect(onCommit).not.toHaveBeenCalled();
    expect(held()).toBe("false");
  });

  it("is no unsaved work once the field is left, though nothing was written", () => {
    render(
      <FieldsOfDocument.Provider value={true}>
        <TrimmingField onCommit={() => undefined} />
        <Held />
      </FieldsOfDocument.Provider>
    );
    const field = screen.getByLabelText<HTMLInputElement>("Thickness");
    typeInto(field, "2px ");
    expect(held()).toBe("true");
    act(() => field.blur());
    expect(held()).toBe("false");
  });
});

/** A field of the document that writes each keystroke as it goes in. */
function LiveField(props: {
  readonly onWrite: (value: string) => void;
}): React.JSX.Element {
  const [stored, setStored] = React.useState("Before");
  const live = useLiveDraft(stored);
  return (
    <input
      aria-label="Live"
      value={live.draft}
      onChange={event =>
        live.type(event.target.value, text => {
          props.onWrite(text);
          setStored(text);
          return true;
        })
      }
      onBlur={() => live.end()}
    />
  );
}

describe("a field of the document that writes as it is typed", () => {
  it("is no draft: its keystrokes are in the document already", () => {
    const onWrite = vi.fn();
    render(
      <FieldsOfDocument.Provider value={true}>
        <LiveField onWrite={onWrite} />
        <Held />
      </FieldsOfDocument.Provider>
    );
    typeInto(screen.getByLabelText<HTMLInputElement>("Live"), "Typed");
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(held()).toBe("false");

    act(() => finishFieldEdit());
    expect(onWrite).toHaveBeenCalledTimes(1);
  });
});
