// @vitest-environment jsdom

/**
 * The Previewing strip over a template's canvas: its chip, its picker, its
 * keys and its empty state, drawn from a preview the test holds.
 *
 * The preview's own reads (which entry, the list, the memory) are
 * `use-template-preview.test`'s; here the subject is what the author sees
 * and presses, so the preview is a plain object whose `step` and `choose`
 * are watched.
 *
 * @module admin/editor/template-preview-strip.test
 */
import type { PreviewedEntry } from "@nextlyhq/builder/shell";
import { ShortcutProvider, TooltipProvider } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreviewEntryItem } from "../../templates/template-preview-contract";

import type { TemplatePreview } from "./use-template-preview";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast,
}));

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  // A fixed clock, so the rows' times read the same on every run.
  useWidgetClock: () => Date.parse("2026-11-07T10:00:00.000Z"),
  formatWidgetTime: (iso: string) => `at ${iso.slice(0, 10)}`,
  useCurrentUserId: () => "u1",
  useDocumentIdentity: () => null,
  useDocumentLocale: () => null,
  PILL_LABEL: {
    draft: "Draft",
    modified: "Modified",
    changed: "Changed",
    published: "Published",
  },
}));

// A search asks the server; here it finds one other post.
const listPreviewEntries = vi.hoisted(() => vi.fn());
vi.mock("../template-preview-client", () => ({
  listPreviewEntries,
  readPreviewEntry: vi.fn(),
}));

const { TemplatePreviewStrip } = await import("./template-preview-strip");

// What Radix's popover and cmdk's list reach for and jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const LONG_TITLE =
  "Building a content model that lasts, and the three questions we ask before adding a field";

const ROWS: readonly PreviewEntryItem[] = [
  {
    id: "p2",
    title: "Release notes: September",
    status: "draft",
    updatedAt: "2026-11-07T08:00:00.000Z",
  },
  {
    id: "p1",
    title: LONG_TITLE,
    status: "published",
    updatedAt: "2026-11-06T09:00:00.000Z",
  },
  {
    id: "p3",
    title: "Field notes: a week with the editor",
    status: "changed",
    updatedAt: "2026-11-04T09:00:00.000Z",
  },
];

/** A preview of the posts template, previewing `current`, its keys watched. */
function previewOf(
  overrides: Partial<TemplatePreview> & { current?: PreviewEntryItem } = {}
): TemplatePreview {
  const { current = ROWS[1], ...rest } = overrides;
  const previewed: PreviewedEntry =
    current === undefined
      ? { kind: "none", reason: "empty" }
      : {
          kind: "entry",
          collection: "posts",
          id: current.id,
          title: current.title,
          editorValues: {},
          publicValues: null,
          fields: [],
        };
  return {
    collection: "posts",
    fixed: false,
    labels: { singular: "Post", plural: "Posts" },
    blocksFields: undefined,
    language: undefined,
    list: { state: "ready", items: ROWS, mayCreate: true },
    chip:
      current === undefined
        ? undefined
        : {
            id: current.id,
            title: current.title,
            status: current.status,
            unavailable: false,
            loading: false,
          },
    previewed,
    latest: previewed,
    scope: JSON.stringify(["posts", null, "u1"]),
    choose: vi.fn(),
    step: vi.fn((by: 1 | -1) => (by === 1 ? ROWS[2] : ROWS[0])),
    refresh: vi.fn(),
    ...rest,
  };
}

/** The strip inside the providers the editor's shell gives what it draws. */
function renderStrip(preview: TemplatePreview, extra?: ReactNode) {
  return render(
    <ShortcutProvider>
      <TooltipProvider>
        <TemplatePreviewStrip preview={preview} />
        {extra}
      </TooltipProvider>
    </ShortcutProvider>
  );
}

const open = vi.fn();

beforeEach(() => {
  toast.mockReset();
  listPreviewEntries.mockReset();
  open.mockReset();
  vi.stubGlobal("open", open);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the chip", () => {
  it("says Previewing, then the entry's full title and status, in its accessible name", () => {
    renderStrip(previewOf());
    expect(screen.getByText("Previewing")).toBeTruthy();
    const chip = screen.getByRole("button", {
      name: `Previewing ${LONG_TITLE}, published`,
    });
    expect(chip.getAttribute("aria-haspopup")).toBe("listbox");
    // The full title is drawn, cut only by the strip's width.
    expect(chip.textContent).toContain(LONG_TITLE);
    expect(chip.textContent).toContain("Published");
  });

  it("offers the full title in a tooltip once the strip cuts it, and not before", async () => {
    renderStrip(previewOf());
    const title = screen.getByText(LONG_TITLE);
    // Not cut: no tooltip repeats the words already shown.
    fireEvent.focus(screen.getByRole("button", { name: /^Previewing / }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    // Cut by the strip's width: the tooltip carries the whole title.
    Object.defineProperty(title, "scrollWidth", { value: 900 });
    Object.defineProperty(title, "clientWidth", { value: 300 });
    const chip = screen.getByRole("button", { name: /^Previewing / });
    fireEvent.blur(chip);
    fireEvent.focus(chip);
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      LONG_TITLE
    );
  });

  /** The strip with its title cut by the strip's width. */
  function renderCut(preview = previewOf()) {
    renderStrip(preview);
    const title = screen.getByText(LONG_TITLE);
    Object.defineProperty(title, "scrollWidth", { value: 900 });
    Object.defineProperty(title, "clientWidth", { value: 300 });
    return screen.getByRole("button", { name: /^Previewing / });
  }

  it("offers the cut title on hover", async () => {
    const chip = renderCut();
    fireEvent.pointerEnter(chip);
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      LONG_TITLE
    );
    fireEvent.pointerLeave(chip);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("opens no tooltip when focus comes back to the chip after a pick", async () => {
    const preview = previewOf();
    const chip = renderCut(preview);
    fireEvent.pointerDown(chip);
    fireEvent.click(chip);
    const options = await screen.findAllByRole("option");
    fireEvent.click(options[0] as HTMLElement);
    expect(preview.choose).toHaveBeenCalledWith(ROWS[0]);
    // The picker hands focus back to the chip as it closes.
    await waitFor(() =>
      expect(screen.queryAllByRole("option")).toHaveLength(0)
    );
    act(() => {
      chip.focus();
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    // The control: the keyboard arriving on the chip offers it.
    act(() => {
      chip.blur();
    });
    fireEvent.focus(chip);
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      LONG_TITLE
    );
  });

  it("claims no status for an entry still being read", () => {
    const preview = previewOf();
    renderStrip({
      ...preview,
      chip: { ...preview.chip!, loading: true },
      previewed: { kind: "none", reason: "loading" },
    });
    expect(
      screen.getByRole("button", { name: `Previewing ${LONG_TITLE}, loading` })
    ).toBeTruthy();
    expect(screen.queryByText("Published")).toBeNull();
  });

  it("names an entry that could not be read as such, never as the entry previewed", () => {
    const preview = previewOf();
    renderStrip({
      ...preview,
      chip: { ...preview.chip!, unavailable: true },
      previewed: { kind: "none", reason: "unavailable" },
    });
    expect(
      screen.getByRole("button", {
        name: `Previewing ${LONG_TITLE}, couldn’t be read`,
      })
    ).toBeTruthy();
    expect(screen.queryByText("Published")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      `${LONG_TITLE} couldn’t be read.`
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(preview.refresh).toHaveBeenCalledTimes(1);
    // Nothing to create: the entry exists, it could not be read.
    expect(screen.queryByRole("button", { name: "New post" })).toBeNull();
  });
});

describe("the keys", () => {
  it("previews the next entry on Shift+Alt+Down and the previous on Shift+Alt+Up, and says which", () => {
    const preview = previewOf();
    renderStrip(preview);
    fireEvent.keyDown(document.body, {
      key: "ArrowDown",
      altKey: true,
      shiftKey: true,
    });
    fireEvent.keyDown(document.body, {
      key: "ArrowUp",
      altKey: true,
      shiftKey: true,
    });
    expect(vi.mocked(preview.step).mock.calls).toEqual([[1], [-1]]);
    // A quiet toast, one at a time, naming the entry switched to.
    expect(toast).toHaveBeenCalledTimes(2);
    const [message, options] = toast.mock.calls[0] ?? [];
    const { container } = render(<>{message}</>);
    expect(container.textContent).toBe(
      "Previewing Field notes: a week with the editor"
    );
    expect(options).toMatchObject({ id: "template-preview-switch" });
  });

  it("does not switch on Alt+Down, which moves a block (the control)", () => {
    const preview = previewOf();
    renderStrip(preview);
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });
    expect(preview.step).not.toHaveBeenCalled();
  });

  it("does not switch while typing in a field", () => {
    const preview = previewOf();
    renderStrip(preview, <input aria-label="Title" />);
    const field = screen.getByRole("textbox", { name: "Title" });
    field.focus();
    fireEvent.keyDown(field, {
      key: "ArrowDown",
      altKey: true,
      shiftKey: true,
    });
    expect(preview.step).not.toHaveBeenCalled();
  });

  it("does not switch while typing in the page's text", () => {
    const preview = previewOf();
    renderStrip(preview, <div data-testid="text" contentEditable />);
    const text = screen.getByTestId("text");
    // jsdom sets no `isContentEditable`; a browser does for this element.
    Object.defineProperty(text, "isContentEditable", { value: true });
    fireEvent.keyDown(text, { key: "ArrowDown", altKey: true, shiftKey: true });
    expect(preview.step).not.toHaveBeenCalled();
  });
});

describe("the picker", () => {
  it("lists the entries newest first, with each one's status and time, checking the one previewed", async () => {
    const preview = previewOf();
    renderStrip(preview);
    fireEvent.click(screen.getByRole("button", { name: /^Previewing / }));
    const options = await screen.findAllByRole("option");
    expect(options.map(option => option.textContent)).toEqual([
      "Release notes: SeptemberDraftat 2026-11-07",
      `${LONG_TITLE}, previewingPublishedat 2026-11-06`,
      "Field notes: a week with the editorChangedat 2026-11-04",
    ]);
    // The previewed one alone is marked as the current one.
    expect(options.map(option => option.hasAttribute("data-current"))).toEqual([
      false,
      true,
      false,
    ]);
    fireEvent.click(options[0] as HTMLElement);
    expect(preview.choose).toHaveBeenCalledWith(ROWS[0]);
  });

  it("searches on the server as the author types", async () => {
    listPreviewEntries.mockResolvedValue({
      items: [ROWS[2]],
      meta: { mayCreate: true },
    });
    renderStrip(previewOf());
    fireEvent.click(screen.getByRole("button", { name: /^Previewing / }));
    const search = await screen.findByPlaceholderText("Search posts");
    fireEvent.change(search, { target: { value: "field" } });
    await waitFor(() =>
      expect(listPreviewEntries).toHaveBeenCalledWith({
        collection: "posts",
        search: "field",
      })
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("option").map(option => option.textContent)
      ).toEqual(["Field notes: a week with the editorChangedat 2026-11-04"])
    );
  });

  it("opens the create screen in a new tab from New, and keeps the template open", async () => {
    renderStrip(previewOf());
    fireEvent.click(screen.getByRole("button", { name: /^Previewing / }));
    fireEvent.click(await screen.findByRole("button", { name: "New post" }));
    expect(open).toHaveBeenCalledWith(
      "/admin/collections/posts/create",
      "_blank",
      "noopener"
    );
  });

  it("offers no New to an author who may not create one", async () => {
    renderStrip(
      previewOf({ list: { state: "ready", items: ROWS, mayCreate: false } })
    );
    fireEvent.click(screen.getByRole("button", { name: /^Previewing / }));
    await screen.findAllByRole("option");
    expect(screen.queryByRole("button", { name: "New post" })).toBeNull();
  });
});

describe("with nothing to preview", () => {
  const nothing = (mayCreate: boolean) =>
    previewOf({
      current: undefined,
      list: { state: "ready", items: [], mayCreate },
    });

  it("says so on the chip and in a notice over the canvas, with New where the author may create", () => {
    renderStrip(nothing(true));
    expect(
      screen.getByRole("button", { name: "No posts to preview" })
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "No posts to preview. Bound text shows its fallback until there is one."
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "New post" }));
    });
    expect(open).toHaveBeenCalledWith(
      "/admin/collections/posts/create",
      "_blank",
      "noopener"
    );
  });

  it("says the same without New to an author who may not create one", () => {
    renderStrip(nothing(false));
    expect(screen.getByRole("status").textContent).toContain(
      "No posts to preview. Bound text shows its fallback until there is one."
    );
    expect(screen.queryByRole("button", { name: "New post" })).toBeNull();
  });

  it("shows no notice while an entry is previewed (the control)", () => {
    renderStrip(previewOf());
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("on an entry's own design", () => {
  it("previews its one entry, with no picker and no keys", () => {
    const preview = previewOf({ fixed: true });
    renderStrip(preview);
    const strip = document.querySelector(".nx-preview-strip");
    expect(strip?.textContent).toContain(`Previewing${LONG_TITLE}Published`);
    // Nothing to choose: no chip to press, so no menu and no chevron.
    expect(screen.queryByRole("button", { name: /^Previewing / })).toBeNull();
    expect(document.querySelector(".nx-preview-strip__chevron")).toBeNull();
    fireEvent.keyDown(document.body, {
      key: "ArrowDown",
      altKey: true,
      shiftKey: true,
    });
    expect(preview.step).not.toHaveBeenCalled();
  });

  it("says its entry could not be read, with Try again", () => {
    const preview = previewOf({ fixed: true });
    renderStrip({
      ...preview,
      chip: { ...preview.chip!, unavailable: true },
      previewed: { kind: "none", reason: "unavailable" },
    });
    expect(document.querySelector(".nx-preview-strip")?.textContent).toContain(
      "Couldn’t be read"
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(preview.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the picker and the keys on a collection's template (the control)", () => {
    const preview = previewOf();
    renderStrip(preview);
    expect(
      screen
        .getByRole("button", { name: /^Previewing / })
        .getAttribute("aria-haspopup")
    ).toBe("listbox");
    fireEvent.keyDown(document.body, {
      key: "ArrowDown",
      altKey: true,
      shiftKey: true,
    });
    expect(preview.step).toHaveBeenCalledWith(1);
  });
});
