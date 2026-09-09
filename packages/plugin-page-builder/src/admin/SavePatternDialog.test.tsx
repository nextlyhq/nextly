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
import { ShortcutProvider } from "@nextlyhq/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  PATTERN_GRANULARITIES,
  isInsertableGranularity,
  type SavePatternFields,
} from "../library-contract";

import { SavePatternDialog } from "./SavePatternDialog";

/**
 * The form inside the shortcut context it holds.
 *
 * The dialog blocks the canvas's shortcuts for its whole lifetime, which needs
 * a provider above it. Rendering it bare throws — which is itself the assertion
 * that the hold is real, since a form that had dropped it would render happily.
 */
function inScope(node: React.ReactNode) {
  return <ShortcutProvider>{node}</ShortcutProvider>;
}

function mount(
  overrides: Partial<React.ComponentProps<typeof SavePatternDialog>> = {}
) {
  const onSave = vi.fn(async () => true);
  const onOpenChange = vi.fn();
  render(
    inScope(
      <SavePatternDialog
        open
        onOpenChange={onOpenChange}
        subject="3 blocks"
        onSave={onSave}
        {...overrides}
      />
    )
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

  it("offers exactly the granularities a surface can offer BACK", () => {
    // Not the whole vocabulary. A page-granularity pattern is a way to start a
    // page, the insert panel filters it out by design, and the surface that
    // would offer it does not exist yet — so choosing it stores a row that
    // disappears from the builder the moment it is written.
    //
    // Both sides derived from the contract, so a granularity added to the
    // vocabulary is covered the day it arrives, and one that becomes offerable
    // moves here without this test being edited.
    const offerable = PATTERN_GRANULARITIES.filter(isInsertableGranularity);
    mount();

    // The control: a filter that removed everything would satisfy the
    // comparison against an empty list.
    expect(offerable.length).toBeGreaterThan(1);
    expect(offerable.length).toBeLessThan(PATTERN_GRANULARITIES.length);
    expect(screen.getAllByRole("radio")).toHaveLength(offerable.length);
  });

  it("does not offer a granularity nothing could show again", () => {
    // Named directly as well as counted, because a count agrees with any filter
    // that removes ONE option — including one that removed the wrong one.
    mount();

    expect(screen.queryByRole("radio", { name: "Page" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Section" })).toBeTruthy();
  });

  it("explains every option without the author opening anything", () => {
    // A picker hides the sentences behind a click, and the choice is required
    // and has no default — so the explanations have to be readable BEFORE the
    // choice rather than after it.
    mount();

    for (const radio of screen.getAllByRole("radio")) {
      const described = radio.getAttribute("aria-describedby");
      expect(described).toBeTruthy();
      const hint = window.document.getElementById(described ?? "");
      expect(hint?.textContent ?? "").not.toBe("");
    }
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
      inScope(
        <SavePatternDialog
          open
          onOpenChange={onOpenChange}
          subject="3 blocks"
          onSave={onSave}
          error="A pattern with that name already exists."
        />
      )
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
      inScope(
        <SavePatternDialog
          open
          onOpenChange={vi.fn()}
          subject="3 blocks"
          onSave={vi.fn(async () => true)}
          error="A pattern with that name already exists."
        />
      )
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
      inScope(
        <SavePatternDialog
          open
          onOpenChange={onOpenChange}
          subject="3 blocks"
          onSave={neverSettles()}
        />
      )
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
      inScope(
        <SavePatternDialog
          open
          onOpenChange={vi.fn()}
          subject="3 blocks"
          onSave={neverSettles()}
        />
      )
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
      inScope(
        <SavePatternDialog
          open
          onOpenChange={onOpenChange}
          subject="3 blocks"
          onSave={vi.fn(async () => true)}
        />
      )
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

describe("what the form does to the canvas underneath it", () => {
  it("holds the editor's shortcuts for its whole lifetime", () => {
    // A focus trap keeps Tab inside the dialog and does nothing about
    // shortcuts: the canvas registers its bindings on the document, so Delete,
    // Mod+D and Alt+Arrow reach the page behind this form and Mod+K opens the
    // palette over it. An author correcting a name can destroy the block they
    // are naming — and the moment focus sits on a radio or a button is exactly
    // when a bare keystroke is a canvas verb.
    //
    // Asserted through the CONTEXT the hold requires: a form that had dropped
    // it renders happily outside a provider, and this does not.
    expect(() =>
      render(
        <SavePatternDialog
          open
          onOpenChange={vi.fn()}
          subject="3 blocks"
          onSave={vi.fn(async () => true)}
        />
      )
    ).toThrow(/ShortcutProvider/);
  });

  it("renders inside one, so the throw above is about the hold", () => {
    // The control. Without it the case above passes against a form that throws
    // for some entirely different reason.
    expect(() => mount()).not.toThrow();
  });
});

describe("fitting a short viewport", () => {
  it("caps the dialog and scrolls its body, not the whole form", () => {
    // Four explained options plus the optional fields make this taller than a
    // short screen, and a refusal alert makes it taller again. `DialogContent`
    // is fixed and has no maximum height of its own, so without this the footer
    // — or the field that needs correcting — sits off-screen with no way to
    // reach it. The BODY scrolls so Save and Cancel stay in view.
    mount();

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/max-h-\[85vh\]/);

    const scroller = dialog.querySelector(".overflow-y-auto");
    expect(scroller).toBeTruthy();
    // The footer is OUTSIDE the scrolling region, which is what keeps it in
    // view rather than scrolling away with the fields.
    expect(
      scroller?.contains(screen.getByRole("button", { name: /save pattern/i }))
    ).toBe(false);
  });
});

describe("reaching the save without the mouse", () => {
  it("submits on Enter from a single-line field", () => {
    /*
     * The hold that keeps the canvas out of reach takes Enter with it: the
     * shortcut manager gives that key to a field only where the field OWNS it —
     * a textarea uses it for a newline — so in a single-line input a blocking
     * layer swallows it. Without this the form loses the keyboard path `submit`
     * exists to support.
     */
    const { onSave } = mount();
    fillRequired("Hero");

    fireEvent.keyDown(screen.getByLabelText("Name"), {
      key: "Enter",
      bubbles: true,
    });

    expect(onSave).toHaveBeenCalled();
  });

  it("leaves Enter alone in the description, which uses it for a newline", () => {
    // The control, and the reason the rule asks what the target OWNS rather
    // than naming the fields: a textarea submitting on Enter cannot be given a
    // second line.
    const { onSave } = mount();
    fillRequired("Hero");

    fireEvent.keyDown(screen.getByLabelText(/Description/), {
      key: "Enter",
      bubbles: true,
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not turn a press on Cancel into a save", () => {
    // A button owns its own Enter. Submitting the form here would make the
    // keyboard path to Cancel do the opposite of what it says.
    const { onSave } = mount();
    fillRequired("Hero");

    fireEvent.keyDown(screen.getByRole("button", { name: /cancel/i }), {
      key: "Enter",
      bubbles: true,
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("returns focus to whatever opened it", async () => {
    /*
     * Radix restores focus to the TRIGGER, and this dialog has none: it is
     * opened from the toolbar, the context menu or the palette. Without a
     * fallback, focus lands on the body and a keyboard author is returned to
     * the top of the page.
     *
     * The opener is passed IN rather than read here, because by the time this
     * mounts it has already lost focus — measured, it is gone even by Radix's
     * own "about to take focus" hook, which is why capturing it there returned
     * the body.
     *
     * Driven through a real close, because the restore runs as Radix UNMOUNTS
     * the content: a controlled dialog whose `open` never changes never reaches
     * it, and a test that only pressed Cancel would pass while the restore did
     * nothing.
     */
    const opener = window.document.createElement("button");
    opener.textContent = "Save as pattern";
    window.document.body.append(opener);
    opener.focus();

    function Host(): React.JSX.Element {
      const [open, setOpen] = React.useState(true);
      return inScope(
        <SavePatternDialog
          open={open}
          onOpenChange={setOpen}
          subject="3 blocks"
          onSave={vi.fn(async () => true)}
          returnFocusTo={() => opener}
        />
      );
    }
    render(<Host />);
    expect(window.document.activeElement).not.toBe(opener);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await vi.waitFor(() => expect(window.document.activeElement).toBe(opener));
    opener.remove();
  });

  it("does not submit while an input method is composing", async () => {
    /*
     * Typing Japanese, Chinese or Korean goes through an IME, and Enter is how
     * a candidate is accepted. Submitting there stores a pattern named with
     * whatever was half-composed, on the first press of the key the author used
     * to finish a word — the same class of defect as a slug that came back
     * empty for those scripts.
     */
    const { onSave } = mount();
    fillRequired("見出し");

    fireEvent.keyDown(screen.getByLabelText("Name"), {
      key: "Enter",
      isComposing: true,
      bubbles: true,
    });

    expect(onSave).not.toHaveBeenCalled();

    // The control: the SAME key, once composition has finished, does submit —
    // so this is the IME talking rather than Enter having been disabled.
    fireEvent.keyDown(screen.getByLabelText("Name"), {
      key: "Enter",
      bubbles: true,
    });
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
  });
});

describe("where focus goes when the opener has gone", () => {
  it("takes whatever the caller answers at the moment it closes", async () => {
    // The control that raised the form is usually gone by then — a menu item
    // unmounts with its menu — so the answer cannot be an element captured at
    // the open. It is asked for one, at the close.
    const fallback = window.document.createElement("button");
    window.document.body.append(fallback);
    const asked: string[] = [];

    function Host(): React.JSX.Element {
      const [open, setOpen] = React.useState(true);
      return inScope(
        <SavePatternDialog
          open={open}
          onOpenChange={setOpen}
          subject="3 blocks"
          onSave={vi.fn(async () => true)}
          returnFocusTo={() => {
            asked.push("asked");
            return fallback;
          }}
        />
      );
    }
    render(<Host />);
    // Not asked while it is open: a resolver called at the open would answer
    // about a moment that has not happened.
    expect(asked).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Awaited because the resolver runs as Radix UNMOUNTS the content, which
    // is a commit later than the click.
    await vi.waitFor(() => expect(asked).toEqual(["asked"]));
    expect(window.document.activeElement).toBe(fallback);
    fallback.remove();
  });

  it("leaves Radix its own default when the caller answers nothing", () => {
    // The control. A dialog that always suppressed the default would take away
    // whatever Radix would otherwise have done, for callers with no answer.
    function Host(): React.JSX.Element {
      const [open, setOpen] = React.useState(true);
      return inScope(
        <SavePatternDialog
          open={open}
          onOpenChange={setOpen}
          subject="3 blocks"
          onSave={vi.fn(async () => true)}
          returnFocusTo={() => null}
        />
      );
    }

    expect(() => {
      render(<Host />);
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    }).not.toThrow();
  });
});
