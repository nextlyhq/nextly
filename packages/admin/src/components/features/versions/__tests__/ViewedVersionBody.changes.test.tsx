/**
 * A past version in the editor's own layout, each changed field marked.
 *
 * Driven through the body the editors mount, with the comparison read stubbed
 * at the API: the pairing (which version it is compared with), the marks, the
 * fold and the moves between changes are all observed as a reader meets them.
 */
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
import type { FieldDiff, VersionDiff } from "@admin/services/versionApi";

import {
  DocumentHistoryContext,
  type ViewedVersion,
} from "../document-history-context";

const { diffMock, unchangedShown } = vi.hoisted(() => ({
  diffMock: vi.fn(),
  unchangedShown: { current: [] as string[][] },
}));

vi.mock("@admin/services/versionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/versionApi")>();
  return { ...actual, versionApi: { ...actual.versionApi, diff: diffMock } };
});

// Stands in for the editor's read-only renderer, recording which fields it
// was handed: the unchanged ones, once the reader asks for them.
vi.mock(
  "@admin/components/features/entries/EntryForm/ReadOnlyDocumentForm",
  () => ({
    ReadOnlyDocumentForm: ({ fields }: { fields: FieldConfig[] }) => {
      unchangedShown.current.push(
        fields.map(field => ("name" in field ? String(field.name) : ""))
      );
      return <div data-testid="read-only-fields" />;
    },
  })
);

import { ViewedVersionBody } from "../viewed-version-host";

const scope = { kind: "collection" as const, slug: "posts", entryId: "e1" };

const node = (name: string, status: FieldDiff["status"]): FieldDiff => ({
  kind: "text",
  name,
  label: name[0]!.toUpperCase() + name.slice(1),
  type: "text",
  status,
  segments:
    status === "unchanged"
      ? [{ op: 0, text: "same" }]
      : [
          { op: -1, text: "before" },
          { op: 1, text: "after" },
        ],
});

// The title changed but is drawn in the header, not the form; the form lays
// out excerpt, body and slug, in that order.
const diff: VersionDiff = {
  from: 2,
  to: 4,
  locale: null,
  hasChanges: true,
  fields: [
    node("title", "changed"),
    node("excerpt", "unchanged"),
    node("body", "changed"),
    node("slug", "unchanged"),
  ],
};

const fields: FieldConfig[] = [
  { name: "excerpt", type: "text" },
  { name: "body", type: "text" },
  { name: "slug", type: "text" },
];

const viewing: ViewedVersion = {
  versionNo: 4,
  snapshot: { title: "after", excerpt: "same", body: "after", slug: "same" },
  locale: null,
  withheld: [],
  isLoading: false,
  error: null,
  scope,
  // Version 3 was pruned: the version before it in its language is 2, which
  // arithmetic on the number would not find.
  comparedWith: { kind: "version", versionNo: 2 },
  about: null,
};

function renderVersion() {
  return render(
    <DocumentHistoryContext.Provider
      value={{
        viewing,
        setViewing: () => {},
        restore: null,
        setRestore: () => {},
      }}
    >
      <ViewedVersionBody
        fields={fields}
        values={viewing.snapshot as Record<string, unknown>}
        actionsDisabled={false}
      >
        <input aria-label="Live field" />
      </ViewedVersionBody>
    </DocumentHistoryContext.Provider>
  );
}

const changedCards = () =>
  screen
    .getAllByRole("region")
    .map(region => region.getAttribute("aria-label"))
    .filter(label => label?.endsWith(", changed"));

beforeEach(() => {
  diffMock.mockReset();
  diffMock.mockResolvedValue(diff);
  unchangedShown.current = [];
});

describe("ViewedVersionBody — a past version with its changes marked", () => {
  it("compares the version with the one before it, and says how much changed", async () => {
    renderVersion();

    expect(
      await screen.findByText("2 of 4 fields changed")
    ).toBeInTheDocument();
    expect(diffMock).toHaveBeenCalledWith(scope, 2, 4, {
      modifiedOnly: false,
    });
  });

  it("marks each changed field, leading with the one the form does not lay out", async () => {
    renderVersion();

    await waitFor(() =>
      expect(changedCards()).toEqual(["Title, changed", "Body, changed"])
    );
    // Unchanged fields are folded, not drawn.
    expect(screen.queryByTestId("read-only-fields")).toBeNull();
  });

  it("shows the unchanged fields on request, through the editor's own renderer", async () => {
    renderVersion();

    await userEvent.click(
      await screen.findByRole("button", { name: "Show 2 unchanged fields" })
    );

    // Each run of unchanged fields between changes, in the form's order.
    expect(unchangedShown.current.at(-2)).toEqual(["excerpt"]);
    expect(unchangedShown.current.at(-1)).toEqual(["slug"]);
    expect(
      screen.getByRole("button", { name: "Hide 2 unchanged fields" })
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("moves to the next change in reading order, and puts focus there", async () => {
    renderVersion();
    await screen.findByText("2 of 4 fields changed");

    // The phone's bar and the comparison bar both offer the move; either
    // moves the one position.
    await userEvent.click(
      screen.getAllByRole("button", { name: "Next change" })[0]!
    );

    expect(document.activeElement).toHaveAttribute(
      "aria-label",
      "Body, changed"
    );
    expect(screen.getByText("Change 2 of 2")).toBeInTheDocument();
  });

  it("says only system fields changed, never no changes, when that is all the server found", async () => {
    diffMock.mockResolvedValue({
      ...diff,
      fields: [
        node("excerpt", "unchanged"),
        {
          kind: "unknown",
          name: "firstPublishedAt",
          status: "changed",
          reason: "system",
        },
      ],
    });
    renderVersion();

    expect(
      await screen.findByText("Only system fields changed.")
    ).toBeInTheDocument();
    const bar = screen.getByRole("toolbar", { name: "Version actions" });
    expect(bar).toHaveTextContent("System fields only");
    expect(screen.queryByText(/No changes/)).toBeNull();
  });

  it("says it is still reading, never that nothing changed, until the comparison answers", async () => {
    // A comparison that has not answered yet.
    diffMock.mockReturnValue(new Promise(() => {}));
    renderVersion();

    const bar = screen.getByRole("toolbar", { name: "Version actions" });
    expect(bar).toHaveTextContent("Reading…");
    expect(bar).not.toHaveTextContent("No changes");
  });

  it("names the language a version of a localized document reads in", () => {
    render(
      <DocumentHistoryContext.Provider
        value={{
          viewing: {
            ...viewing,
            comparedWith: { kind: "first" },
            about: {
              id: "v4",
              versionNo: 4,
              status: "draft",
              isAutosave: false,
              label: null,
              locale: "es",
              sourceVersionNo: null,
              createdBy: "u1",
              author: { id: "u1", name: "Ana" },
              createdAt: "2026-10-14T16:40:00.000Z",
              updatedAt: "2026-10-14T16:40:00.000Z",
            },
          },
          setViewing: () => {},
          restore: null,
          setRestore: () => {},
        }}
      >
        <ViewedVersionBody
          fields={fields}
          values={viewing.snapshot as Record<string, unknown>}
          actionsDisabled={false}
        />
      </DocumentHistoryContext.Provider>
    );

    expect(
      screen.getByRole("region", { name: "Comparison" })
    ).toHaveTextContent(/ES · .*Ana/);
  });

  it("reads the first version whole, with nothing to mark", () => {
    render(
      <DocumentHistoryContext.Provider
        value={{
          viewing: { ...viewing, comparedWith: { kind: "first" } },
          setViewing: () => {},
          restore: null,
          setRestore: () => {},
        }}
      >
        <ViewedVersionBody
          fields={fields}
          values={viewing.snapshot as Record<string, unknown>}
          actionsDisabled={false}
        />
      </DocumentHistoryContext.Provider>
    );

    expect(
      screen.getByText("The first version, shown on its own.")
    ).toBeInTheDocument();
    expect(unchangedShown.current.at(-1)).toEqual(["excerpt", "body", "slug"]);
    expect(diffMock).not.toHaveBeenCalled();
  });
});
