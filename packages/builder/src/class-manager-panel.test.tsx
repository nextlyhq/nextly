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

  it("treats a name typed away and back as no rename at all", () => {
    /*
     * Two things at once, and both matter. Its own slug is not a COLLISION, so
     * no refusal is reported — but it is also not a CHANGE, so no rename is
     * dispatched: a host that persists every reported intent would write a
     * revision rendering identically to the one before it. The draft still
     * clears, because the author did finish editing.
     */
    const { onRename } = draw();
    fireEvent.change(nameField("hero"), { target: { value: "heroic" } });
    fireEvent.change(screen.getByLabelText("Name of hero"), {
      target: { value: "hero" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(screen.getByLabelText("Name of hero"), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("Name of hero") as HTMLInputElement).value
    ).toBe("hero");
  });

  it("treats whitespace around the current slug as no rename either", () => {
    // Normalisation happens before the comparison, so " hero " is the value
    // the class already has — the same no-op wearing different text.
    const { onRename } = draw();
    fireEvent.change(nameField("hero"), { target: { value: "  hero  " } });
    fireEvent.keyDown(screen.getByLabelText("Name of hero"), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
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

describe("a host that could not read the usage index", () => {
  it("says the reading is absent rather than reporting an empty index", () => {
    // An empty map and an unread index are different facts, and only one of
    // them is a statement about the site. Printing "Not in index" against
    // every class from a read that never happened is the direction that reads
    // as permission to delete.
    draw({ usage: undefined });
    expect(screen.getAllByText(/Usage not read/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Not in index")).toBeNull();
  });

  it("withdraws the filter it can no longer answer", () => {
    draw({ usage: undefined });
    expect(screen.queryByRole("button", { name: "Not in index" })).toBeNull();
    // The control: the filters it CAN answer are still offered, so this is a
    // withdrawal rather than the chips having failed to render at all.
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "On this page" })).toBeTruthy();
  });

  it("still answers on-this-page, which the open document decides", () => {
    // That question never went through the index, so losing the index must
    // not cost it.
    draw({ usage: undefined });
    expect(screen.getByText(/on this page/)).toBeTruthy();
  });
});

describe("a host with no way to carry out a delete", () => {
  it("offers no Delete at all rather than a disabled one", () => {
    draw({ onDelete: undefined });
    // The control first: an absent button is also what a panel that rendered
    // nothing looks like.
    expect(nameField("hero")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete hero" })).toBeNull();
  });
});

describe("a rename the host refuses", () => {
  it("shows the reason rather than clearing as though it landed", async () => {
    const onRename = vi.fn(async () => ({
      ok: false as const,
      reason: "The site style is locked.",
    }));
    render(
      <ClassManagerPanel
        library={LIBRARY}
        usage={{}}
        documentClassIds={[]}
        onRename={onRename}
        onDelete={vi.fn()}
      />
    );
    const field = nameField("hero");
    fireEvent.change(field, { target: { value: "renamed" } });
    fireEvent.blur(field);
    expect(await screen.findByText("The site style is locked.")).toBeTruthy();
  });

  it("treats a REJECTED write as a refusal too", async () => {
    // The contract is to answer, but a thrown error arrives all the same, and
    // without handling it the row clears and says nothing.
    const onRename = vi.fn(async () => {
      throw new Error("network");
    });
    render(
      <ClassManagerPanel
        library={LIBRARY}
        usage={{}}
        documentClassIds={[]}
        onRename={onRename}
        onDelete={vi.fn()}
      />
    );
    const field = nameField("hero");
    fireEvent.change(field, { target: { value: "renamed" } });
    fireEvent.blur(field);
    expect(await screen.findByText(/could not be renamed/i)).toBeTruthy();
  });
});

describe("a host that answers a rename with nothing", () => {
  it("treats an undefined resolution as silence, not as failure", async () => {
    /*
     * A merely `async` handler already satisfied the older `void` contract, so
     * these callers exist. Reading `.ok` off a resolved `Promise<void>` throws,
     * the throw is caught, and a rename that SUCCEEDED is then reported to the
     * author as having failed — the worst direction for this to go wrong in.
     */
    const onRename = vi.fn(async () => undefined);
    render(
      <ClassManagerPanel
        library={LIBRARY}
        usage={{}}
        documentClassIds={[]}
        onRename={onRename}
        onDelete={vi.fn()}
      />
    );
    const field = nameField("hero");
    await act(async () => {
      fireEvent.change(field, { target: { value: "renamed" } });
      fireEvent.blur(field);
    });
    /*
     * The chain has to SETTLE before absence means anything. Asserting straight
     * after the blur passes whether or not the guard is there, because the
     * message it is looking for could not have been rendered yet — measured:
     * removing the guard left this test green.
     */
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRename).toHaveBeenCalled();
    expect(screen.queryByText(/could not be renamed/i)).toBeNull();
  });
});

describe("two renames on one row, answered out of order", () => {
  it("ignores a refusal the author has already moved past", async () => {
    // The superseded attempt's answer describes a name that is no longer being
    // asked for, so reporting it points at an edit that no longer exists.
    let settleFirst: ((v: { ok: false; reason: string }) => void) | undefined;
    const first = new Promise<{ ok: false; reason: string }>(resolve => {
      settleFirst = resolve;
    });
    const onRename = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ ok: true as const });

    render(
      <ClassManagerPanel
        library={LIBRARY}
        usage={{}}
        documentClassIds={[]}
        onRename={onRename}
        onDelete={vi.fn()}
      />
    );
    const field = nameField("hero");
    fireEvent.change(field, { target: { value: "second" } });
    fireEvent.blur(field);
    fireEvent.change(nameField("hero"), { target: { value: "third" } });
    fireEvent.blur(nameField("hero"));
    await vi.waitFor(() => expect(onRename).toHaveBeenCalledTimes(2));

    await act(async () => {
      settleFirst?.({ ok: false, reason: "The first one was refused." });
      await first.catch(() => undefined);
    });
    expect(screen.queryByText("The first one was refused.")).toBeNull();
  });
});
