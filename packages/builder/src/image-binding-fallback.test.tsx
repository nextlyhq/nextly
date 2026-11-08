// @vitest-environment jsdom

/**
 * A bound image's Fallback row on its own: an address committed through
 * `onFallback`, anything else held back with the reason, a stored address
 * named in full and pictured, a stored media id named by its file and never
 * by the id, and the library picker: its grid, its keyboard, its empty state,
 * "Browse all…" to the host's dialog and "Use this address" for a pasted
 * address, every one of them writing through `onFallback` alone.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type * as React from "react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import type {
  ContentServices,
  FoundMedia,
  MediaPickerProps,
  MediaSummary,
} from "./content-controls";
import { ImageBindingFallback } from "./image-binding-fallback";

beforeAll(() => {
  // What Radix's popover asks of an element, which jsdom does not draw.
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

afterEach(cleanup);

const ADDRESS = "https://cdn.example.test/campaigns/spring-banner.jpg";

/** The library's newest images, as the host's search answers them. */
const FOUND: readonly FoundMedia[] = [
  { id: "m-1", name: "spring-banner.jpg", thumbnail: "/t/spring.jpg" },
  { id: "m-2", name: "campus.jpg", thumbnail: "/t/campus.jpg" },
  { id: "m-3", name: "workbook.png", thumbnail: "/t/workbook.png" },
  { id: "m-4", name: "team.jpg", thumbnail: "/t/team.jpg" },
  // No file name: named by its alt text.
  { id: "m-5", alt: "The course room", thumbnail: "/t/course.jpg" },
];

/** A search that finds the images above for anything but "zebra". */
function searchOf(): Mock<NonNullable<ContentServices["searchMedia"]>> {
  return vi.fn<NonNullable<ContentServices["searchMedia"]>>(async search =>
    search === "zebra" ? [] : FOUND
  );
}

/**
 * The host's media dialog, drawn as one button that picks `m-9`; the props
 * it was opened with are kept for the case to read.
 */
function pickerOf(
  opened: MediaPickerProps[]
): React.ComponentType<MediaPickerProps> {
  return function Picker(props: MediaPickerProps): React.JSX.Element {
    opened.push(props);
    return (
      <div role="dialog" aria-label="Media library">
        <button type="button" onClick={() => props.onSelect([{ id: "m-9" }])}>
          Pick m-9
        </button>
      </div>
    );
  };
}

function mountRow(
  services: ContentServices | undefined,
  fallback?: string
): { onFallback: Mock<(value: string) => void> } {
  const onFallback = vi.fn<(value: string) => void>();
  render(
    <ImageBindingFallback
      binding={
        fallback === undefined
          ? { $bind: "cover" }
          : { $bind: "cover", fallback }
      }
      onFallback={onFallback}
      services={services}
      shownWhen="Shown when a post has no cover image."
    />
  );
  return { onFallback };
}

/** Open the library popover and wait for its first images. */
async function openLibrary(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Choose from library" }));
  await screen.findByRole("option", { name: "spring-banner.jpg" });
  return screen.getByRole("combobox", { name: "Find in the media library" });
}

describe("a bound image's Fallback", () => {
  it("commits a typed image address through onFallback", () => {
    const { onFallback } = mountRow(undefined);
    const field = screen.getByRole("textbox", { name: "Fallback" });
    fireEvent.change(field, { target: { value: `  ${ADDRESS}  ` } });
    fireEvent.blur(field);
    // Trimmed, as the address a visitor's page draws.
    expect(onFallback.mock.calls).toEqual([[ADDRESS]]);
  });

  it("holds back what is not an image address, and says why", () => {
    // The control for the test above: the same commit, with a value the
    // field does not take (a file name, or a media id typed by hand), writes
    // nothing.
    const { onFallback } = mountRow(undefined);
    const field = screen.getByRole("textbox", { name: "Fallback" });
    fireEvent.change(field, { target: { value: "spring-banner.jpg" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onFallback).not.toHaveBeenCalled();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(
      /^Enter an image address/
    );
  });

  it("clears the fallback when the field is emptied", () => {
    const { onFallback } = mountRow(undefined, ADDRESS);
    const field = screen.getByRole("textbox", { name: `Fallback: ${ADDRESS}` });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(onFallback.mock.calls).toEqual([[""]]);
  });

  it("names a stored address in full, on its tooltip too, beside its picture", () => {
    mountRow(undefined, ADDRESS);
    // The field cuts a long address; its name and tooltip carry all of it.
    const field = screen.getByRole("textbox", {
      name: `Fallback: ${ADDRESS}`,
    });
    expect(field.getAttribute("title")).toBe(`Fallback: ${ADDRESS}`);
    expect((field as HTMLInputElement).value).toBe(ADDRESS);
    const picture = document.querySelector(".nx-image-fallback__thumb");
    expect(picture?.getAttribute("src")).toBe(ADDRESS);
    // Decorative: the address beside it already names it.
    expect(picture?.getAttribute("alt")).toBe("");
  });

  it("offers no library button where the host has neither a search nor a dialog", () => {
    mountRow(undefined);
    const place = document.querySelector("[data-fallback-actions]");
    // There, so the action lands in the row's layout, and empty, so nothing
    // is offered that would do nothing.
    expect(place).not.toBeNull();
    expect(place?.childElementCount).toBe(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("a fallback chosen from the media library", () => {
  it("is named by the file readMedia reads, never by its id", async () => {
    const readMedia = vi.fn<(id: string) => Promise<MediaSummary | null>>(
      async () => ({ name: "spring-banner.jpg", thumbnail: "/t/spring.jpg" })
    );
    const { onFallback } = mountRow({ readMedia }, "m-7");
    const row = await screen.findByRole("group", {
      name: "Fallback: spring-banner.jpg",
    });
    expect(readMedia).toHaveBeenCalledWith("m-7");
    expect(row.getAttribute("title")).toBe("Fallback: spring-banner.jpg");
    expect(row.querySelector("img")?.getAttribute("src")).toBe("/t/spring.jpg");
    // The id is stored, not shown: not in the row's words, nor in a field.
    expect(document.body.textContent).not.toContain("m-7");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(
      within(row).getByRole("button", { name: "Remove fallback" })
    );
    expect(onFallback.mock.calls).toEqual([[""]]);
  });

  it("says it is a library image while it is read, and when the library has lost it", async () => {
    let answer: (summary: MediaSummary | null) => void = () => {};
    const readMedia = vi.fn<(id: string) => Promise<MediaSummary | null>>(
      () =>
        new Promise(resolve => {
          answer = resolve;
        })
    );
    mountRow({ readMedia }, "m-7");
    expect(
      screen.getByRole("group", { name: "Fallback: Library image" })
    ).toBeTruthy();
    answer(null);
    expect(
      await screen.findByRole("group", {
        name: "Fallback: A file that is no longer in the library",
      })
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("m-7");
  });
});

describe("the Fallback's library picker", () => {
  it("opens from the row's button with the newest images, the search focused", async () => {
    const searchMedia = searchOf();
    mountRow({ searchMedia });
    const search = await openLibrary();
    // The newest: asked with an empty search.
    expect(searchMedia.mock.calls[0]?.[0]).toBe("");
    expect(searchMedia.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    const grid = screen.getByRole("listbox", {
      name: "Images in the media library",
    });
    // Each named by its file, else its alt text.
    expect(
      within(grid)
        .getAllByRole("option")
        .map(option => option.textContent)
    ).toEqual([
      "spring-banner.jpg",
      "campus.jpg",
      "workbook.png",
      "team.jpg",
      "The course room",
    ]);
    expect(document.activeElement).toBe(search);
    expect(
      screen.getByText(
        "Shown when a post has no cover image. Or paste an image address."
      )
    ).toBeTruthy();
  });

  it("writes a picked tile's id through onFallback, and closes", async () => {
    const { onFallback } = mountRow({ searchMedia: searchOf() });
    await openLibrary();
    fireEvent.click(screen.getByRole("option", { name: "campus.jpg" }));
    // The id, which stays right when the file is renamed, not its name.
    expect(onFallback.mock.calls).toEqual([["m-2"]]);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("moves through the grid by the arrows and picks the active tile on Enter", async () => {
    const { onFallback } = mountRow({ searchMedia: searchOf() });
    const search = await openLibrary();
    const active = (): string | null | undefined => {
      const id = search.getAttribute("aria-activedescendant");
      return id === null ? null : document.getElementById(id)?.textContent;
    };
    expect(active()).toBe("spring-banner.jpg");
    fireEvent.keyDown(search, { key: "ArrowRight" });
    expect(active()).toBe("campus.jpg");
    // Down a row: three along, the grid's width.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(active()).toBe("The course room");
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(active()).toBe("campus.jpg");
    fireEvent.keyDown(search, { key: "ArrowLeft" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(active()).toBe("team.jpg");
    fireEvent.keyDown(search, { key: "Enter" });
    // The control: the active tile, and only it, is written; not the first,
    // nor the one the arrows passed through.
    expect(onFallback.mock.calls).toEqual([["m-4"]]);
  });

  it("closes on Escape and hands focus back to the row's button", async () => {
    const { onFallback } = mountRow({ searchMedia: searchOf() });
    const search = await openLibrary();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Choose from library" })
      )
    );
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("marks the stored file selected in the grid", async () => {
    mountRow(
      {
        searchMedia: searchOf(),
        readMedia: async () => ({ name: "workbook.png" }),
      },
      "m-3"
    );
    await openLibrary();
    expect(
      screen
        .getByRole("option", { name: "workbook.png" })
        .getAttribute("aria-selected")
    ).toBe("true");
    // The control: another tile is not.
    expect(
      screen
        .getByRole("option", { name: "campus.jpg" })
        .getAttribute("aria-selected")
    ).toBe("false");
  });

  it("says what the search matched nothing for, and still offers Browse all…", async () => {
    const opened: MediaPickerProps[] = [];
    mountRow({ searchMedia: searchOf(), MediaPicker: pickerOf(opened) });
    const search = await openLibrary();
    fireEvent.change(search, { target: { value: "zebra" } });
    expect(await screen.findByText("No images match “zebra”.")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Browse all…" })).toBeTruthy();
  });

  it("says the library could not be read, and still offers Browse all…", async () => {
    const opened: MediaPickerProps[] = [];
    mountRow({
      searchMedia: async () => {
        throw new Error("Forbidden");
      },
      MediaPicker: pickerOf(opened),
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose from library" })
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't read the media library."
    );
    expect(screen.getByRole("button", { name: "Browse all…" })).toBeTruthy();
  });

  it("opens the host's dialog from Browse all…, whose pick writes the id", async () => {
    const opened: MediaPickerProps[] = [];
    const { onFallback } = mountRow({
      searchMedia: searchOf(),
      MediaPicker: pickerOf(opened),
    });
    await openLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Browse all…" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Media library",
    });
    // The popover gave way to the dialog, which offers images alone.
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(opened.at(-1)?.accept).toBe("image/*");
    fireEvent.click(within(dialog).getByRole("button", { name: "Pick m-9" }));
    expect(onFallback.mock.calls).toEqual([["m-9"]]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers a pasted image address as itself, and writes the address", async () => {
    const searchMedia = searchOf();
    const { onFallback } = mountRow({ searchMedia });
    const search = await openLibrary();
    fireEvent.change(search, { target: { value: ` ${ADDRESS} ` } });
    const use = await screen.findByRole("option", {
      name: /^Use this address/,
    });
    // The library is not searched for an address: no file is named like one.
    expect(searchMedia.mock.calls.map(call => call[0])).not.toContain(ADDRESS);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onFallback.mock.calls).toEqual([[ADDRESS]]);
    expect(use).toBeTruthy();
  });

  it("offers no address for a search that is not one", async () => {
    // The control for the case above: a file name is searched, not offered.
    const searchMedia = searchOf();
    mountRow({ searchMedia });
    const search = await openLibrary();
    fireEvent.change(search, { target: { value: "spring" } });
    await waitFor(() =>
      expect(searchMedia.mock.calls.map(call => call[0])).toContain("spring")
    );
    await screen.findByRole("option", { name: "spring-banner.jpg" });
    expect(
      screen.queryByRole("option", { name: /^Use this address/ })
    ).toBeNull();
  });

  it("opens the host's dialog straight from the button where the host has no search", async () => {
    const opened: MediaPickerProps[] = [];
    const { onFallback } = mountRow({ MediaPicker: pickerOf(opened) });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose from library" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Media library",
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Pick m-9" }));
    expect(onFallback.mock.calls).toEqual([["m-9"]]);
  });
});
