// @vitest-environment jsdom

/**
 * The Page checks entry point beside Publish: a count chip that opens the
 * list, and, once an item is pressed, the slim bar under it that walks the
 * list while the author fixes things in the inspector.
 *
 * The draft is handed in as the editor holds it, so a fix is seen by drawing
 * the chip again over the changed document, as the editor does.
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

import type {
  AnyBlockDefinition,
  BlockDocument,
  BlockNode,
} from "@nextlyhq/blocks-engine";

import { revealNode } from "../canvas/reveal-node";
import { ShowInspectorContext } from "../shell/show-inspector";

import { IMAGE_ALT_CHECK } from "./image-alt-check";
import { PageChecksChip, type PageChecksChipProps } from "./page-checks-chip";

vi.mock("../canvas/reveal-node", () => ({ revealNode: vi.fn(() => true) }));

beforeAll(() => {
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(revealNode).mockClear();
});

const PICTURE = {
  name: "acme/picture",
  version: 1,
  editor: { label: "Picture" },
  props: {
    mediaId: { label: "Image", role: "content", type: "media" },
    src: { label: "Image address", role: "content", type: "url" },
    alt: { label: "Alt text", role: "content", type: "text" },
    decorative: { label: "Decorative, no alt text", type: "checkbox" },
  },
  render: () => null,
} as unknown as AnyBlockDefinition;

const blocks = (type: string) => (type === PICTURE.name ? PICTURE : undefined);

/** A page of pictures, each with no alt text unless given some. */
function page(alts: Record<string, string | undefined>): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: Object.entries(alts).map(
      ([id, alt]): BlockNode => ({
        id,
        type: PICTURE.name,
        version: 1,
        name: `Photo ${id}`,
        props: { src: `/${id}.jpg`, ...(alt === undefined ? {} : { alt }) },
      })
    ),
  };
}

function mount(document: BlockDocument) {
  const canvas = window.document.createElement("div");
  const editor = { document, select: vi.fn(), askSetting: vi.fn() };
  const props = (next: BlockDocument): PageChecksChipProps => ({
    editor: { ...editor, document: next },
    canvas,
    blocks,
    // The chip's behaviour, with one check whose findings the pages set;
    // the builder's other checks have their own tests.
    checks: [IMAGE_ALT_CHECK],
  });
  const view = render(<PageChecksChip {...props(document)} />);
  return {
    editor,
    canvas,
    redraw: (next: BlockDocument) =>
      view.rerender(<PageChecksChip {...props(next)} />),
  };
}

const chip = () =>
  screen.getByRole("button", { name: /^(\d+ checks?|Checks)/ });
const bar = () => screen.queryByRole("group", { name: "Fixing page checks" });

describe("the count beside Publish", () => {
  it("says how many items need attention", () => {
    const { redraw } = mount(page({ a: undefined, b: undefined }));
    expect(chip().textContent).toBe("2 checks");
    redraw(page({ a: undefined, b: "Two" }));
    expect(chip().textContent).toBe("1 check");
  });

  it("says Checks with a tick when nothing needs attention", () => {
    mount(page({ a: "One" }));
    expect(chip().textContent).toBe("Checks");
    expect(chip().getAttribute("aria-label")).toBe(
      "Checks: nothing needs attention"
    );
  });

  it("opens the list, which Escape closes, back on the chip", async () => {
    mount(page({ a: undefined }));
    fireEvent.click(chip());
    expect(screen.getByRole("heading", { name: "Page checks" })).toBeDefined();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByRole("heading", { name: "Page checks" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(chip()));
  });
});

describe("pressing an item", () => {
  it("selects the block at its setting, brings it into view, and shows the bar", () => {
    const { editor, canvas } = mount(page({ a: undefined, b: undefined }));
    fireEvent.click(chip());
    fireEvent.click(
      screen.getByRole("button", { name: "Image has no alt text: Photo b" })
    );
    expect(editor.askSetting).toHaveBeenCalledWith("b", {
      tab: "content",
      id: "alt",
    });
    expect(revealNode).toHaveBeenCalledWith(canvas, "b");
    // The list gives way to the bar, which leaves the inspector uncovered.
    expect(screen.queryByRole("heading", { name: "Page checks" })).toBeNull();
    expect(bar()?.textContent).toContain("Check 2 of 2");
  });

  it("shows the inspector first, where the author hid it", () => {
    const show = vi.fn();
    const editor = {
      document: page({ a: undefined }),
      select: vi.fn(),
      askSetting: vi.fn(),
    };
    render(
      <ShowInspectorContext.Provider value={show}>
        <PageChecksChip editor={editor} canvas={null} blocks={blocks} />
      </ShowInspectorContext.Provider>
    );
    fireEvent.click(chip());
    fireEvent.click(
      screen.getByRole("button", { name: "Image has no alt text: Photo a" })
    );
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("closes the list back on the count after walking with Next", async () => {
    mount(page({ a: undefined, b: undefined }));
    chip().focus();
    fireEvent.click(chip());
    fireEvent.click(
      screen.getByRole("button", { name: "Image has no alt text: Photo a" })
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    fireEvent.click(screen.getByRole("button", { name: "Next check" }));
    fireEvent.click(screen.getByRole("button", { name: "All checks" }));
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(document.activeElement).toBe(chip()));
  });

  it("leaves the cursor for the inspector, not back on the count", async () => {
    mount(page({ a: undefined }));
    chip().focus();
    fireEvent.click(chip());
    fireEvent.click(
      screen.getByRole("button", { name: "Image has no alt text: Photo a" })
    );
    // What the list closing would have done by now, had it been let.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(document.activeElement).not.toBe(chip());
  });

  it("updates the bar and the count as the author fixes the item", () => {
    const { redraw } = mount(page({ a: undefined, b: undefined }));
    fireEvent.click(chip());
    fireEvent.click(
      screen.getByRole("button", { name: "Image has no alt text: Photo a" })
    );
    redraw(page({ a: "The team", b: undefined }));
    expect(bar()?.textContent).toContain("Fixed · 1 to go");
    expect(chip().textContent).toBe("1 check");
  });

  it("walks the list with Previous and Next", () => {
    const { editor, redraw } = mount(
      page({ a: undefined, b: undefined, c: undefined })
    );
    fireEvent.click(chip());
    fireEvent.click(
      screen.getByRole("button", { name: "Image has no alt text: Photo a" })
    );
    const previous = screen.getByRole("button", { name: "Previous check" });
    expect((previous as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next check" }));
    expect(editor.askSetting).toHaveBeenLastCalledWith("b", {
      tab: "content",
      id: "alt",
    });
    expect(bar()?.textContent).toContain("Check 2 of 3");
    // Fixed: Next goes on to the one that took its place.
    redraw(page({ a: undefined, b: "Two", c: undefined }));
    fireEvent.click(screen.getByRole("button", { name: "Next check" }));
    expect(editor.askSetting).toHaveBeenLastCalledWith("c", {
      tab: "content",
      id: "alt",
    });
    expect(bar()?.textContent).toContain("Check 2 of 2");
  });

  it("keeps its place when an earlier item is fixed first", () => {
    const { editor, redraw } = mount(
      page({ a: undefined, b: undefined, c: undefined, d: undefined })
    );
    fireEvent.click(chip());
    fireEvent.click(
      screen.getByRole("button", { name: "Image has no alt text: Photo c" })
    );
    redraw(page({ a: "One", b: undefined, c: undefined, d: undefined }));
    expect(bar()?.textContent).toContain("Check 2 of 3");
    redraw(page({ a: "One", b: undefined, c: "Three", d: undefined }));
    fireEvent.click(screen.getByRole("button", { name: "Next check" }));
    expect(editor.askSetting).toHaveBeenLastCalledWith("d", {
      tab: "content",
      id: "alt",
    });
  });

  it("opens the whole list again from All checks", () => {
    mount(page({ a: undefined }));
    fireEvent.click(chip());
    fireEvent.click(
      screen.getByRole("button", { name: "Image has no alt text: Photo a" })
    );
    fireEvent.click(screen.getByRole("button", { name: "All checks" }));
    expect(screen.getByRole("heading", { name: "Page checks" })).toBeDefined();
    expect(bar()).toBeNull();
  });

  it("says All clear once the last item is fixed, then goes away", () => {
    vi.useFakeTimers();
    const { redraw } = mount(page({ a: undefined }));
    fireEvent.click(chip());
    fireEvent.click(
      screen.getByRole("button", { name: "Image has no alt text: Photo a" })
    );
    redraw(page({ a: "The team" }));
    expect(bar()?.textContent).toContain("All clear");
    expect(chip().textContent).toBe("Checks");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(bar()).toBeNull();
  });

  it("closes the bar from its close button", () => {
    mount(page({ a: undefined }));
    fireEvent.click(chip());
    fireEvent.click(
      screen.getByRole("button", { name: "Image has no alt text: Photo a" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(bar()).toBeNull();
  });
});
