/**
 * The block list of a written email: a card per block that can be moved,
 * duplicated and removed (with Undo), new blocks added at the end of the
 * email or of a list, and nothing editable when the email is read-only.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState, type MutableRefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  WrittenBlock,
  WrittenDocument,
} from "@admin/services/emailTemplateApi";
import type { Media } from "@admin/types/media";

import { WrittenBody, type InsertVariable } from "../WrittenBody";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { info: vi.fn() }));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

afterEach(() => {
  toast.mockReset();
  toast.info.mockReset();
});

/** A file in the media library, as the picker hands it over. */
const LAMP: Media = {
  id: "m1",
  filename: "lamp.png",
  originalFilename: "lamp.png",
  mimeType: "image/png",
  size: 1200,
  url: "/uploads/lamp.png",
  altText: "A brass lamp",
  uploadedBy: null,
  uploadedAt: new Date(0),
  updatedAt: new Date(0),
};

// The library itself is the media library's to test: here, a picker that
// hands over one file when asked.
vi.mock("@admin/components/features/media-library/MediaPickerDialog", () => ({
  MediaPickerDialog: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (media: Media[]) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onSelect([LAMP])}>
        Pick the lamp
      </button>
    ) : null,
}));

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
  insert,
}: {
  initial: WrittenDocument;
  readOnly?: boolean;
  seen: (doc: WrittenDocument) => void;
  insert?: MutableRefObject<InsertVariable | null>;
}) {
  const [value, setValue] = useState(initial);
  const own = useRef<InsertVariable | null>(null);
  return (
    <WrittenBody
      value={value}
      readOnly={readOnly}
      insertRef={insert ?? own}
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

  it("puts a variable chosen from the rail into the block last typed in", () => {
    const insert: MutableRefObject<InsertVariable | null> = { current: null };
    const seen = vi.fn<(doc: WrittenDocument) => void>();
    render(
      <Harness initial={doc(heading("Hi "))} seen={seen} insert={insert} />
    );
    fireEvent.focus(screen.getByRole("textbox", { name: "Heading" }));
    act(() => {
      expect(insert.current?.("name")).toBe(true);
    });
    const last = seen.mock.calls[seen.mock.calls.length - 1]?.[0];
    expect(last?.blocks[0]).toEqual({
      type: "heading",
      text: [
        { type: "text", text: "Hi " },
        { type: "chip", variable: "name" },
      ],
    });
  });

  it("says there is nowhere to put a variable before a block is typed in", () => {
    const insert: MutableRefObject<InsertVariable | null> = { current: null };
    render(
      <Harness initial={doc(heading("Hi"))} seen={vi.fn()} insert={insert} />
    );
    expect(insert.current?.("name")).toBe(false);
  });

  it("edits each kind's own fields: a button's link, an image's address, a spacer's height, a list's variable", async () => {
    const user = userEvent.setup();
    const seen = vi.fn<(doc: WrittenDocument) => void>();
    render(
      <WrittenBody
        value={doc(
          {
            type: "button",
            label: [{ type: "text", text: "Go" }],
            link: { url: "" },
          },
          { type: "image", src: { url: "" }, alt: [] },
          { type: "spacer" },
          { type: "list", variable: "", blocks: [] }
        )}
        variables={[
          { name: "name", description: "", required: true },
          { name: "lines", description: "", required: true },
        ]}
        onChange={seen}
      />
    );
    const last = () => seen.mock.calls[seen.mock.calls.length - 1]?.[0];

    fireEvent.change(screen.getByRole("textbox", { name: "Button link" }), {
      target: { value: "https://shop.example" },
    });
    expect(last()?.blocks[0]).toMatchObject({
      link: { url: "https://shop.example" },
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Image address" }), {
      target: { value: "https://cdn.example/a.png" },
    });
    expect(last()?.blocks[1]).toMatchObject({
      src: { url: "https://cdn.example/a.png" },
    });
    expect(
      screen.getByText(
        "No alt text: screen readers and blocked images show nothing."
      )
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Large" }));
    expect(last()?.blocks[2]).toEqual({ type: "spacer", height: 48 });

    fireEvent.change(screen.getByRole("combobox", { name: "List variable" }), {
      target: { value: "lines" },
    });
    expect(last()?.blocks[3]).toMatchObject({
      type: "list",
      variable: "lines",
    });
  });

  it("shows chips by friendly name, and a list's item by the list's own fields", () => {
    const chip = (variable: string) => ({ type: "chip" as const, variable });
    render(
      <WrittenBody
        value={doc(
          { type: "heading", text: [chip("customer.firstName")] },
          {
            type: "list",
            variable: "order.lines",
            blocks: [{ type: "text", text: [chip("item.title")] }],
          }
        )}
        variables={[
          {
            name: "customer",
            description: "",
            required: true,
            presentation: {
              label: "Customer",
              fields: [{ name: "firstName", label: "First name" }],
            },
          },
          {
            name: "order",
            description: "",
            required: true,
            presentation: {
              label: "Order",
              fields: [
                {
                  name: "lines",
                  label: "Lines",
                  fields: [{ name: "title", label: "Product" }],
                },
              ],
            },
          },
        ]}
        onChange={vi.fn()}
      />
    );
    const heading = screen.getByRole("textbox", { name: "Heading" });
    expect(heading.textContent).toContain("Customer › First name");
    const text = screen.getByRole("textbox", { name: "Text" });
    expect(text.textContent).toContain("Item › Product");
    // The path stays on hover, for whoever knows the data by its keys.
    expect(screen.getByTitle("item.title").textContent).toBe("Item › Product");
  });

  it("marks a chip that shows nothing, and its fallback dialog stores the fallback", async () => {
    const user = userEvent.setup();
    const seen = vi.fn<(doc: WrittenDocument) => void>();
    function Body() {
      const [value, setValue] = useState(
        doc({
          type: "heading",
          text: [
            { type: "chip", variable: "customer.firstName" },
            { type: "chip", variable: "customer.lastName" },
          ],
        })
      );
      return (
        <WrittenBody
          value={value}
          variables={[
            {
              name: "customer",
              description: "",
              required: true,
              presentation: {
                label: "Customer",
                fields: [
                  { name: "firstName", label: "First name" },
                  { name: "lastName", label: "Last name" },
                ],
              },
            },
          ]}
          sampleData={{ customer: { firstName: "Ada" } }}
          onChange={next => {
            seen(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Body />);

    // A test value: shown plainly. None and no fallback: marked.
    expect(
      screen.getByRole("button", { name: "Customer › First name" })
    ).toBeDefined();
    await user.click(
      screen.getByRole("button", {
        name: "Customer › Last name, shows nothing",
      })
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("status").textContent).toContain(
      "No test value and no fallback"
    );

    await user.type(within(dialog).getByLabelText("Fallback"), "there");
    expect(within(dialog).queryByRole("status")).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: "Save fallback" })
    );

    const last = seen.mock.calls[seen.mock.calls.length - 1]?.[0];
    expect(last?.blocks[0]).toEqual({
      type: "heading",
      text: [
        { type: "chip", variable: "customer.firstName" },
        { type: "chip", variable: "customer.lastName", fallback: "there" },
      ],
    });
    expect(
      screen.getByRole("button", { name: "Customer › Last name" })
    ).toBeDefined();
  });

  it("offers a list's item fields, only into the blocks that list repeats", async () => {
    const user = userEvent.setup();
    const seen = vi.fn<(doc: WrittenDocument) => void>();
    render(
      <WrittenBody
        value={doc(heading("Your order"), {
          type: "list",
          variable: "lines",
          blocks: [{ type: "text", text: [{ type: "text", text: "One " }] }],
        })}
        variables={[
          {
            name: "lines",
            description: "",
            required: true,
            presentation: {
              type: "list",
              fields: [{ name: "title", label: "Product" }],
            },
          },
        ]}
        onChange={seen}
      />
    );
    const field = within(
      screen.getByRole("group", { name: "Item fields" })
    ).getByRole("button", { name: "Item › Product" });

    // Outside the list, `item` means nothing: it says where to click.
    fireEvent.focus(screen.getByRole("textbox", { name: "Heading" }));
    await user.click(field);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(seen).not.toHaveBeenCalled();

    fireEvent.focus(screen.getByRole("textbox", { name: "Text" }));
    await user.click(field);
    const last = seen.mock.calls[seen.mock.calls.length - 1]?.[0];
    expect(last?.blocks[1]).toEqual({
      type: "list",
      variable: "lines",
      blocks: [
        {
          type: "text",
          text: [
            { type: "text", text: "One " },
            { type: "chip", variable: "item.title" },
          ],
        },
      ],
    });
  });

  it("chooses an image from the media library, with a complete address and its alt text", async () => {
    const user = userEvent.setup();
    const seen = vi.fn<(doc: WrittenDocument) => void>();
    render(
      <WrittenBody
        value={doc(
          { type: "image", src: { url: "" }, alt: [] },
          {
            type: "image",
            src: { url: "" },
            alt: [{ type: "text", text: "Ours" }],
          }
        )}
        onChange={seen}
      />
    );
    const [first, second] = screen.getAllByRole("button", {
      name: "Choose from library",
    });
    await user.click(first);
    await user.click(screen.getByRole("button", { name: "Pick the lamp" }));
    // A relative library address is made complete, so a sent email loads it.
    expect(seen.mock.calls[0]?.[0].blocks[0]).toEqual({
      type: "image",
      src: { url: `${window.location.origin}/uploads/lamp.png` },
      alt: [{ type: "text", text: "A brass lamp" }],
    });

    // Alt text the block already has is its own: the library's does not replace it.
    await user.click(second);
    await user.click(screen.getByRole("button", { name: "Pick the lamp" }));
    const last = seen.mock.calls[seen.mock.calls.length - 1]?.[0];
    expect(last?.blocks[1]).toMatchObject({
      alt: [{ type: "text", text: "Ours" }],
    });
  });

  it("opens no fallback dialog while the email is read-only", () => {
    render(
      <WrittenBody
        value={doc({
          type: "heading",
          text: [{ type: "chip", variable: "name" }],
        })}
        readOnly
        onChange={vi.fn()}
      />
    );
    expect(
      (
        screen.getByRole("button", {
          name: "name, shows nothing",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("offers declared lists first in a list's picker, by their friendly names", () => {
    render(
      <WrittenBody
        value={doc({ type: "list", variable: "", blocks: [] })}
        variables={[
          { name: "resetUrl", description: "", required: true },
          {
            name: "lines",
            description: "",
            required: true,
            presentation: { type: "list", label: "Order lines" },
          },
        ]}
        onChange={vi.fn()}
      />
    );
    const options = within(
      screen.getByRole("combobox", { name: "List variable" })
    )
      .getAllByRole("option")
      .map(option => option.textContent);
    expect(options).toEqual(["Choose a list", "Order lines", "resetUrl"]);
  });
});
