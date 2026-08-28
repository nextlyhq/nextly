// @vitest-environment jsdom
/**
 * The property under test: a column the reader's stored choice hides is gone
 * from the rendered table — header and cells both — while the columns kept
 * visible still render. The sizes load through the service, so the row is
 * awaited with a findBy before the column assertions. Header queries are
 * scoped to the table because the toolbar's column menu lists every
 * toggleable column by design.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import ImageSizesSettingsPage from "../index";

const { fetchImageSizes, fetchImageProcessingAvailability, deleteImageSize } =
  vi.hoisted(() => ({
    fetchImageSizes: vi.fn(),
    fetchImageProcessingAvailability: vi.fn(),
    deleteImageSize: vi.fn(),
  }));

vi.mock("@admin/services/imageSizesApi", () => ({
  fetchImageSizes: () => fetchImageSizes(),
  fetchImageProcessingAvailability: () => fetchImageProcessingAvailability(),
  deleteImageSize: (id: string) => deleteImageSize(id),
}));

/** The image-sizes list's toggleable columns, in declaration order. */
const TOGGLEABLE = ["width", "height", "fit", "format", "quality"];

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-image-sizes",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  fetchImageSizes.mockResolvedValue([
    {
      id: "size_1",
      name: "Thumbnail",
      width: 320,
      height: 240,
      fit: "cover",
      quality: 80,
      format: "webp",
      isDefault: false,
      sortOrder: 1,
    },
  ]);
  fetchImageProcessingAvailability.mockResolvedValue({ available: true });
});

describe("ImageSizesSettingsPage columns", () => {
  it("omits the header and cells of a column the stored choice hides", async () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "width"));
    render(<ImageSizesSettingsPage />);
    expect((await screen.findAllByText("Thumbnail")).length).toBeGreaterThan(0);
    const table = screen.getByRole("table");
    // The RESIZE header is the positive control: a header this query CAN find
    // inside the table, so the WIDTH absence below is the hidden column and
    // not a string that never renders at all.
    expect(within(table).getAllByText("RESIZE").length).toBeGreaterThan(0);
    expect(within(table).queryByText("WIDTH")).toBeNull();
  });
});
