// @vitest-environment jsdom

/**
 * The Background section's image: picked from the library or uploaded and
 * written by its address, given by a pasted link, shown with Replace and
 * Remove once set, and Remove clears only the image.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import type { StyleValue } from "@nextlyhq/blocks-engine";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { BackgroundImageField } from "./background-image-control";
import type {
  ContentServices,
  MediaPickerProps,
  PickedMedia,
} from "./content-services";
import { ContentServicesContext } from "./content-services";
import { InheritedValue } from "./inherited-value";

afterEach(cleanup);

/** What the field is handed to write with. */
type Commit = (value: StyleValue | null) => "applied" | "refused" | "unchanged";

const PICKED: PickedMedia = {
  id: "m1",
  url: "https://cdn.example.com/hero.jpg",
  filename: "hero.jpg",
};

/** A library that hands back `picked` as soon as it opens. */
function libraryReturning(picked: PickedMedia) {
  return function Library({ open, onSelect }: MediaPickerProps) {
    React.useEffect(() => {
      if (open) onSelect([picked]);
    }, [open, onSelect]);
    return null;
  };
}

function renderField({
  stored,
  services = {},
  onCommit = vi.fn<Commit>(() => "applied"),
}: {
  stored?: string;
  services?: Partial<ContentServices>;
  onCommit?: Mock<Commit>;
}) {
  render(
    <ContentServicesContext.Provider value={services as ContentServices}>
      <span id="label">Image</span>
      <BackgroundImageField
        id="bg-image"
        labelledBy="label"
        stored={stored}
        actionName="Set Image"
        describedBy={undefined}
        onCommit={onCommit}
      />
    </ContentServicesContext.Provider>
  );
  return onCommit;
}

describe("choosing a background image", () => {
  it("writes the library file's address, not its id", async () => {
    const onCommit = renderField({
      services: { MediaPicker: libraryReturning(PICKED) },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose Background image" })
    );
    await vi.waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith("https://cdn.example.com/hero.jpg")
    );
  });

  it("says so, and writes nothing, for a library file with no address", async () => {
    const onCommit = renderField({
      services: { MediaPicker: libraryReturning({ id: "m2", url: null }) },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose Background image" })
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That file has no address to show it from."
    );
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("uploads a file and writes its address", async () => {
    const uploadMedia = vi.fn(async () => PICKED);
    const onCommit = renderField({ services: { uploadMedia } });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["x"], "hero.jpg", { type: "image/jpeg" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    await vi.waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith("https://cdn.example.com/hero.jpg")
    );
    expect(uploadMedia).toHaveBeenCalledWith(file);
  });

  it("writes a pasted link when the field is left, and on Enter", () => {
    const onCommit = renderField({});
    const link = screen.getByRole("textbox", { name: "Image link" });
    fireEvent.change(link, { target: { value: " https://x.test/a.png " } });
    fireEvent.blur(link);
    expect(onCommit).toHaveBeenLastCalledWith("https://x.test/a.png");
    fireEvent.change(link, { target: { value: "https://x.test/b.png" } });
    fireEvent.keyDown(link, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith("https://x.test/b.png");
  });

  it("offers no library or upload when the host provides neither, only the link", () => {
    renderField({});
    expect(screen.queryByRole("button", { name: /Choose/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Image link" })).toBeDefined();
  });
});

describe("a set background image", () => {
  it("shows a thumbnail and its file name, with Replace and Remove", () => {
    renderField({
      stored: "https://cdn.example.com/hero.jpg",
      services: { MediaPicker: libraryReturning(PICKED), uploadMedia: vi.fn() },
    });
    expect(screen.getByText("hero.jpg")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Choose Background image" })
        .textContent
    ).toBe("Replace");
    expect(
      screen.getByRole("button", { name: "Remove background image" })
    ).toBeDefined();
    // Upload and the link are for choosing; Replace takes their place.
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Image link" })).toBeNull();
  });

  it("clears only the image on Remove", () => {
    const onCommit = renderField({ stored: "https://x.test/a.png" });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove background image" })
    );
    expect(onCommit).toHaveBeenCalledWith(null);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("says a keyword set here names no image, and offers to remove it", () => {
    const onCommit = renderField({ stored: "none" });
    expect(screen.getByText("No image here (none).")).toBeDefined();
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove background image" })
    );
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it.each(["None", "inherit", "revert-layer"])(
    "draws no thumbnail for the keyword %j",
    keyword => {
      renderField({ stored: keyword });
      expect(document.querySelector("img")).toBeNull();
    }
  );

  it("names a file whose address holds a bare %, rather than failing", () => {
    renderField({ stored: "/img/100%.jpg" });
    expect(screen.getByText("100%.jpg")).toBeDefined();
  });
});

describe("an image reaching the field from elsewhere", () => {
  it("says which image is inherited when none is set here", () => {
    render(
      <InheritedValue.Provider value="https://cdn.example.com/hero.jpg">
        <BackgroundImageField
          id="bg-image"
          labelledBy="label"
          stored={undefined}
          actionName="Set Image"
          describedBy={undefined}
          onCommit={() => "applied"}
        />
      </InheritedValue.Provider>
    );
    expect(screen.getByText("Inherits hero.jpg")).toBeDefined();
  });
});

describe("uploading", () => {
  it("refuses a file that isn't an image, as the canvas's Image does", async () => {
    const uploadMedia = vi.fn(async () => PICKED);
    const onCommit = renderField({ services: { uploadMedia } });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["%PDF"], "brief.pdf", { type: "application/pdf" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That file isn't an image."
    );
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("says why an upload failed, in the library's words, and can be tried again", async () => {
    const uploadMedia = vi.fn(async () => {
      throw new Error("The file is too large");
    });
    renderField({ services: { uploadMedia } });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["x"], "big.jpg", { type: "image/jpeg" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The upload didn't finish: The file is too large"
    );
    // Not left "Uploading…": the button is offered again.
    expect(
      (screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("holds the link field while an upload runs, then writes the upload", async () => {
    let finish: (media: PickedMedia) => void = () => {};
    const uploadMedia = vi.fn(
      () =>
        new Promise<PickedMedia>(resolve => {
          finish = resolve;
        })
    );
    const onCommit = renderField({ services: { uploadMedia } });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] },
    });
    // The link field is held while the upload runs.
    const link = screen.getByRole("textbox", {
      name: "Image link",
    }) as HTMLInputElement;
    expect(link.disabled).toBe(true);
    finish(PICKED);
    await vi.waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith("https://cdn.example.com/hero.jpg")
    );
  });
});

describe("what the review asked of it", () => {
  it("reads an escaped keyword as the compiler does: no image", () => {
    // `\\6e one` is `none`, written with a CSS escape; the page draws none.
    renderField({ stored: "\\6e one" });
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/^No image here/)).toBeDefined();
  });

  it("opens Replace with nothing selected, since an address is no media id", async () => {
    const opened: { size: number }[] = [];
    function Library({ open, initialSelectedIds }: MediaPickerProps) {
      if (open) opened.push({ size: initialSelectedIds?.size ?? 0 });
      return null;
    }
    renderField({
      stored: "https://cdn.example.com/hero.jpg",
      services: { MediaPicker: Library },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose Background image" })
    );
    await vi.waitFor(() => expect(opened.length).toBeGreaterThan(0));
    expect(opened.every(each => each.size === 0)).toBe(true);
  });

  it("keeps a Remove pressed while an upload runs, rather than the upload's later result", async () => {
    let finish: (media: PickedMedia) => void = () => {};
    const uploadMedia = vi.fn(
      () =>
        new Promise<PickedMedia>(resolve => {
          finish = resolve;
        })
    );
    // A keyword set here offers both Upload and Remove at once.
    const onCommit = renderField({ stored: "none", services: { uploadMedia } });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove background image" })
    );
    finish(PICKED);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onCommit.mock.calls).toEqual([[null]]);
  });
});

describe("an upload finishing after the field was drawn again", () => {
  it("writes through the newest commit, not the one the upload started with", async () => {
    // Each render's commit holds the document as it was then; an upload that
    // finished through an older one would write back an older page.
    let finish: (media: PickedMedia) => void = () => {};
    const uploadMedia = vi.fn(
      () =>
        new Promise<PickedMedia>(resolve => {
          finish = resolve;
        })
    );
    const first = vi.fn<Commit>(() => "applied");
    const second = vi.fn<Commit>(() => "applied");
    const field = (onCommit: Commit) => (
      <ContentServicesContext.Provider
        value={{ uploadMedia } as unknown as ContentServices}
      >
        <BackgroundImageField
          id="bg-image"
          labelledBy="label"
          stored={undefined}
          actionName="Set Image"
          describedBy={undefined}
          onCommit={onCommit}
        />
      </ContentServicesContext.Provider>
    );
    const { rerender } = render(field(first));
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] },
    });
    rerender(field(second));
    finish(PICKED);
    await vi.waitFor(() =>
      expect(second).toHaveBeenCalledWith("https://cdn.example.com/hero.jpg")
    );
    expect(first).not.toHaveBeenCalled();
  });
});
