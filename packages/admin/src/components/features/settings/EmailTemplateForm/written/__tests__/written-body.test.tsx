/**
 * The block list of a written email: a card per block that can be moved,
 * duplicated and removed (with Undo), new blocks added at the end of the
 * email or of a list, and nothing editable when the email is read-only.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  WrittenBlock,
  WrittenDocument,
} from "@admin/services/emailTemplateApi";

import { WrittenBody } from "../WrittenBody";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

afterEach(() => toast.mockReset());

const heading = (text: string): WrittenBlock => ({
  type: "heading",
  text: [{ type: "text", text }],
});
const doc = (...blocks: WrittenBlock[]): WrittenDocument => ({
  version: 1,
  blocks,
});

/** The body with its value held as the form would hold it. */
function Harness({
  initial,
  readOnly = false,
  seen,
}: {
  initial: WrittenDocument;
  readOnly?: boolean;
  seen: (doc: WrittenDocument) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <WrittenBody
      value={value}
      readOnly={readOnly}
      onChange={next => {
        seen(next);
        setValue(next);
      }}
    />
  );
}

function mount(initial: WrittenDocument, readOnly = false) {
  const seen = vi.fn<(doc: WrittenDocument) => void>();
  render(<Harness initial={initial} readOnly={readOnly} seen={seen} />);
  const last = () => seen.mock.calls[seen.mock.calls.length - 1]?.[0];
  return { seen, last };
}

const cards = () => screen.getAllByRole("group", { name: /block$/i });

describe("a written email's blocks", () => {
  it("shows a card per block, named by its kind", () => {
    mount(doc(heading("Paid"), { type: "divider" }));
    expect(cards().map(card => card.getAttribute("aria-label"))).toEqual([
      "Heading block",
      "Divider block",
    ]);
  });

  it("adds a block at the end of the email", async () => {
    const user = userEvent.setup();
    const { last } = mount(doc(heading("Paid")));
    await user.click(screen.getByRole("button", { name: "Add block" }));
    await user.click(await screen.findByRole("menuitem", { name: "Divider" }));
    expect(last()?.blocks).toEqual([heading("Paid"), { type: "divider" }]);
  });

  it("moves a block down or up, and not past either end", async () => {
    const user = userEvent.setup();
    const { last } = mount(doc(heading("A"), heading("B")));
    const [first, second] = cards();
    expect(
      within(first).getByRole("button", { name: "Move up" })
    ).toBeDisabled();
    expect(
      within(second).getByRole("button", { name: "Move down" })
    ).toBeDisabled();
    await user.click(within(first).getByRole("button", { name: "Move down" }));
    expect(last()?.blocks).toEqual([heading("B"), heading("A")]);
  });

  it("duplicates a block just after itself", async () => {
    const user = userEvent.setup();
    const { last } = mount(doc(heading("A"), heading("B")));
    await user.click(
      within(cards()[0]).getByRole("button", {
        name: "Actions for this heading block",
      })
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Duplicate" })
    );
    expect(last()?.blocks).toEqual([heading("A"), heading("A"), heading("B")]);
  });

  it("removes a block, and puts it back on Undo", async () => {
    const user = userEvent.setup();
    const original = doc(heading("A"), heading("B"));
    const { last } = mount(original);
    await user.click(
      within(cards()[0]).getByRole("button", {
        name: "Actions for this heading block",
      })
    );
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(last()?.blocks).toEqual([heading("B")]);

    expect(toast).toHaveBeenCalledWith(
      "Removed the heading block",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      })
    );
    const [, options] = toast.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    options.action.onClick();
    expect(last()).toEqual(original);
  });

  it("adds a block inside a list, and offers no list there", async () => {
    const user = userEvent.setup();
    const { last } = mount(
      doc({ type: "list", variable: "lines", blocks: [] })
    );
    await user.click(
      screen.getByRole("button", { name: "Add a block inside the list" })
    );
    expect(
      screen.queryByRole("menuitem", { name: "List of items" })
    ).toBeNull();
    await user.click(await screen.findByRole("menuitem", { name: "Spacer" }));
    expect(last()?.blocks).toEqual([
      { type: "list", variable: "lines", blocks: [{ type: "spacer" }] },
    ]);
  });

  it("offers no way to change the blocks when the email is read-only", () => {
    mount(doc(heading("A"), heading("B")), true);
    expect(screen.queryByRole("button", { name: "Add block" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move down" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Actions for this/ })
    ).toBeNull();
  });
});
