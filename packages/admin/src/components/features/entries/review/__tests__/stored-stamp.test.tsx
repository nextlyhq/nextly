/**
 * A save records a version and moves the review, so when the document's
 * stored stamp changes the editor reads again the review state, the
 * document's version lists and its comparisons: the changes a reviewer is
 * shown stay those of the version the review state says was seen.
 */
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createTestQueryClient, render, waitFor } from "@admin/__tests__/utils";
import { versionKeys } from "@admin/hooks/queries/useVersions";

const { fetchSpy } = vi.hoisted(() => ({ fetchSpy: vi.fn() }));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: fetchSpy,
}));

import { useEditorReview } from "../useEditorReview";

const post = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};
const SCOPE = { kind: "collection", slug: "posts", entryId: "e1" } as const;

function Editor({ stamp }: { stamp: string }): ReactElement | null {
  useEditorReview({
    document: post,
    locale: undefined,
    isDirty: false,
    storedStamp: stamp,
  });
  return null;
}

/** The keys a query client was asked to read again, in order. */
function invalidated(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map(
    call => (call[0] as { queryKey?: unknown } | undefined)?.queryKey
  );
}

describe("a new stored stamp", () => {
  it("reads the document's versions and comparisons again, with its review", async () => {
    fetchSpy.mockResolvedValue({ attached: false });
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const view = render(<Editor stamp="a" />, { queryClient });
    // POPULATION CONTROL: the first render asks nothing again.
    expect(spy).not.toHaveBeenCalled();

    view.rerender(<Editor stamp="b" />);

    await waitFor(() =>
      expect(invalidated(spy)).toEqual(
        expect.arrayContaining([
          versionKeys.list(SCOPE),
          versionKeys.documentDiffs(SCOPE),
        ])
      )
    );
  });
});
