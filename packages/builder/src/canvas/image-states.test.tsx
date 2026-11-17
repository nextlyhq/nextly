// @vitest-environment jsdom
/**
 * An Image's empty state on the canvas, each state and each choice:
 *
 * - "Add an image" with Upload, Media library and Link, and "or drop a file
 *   here", over an Image with nothing chosen; a choice whose host service
 *   is absent is not offered;
 * - Upload and a dropped file go through the host's upload with progress on
 *   the block, then store the file; a file that is not a picture says so and
 *   changes nothing; an upload refused says why;
 * - Media library stores the file picked;
 * - Link stores an address only once it loads as a picture, and otherwise
 *   says "This link didn't load an image" with "Try another link";
 * - a library file the library no longer has says so, with Replace;
 * - a file dropped on an Image with a picture replaces it;
 * - a locked or bound Image, or one a component placed, offers nothing.
 *
 * jsdom lays nothing out, so where each plate is drawn is not asserted here:
 * the overlay measures as `EmptyContainerAppenders` does, and the browser
 * test checks the box on a real canvas. jsdom loads no pictures either, so
 * whether a link loads is the model's question, answered by a stand-in.
 *
 * @module canvas/image-states.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaPickerProps, PickedMedia } from "../content-services";
import type { EditorState } from "../editor-state";
import { CANVAS_ROOT_CLASS } from "../shell-state";

const loads = vi.fn<(address: string) => Promise<boolean>>();

vi.mock("./image-states-model", async importOriginal => ({
  ...(await importOriginal<typeof import("./image-states-model")>()),
  loadsAsImage: (address: string) => loads(address),
}));

const { ImageStates } = await import("./image-states");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

beforeEach(() => {
  loads.mockResolvedValue(true);
  // jsdom lays nothing out, so every element reports no box. The canvas
  // lays out each one here except an element marked as drawn nowhere, as a
  // box inside a closed accordion item is.
  // Each element is laid out at the rectangle a case gives it, else at a
  // 320 by 180 box at the origin.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const [x, y, w, h] = (
        this.getAttribute("data-test-rect") ?? "0,0,320,180"
      )
        .split(",")
        .map(Number);
      return new DOMRect(x, y, w, h);
    }
  );
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
    this: Element
  ) {
    const boxes = this.hasAttribute("data-test-undrawn")
      ? []
      : [new DOMRect(0, 0, 320, 180)];
    return Object.assign(boxes, {
      item: (i: number) => boxes[i] ?? null,
    }) as unknown as DOMRectList;
  });
});

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

function imageNode(
  id: string,
  props: Record<string, unknown> = {},
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type: "core/image", version: 1, props, ...extra };
}

/** An editor over `document`, recording what it is asked to write. */
function editorOver(document: BlockDocument) {
  const apply = vi.fn<EditorState["apply"]>(() => document);
  const select = vi.fn<EditorState["select"]>();
  const editor = {
    document,
    selectedId: null,
    selection: { ids: [], primary: null },
    select,
    apply,
    composed: () => undefined,
  } as unknown as EditorState;
  return { editor, apply, select };
}

/** The host's picker: records it was opened, and picks when told. */
let picker: MediaPickerProps | null = null;
function FakePicker(props: MediaPickerProps): React.JSX.Element {
  picker = props;
  return <div role="dialog" aria-label={props.title} />;
}

type Upload = (
  file: File,
  onProgress?: (percent: number) => void
) => Promise<PickedMedia>;

interface Mounted {
  readonly apply: ReturnType<typeof editorOver>["apply"];
  readonly select: ReturnType<typeof editorOver>["select"];
  readonly root: HTMLElement;
}

/**
 * A canvas root holding the boxes the Image block draws, as the page
 * renderer marks them, with the overlay inside it as the canvas holds it.
 */
function mount(
  document: BlockDocument,
  boxes: string,
  services: { upload?: Upload | null; picker?: boolean } = {}
): Mounted {
  const { editor, apply, select } = editorOver(document);
  const upload =
    services.upload === undefined ? vi.fn<Upload>() : services.upload;
  const { container } = render(
    <div className={CANVAS_ROOT_CLASS}>
      <div dangerouslySetInnerHTML={{ __html: boxes }} />
      <ImageStates
        editor={editor}
        services={{
          ...(upload === null ? {} : { uploadMedia: upload }),
          ...(services.picker === false ? {} : { MediaPicker: FakePicker }),
        }}
      />
    </div>
  );
  const root = container.querySelector(`.${CANVAS_ROOT_CLASS}`);
  if (!(root instanceof HTMLElement)) throw new Error("no canvas root");
  return { apply, select, root };
}

const EMPTY_BOX = '<div data-nx-node="img" data-nx-image-empty="empty"></div>';
const MISSING_BOX =
  '<div data-nx-node="img" data-nx-image-empty="missing"></div>';

/** A drag event carrying these files, as a browser hands one over. */
function fileDrag(type: string, files: File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: ["Files"], files, dropEffect: "none" },
  });
  return event;
}

const PNG = (): File => new File(["png"], "photo.png", { type: "image/png" });
const PDF = (): File =>
  new File(["pdf"], "brief.pdf", { type: "application/pdf" });

/** The one write asked for, as the props it stores. */
function writtenProps(apply: Mounted["apply"]): unknown {
  expect(apply).toHaveBeenCalledTimes(1);
  const op = apply.mock.calls[0]?.[0] as { patch?: { props?: unknown } };
  return op.patch?.props;
}

describe("an Image with nothing chosen", () => {
  it("reads Add an image, with Upload, Media library, Link and the drop hint", () => {
    mount(page(imageNode("img")), EMPTY_BOX);
    expect(screen.getByText("Add an image")).toBeTruthy();
    for (const name of ["Upload", "Media library", "Link"]) {
      const button = screen.getByRole("button", { name });
      // Real buttons, in the tab order.
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("tabindex")).not.toBe("-1");
    }
    expect(screen.getByText("or drop a file here")).toBeTruthy();
  });

  it("offers no Upload or drop without the host's upload, and no Media library without its picker", () => {
    mount(page(imageNode("img")), EMPTY_BOX, { upload: null, picker: false });
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Media library" })).toBeNull();
    expect(screen.queryByText("or drop a file here")).toBeNull();
    expect(screen.getByRole("button", { name: "Link" })).toBeTruthy();
  });

  it("selects its block when the box itself is pressed", () => {
    const { select } = mount(page(imageNode("img")), EMPTY_BOX);
    fireEvent.click(screen.getByRole("group", { name: "Image" }));
    expect(select).toHaveBeenCalledWith("img", "replace");
  });
});

describe("Upload", () => {
  it("uploads the chosen file with its progress on the block, then stores it", async () => {
    let progress: ((percent: number) => void) | undefined;
    let finish: ((media: PickedMedia) => void) | undefined;
    const upload = vi.fn<Upload>(
      (_file, onProgress) =>
        new Promise(resolve => {
          progress = onProgress;
          finish = resolve;
        })
    );
    const { apply, root } = mount(page(imageNode("img")), EMPTY_BOX, {
      upload,
    });
    const chooser = root.querySelector('input[type="file"]');
    if (!(chooser instanceof HTMLInputElement)) throw new Error("no chooser");
    expect(chooser.accept).toBe("image/*");
    const file = PNG();
    fireEvent.change(chooser, { target: { files: [file] } });
    expect(upload).toHaveBeenCalledWith(file, expect.any(Function));

    act(() => progress?.(40));
    const bar = screen.getByRole("progressbar", { name: "Uploading" });
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("Uploading photo.png")).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();

    await act(async () => finish?.({ id: "m7" }));
    expect(writtenProps(apply)).toEqual({ mediaId: "m7" });
  });

  it("says a file that is not a picture isn't one, and sends and stores nothing", () => {
    const upload = vi.fn<Upload>();
    const { apply, root } = mount(page(imageNode("img")), EMPTY_BOX, {
      upload,
    });
    const chooser = root.querySelector('input[type="file"]');
    fireEvent.change(chooser as Element, { target: { files: [PDF()] } });
    expect(screen.getByRole("alert").textContent).toBe(
      "That file isn't an image"
    );
    expect(upload).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    // Its choices stay, to try again.
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
  });

  it("says why the library refused an upload, and stores nothing", async () => {
    const upload = vi.fn<Upload>(() =>
      Promise.reject(new Error("File is larger than 10 MB"))
    );
    const { apply, root } = mount(page(imageNode("img")), EMPTY_BOX, {
      upload,
    });
    const chooser = root.querySelector('input[type="file"]');
    fireEvent.change(chooser as Element, { target: { files: [PNG()] } });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "The upload didn't finish: File is larger than 10 MB"
      )
    );
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("a file dropped on the box", () => {
  it("is uploaded and stored", async () => {
    const upload = vi.fn<Upload>(() => Promise.resolve({ id: "m8" }));
    const { apply } = mount(page(imageNode("img")), EMPTY_BOX, { upload });
    const plate = screen.getByRole("group", { name: "Image" });
    const over = fileDrag("dragover", [PNG()]);
    act(() => {
      plate.dispatchEvent(over);
    });
    // Taken: the browser is told not to open the file itself.
    expect(over.defaultPrevented).toBe(true);
    await act(async () => {
      plate.dispatchEvent(fileDrag("drop", [PNG()]));
    });
    expect(upload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(writtenProps(apply)).toEqual({ mediaId: "m8" }));
  });

  it("is refused, changing nothing, when it is not a picture", () => {
    const upload = vi.fn<Upload>();
    const { apply } = mount(page(imageNode("img")), EMPTY_BOX, { upload });
    const plate = screen.getByRole("group", { name: "Image" });
    act(() => {
      plate.dispatchEvent(fileDrag("drop", [PDF()]));
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "That file isn't an image"
    );
    expect(upload).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("Media library", () => {
  it("opens the host's picker for images, and stores the file picked", () => {
    const { apply, select } = mount(page(imageNode("img")), EMPTY_BOX);
    fireEvent.click(screen.getByRole("button", { name: "Media library" }));
    expect(select).toHaveBeenCalledWith("img");
    expect(
      screen.getByRole("dialog", { name: "Choose an image" })
    ).toBeTruthy();
    expect(picker?.accept).toBe("image/*");
    act(() => picker?.onSelect([{ id: "m9" }]));
    expect(writtenProps(apply)).toEqual({ mediaId: "m9" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Link", () => {
  async function typeLink(address: string): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const field = screen.getByLabelText("Image address");
    expect(window.document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: address } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });
  }

  it("stores an address once it loads as a picture", async () => {
    const { apply } = mount(page(imageNode("img")), EMPTY_BOX);
    await typeLink("https://cdn.example/team.png");
    expect(loads).toHaveBeenCalledWith("https://cdn.example/team.png");
    await waitFor(() =>
      expect(writtenProps(apply)).toEqual({
        src: "https://cdn.example/team.png",
      })
    );
  });

  it("says an address that does not load didn't load an image, and stays empty", async () => {
    loads.mockResolvedValue(false);
    const { apply } = mount(page(imageNode("img")), EMPTY_BOX);
    await typeLink("https://example.com/nothing.png");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "This link didn't load an image"
      )
    );
    expect(apply).not.toHaveBeenCalled();
    // "Try another link" brings the field back with what was typed.
    fireEvent.click(screen.getByRole("button", { name: "Try another link" }));
    const field = screen.getByLabelText("Image address");
    expect((field as HTMLInputElement).value).toBe(
      "https://example.com/nothing.png"
    );
    expect(window.document.activeElement).toBe(field);
  });

  it("refuses an address the page would not draw, without loading it", async () => {
    const { apply } = mount(page(imageNode("img")), EMPTY_BOX);
    await typeLink("javascript:alert(1)");
    expect(screen.getByRole("alert").textContent).toBe(
      "This link didn't load an image"
    );
    expect(loads).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("goes back to the choices on Escape", () => {
    mount(page(imageNode("img")), EMPTY_BOX);
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.keyDown(screen.getByLabelText("Image address"), {
      key: "Escape",
    });
    expect(screen.getByText("Add an image")).toBeTruthy();
  });
});

describe("an Image whose library file is gone", () => {
  it("says the file is missing, and Replace stores the one picked", () => {
    const { apply } = mount(
      page(imageNode("img", { mediaId: "deleted" })),
      MISSING_BOX
    );
    expect(screen.getByText("This image's file is missing")).toBeTruthy();
    expect(screen.queryByText("Add an image")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    act(() => picker?.onSelect([{ id: "m10" }]));
    expect(writtenProps(apply)).toEqual({ mediaId: "m10" });
  });
});

describe("a file dropped on an Image with a picture", () => {
  it("replaces its picture", async () => {
    const upload = vi.fn<Upload>(() => Promise.resolve({ id: "m11" }));
    const { apply, root } = mount(
      page(imageNode("img", { src: "https://cdn.example/old.png" })),
      '<img data-nx-node="img" src="https://cdn.example/old.png" alt="">',
      { upload }
    );
    const picture = root.querySelector('[data-nx-node="img"]');
    if (picture === null) throw new Error("no picture");
    const over = fileDrag("dragover", [PNG()]);
    act(() => {
      picture.dispatchEvent(over);
    });
    expect(over.defaultPrevented).toBe(true);
    expect(screen.getByText("Drop to replace the image")).toBeTruthy();
    await act(async () => {
      picture.dispatchEvent(fileDrag("drop", [PNG()]));
    });
    await waitFor(() =>
      expect(writtenProps(apply)).toEqual({
        src: "https://cdn.example/old.png",
        mediaId: "m11",
      })
    );
  });

  it("is refused with a note, changing nothing, when it is not a picture", () => {
    const upload = vi.fn<Upload>();
    const { apply, root } = mount(
      page(imageNode("img", { src: "https://cdn.example/old.png" })),
      '<img data-nx-node="img" src="https://cdn.example/old.png" alt="">',
      { upload }
    );
    const picture = root.querySelector('[data-nx-node="img"]');
    act(() => {
      picture?.dispatchEvent(fileDrag("drop", [PDF()]));
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "That file isn't an image"
    );
    expect(upload).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("an Image whose picture is set elsewhere", () => {
  it("offers nothing while a lock holds it", () => {
    mount(page(imageNode("img", {}, { locked: true } as never)), EMPTY_BOX);
    expect(screen.getByText("Add an image")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("or drop a file here")).toBeNull();
  });

  it("draws nothing over one a placed component holds", () => {
    mount(
      page(imageNode("img")),
      '<div data-nx-node="img" data-nx-instance="placed" data-nx-image-empty="empty"></div>'
    );
    expect(screen.queryByText("Add an image")).toBeNull();
  });
});

describe("an answer that comes after the author moved on", () => {
  it("stores no link whose check was cancelled", async () => {
    let answer: ((loaded: boolean) => void) | undefined;
    loads.mockImplementation(
      () =>
        new Promise(resolve => {
          answer = resolve;
        })
    );
    const { apply } = mount(page(imageNode("img")), EMPTY_BOX);
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("Image address"), {
      target: { value: "https://cdn.example/slow.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(loads).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => answer?.(true));
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText("Add an image")).toBeTruthy();
  });

  it("stores the newer of two files dropped on one Image, whichever answers last", async () => {
    const finishes: ((media: PickedMedia) => void)[] = [];
    const upload = vi.fn<Upload>(
      () =>
        new Promise(resolve => {
          finishes.push(resolve);
        })
    );
    const { apply, root } = mount(
      page(imageNode("img", { src: "https://cdn.example/old.png" })),
      '<img data-nx-node="img" src="https://cdn.example/old.png" alt="">',
      { upload }
    );
    const picture = root.querySelector('[data-nx-node="img"]');
    await act(async () => {
      picture?.dispatchEvent(fileDrag("drop", [PNG()]));
    });
    await act(async () => {
      picture?.dispatchEvent(fileDrag("drop", [PNG()]));
    });
    expect(upload).toHaveBeenCalledTimes(2);
    await act(async () => finishes[1]?.({ id: "newer" }));
    await act(async () => finishes[0]?.({ id: "older" }));
    expect(writtenProps(apply)).toEqual({
      src: "https://cdn.example/old.png",
      mediaId: "newer",
    });
  });

  it("draws nothing over a box the canvas lays out nowhere", () => {
    mount(
      page(imageNode("img")),
      '<div data-nx-node="img" data-nx-image-empty="empty" data-test-undrawn></div>'
    );
    expect(screen.queryByText("Add an image")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("where a plate is drawn", () => {
  it("covers only the part of the box a clipping ancestor shows", () => {
    mount(
      page(imageNode("img")),
      '<div style="overflow: hidden" data-test-rect="0,0,320,100">' +
        '<div data-nx-node="img" data-nx-image-empty="empty" data-test-rect="0,0,320,180"></div>' +
        "</div>"
    );
    const plate = screen.getByRole("group", { name: "Image" });
    expect(plate.style.height).toBe("100px");
    expect(plate.style.width).toBe("320px");
  });

  it("draws none for a box its scroller has scrolled out of sight", () => {
    mount(
      page(imageNode("img")),
      '<div style="overflow: auto" data-test-rect="0,0,320,100">' +
        '<div data-nx-node="img" data-nx-image-empty="empty" data-test-rect="0,300,320,180"></div>' +
        "</div>"
    );
    expect(screen.queryByText("Add an image")).toBeNull();
  });
});

describe("selecting an empty Image from its box", () => {
  it("keeps the canvas's modifiers: Shift extends, Ctrl or Cmd toggles", () => {
    const { select } = mount(page(imageNode("img")), EMPTY_BOX);
    const plate = screen.getByRole("group", { name: "Image" });
    fireEvent.click(plate, { shiftKey: true });
    fireEvent.click(plate, { metaKey: true });
    fireEvent.click(plate);
    expect(select.mock.calls).toEqual([
      ["img", "extend"],
      ["img", "toggle"],
      ["img", "replace"],
    ]);
  });
});

describe("an Image bound to an address field", () => {
  it("takes no dropped file, which would outrank its binding", () => {
    const upload = vi.fn<Upload>();
    const { root } = mount(
      page(
        imageNode("img", { src: "https://cdn.example/old.png" }, {
          bindings: { src: { $bind: "entry.photoUrl" } },
        } as never)
      ),
      '<img data-nx-node="img" src="https://cdn.example/old.png" alt="">',
      { upload }
    );
    const over = fileDrag("dragover", [PNG()]);
    act(() => {
      root.querySelector('[data-nx-node="img"]')?.dispatchEvent(over);
    });
    expect(over.defaultPrevented).toBe(false);
    act(() => {
      root
        .querySelector('[data-nx-node="img"]')
        ?.dispatchEvent(fileDrag("drop", [PNG()]));
    });
    expect(upload).not.toHaveBeenCalled();
  });
});
