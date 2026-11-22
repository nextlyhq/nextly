/**
 * The diff view reports a comparison as shown only once it has drawn that
 * comparison's fields: not while it loads, not when it failed, and not while
 * another pair's answer stands in for it. Its host marks what the reader has
 * seen from this report alone, so each of these must hold against the real
 * query, with only the API beneath it replaced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act, render, screen, waitFor } from "@admin/__tests__/utils";
import type { VersionScope } from "@admin/services/versionApi";

const { diffSpy } = vi.hoisted(() => ({ diffSpy: vi.fn() }));

vi.mock("@admin/services/versionApi", () => ({
  versionApi: { diff: diffSpy },
}));

import { VersionDiffView } from "../VersionDiffView";

const scope: VersionScope = {
  kind: "collection",
  slug: "posts",
  entryId: "e1",
};

function answer(from: number, to: number) {
  return {
    from,
    to,
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
  };
}

describe("VersionDiffView, reporting what it has shown", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports nothing while the comparison loads, then the pair once its fields are drawn", async () => {
    let arrive: (value: unknown) => void = () => {};
    diffSpy.mockReturnValue(
      new Promise(resolve => {
        arrive = resolve;
      })
    );
    const onShown = vi.fn();

    render(<VersionDiffView scope={scope} from={1} to={2} onShown={onShown} />);
    expect(screen.getByText("Loading comparison")).toBeInTheDocument();
    expect(onShown).not.toHaveBeenCalled();

    await act(async () => {
      arrive(answer(1, 2));
    });

    expect(await screen.findByText("Views")).toBeInTheDocument();
    expect(onShown).toHaveBeenCalledTimes(1);
    expect(onShown).toHaveBeenCalledWith({ from: 1, to: 2, locale: null });
  });

  it("reports nothing when the comparison fails", async () => {
    diffSpy.mockRejectedValue(new Error("refused"));
    const onShown = vi.fn();

    render(<VersionDiffView scope={scope} from={1} to={2} onShown={onShown} />);

    expect(
      await screen.findByRole("button", { name: "Try again" })
    ).toBeInTheDocument();
    expect(onShown).not.toHaveBeenCalled();
  });

  it("reports nothing for the previous pair's answer standing in, and withdraws that pair", async () => {
    // The second pair never answers, so the fields on screen after the move
    // are the first pair's, kept while the second loads.
    diffSpy
      .mockResolvedValueOnce(answer(1, 2))
      .mockReturnValue(new Promise(() => {}));
    const onShown = vi.fn();

    const { rerender } = render(
      <VersionDiffView scope={scope} from={1} to={2} onShown={onShown} />
    );
    await waitFor(() =>
      expect(onShown).toHaveBeenCalledWith({ from: 1, to: 2, locale: null })
    );

    rerender(
      <VersionDiffView scope={scope} from={2} to={3} onShown={onShown} />
    );
    await waitFor(() =>
      expect(diffSpy).toHaveBeenCalledWith(scope, 2, 3, { modifiedOnly: false })
    );

    expect(screen.getByText("Views")).toBeInTheDocument();
    expect(onShown).not.toHaveBeenCalledWith({ from: 2, to: 3, locale: null });
    expect(onShown).toHaveBeenLastCalledWith(null);
  });

  it("reports the language the comparison's answer names", async () => {
    // The host's address may name no language; the answer always does.
    diffSpy.mockResolvedValue({ ...answer(1, 2), locale: "fr" });
    const onShown = vi.fn();

    render(<VersionDiffView scope={scope} from={1} to={2} onShown={onShown} />);

    await waitFor(() =>
      expect(onShown).toHaveBeenCalledWith({ from: 1, to: 2, locale: "fr" })
    );
  });
});
