// @vitest-environment jsdom

/**
 * The form an author meets on the way into the library.
 *
 * Two properties are worth more than the rest. **The draft survives a refused
 * save** — a name collision is the expected failure, and it is fixed by editing
 * a field that has to still be on screen. And **the granularity has no
 * default**, because nothing downstream can tell an author who has not answered
 * from one whose answer happens to be the default.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  PATTERN_GRANULARITIES,
  type SavePatternFields,
} from "../library-contract";

import { SavePatternDialog } from "./SavePatternDialog";

function mount(
  overrides: Partial<React.ComponentProps<typeof SavePatternDialog>> = {}
) {
  const onSave = vi.fn(async () => true);
  const onOpenChange = vi.fn();
  render(
    <SavePatternDialog
      open
      onOpenChange={onOpenChange}
      subject="3 blocks"
      onSave={onSave}
      {...overrides}
    />
  );
  return { onSave, onOpenChange };
}

/** Fill the two required fields the way an author would. */
function fillRequired(title = "Hero"): void {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: title } });
  fireEvent.click(screen.getByRole("radio", { name: "Section" }));
}

describe("what the form asks for", () => {
  it("says what is being saved, and that the page is left alone", () => {
    // The canvas is behind a modal by now, so this is the only thing telling
    // an author how much of their selection is travelling — and a pattern is
    // copy-on-insert, which is not obvious from a button called Save.
    mount({ subject: "Hero banner" });

    expect(screen.getByText(/Hero banner/)).toBeTruthy();
    expect(screen.getByText(/page is not\s+changed/i)).toBeTruthy();
  });

  it("does NOT ask for a slug", () => {
    // It is an identity rather than an address, and the route derives it. A
    // field here would be a second one restating the name.
    mount();

    expect(screen.queryByLabelText(/slug/i)).toBeNull();
  });

  it("offers every granularity the vocabulary holds", () => {
    // Derived from the contract rather than from a list written here, so a
    // granularity added to the vocabulary is covered the day it arrives.
    mount();

    expect(screen.getAllByRole("radio")).toHaveLength(
      PATTERN_GRANULARITIES.length
    );
  });

  it("explains what the chosen granularity means", () => {
    // The page case is the footgun this exists for: choosing it files the
    // pattern somewhere the author is not expecting to find it.
    // Every hint is visible without opening anything: an author choosing
    // "Page" has to be able to read what it means before they choose it, not
    // after.
    mount();

    expect(screen.getByText(/not when inserting into one/i)).toBeTruthy();
  });

  it("suggests the categories the library already uses", () => {
    mount({ categories: ["Heroes", "Footers"] });

    const suggestions = Array.from(
      screen.getByLabelText(/Category/).ownerDocument.querySelectorAll("option")
    ).map(option => option.getAttribute("value"));

    expect(suggestions).toEqual(expect.arrayContaining(["Heroes", "Footers"]));
  });
});

describe("what the form refuses to submit", () => {
  it("will not save without a name", () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Section" }));

    expect(
      screen
        .getByRole("button", { name: /save pattern/i })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("will not save without a granularity, which has no default", () => {
    // A default would make the form completable without a decision and file the
    // mistakes silently.
    mount();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Hero" },
    });

    expect(
      screen
        .getByRole("button", { name: /save pattern/i })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("will not save a name that is only spaces", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Section" }));

    expect(
      screen
        .getByRole("button", { name: /save pattern/i })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("starts with NO granularity chosen", () => {
    // Asserted directly rather than only through the disabled button: a default
    // would make the form completable without a decision and file the mistakes
    // silently.
    mount();

    expect(
      screen
        .getAllByRole("radio")
        .filter(r => r.getAttribute("aria-checked") === "true")
    ).toEqual([]);
  });
});

describe("what the form sends, and what it does afterwards", () => {
  it("sends the trimmed fields the author filled, and nothing empty", () => {
    // Empty optional fields are OMITTED rather than sent blank: a description
    // of "" is a description the collection stores, and it reads back as a
    // pattern someone described with nothing.
    const { onSave } = mount();
    fillRequired("  Hero  ");
    fireEvent.change(screen.getByLabelText(/Category/), {
      target: { value: " Heroes " },
    });
    fireEvent.click(screen.getByRole("button", { name: /save pattern/i }));

    expect(onSave).toHaveBeenCalledWith({
      title: "Hero",
      granularity: "section",
      category: "Heroes",
    } satisfies SavePatternFields);
  });

  it("closes once the save is stored", async () => {
    const { onSave, onOpenChange } = mount();
    fillRequired();

    fireEvent.click(screen.getByRole("button", { name: /save pattern/i }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());

    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("KEEPS the draft and stays open when the save is refused", async () => {
    // The property that matters most. A name collision is the expected failure
    // and the remedy is to change the name — which is impossible if the form
    // closed and threw away everything else the author typed.
    const onSave = vi.fn(async () => false);
    const onOpenChange = vi.fn();
    render(
      <SavePatternDialog
        open
        onOpenChange={onOpenChange}
        subject="3 blocks"
        onSave={onSave}
        error="A pattern with that name already exists."
      />
    );
    fillRequired("Hero");
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "The top of the page" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save pattern/i }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("already exists")
    );

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Hero"
    );
    expect(
      (screen.getByLabelText(/Description/) as HTMLTextAreaElement).value
    ).toBe("The top of the page");
  });

  it("says nothing about a failure the author has not caused yet", () => {
    // The reason belongs to the writer and outlives any one form, so a failure
    // left over from an earlier save must not appear beside an untouched form.
    render(
      <SavePatternDialog
        open
        onOpenChange={vi.fn()}
        subject="3 blocks"
        onSave={vi.fn(async () => true)}
        error="A pattern with that name already exists."
      />
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("while the write is in flight", () => {
  /** A save that never settles, so the in-flight state can be observed. */
  function neverSettles() {
    return vi.fn(() => new Promise<boolean>(() => {}));
  }

  it("refuses every way of dismissing the form", async () => {
    // None of these cancels the request. The row would still be created while
    // the author believed they had stopped it — and reopening would let them
    // submit a second.
    const onOpenChange = vi.fn();
    render(
      <SavePatternDialog
        open
        onOpenChange={onOpenChange}
        subject="3 blocks"
        onSave={neverSettles()}
      />
    );
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: /save pattern/i }));
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /saving/i })).toBeTruthy()
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("says so on the button, rather than ignoring a press in silence", async () => {
    render(
      <SavePatternDialog
        open
        onOpenChange={vi.fn()}
        subject="3 blocks"
        onSave={neverSettles()}
      />
    );
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: /save pattern/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: /saving/i }).hasAttribute("disabled")
      ).toBe(true);
      expect(
        screen.getByRole("button", { name: /cancel/i }).hasAttribute("disabled")
      ).toBe(true);
    });
  });

  it("closes normally when nothing is in flight", () => {
    // The control. Without it a dialog that never closed would satisfy both
    // cases above.
    const onOpenChange = vi.fn();
    render(
      <SavePatternDialog
        open
        onOpenChange={onOpenChange}
        subject="3 blocks"
        onSave={vi.fn(async () => true)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("what the granularity group tells assistive technology", () => {
  it("is a NAMED required group, so a choice satisfies the requirement", () => {
    // `required` without a name is not one requirement but four: Radix mirrors
    // each item into a hidden native radio, and radios sharing no `name` are
    // not a group — so choosing one leaves the others unsatisfied and the form
    // cannot submit. Measured before the name was added: `checkValidity()` came
    // back false with a choice made.
    mount();
    fillRequired();

    const form = screen
      .getByRole("button", { name: /save pattern/i })
      .closest("form");

    expect(form?.checkValidity()).toBe(true);
  });

  it("announces itself as required and named", () => {
    mount();

    // Found BY its accessible name, which is the assertion: a group the legend
    // does not name is not found here at all. A Radix radio group is a div
    // rather than a native fieldset child, so the legend does not name it on
    // its own and it would reach a screen reader unlabelled.
    const group = screen.getByRole("radiogroup", {
      name: "How much of a page is this?",
    });

    expect(group.getAttribute("aria-required")).toBe("true");
  });
});
