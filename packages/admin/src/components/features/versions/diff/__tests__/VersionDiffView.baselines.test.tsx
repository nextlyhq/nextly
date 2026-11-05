/**
 * A comparison the server resolved from a named baseline says which one, in words read from the
 * baseline's name, so a baseline another feature registers ("since submitted", "since approved")
 * reads here with no change to the comparison's code. A comparison of an explicit pair names none.
 */
import { describe, expect, it, vi } from "vitest";

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

/** The diff the server answers for 4 → 7, resolved from `baseline` when one is given. */
function answer(baseline?: {
  name: string;
  versionNo: number;
  replaces?: number;
}) {
  useVersionDiffMock.mockReturnValue({
    data: {
      from: 4,
      to: 7,
      locale: null,
      hasChanges: true,
      fields: [
        {
          kind: "value",
          name: "title",
          label: "Title",
          type: "text",
          status: "changed",
          before: "Submitted",
          after: "Edited",
        },
      ],
      ...(baseline ? { baseline } : {}),
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe("VersionDiffView, from a named baseline", () => {
  it.each([
    ["since-submitted", "Since submitted"],
    ["since-approved", "Since approved"],
  ])("says the comparison is %s", (name, words) => {
    answer({ name, versionNo: 4 });

    render(<VersionDiffView scope={scope} from={4} to={7} />);

    expect(
      screen.getByText(`Compared from: ${words} (version 4).`)
    ).toBeInTheDocument();
  });

  it("says which version stood in for one retention removed", () => {
    answer({ name: "since-approved", versionNo: 4, replaces: 5 });

    render(<VersionDiffView scope={scope} from={4} to={7} />);

    expect(
      screen.getByText(
        "Compared from: Since approved (version 4, as version 5 was removed)."
      )
    ).toBeInTheDocument();
  });

  it("names no baseline for a pair chosen by number", () => {
    answer();

    render(<VersionDiffView scope={scope} from={4} to={7} />);

    expect(screen.queryByText(/Compared from:/)).not.toBeInTheDocument();
  });
});
