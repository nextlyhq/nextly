/**
 * What the document area and the banner do while a chosen version has not
 * arrived.
 *
 * `isLoading` is false for a query that was never started as well as for one
 * that has finished, so it cannot stand for "the snapshot is here": the version
 * read is disabled until the scope is addressable, and a paused one reports the
 * same. Both consumers are asserted in one test on purpose — the defect was
 * that they disagreed, rendering an empty document as the version while
 * offering to restore it, so covering either alone would leave the other free
 * to drift.
 */
import { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { useDocumentHistory } from "@admin/components/features/versions/document-history-context";
import type { ViewedVersion } from "@admin/components/features/versions/document-history-context";

const { viewed } = vi.hoisted(() => ({
  viewed: { current: null as ViewedVersion | null },
}));

// The header is where the history panel normally mounts and publishes both the
// chosen version and the restore affordance. Standing in for it lets a test
// name the arrival state directly, which no fixture of the real panel can.
vi.mock("../EntrySystemHeader", () => ({
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
}));

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));

vi.mock("../../../versions/VersionSnapshotForm", () => ({
  VersionSnapshotForm: () => <div data-testid="snapshot-form" />,
}));

import { EntryForm } from "../EntryForm";

const collection = {
  name: "posts",
  label: "Posts",
  fields: [{ name: "title", type: "text", label: "Title" }],
} as never;

const entry = { id: "e1", title: "Hello" } as never;

function renderViewing(version: ViewedVersion) {
  viewed.current = version;
  return render(
    <EntryForm collection={collection} entry={entry} mode="edit" />
  );
}

describe("EntryForm — a version has to be on screen before it can be acted on", () => {
  it("shows the snapshot and offers restore once the read has returned", () => {
    // The positive control. Without it the assertions below are satisfied by a
    // document area that renders nothing under any circumstances.
    renderViewing({
      versionNo: 7,
      snapshot: { title: "as it was" },
      locale: null,
      isLoading: false,
      error: null,
    });

    expect(screen.getByTestId("snapshot-form")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /restore this version/i })
    ).toBeEnabled();
  });

  it("holds both back when the read has not returned, though nothing is loading or failed", () => {
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
});
