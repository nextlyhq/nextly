/**
 * What the delete dialog says of an item's uses, from the usage route's
 * answer as the library reads it: it says the item isn't used anywhere only
 * when the usage record is built and lists no use. While the record is still
 * being built, or the answer does not say whether it is, an item listing no
 * use may still be used by older content, and the dialog says that instead.
 */
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";
import type { Media } from "@admin/types/media";

const fetchJson = vi.hoisted(() => vi.fn());
vi.mock("@admin/services/mediaApi", () => ({ mediaFetchJson: fetchJson }));

import { MediaDeleteDialog } from "../MediaDeleteDialog";

const ITEM: Media = {
  id: "m1",
  filename: "photo-1.jpg",
  originalFilename: "photo-1.jpg",
  mimeType: "image/jpeg",
  size: 1000,
  width: 1600,
  height: 900,
  url: "/uploads/photo-1.jpg",
  altText: "Photo 1",
  folderId: null,
  uploadedAt: new Date(0),
  updatedAt: new Date(0),
  uploadedBy: "u1",
};

const STILL_BUILDING =
  "The usage record is still being built, so this may still be used.";

/** The dialog for one item, its uses answered with `meta`. */
async function dialogSaying(meta: Record<string, unknown>): Promise<string> {
  fetchJson.mockResolvedValue({ items: [], meta });
  renderWithProviders(
    <MediaDeleteDialog
      open
      media={ITEM}
      onOpenChange={() => undefined}
      onConfirm={() => Promise.resolve()}
    />
  );
  const description = await screen.findByText(
    (_content, element) =>
      element?.id === "delete-media-dialog-description" &&
      !(element.textContent ?? "").includes("Checking where")
  );
  return description.textContent ?? "";
}

beforeEach(() => {
  fetchJson.mockReset();
});

describe("the delete dialog's account of an item's uses", () => {
  it("says the record is still being built when the answer does not say it is built", async () => {
    const said = await dialogSaying({});

    expect(fetchJson).toHaveBeenCalledWith(
      "/admin/api/media/m1/usage",
      undefined
    );
    expect(said).toContain(STILL_BUILDING);
    expect(said).not.toContain("isn't used anywhere");
  });

  it("says the record is still being built while the answer says it is not", async () => {
    const said = await dialogSaying({ usageRecorded: false });

    expect(said).toContain(STILL_BUILDING);
    expect(said).not.toContain("isn't used anywhere");
  });

  it("says the item isn't used anywhere once the record is built and lists no use", async () => {
    // POSITIVE CONTROL for the two above: the same answer, the record built.
    const said = await dialogSaying({ usageRecorded: true });

    expect(said).toContain("It isn't used anywhere.");
    expect(said).not.toContain(STILL_BUILDING);
  });

  it("says how many places use it in all, and shows the next page with Show more", async () => {
    const use = (n: number) => ({
      kind: "collection",
      slug: "posts",
      documentId: `p${n}`,
      title: `Post ${n}`,
      owner: "Posts",
      fields: [
        {
          path: "cover",
          locales: [],
          byAddress: false,
          showsPreviousFile: false,
        },
      ],
    });
    fetchJson.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("?page=2")
          ? {
              items: [use(3)],
              meta: { total: 3, hasNext: false, usageRecorded: true },
            }
          : {
              items: [use(1), use(2)],
              meta: { total: 3, hasNext: true, usageRecorded: true },
            }
      )
    );
    renderWithProviders(
      <MediaDeleteDialog
        open
        media={ITEM}
        onOpenChange={() => undefined}
        onConfirm={() => Promise.resolve()}
      />
    );

    // Every place, the ones not read yet included.
    expect(await screen.findByText(/used in 3 places/)).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 3 places")).toBeInTheDocument();
    expect(screen.queryByText("Post 3")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByText("Post 3")).toBeInTheDocument();
    expect(fetchJson).toHaveBeenCalledWith(
      "/admin/api/media/m1/usage?page=2",
      undefined
    );
    expect(
      screen.queryByRole("button", { name: "Show more" })
    ).not.toBeInTheDocument();
  });
});
