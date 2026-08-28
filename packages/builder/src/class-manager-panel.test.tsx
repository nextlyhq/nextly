// @vitest-environment jsdom

/**
 * The class manager, driven as an author drives it.
 *
 * `class-library.test.ts` asserts the rules against the compiled stylesheet.
 * What is only true HERE is the wiring: that a refused rename is reported and
 * NOT committed, that deleting asks first whatever the count says, that the
 * confirmation never claims the number is complete, and that a library still
 * loading is not drawn as a library with nothing in it.
 *
 * @module class-manager-panel.test
 */
import type { NamedClass } from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ClassManagerPanel,
  type ClassManagerPanelProps,
} from "./class-manager-panel";

afterEach(cleanup);

const cls = (id: string, slug: string, orderIndex: number): NamedClass => ({
  id,
  slug,
  orderIndex,
  styles: {},
});

const LIBRARY: NamedClass[] = [
  cls("id-card", "card", 2),
  cls("id-hero", "hero", 0),
  cls("id-badge", "badge", 1),
];

function draw(overrides: Partial<ClassManagerPanelProps> = {}): {
  onRename: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
} {
  const onRename = vi.fn();
  const onDelete = vi.fn();
  render(
    <ClassManagerPanel
      library={LIBRARY}
      usage={{ "id-hero": 3 }}
      documentClassIds={["id-card"]}
      onRename={onRename}
      onDelete={onDelete}
      {...overrides}
    />
  );
  return { onRename, onDelete };
}

const nameField = (slug: string): HTMLInputElement =>
  screen.getByLabelText(`Name of ${slug}`) as HTMLInputElement;

describe("a library that has not been read yet", () => {
  it("says it is loading rather than reporting no classes", () => {
    render(
      <ClassManagerPanel
        library={undefined}
        usage={{}}
        documentClassIds={[]}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/loading classes/i)).toBeTruthy();
    expect(screen.queryByText(/no classes match/i)).toBeNull();
  });
});

describe("what the list shows", () => {
  it("lists in precedence order, not by name or by storage", () => {
    draw();
    const names = screen
      .getAllByRole("textbox")
      .map(input => (input as HTMLInputElement).value);
    expect(names).toEqual(["hero", "badge", "card"]);
  });

  it("names the INDEX, never usage, and never a bare count", () => {
    /*
     * The index errs in both directions — it loses rows to interleaved saves
     * and retains them when a removal fails — so neither "used" nor "unused" is
     * something a row can assert. It can only report what the index holds.
     */
    draw();
    expect(screen.getByText(/3 in index/)).toBeTruthy();
    expect(screen.getAllByText(/Not in index/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/known/i)).toBeNull();
    expect(screen.queryByText(/unused/i)).toBeNull();
  });

  it("uses the SAME words in the row and in the confirmation", () => {
    // Two uncertainty policies for one number is how the shorter one — the row,
    // which is read far more often — comes to overstate what the index knows.
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Delete hero" }));
    const row = screen.getByText(/3 in index/).textContent ?? "";
    const confirm = screen.getByText(/has it on 3 document/i).textContent ?? "";
    expect(row).toMatch(/index/);
    expect(confirm).toMatch(/index/);
    expect(confirm).not.toMatch(/\bknown\b/i);
  });

  it("marks what the open document applies, separately from the count", () => {
    draw();
    expect(screen.getByText(/on this page/)).toBeTruthy();
  });
});

describe("the filters, which ask three different questions", () => {
  it("narrows to classes the index knows no document for", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Not in index" }));
    const names = screen
      .getAllByRole("textbox")
      .map(input => (input as HTMLInputElement).value);
    expect(names).toEqual(["badge", "card"]);
  });

  it("narrows to what the open document applies", () => {
    // `card` is on this page AND has no known usage, so this separates the two
    // filters rather than being satisfied by either.
    draw();
    fireEvent.click(screen.getByRole("button", { name: "On this page" }));
    const names = screen
      .getAllByRole("textbox")
      .map(input => (input as HTMLInputElement).value);
    expect(names).toEqual(["card"]);
  });

  it("never labels a filter as unused", () => {
    draw();
    expect(screen.queryByRole("button", { name: /unused/i })).toBeNull();
  });

  it("says so when a filter matches nothing", () => {
    draw({ usage: { "id-hero": 1, "id-badge": 1, "id-card": 1 } });
    fireEvent.click(screen.getByRole("button", { name: "Not in index" }));
    expect(screen.getByText(/no classes match/i)).toBeTruthy();
  });
});

describe("renaming in place", () => {
  it("commits a name the engine would accept", () => {
    const { onRename } = draw();
    fireEvent.change(nameField("hero"), { target: { value: "banner" } });
    fireEvent.keyDown(nameField("hero"), { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("id-hero", "banner");
  });

  it("commits the NORMALIZED slug, not the text that was typed", () => {
    // Validation runs on the trimmed value, so committing the raw text would
    // store a name the compiler drops.
    const { onRename } = draw();
    fireEvent.change(nameField("hero"), { target: { value: "  banner  " } });
    fireEvent.keyDown(nameField("hero"), { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("id-hero", "banner");
  });

  it("reports a refusal and does NOT commit it", () => {
    const { onRename } = draw();
    fireEvent.change(nameField("hero"), { target: { value: "Not A Slug" } });
    expect(screen.getByRole("alert").textContent).toMatch(/lowercase/i);
    fireEvent.keyDown(nameField("hero"), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("keeps the refused text on screen rather than reverting it", () => {
    // An author who mistypes needs to see what they typed beside the reason.
    draw();
    fireEvent.change(nameField("hero"), { target: { value: "Not A Slug" } });
    fireEvent.keyDown(nameField("hero"), { key: "Enter" });
    expect(
      (screen.getByLabelText("Name of hero") as HTMLInputElement).value
    ).toBe("Not A Slug");
  });

  it("refuses a name another class already holds", () => {
    const { onRename } = draw();
    fireEvent.change(nameField("hero"), { target: { value: "card" } });
    expect(screen.getByRole("alert").textContent).toMatch(/already has/i);
    fireEvent.keyDown(nameField("hero"), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("lets a class keep its own name, which is not a collision", () => {
    // Typed away and back, because a field set to the value it already holds
    // fires no change and would leave the draft unset — the test would then
    // pass on a code path that never consulted the collision rule at all.
    const { onRename } = draw();
    fireEvent.change(nameField("hero"), { target: { value: "heroic" } });
    fireEvent.change(screen.getByLabelText("Name of hero"), {
      target: { value: "hero" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(screen.getByLabelText("Name of hero"), { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("id-hero", "hero");
  });

  it("commits nothing when the field was never edited", () => {
    // Focus and Enter is not a rename. Reporting one would write a document
    // revision that renders identically to the one before it.
    const { onRename } = draw();
    fireEvent.keyDown(nameField("hero"), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("abandons the draft on Escape", () => {
    const { onRename } = draw();
    fireEvent.change(nameField("hero"), { target: { value: "banner" } });
    fireEvent.keyDown(nameField("hero"), { key: "Escape" });
    expect(
      (screen.getByLabelText("Name of hero") as HTMLInputElement).value
    ).toBe("hero");
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe("a class the site's config supplies", () => {
  // `resolveSiteStyle` merges configured classes back over storage BY ID, so
  // absence from the stored tier reads as "no override" rather than "deleted".
  // A delete would strip every document's reference and the class would return
  // on the next read — the references gone, the class back, nothing using it.
  it("offers no Delete, and says why instead", () => {
    draw({ suppliedClassIds: ["id-hero"] });
    expect(screen.queryByRole("button", { name: "Delete hero" })).toBeNull();
    expect(screen.getByText("Default")).toBeTruthy();
  });

  it("still offers Delete for the stored classes beside it", () => {
    // The control: withholding is about that one class, not about the panel
    // having stopped offering deletion.
    draw({ suppliedClassIds: ["id-hero"] });
    expect(screen.getByRole("button", { name: "Delete card" })).toBeTruthy();
  });

  it("still lets a supplied class be RENAMED, which storage can express", () => {
    // A rename writes an override rather than removing one, so it survives the
    // merge. Withholding it too would be a restriction nothing requires.
    const { onRename } = draw({ suppliedClassIds: ["id-hero"] });
    fireEvent.change(nameField("hero"), { target: { value: "banner" } });
    fireEvent.keyDown(nameField("hero"), { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("id-hero", "banner");
  });
});

describe("Enter inside the surrounding entry form", () => {
  it("prevents the default action, so the form is not submitted", () => {
    /*
     * This panel mounts inside the entry form. An unprevented Enter submits it,
     * saving or publishing the entry when the author only meant to finish
     * typing a class name — a far larger action than the one they took.
     */
    draw();
    fireEvent.change(nameField("hero"), { target: { value: "banner" } });
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    nameField("hero").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves other keys alone, so typing still reaches the field", () => {
    // The control: preventing everything would break the input itself.
    draw();
    const event = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
    });
    nameField("hero").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("deleting", () => {
  it("asks before deleting a class the index knows documents for", () => {
    const { onDelete } = draw();
    fireEvent.click(screen.getByRole("button", { name: "Delete hero" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/has it on 3 document/i)).toBeTruthy();
  });

  it("STILL asks when the index knows of no document", () => {
    /*
     * The case the whole design turns on. Two concurrent saves can each remove
     * the other's row, so a class that renders on the live site reads as zero.
     * Skipping the confirmation here would put an irreversible edit behind the
     * one value the index is known to get wrong in the losing direction.
     */
    const { onDelete } = draw();
    fireEvent.click(screen.getByRole("button", { name: "Delete badge" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot rule one out/i)).toBeTruthy();
  });

  it("claims no bound in EITHER direction, not even a lower one", () => {
    // The index loses rows to interleaved saves and retains them when a removal
    // fails, so it errs both ways. "At least N" reads as careful and is false
    // for a stale over-count.
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Delete hero" }));
    const text = screen.getByText(/has it on 3 document/i).textContent ?? "";
    expect(text).toMatch(/wrong in either direction/i);
    expect(text).not.toMatch(/at least/i);
  });

  it("deletes only after the confirmation", () => {
    const { onDelete } = draw();
    fireEvent.click(screen.getByRole("button", { name: "Delete hero" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm deleting hero" })
    );
    expect(onDelete).toHaveBeenCalledWith("id-hero");
  });

  it("deletes nothing when the confirmation is cancelled", () => {
    const { onDelete } = draw();
    fireEvent.click(screen.getByRole("button", { name: "Delete hero" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText(/has it on 3 document/i)).toBeNull();
  });

  it("asks about the row that was clicked, not the first one", () => {
    // A single-row fixture could not tell these apart.
    const { onDelete } = draw();
    fireEvent.click(screen.getByRole("button", { name: "Delete card" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm deleting card" })
    );
    expect(onDelete).toHaveBeenCalledWith("id-card");
  });
});
