// @vitest-environment jsdom

/**
 * An image's source and alt text in the Content tab, each one control over
 * two props, with the host's media library stood in for.
 *
 * - Source: "Library | URL", one field shown at a time; switching sides
 *   writes nothing; a typed address replaces a stored file in one edit; a
 *   file and an address stored together show as they are.
 * - Alt text: "From library | Custom | Decorative", read as the block reads
 *   the props; each choice is one edit; decorative alt text kept and an
 *   empty alt are shown as they are and not rewritten.
 * - Both are named for a screen reader and held by a lock.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { ContentServices, MediaPickerProps } from "./content-controls";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

/** A block declaring an image's props as `core/image` declares them. */
function register(): void {
  registerBlocks(
    [
      {
        name: "acme/picture",
        version: 1,
        description: "A picture.",
        // Placed with a placeholder address, as `core/image` is.
        example: { props: { src: "/example.jpg" } },
        editor: { label: "Picture" },
        props: {
          mediaId: {
            label: "Image",
            role: "content",
            type: "media",
            accept: "image/*",
          },
          src: { label: "Image address", role: "content", type: "url" },
          alt: { label: "Alt text", role: "content", type: "text" },
          decorative: { label: "Decorative (no alt text)", type: "checkbox" },
        },
        render: () => null,
      },
    ] as never,
    { source: "content-controls-image-test" }
  );
}

/** A picker that picks `m-2` the moment it opens. */
function Picker({
  open,
  onSelect,
}: MediaPickerProps): React.JSX.Element | null {
  React.useEffect(() => {
    if (open) onSelect([{ id: "m-2", filename: "new.jpg" }]);
  }, [open, onSelect]);
  return null;
}

const SERVICES: ContentServices = {
  MediaPicker: Picker,
  readMedia: async () => ({ name: "team.jpg", alt: "The team at launch" }),
};

function mount(
  props: Record<string, unknown>,
  {
    services = SERVICES,
    locked = false,
  }: { services?: ContentServices; locked?: boolean } = {}
) {
  register();
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/picture",
        version: 1,
        props,
        ...(locked ? { locked: true } : {}),
      } as BlockNode,
    ],
  } as BlockDocument;
  const editor = {
    document,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
  const view = render(
    <InspectorPanel editor={editor} contentServices={services} />
  );
  // The panel drawn again over `next` as the stored props, as an undo or a
  // document replaced from outside draws it: the same node, new values.
  const storeNow = (next: Record<string, unknown>) => {
    const changed = {
      ...document,
      nodes: [{ ...document.nodes[0], props: next } as BlockNode],
    } as BlockDocument;
    view.rerender(
      <InspectorPanel
        editor={{ ...editor, document: changed } as EditorState}
        contentServices={services}
      />
    );
  };
  return Object.assign(editor, { storeNow });
}

/** The props the one write stored: one edit, so one step to undo. */
function written(editor: { apply: ReturnType<typeof vi.fn> }): object {
  expect(editor.apply).toHaveBeenCalledTimes(1);
  return (editor.apply.mock.calls[0]?.[0] as { patch: { props: object } }).patch
    .props;
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("where an image's picture comes from", () => {
  it("shows the library side, and its chip alone, while a file is stored", () => {
    mount({ mediaId: "m-1" });
    expect(screen.getByRole("radiogroup", { name: "Source" })).toBeDefined();
    expect(radio("Library").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Choose Image" })).toBeDefined();
    expect(screen.queryByLabelText("Image address")).toBeNull();
  });

  it("shows the address side, and its field alone, where only an address is stored", () => {
    mount({ src: "/photo.jpg" });
    expect(radio("URL").getAttribute("aria-checked")).toBe("true");
    expect(
      (screen.getByLabelText("Image address") as HTMLInputElement).value
    ).toBe("/photo.jpg");
    expect(screen.queryByRole("button", { name: "Choose Image" })).toBeNull();
  });

  it("writes nothing for switching sides", () => {
    const editor = mount({ mediaId: "m-1" });
    fireEvent.click(radio("URL"));
    expect(screen.getByLabelText("Image address")).toBeDefined();
    expect(screen.getByText(/A library file is chosen/)).toBeDefined();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("writes a typed address over a stored file, as one edit", () => {
    const editor = mount({ mediaId: "m-1", alt: "Words" });
    fireEvent.click(radio("URL"));
    const field = screen.getByLabelText("Image address");
    fireEvent.change(field, { target: { value: "/other.jpg" } });
    fireEvent.blur(field);
    expect(written(editor)).toEqual({ alt: "Words", src: "/other.jpg" });
  });

  it("keeps a stored address when a library file is picked", async () => {
    const editor = mount({ src: "/photo.jpg" });
    fireEvent.click(radio("Library"));
    fireEvent.click(screen.getByRole("button", { name: "Choose Image" }));
    await waitFor(() => expect(editor.apply).toHaveBeenCalled());
    expect(written(editor)).toEqual({ src: "/photo.jpg", mediaId: "m-2" });
  });

  it("drops the address the block was placed with when a library file is picked, in one edit", async () => {
    // A fresh image's address is the block's own placeholder, nobody's
    // fallback, so the picked file stands alone.
    const editor = mount({ src: "/example.jpg", loading: "lazy" });
    fireEvent.click(radio("Library"));
    fireEvent.click(screen.getByRole("button", { name: "Choose Image" }));
    await waitFor(() => expect(editor.apply).toHaveBeenCalled());
    expect(written(editor)).toEqual({ loading: "lazy", mediaId: "m-2" });
  });

  it("follows the stored props again when they change under it, as an undo does", () => {
    const editor = mount({ mediaId: "m-1" });
    fireEvent.click(radio("URL"));
    // The address typed over the file is stored...
    editor.storeNow({ src: "/typed.jpg" });
    expect(radio("URL").getAttribute("aria-checked")).toBe("true");
    // ...and undone: the file is back, so the library side shows it.
    editor.storeNow({ mediaId: "m-1" });
    expect(radio("Library").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Choose Image" })).toBeDefined();
    expect(screen.queryByLabelText("Image address")).toBeNull();
  });

  it("keeps the side an author switched to while the stored props stay as they are", () => {
    const editor = mount({ mediaId: "m-1" });
    fireEvent.click(radio("URL"));
    editor.storeNow({ mediaId: "m-1", alt: "Words" });
    expect(radio("URL").getAttribute("aria-checked")).toBe("true");
  });

  it("shows a file and an address stored together as they are, and writes nothing", () => {
    const editor = mount({ mediaId: "m-1", src: "/fallback.jpg" });
    expect(radio("Library").getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText(/An address is also stored.*\/fallback\.jpg/)
    ).toBeDefined();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("is held by a lock", () => {
    mount({ mediaId: "m-1" }, { locked: true });
    expect(radio("Library").hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Choose Image" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});

describe("what a screen reader is given for an image", () => {
  const menu = () => screen.getByRole("combobox", { name: "Alt text" });

  it("reads From library, with the library's words, where the page stores none", async () => {
    mount({ mediaId: "m-1" });
    expect(menu().textContent).toBe("From library");
    expect(await screen.findByText("The team at launch")).toBeDefined();
    // Said once, in the alt row, not again under the file's name.
    expect(screen.queryByText(/Library alt text:/)).toBeNull();
  });

  it("reads Custom, in a field of its own, where the page stores alt text", () => {
    mount({ mediaId: "m-1", alt: "Written for this page" });
    expect(menu().textContent).toBe("Custom");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Custom alt text",
        }) as HTMLTextAreaElement
      ).value
    ).toBe("Written for this page");
  });

  it("shows an empty stored alt as an empty Custom, said, and writes nothing", async () => {
    const editor = mount({ mediaId: "m-1", alt: "" });
    expect(menu().textContent).toBe("Custom");
    expect(
      await screen.findByText(
        /Empty: screen readers skip this image\. The library has alt text/
      )
    ).toBeDefined();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("shows decorative alt text kept as it is, and writes nothing", () => {
    const editor = mount({ mediaId: "m-1", decorative: true, alt: "Kept" });
    expect(menu().textContent).toBe("Decorative");
    expect(
      screen.getByText(/Screen readers skip this image\..*Kept/)
    ).toBeDefined();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("writes Decorative as the mark, keeping the alt, in one edit", () => {
    const editor = mount({ mediaId: "m-1", alt: "Kept" });
    fireEvent.click(menu());
    fireEvent.click(screen.getByRole("option", { name: "Decorative" }));
    expect(written(editor)).toEqual({
      mediaId: "m-1",
      alt: "Kept",
      decorative: true,
    });
  });

  it("writes From library by removing the page's alt and the mark, in one edit", () => {
    const editor = mount({ mediaId: "m-1", alt: "Kept", decorative: true });
    fireEvent.click(menu());
    fireEvent.click(screen.getByRole("option", { name: "From library" }));
    expect(written(editor)).toEqual({ mediaId: "m-1" });
  });

  it("writes Custom from the library's words", async () => {
    const editor = mount({ mediaId: "m-1" });
    await screen.findByText("The team at launch");
    fireEvent.click(menu());
    fireEvent.click(screen.getByRole("option", { name: "Custom" }));
    expect(written(editor)).toEqual({
      mediaId: "m-1",
      alt: "The team at launch",
    });
  });

  it("waits for the library's words before offering Custom, then starts from them", async () => {
    // Chosen before the words arrive, Custom would store an empty alt and
    // silence the description the image was being read with.
    let settle: (summary: { alt: string }) => void = () => undefined;
    const editor = mount(
      { mediaId: "m-1" },
      {
        services: {
          ...SERVICES,
          readMedia: () =>
            new Promise(resolve => {
              settle = resolve;
            }),
        },
      }
    );
    fireEvent.click(menu());
    expect(
      screen
        .getByRole("option", { name: "Custom" })
        .getAttribute("aria-disabled")
    ).toBe("true");
    // Not a lock: the other choices stay open meanwhile.
    expect(
      screen
        .getByRole("option", { name: "Decorative" })
        .getAttribute("aria-disabled")
    ).not.toBe("true");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await act(async () => {
      settle({ alt: "The team at launch" });
    });
    fireEvent.click(menu());
    fireEvent.click(screen.getByRole("option", { name: "Custom" }));
    expect(written(editor)).toEqual({
      mediaId: "m-1",
      alt: "The team at launch",
    });
  });

  it("commits the custom words on Enter, and keeps an emptied field empty", () => {
    const editor = mount({ mediaId: "m-1", alt: "Old" });
    const field = screen.getByRole("textbox", { name: "Custom alt text" });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(written(editor)).toEqual({ mediaId: "m-1", alt: "" });
  });

  it("is held by a lock", () => {
    mount({ mediaId: "m-1", alt: "Words" }, { locked: true });
    expect(menu().hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("textbox", { name: "Custom alt text" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});
