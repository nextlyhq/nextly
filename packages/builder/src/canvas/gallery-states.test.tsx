// @vitest-environment jsdom
/**
 * A Gallery on the canvas: its empty state, and pictures added to it from
 * there or dropped on it.
 *
 * - An empty gallery reads "Add images", with Upload, Media library and
 *   "or drop files here", and no "+" of an empty container;
 * - Media library picks several and adds one Image per pick, in pick
 *   order, as one step;
 * - Upload and a drop take several files, add one Image per picture in the
 *   order given whatever order the uploads finish in, as one step, after
 *   the pictures the gallery holds; a file that is not a picture is left
 *   out and said;
 * - several files held over a gallery's picture go to the gallery, one
 *   replaces that picture;
 * - a gallery a lock holds offers nothing.
 *
 * jsdom lays nothing out: where the plate is drawn is the browser test's.
 *
 * @module canvas/gallery-states.test
 */
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
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
import { BUILDER_CHROME_CLASS, CANVAS_ROOT_CLASS } from "../shell-state";

import { EmptyContainerAppenders } from "./empty-container-appender";
import { ImageStates } from "./image-states";

beforeEach(() => {
  registerBlocks(coreBlocks as never, { source: "core" });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 320, 180)
  );
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => {
    const boxes = [new DOMRect(0, 0, 320, 180)];
    return Object.assign(boxes, {
      item: (i: number) => boxes[i] ?? null,
    }) as unknown as DOMRectList;
  });
});

afterEach(() => {
  cleanup();
  clearBlocks();
  vi.restoreAllMocks();
  picker = null;
});

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const picture = (id: string): BlockNode => ({
  id,
  type: "core/image",
  version: 1,
  props: { mediaId: `media-${id}` },
});

const gallery = (children: BlockNode[] = []): BlockNode => ({
  id: "g",
  type: "core/gallery",
  version: 1,
  props: { as: "div" },
  slots: { children },
});

/** An editor over `document`, recording what it is asked to write. */
function editorOver(document: BlockDocument, held = false) {
  const apply = vi.fn<EditorState["apply"]>(() => document);
  const applyAll = vi.fn<EditorState["applyAll"]>(() => document);
  const select = vi.fn<EditorState["select"]>();
  const editor = {
    document,
    selectedId: null,
    selection: { ids: [], primary: null },
    select,
    apply,
    applyAll,
    lockRefusalFor: () => (held ? { kind: "held" } : undefined),
    composed: () => undefined,
  } as unknown as EditorState;
  return { editor, apply, applyAll, select };
}

let picker: MediaPickerProps | null = null;
function FakePicker(props: MediaPickerProps): React.JSX.Element {
  picker = props;
  return <div role="dialog" aria-label={props.title} />;
}

type Upload = (
  file: File,
  onProgress?: (percent: number) => void
) => Promise<PickedMedia>;

/** The canvas root, the gallery drawn as the renderer marks it, the overlay. */
function mount(
  document: BlockDocument,
  html: string,
  upload: Upload = vi.fn<Upload>(),
  held = false
) {
  const { editor, apply, applyAll, select } = editorOver(document, held);
  const { container } = render(
    <div className={CANVAS_ROOT_CLASS}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <ImageStates
        editor={editor}
        services={{ uploadMedia: upload, MediaPicker: FakePicker }}
      />
    </div>
  );
  const root = container.querySelector(`.${CANVAS_ROOT_CLASS}`);
  if (!(root instanceof HTMLElement)) throw new Error("no canvas root");
  return { apply, applyAll, select, root };
}

const EMPTY_GALLERY = '<div data-nx-node="g" data-nx-slots=""></div>';
const FULL_GALLERY =
  '<div data-nx-node="g" data-nx-slots=""><img data-nx-node="p1" alt=""></div>';

/** The media ids one `applyAll` adds, in order, and where. */
function added(applyAll: ReturnType<typeof editorOver>["applyAll"]) {
  expect(applyAll).toHaveBeenCalledTimes(1);
  const ops = applyAll.mock.calls[0]?.[0] ?? [];
  return ops.map(op => {
    if (op.kind !== "insert") throw new Error(`not an insert: ${op.kind}`);
    return {
      mediaId: op.node.props.mediaId,
      type: op.node.type,
      index: op.at.index,
      parent: "parentId" in op.at ? op.at.parentId : undefined,
    };
  });
}

/** A drag event carrying these files, as a browser hands one over. */
function fileDrag(type: string, files: File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: ["Files"], files, dropEffect: "none" },
  });
  return event;
}

const PNG = (name = "photo.png"): File =>
  new File(["png"], name, { type: "image/png" });
const PDF = (): File =>
  new File(["pdf"], "brief.pdf", { type: "application/pdf" });

describe("an empty Gallery on the canvas", () => {
  it("reads Add images, with Upload, Media library and the drop hint", () => {
    mount(page(gallery()), EMPTY_GALLERY);
    const plate = screen.getByRole("group", { name: "Gallery" });
    expect(plate.textContent).toContain("Add images");
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Media library" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
    expect(screen.getByText("or drop files here")).toBeTruthy();
    // Several files at once.
    const chooser = plate.querySelector('input[type="file"]');
    expect(chooser?.hasAttribute("multiple")).toBe(true);
  });

  it("draws no empty-container + for a gallery, while an empty box keeps its own", () => {
    render(
      <div className={BUILDER_CHROME_CLASS}>
        <EmptyContainerAppenders
          document={page(gallery(), {
            id: "box",
            type: "core/box",
            version: 1,
            props: {},
          })}
          slots={{
            slotsOf: type =>
              type === "core/gallery" || type === "core/box"
                ? ["children"]
                : undefined,
          }}
          blocks={{
            get: type =>
              type === "core/box"
                ? { editor: { label: "Box" } }
                : { editor: { label: "Gallery" } },
          }}
          onAppend={() => undefined}
        />
      </div>
    );
    expect(screen.getByRole("button", { name: /in Box/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /in Gallery/ })).toBeNull();
  });

  it("picks several from the library and adds one Image per pick, in pick order, as one step", () => {
    const { applyAll, select } = mount(page(gallery()), EMPTY_GALLERY);
    fireEvent.click(screen.getByRole("button", { name: "Media library" }));
    expect(select).toHaveBeenCalledWith("g");
    expect(screen.getByRole("dialog", { name: "Choose images" })).toBeTruthy();
    expect(picker?.mode).toBe("multi");
    act(() => picker?.onSelect([{ id: "m2" }, { id: "m9" }, { id: "m4" }]));
    expect(added(applyAll)).toEqual([
      { mediaId: "m2", type: "core/image", index: 0, parent: "g" },
      { mediaId: "m9", type: "core/image", index: 1, parent: "g" },
      { mediaId: "m4", type: "core/image", index: 2, parent: "g" },
    ]);
  });

  it("uploads several chosen files and adds them in the order chosen, whatever order they finish in", async () => {
    const finish = new Map<string, (media: PickedMedia) => void>();
    const upload = vi.fn<Upload>(
      file =>
        new Promise(resolve => {
          finish.set(file.name, resolve);
        })
    );
    const { applyAll, root } = mount(page(gallery()), EMPTY_GALLERY, upload);
    const chooser = root.querySelector('input[type="file"]');
    if (!(chooser instanceof HTMLInputElement)) throw new Error("no chooser");
    fireEvent.change(chooser, {
      target: { files: [PNG("a.png"), PNG("b.png"), PNG("c.png")] },
    });
    expect(upload).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Uploading 3 images")).toBeTruthy();
    await act(async () => finish.get("c.png")?.({ id: "mc" }));
    await act(async () => finish.get("a.png")?.({ id: "ma" }));
    expect(applyAll).not.toHaveBeenCalled();
    await act(async () => finish.get("b.png")?.({ id: "mb" }));
    await waitFor(() => expect(applyAll).toHaveBeenCalledTimes(1));
    expect(added(applyAll).map(each => each.mediaId)).toEqual([
      "ma",
      "mb",
      "mc",
    ]);
  });

  it("leaves a dropped file that is not a picture out, says so, and adds the pictures", async () => {
    let next = 0;
    const upload = vi.fn<Upload>(() => {
      next += 1;
      return Promise.resolve({ id: `m${String(next)}` });
    });
    const { applyAll } = mount(page(gallery()), EMPTY_GALLERY, upload);
    const plate = screen.getByRole("group", { name: "Gallery" });
    const over = fileDrag("dragover", [PNG()]);
    act(() => {
      plate.dispatchEvent(over);
    });
    expect(over.defaultPrevented).toBe(true);
    await act(async () => {
      plate.dispatchEvent(
        fileDrag("drop", [PNG("a.png"), PDF(), PNG("b.png")])
      );
    });
    expect(upload).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(applyAll).toHaveBeenCalledTimes(1));
    expect(added(applyAll).map(each => each.mediaId)).toEqual(["m1", "m2"]);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "That file isn't an image"
      )
    );
  });

  it("refuses a drop holding no picture, sending and adding nothing", () => {
    const upload = vi.fn<Upload>();
    const { applyAll } = mount(page(gallery()), EMPTY_GALLERY, upload);
    act(() => {
      screen
        .getByRole("group", { name: "Gallery" })
        .dispatchEvent(fileDrag("drop", [PDF()]));
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "That file isn't an image"
    );
    expect(upload).not.toHaveBeenCalled();
    expect(applyAll).not.toHaveBeenCalled();
  });

  it("offers nothing to choose where a lock holds the gallery's pictures", () => {
    mount(page(gallery()), EMPTY_GALLERY, vi.fn<Upload>(), true);
    expect(screen.getByRole("group", { name: "Gallery" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Media library" })).toBeNull();
  });
});

describe("files dropped on a Gallery with pictures", () => {
  it("adds several after the pictures it holds, when dropped on one of them", async () => {
    let next = 0;
    const upload = vi.fn<Upload>(() => {
      next += 1;
      return Promise.resolve({ id: `m${String(next)}` });
    });
    const { applyAll, apply, root } = mount(
      page(gallery([picture("p1")])),
      FULL_GALLERY,
      upload
    );
    const onPicture = root.querySelector('[data-nx-node="p1"]');
    if (onPicture === null) throw new Error("no picture");
    const over = fileDrag("dragover", [PNG(), PNG()]);
    act(() => {
      onPicture.dispatchEvent(over);
    });
    expect(over.defaultPrevented).toBe(true);
    expect(screen.getByText("Drop to add the images")).toBeTruthy();
    await act(async () => {
      onPicture.dispatchEvent(fileDrag("drop", [PNG("a.png"), PNG("b.png")]));
    });
    await waitFor(() => expect(applyAll).toHaveBeenCalledTimes(1));
    expect(added(applyAll)).toEqual([
      { mediaId: "m1", type: "core/image", index: 1, parent: "g" },
      { mediaId: "m2", type: "core/image", index: 2, parent: "g" },
    ]);
    expect(apply).not.toHaveBeenCalled();
  });

  it("replaces the picture one file is dropped on, as an Image takes a file", async () => {
    const upload = vi.fn<Upload>(() => Promise.resolve({ id: "m5" }));
    const { applyAll, apply, root } = mount(
      page(gallery([picture("p1")])),
      FULL_GALLERY,
      upload
    );
    const onPicture = root.querySelector('[data-nx-node="p1"]');
    await act(async () => {
      onPicture?.dispatchEvent(fileDrag("drop", [PNG()]));
    });
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(applyAll).not.toHaveBeenCalled();
  });
});
