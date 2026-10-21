/**
 * The compare panel. Each state must read true: a real diff shows its fields,
 * an identical pair says so rather than looking empty, and a failed comparison
 * (a locale mismatch, say) offers a way to retry.
 */
import { describe, it, expect, vi } from "vitest";

import userEvent from "@testing-library/user-event";

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
    expect(screen.getByText(/1 of 1 fields changed/)).toBeInTheDocument();
    // Every field is read, so the count and the fold cover the whole document.
    expect(useVersionDiffMock).toHaveBeenCalledWith(
      expect.objectContaining({ modifiedOnly: false })
    );
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

  it("never calls versions identical when fields were withheld from the reader", () => {
    useVersionDiffMock.mockReturnValue({
      data: {
        from: 1,
        to: 2,
        locale: null,
        hasChanges: false,
        incomplete: true,
        fields: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(
      screen.getByText("No changes in the fields you can read.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/identical/)).not.toBeInTheDocument();
  });

  it("names a hidden field and says why, without claiming no change overall", () => {
    useVersionDiffMock.mockReturnValue({
      data: {
        from: 1,
        to: 2,
        locale: null,
        hasChanges: false,
        incomplete: true,
        fields: [
          {
            kind: "hidden",
            reason: "no-access",
            name: "notes",
            label: "Internal notes",
            declaredLabel: "Internal notes",
            type: "textarea",
            status: "unchanged",
            path: [],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(screen.getByText("Internal notes")).toBeInTheDocument();
    expect(
      screen.getByText("Hidden: you don't have access to this field.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("No changes in the fields you can read.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No changes between these versions.")
    ).not.toBeInTheDocument();
  });

  it("says how many fields changed, and folds the unchanged ones until asked", async () => {
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
          {
            kind: "value",
            name: "title",
            label: "Title",
            type: "text",
            status: "unchanged",
            before: "same",
            after: "same",
          },
          {
            kind: "value",
            name: "slug",
            label: "Slug",
            type: "text",
            status: "unchanged",
            before: "s",
            after: "s",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(screen.getByText(/1 of 3 fields changed/)).toBeInTheDocument();
    expect(screen.queryByText("Title")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Show 2 unchanged fields" })
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Slug")).toBeInTheDocument();
    // Each unfolded field shows its value, read-only, as a changed one does.
    expect(screen.getByText("same")).toBeInTheDocument();
    expect(screen.getByText("s")).toBeInTheDocument();
  });

  it("says two versions are identical, with their fields folded", async () => {
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

    expect(screen.getByText(/identical/)).toBeInTheDocument();
    expect(screen.getByText(/0 of 1 fields changed/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show 1 unchanged field" })
    ).toBeInTheDocument();
  });

  it("keeps system fields out of the count and behind Show system fields", async () => {
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
          {
            kind: "unknown",
            name: "firstPublishedAt",
            status: "changed",
            reason: "system",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(screen.getByText(/1 of 1 fields changed/)).toBeInTheDocument();
    expect(screen.queryByText("First Published At")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Show system fields" })
    );
    expect(screen.getByText("First Published At")).toBeInTheDocument();
  });

  it("offers Previous and Next change once there is more than one", () => {
    useVersionDiffMock.mockReturnValue({
      data: {
        from: 1,
        to: 2,
        locale: null,
        hasChanges: true,
        fields: ["a", "b"].map(name => ({
          kind: "value",
          name,
          label: name,
          type: "text",
          status: "changed",
          before: "x",
          after: "y",
        })),
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<VersionDiffView scope={scope} from={1} to={2} />);

    expect(
      screen.getByRole("button", { name: "Previous change" })
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next change" })).toBeEnabled();
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
