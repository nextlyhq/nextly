// @vitest-environment jsdom

/**
 * The canvas's Image empty states, given the admin's media library: a file
 * goes through the library's own upload with its progress, and the canvas is
 * handed the stored item's id, address and name; the picker is the library's
 * own dialog.
 *
 * @module canvas-image-states.test
 */
import { render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mutateAsync =
  vi.fn<
    (input: {
      file: File;
      onProgress?: (percent: number) => void;
    }) => Promise<unknown>
  >();
function MediaPickerDialog(): null {
  return null;
}

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  MediaPickerDialog,
  useUploadMedia: () => ({ mutateAsync }),
}));

const drawn = vi.fn<(props: Record<string, unknown>) => void>();
vi.mock("@nextlyhq/builder/shell", () => ({
  ImageStates: (props: Record<string, unknown>) => {
    drawn(props);
    return null;
  },
}));

const { CanvasImageStates, useMediaUpload } = await import(
  "./canvas-image-states"
);

describe("the canvas's media library upload", () => {
  it("uploads through the library with its progress, naming the file as uploaded", async () => {
    mutateAsync.mockResolvedValue({
      id: "m1",
      url: "/uploads/photo-1.png",
      filename: "photo-1.png",
      originalFilename: "Photo.png",
    });
    const { result } = renderHook(() => useMediaUpload());
    const file = new File(["png"], "Photo.png", { type: "image/png" });
    const progress = vi.fn();
    await expect(result.current(file, progress)).resolves.toEqual({
      id: "m1",
      url: "/uploads/photo-1.png",
      filename: "Photo.png",
    });
    expect(mutateAsync).toHaveBeenCalledWith({ file, onProgress: progress });
  });

  it("passes on the library's refusal, as its own words", async () => {
    mutateAsync.mockRejectedValue(new Error("This file type is not allowed"));
    const { result } = renderHook(() => useMediaUpload());
    await expect(
      result.current(new File(["x"], "a.png", { type: "image/png" }))
    ).rejects.toThrow("This file type is not allowed");
  });

  it("hands the canvas the upload and the library's own picker", () => {
    const editor = {} as never;
    render(<CanvasImageStates editor={editor} dragging={false} />);
    const props = drawn.mock.calls.at(-1)?.[0];
    expect(props?.editor).toBe(editor);
    const services = props?.services as Record<string, unknown> | undefined;
    expect(services?.MediaPicker).toBe(MediaPickerDialog);
    expect(typeof services?.uploadMedia).toBe("function");
  });
});
