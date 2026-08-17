/**
 * The comparison dialog exists to give a diff a surface it fits in, so what
 * matters is that it names the pair it is showing, hands that pair to the diff
 * view, and mounts a fresh view when the pair changes rather than painting one
 * comparison under another's heading.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const { diffViewMock } = vi.hoisted(() => ({ diffViewMock: vi.fn() }));

// Stubbed so this suite is about the dialog. The view's own suite covers what
// it renders; here it stands in as a recorder of what it was handed.
vi.mock("../diff/VersionDiffView", () => ({
  VersionDiffView: (props: Record<string, unknown>) => {
    diffViewMock(props);
    return <div data-testid="diff-view" />;
  },
}));

import { VersionCompareDialog } from "../VersionCompareDialog";

const scope = { kind: "collection" as const, slug: "posts", entryId: "e1" };

describe("VersionCompareDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the pair it is comparing", () => {
    render(
      <VersionCompareDialog
        open
        onOpenChange={vi.fn()}
        scope={scope}
        from={2}
        to={5}
      />
    );

    expect(
      screen.getByRole("heading", { name: /Compare version 2 with version 5/ })
    ).toBeInTheDocument();
  });

  it("hands the diff view the same pair and scope", () => {
    render(
      <VersionCompareDialog
        open
        onOpenChange={vi.fn()}
        scope={scope}
        from={2}
        to={5}
      />
    );

    expect(diffViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope, from: 2, to: 5 })
    );
  });

  it("renders nothing while closed", () => {
    render(
      <VersionCompareDialog
        open={false}
        onOpenChange={vi.fn()}
        scope={scope}
        from={2}
        to={5}
      />
    );

    // The panel that owns this keeps the pair in state, so a closed dialog must
    // not keep a diff mounted and fetching behind it.
    expect(screen.queryByTestId("diff-view")).toBeNull();
    expect(diffViewMock).not.toHaveBeenCalled();
  });

  it("mounts a fresh view when the pair changes", () => {
    const { rerender } = render(
      <VersionCompareDialog
        open
        onOpenChange={vi.fn()}
        scope={scope}
        from={2}
        to={5}
      />
    );
    const first = screen.getByTestId("diff-view");

    rerender(
      <VersionCompareDialog
        open
        onOpenChange={vi.fn()}
        scope={scope}
        from={3}
        to={5}
      />
    );

    // A reused instance would let a cached response for the old pair paint
    // under the new pair's heading while the new diff loads. A different DOM
    // node is what proves the key remounted it rather than updating props.
    expect(screen.getByTestId("diff-view")).not.toBe(first);
  });
});
