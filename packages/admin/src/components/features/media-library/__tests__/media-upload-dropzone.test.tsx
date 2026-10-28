/**
 * The media picker's drop area: files dropped on it go through the same
 * upload queue as the library's, are listed in the same tray under it, and
 * the picker hears about them once, when the whole batch has finished, so it
 * selects them together rather than one by one.
 */
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";

const api = vi.hoisted(() => ({ uploadMedia: vi.fn() }));
vi.mock("@admin/services/mediaApi", () => ({
  uploadMedia: (...a: unknown[]) => api.uploadMedia(...a),
}));

import { MediaUploadDropzone } from "../MediaUploadDropzone";

let answers: Array<{ file: File; resolve: (media: unknown) => void }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  answers = [];
  api.uploadMedia.mockImplementation(
    (file: File) =>
      new Promise(resolve => {
        answers.push({ file, resolve });
      })
  );
});

function png(name: string): File {
  return new File(["x"], name, { type: "image/png" });
}

describe("the media picker's drop area", () => {
  it("lists the drop in the tray and reports the batch once, when it has all finished", async () => {
    const onUploadComplete = vi.fn();
    renderWithProviders(
      <MediaUploadDropzone
        onUploadComplete={onUploadComplete}
        activeFolderId="f1"
      />
    );
    const target = screen.getByRole("button", { name: /^Upload files\./ });
    const files = [png("a.png"), png("b.png"), png("c.png"), png("d.png")];
    const drag = { dataTransfer: { files, types: ["Files"] } };

    fireEvent.dragEnter(target, drag);
    await screen.findByText("Drop files here...");
    fireEvent.drop(target, drag);

    const tray = await screen.findByRole("region", { name: "Uploads" });
    expect(within(tray).getAllByRole("listitem")).toHaveLength(4);
    await waitFor(() => expect(answers).toHaveLength(3));
    expect(api.uploadMedia).toHaveBeenCalledWith(
      files[0],
      expect.any(Function),
      "f1"
    );

    for (let answered = 0; answered < 4; answered += 1) {
      await waitFor(() => expect(answers.length).toBeGreaterThan(answered));
      const { file, resolve } = answers[answered];
      act(() => resolve({ id: `id-${file.name}`, filename: file.name }));
      await waitFor(() =>
        expect(within(tray).getAllByText("Done")).toHaveLength(answered + 1)
      );
      // Nothing is reported while files are still moving.
      if (answered < 3) expect(onUploadComplete).not.toHaveBeenCalled();
    }

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledTimes(1));
    expect(
      onUploadComplete.mock.calls[0][0].map((m: { id: string }) => m.id)
    ).toEqual(["id-a.png", "id-b.png", "id-c.png", "id-d.png"]);
  });
});
