/**
 * The sidebar beside the library: All media, then the views (Missing alt
 * text, Unused), each with its count, then the folders with theirs. A view
 * is picked across every folder, a folder clears the view, and every row is
 * reached and picked by keyboard.
 */
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";

vi.mock("@admin/services/mediaApi", () => ({
  listRootFolders: vi.fn(() =>
    Promise.resolve([
      { id: "f1", name: "Brand", parentId: null },
      { id: "f2", name: "Blog", parentId: null },
    ])
  ),
  listSubfolders: vi.fn(() => Promise.resolve([])),
}));

const library = vi.hoisted(() => ({
  fetchMediaLibraryCounts: vi.fn(),
}));
vi.mock("../media-library-api", () => library);

import { FolderTreeView } from "../FolderTreeView";
import {
  setMediaLibraryView,
  useMediaLibraryView,
} from "../media-library-view";

/** The view the store holds, rendered so a test can read it. */
function ViewProbe() {
  return <output data-testid="view">{useMediaLibraryView() ?? "all"}</output>;
}

function renderSidebar(activeFolderId: string | null = null) {
  const onFolderSelect = vi.fn();
  renderWithProviders(
    <>
      <FolderTreeView
        activeFolderId={activeFolderId}
        onFolderSelect={onFolderSelect}
        onCreateFolder={vi.fn()}
        onEditFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
      />
      <ViewProbe />
    </>
  );
  return { onFolderSelect };
}

const nav = () => screen.getByRole("navigation", { name: "Media library" });
const row = (name: RegExp) => within(nav()).getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  library.fetchMediaLibraryCounts.mockResolvedValue({
    all: 12,
    missingAltText: 3,
    unused: 2,
    usageRecorded: true,
    root: 5,
    folders: { f1: 4 },
  });
});

afterEach(() => {
  act(() => setMediaLibraryView(null));
});

describe("the media library sidebar", () => {
  it("shows All media, the views and the folders, each with its count, in that order", async () => {
    renderSidebar();
    await waitFor(() => expect(row(/^All media, 12$/)).toBeInTheDocument());

    const names = within(nav())
      .getAllByRole("button")
      .map(button => button.getAttribute("aria-label"));
    expect(names.slice(0, 3)).toEqual([
      "All media, 12",
      "Missing alt text, 3",
      "Unused, 2",
    ]);
    expect(row(/^Brand, 4$/)).toBeInTheDocument();
    // A folder with nothing in it has no count, and shows none as 0.
    expect(row(/^Blog, 0$/)).toBeInTheDocument();
    // The views are headed apart from the folders.
    const headings = within(nav())
      .getAllByRole("heading")
      .map(heading => heading.textContent);
    expect(headings).toEqual(["Views", "Folders"]);
    expect(row(/^All media/)).toHaveAttribute("aria-current", "page");
  });

  it("picks a view across every folder, and a folder clears it", async () => {
    const { onFolderSelect } = renderSidebar();
    await waitFor(() => row(/^Missing alt text/));

    fireEvent.click(row(/^Missing alt text/));
    expect(onFolderSelect).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId("view")).toHaveTextContent("missing-alt");
    expect(row(/^Missing alt text/)).toHaveAttribute("aria-current", "page");
    expect(row(/^All media/)).not.toHaveAttribute("aria-current");

    fireEvent.click(row(/^Brand/));
    expect(onFolderSelect).toHaveBeenLastCalledWith("f1");
    expect(screen.getByTestId("view")).toHaveTextContent("all");
  });

  it("reaches and picks every row by keyboard", async () => {
    const { onFolderSelect } = renderSidebar();
    await waitFor(() => row(/^Brand/));

    const user = userEvent.setup();
    row(/^All media/).focus();
    await user.tab();
    expect(row(/^Missing alt text/)).toHaveFocus();
    await user.tab();
    expect(row(/^Unused/)).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("view")).toHaveTextContent("unused");

    await user.tab();
    expect(
      within(nav()).getByRole("button", { name: "New folder" })
    ).toHaveFocus();
    // The folder's expander, then the folder itself, then its actions.
    await user.tab();
    await user.tab();
    expect(row(/^Brand/)).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onFolderSelect).toHaveBeenLastCalledWith("f1");
    await user.tab();
    expect(
      within(nav()).getByRole("button", { name: "Actions for Brand" })
    ).toHaveFocus();
  });

  it("says Unused is still being counted until the usage record covers older content", async () => {
    library.fetchMediaLibraryCounts.mockResolvedValue({
      all: 12,
      missingAltText: 0,
      unused: 12,
      usageRecorded: false,
      root: 12,
      folders: {},
    });
    renderSidebar();

    await waitFor(() =>
      expect(row(/^Unused/)).toHaveAccessibleName("Unused, Still being counted")
    );
    expect(row(/^Unused/)).not.toHaveTextContent("12");
  });
});
