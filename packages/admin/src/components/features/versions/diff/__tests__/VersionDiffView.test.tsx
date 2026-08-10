/**
 * The compare panel. Each state must read true: a real diff shows its fields,
 * an identical pair says so rather than looking empty, and a failed comparison
 * (a locale mismatch, say) offers a way to retry.
 */
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { VersionScope } from "@admin/services/versionApi";

const { useVersionDiffMock } = vi.hoisted(() => ({
  useVersionDiffMock: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useVersions", () => ({
  useVersionDiff: (...a: unknown[]) => useVersionDiffMock(...a),
}));

import { VersionDiffView } from "../VersionDiffView";

const scope: VersionScope = {
  kind: "collection",
  slug: "posts",
  entryId: "e1",
};

describe("VersionDiffView", () => {
  it("renders the diff nodes and names the pair", () => {
    useVersionDiffMock.mockReturnValue({
      data: {
        from: 1,
        to: 2,
        locale: null,
        hasChanges: true,
        fields: [
          {
            kind: "value",
            name: "views",
            label: "Views",
            type: "number",
            status: "changed",
            before: 1,
            after: 2,
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(screen.getByText("Views")).toBeInTheDocument();
    expect(screen.getByText(/Comparing version/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Changed only/ })
    ).toBeInTheDocument();
  });

  it("says the versions are identical when nothing changed", () => {
    useVersionDiffMock.mockReturnValue({
      data: { from: 1, to: 2, locale: null, hasChanges: false, fields: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(screen.getByText(/identical/)).toBeInTheDocument();
  });

  it("renders the unchanged fields with a no-change note when filter is off", () => {
    // "Changed only" off returns the unchanged fields even though hasChanges is
    // false; they must render (with a note) rather than showing "identical".
    useVersionDiffMock.mockReturnValue({
      data: {
        from: 1,
        to: 2,
        locale: null,
        hasChanges: false,
        fields: [
          {
            kind: "value",
            name: "title",
            label: "Title",
            type: "text",
            status: "unchanged",
            before: "same",
            after: "same",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText(/No changes between/)).toBeInTheDocument();
    expect(screen.queryByText(/identical/)).not.toBeInTheDocument();
  });

  it("offers a retry when the comparison fails", () => {
    useVersionDiffMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(
      screen.getByRole("button", { name: /Try again/ })
    ).toBeInTheDocument();
  });

  it("renders a relationship by its resolved label, not its id", () => {
    // The server resolves the id to the value kit's { id, label } shape, so the
    // one kit shows the title rather than the bare id it used to leak.
    useVersionDiffMock.mockReturnValue({
      data: {
        from: 1,
        to: 2,
        locale: null,
        hasChanges: true,
        fields: [
          {
            kind: "value",
            name: "author",
            label: "Author",
            type: "relationship",
            status: "changed",
            before: { id: "a1", label: "Ada" },
            after: { id: "a2", label: "Grace" },
            display: { relationTo: "authors" },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.queryByText("a1")).not.toBeInTheDocument();
  });

  it("renders many-relationship targets by their resolved labels", () => {
    useVersionDiffMock.mockReturnValue({
      data: {
        from: 1,
        to: 2,
        locale: null,
        hasChanges: true,
        fields: [
          {
            kind: "set",
            name: "tags",
            label: "Tags",
            type: "relationship",
            status: "changed",
            added: [{ id: "t2", label: "Engineering" }],
            removed: [{ id: "t1", label: "Design" }],
            display: { relationTo: "tags", hasMany: true },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Design")).toBeInTheDocument();
  });

  it("renders an upload by its filename", () => {
    useVersionDiffMock.mockReturnValue({
      data: {
        from: 1,
        to: 2,
        locale: null,
        hasChanges: true,
        fields: [
          {
            kind: "value",
            name: "cover",
            label: "Cover",
            type: "upload",
            status: "added",
            before: null,
            after: {
              id: "m1",
              originalFilename: "hero.png",
              filename: "abc.png",
              url: "/u",
              thumbnailUrl: "/t",
              mimeType: "image/png",
            },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(screen.getByText("hero.png")).toBeInTheDocument();
  });
});
