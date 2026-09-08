/**
 * The Single editor consumes what its history panel publishes.
 *
 * The panel is mounted from the system header for collections and singles
 * alike, and it hands the chosen version to the document area through shared
 * context. The entry editor answers by swapping the document for the version;
 * these tests establish that the Single editor consumes the same publication —
 * the banner over a read-only snapshot — rather than leaving the live document
 * on screen while the panel reports a selection nothing answers.
 *
 * The arrival states share one file on purpose, mirroring the entry editor's
 * suite: the defect class is the panel and the document disagreeing about
 * whether a version is being read, so covering only the arrived state would
 * leave the other states free to drift.
 */
import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
import { useDocumentHistory } from "@admin/components/features/versions/document-history-context";
import type { ViewedVersion } from "@admin/components/features/versions/document-history-context";

const { viewed, useDocumentLock, useDocumentAutosave } = vi.hoisted(() => ({
  viewed: { current: null as ViewedVersion | null },
  useDocumentLock: vi.fn(),
  useDocumentAutosave: vi.fn(() => ({ status: "idle", lastSavedAt: null })),
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave,
}));

// The header is where the history panel normally mounts and publishes both the
// chosen version and the restore affordance. Standing in for it lets a test
// name the arrival state directly, which no fixture of the real panel can.
vi.mock(
  "@admin/components/features/entries/EntryForm/EntrySystemHeader",
  () => ({
    EntrySystemHeader: () => {
      const { setViewing, setRestore } = useDocumentHistory();
      useEffect(() => {
        setViewing(viewed.current);
        setRestore({
          canRestore: true,
          request: vi.fn(),
          returnToCurrent: vi.fn(),
        });
      }, [setViewing, setRestore]);
      return null;
    },
  })
);

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));

vi.mock("@admin/components/features/versions/VersionSnapshotForm", () => ({
  VersionSnapshotForm: () => <div data-testid="snapshot-form" />,
}));

import {
  SingleForm,
  type SingleSchema,
  type SingleDocumentData,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  fields: [
    { type: "text", name: "title", label: "Title", required: true },
    { type: "text", name: "slug", label: "Slug", required: true, unique: true },
    { type: "text", name: "heroTitle", label: "Hero Title" },
  ],
} as unknown as SingleSchema;

const document = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  slug: "homepage",
  heroTitle: "",
} as unknown as SingleDocumentData;

beforeEach(() => {
  vi.clearAllMocks();
  // The module-level holder outlives a test; a version published by the
  // previous test would leak into this one's first render.
  viewed.current = null;
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
  });
});

function renderViewing(version: ViewedVersion) {
  viewed.current = version;
  return render(
    <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
  );
}

describe("SingleForm — a published version replaces the document", () => {
  it("shows the banner and the snapshot once the read has returned", () => {
    // The positive control. Without it the assertions below are satisfied by a
    // document area that renders nothing under any circumstances.
    renderViewing({
      versionNo: 7,
      snapshot: { heroTitle: "as it was" },
      locale: null,
      isLoading: false,
      error: null,
    });

    expect(
      screen.getByText(/you are reading a past version/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("snapshot-form")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /restore this version/i })
    ).toBeEnabled();
    // The live editor's own fields are not on screen beside the version.
    expect(screen.queryByLabelText("Hero Title")).toBeNull();
  });

  it("holds the snapshot back while the read has not returned", () => {
    renderViewing({
      versionNo: 7,
      // No snapshot, and the query reports neither progress nor failure —
      // which is what a disabled or paused read looks like.
      snapshot: undefined,
      locale: null,
      isLoading: false,
      error: null,
    });

    // An absent snapshot must not render as an empty version.
    expect(screen.queryByTestId("snapshot-form")).toBeNull();
    expect(screen.getByText(/loading version 7/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /restore this version/i })
    ).toBeDisabled();
  });

  it("reports a failed read instead of rendering it as the version", () => {
    renderViewing({
      versionNo: 7,
      snapshot: undefined,
      locale: null,
      isLoading: false,
      error: new Error("boom"),
    });

    expect(
      screen.getByText(/this version could not be loaded/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("snapshot-form")).toBeNull();
  });

  it("keeps the editor's autosave off while a version is on screen", async () => {
    // Reading is not editing, and the recovery point is a write. While the
    // version stands in for the document, no recovery point may be recorded.
    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );
    await waitFor(() =>
      expect(useDocumentAutosave).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true })
      )
    );

    renderViewing({
      versionNo: 7,
      snapshot: { heroTitle: "as it was" },
      locale: null,
      isLoading: false,
      error: null,
    });

    expect(useDocumentAutosave).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });
});
