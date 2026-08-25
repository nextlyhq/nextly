/**
 * When a refresh RELOADS and when it mints a new credential.
 *
 * The distinction is the whole of this hook's reason to exist: reloading is
 * free and re-minting issues a bearer credential and an audit row, so doing
 * the second every time would be wasteful, and doing the first when the token
 * has lapsed shows the PUBLISHED page while looking like a working preview.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mint = vi.hoisted(() => vi.fn());
vi.mock("@admin/hooks/useEntryPreview", () => ({
  mintSelfPreview: mint,
  PREVIEW_MESSAGES: {},
}));

import { usePreviewFrame } from "../usePreviewFrame";

/** A mint that expires the given number of milliseconds from now. */
function expiringIn(ms: number) {
  return {
    kind: "open" as const,
    url: "https://site.example/api/preview?token=t",
    expiresAt: new Date(Date.now() + ms).toISOString(),
  };
}

const args = { collection: "pages", entryId: "7", active: true };

/*
 * REAL timers, deliberately. `waitFor` polls on real ones, so faking them
 * starves every assertion here into its timeout — and nothing in this hook
 * needs the clock moved: each fixture states its expiry RELATIVE to now, which
 * is what the margin comparison reads.
 */
beforeEach(() => {
  mint.mockReset();
});

describe("usePreviewFrame", () => {
  it("mints once when the pane opens", async () => {
    mint.mockResolvedValue(expiringIn(15 * 60_000));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.url).not.toBeNull());

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("mints NOTHING while the pane is closed", async () => {
    renderHook(() => usePreviewFrame({ ...args, active: false }));
    await act(async () => {});

    expect(mint).not.toHaveBeenCalled();
  });

  it("reloads without re-minting while the token is comfortably valid", async () => {
    mint.mockResolvedValue(expiringIn(15 * 60_000));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.url).not.toBeNull());
    const before = result.current.reloadKey;

    act(() => result.current.refresh());

    // The key moved, so the frame remounts — and no second credential exists.
    expect(result.current.reloadKey).toBe(before + 1);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("re-mints when the token is close enough to expiry to lapse mid-load", async () => {
    // Inside the margin: a reload that begins now can arrive after the token
    // dies, and the site answers that with the published page rather than an
    // error — a preview that silently stops being one.
    mint.mockResolvedValue(expiringIn(30_000));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.url).not.toBeNull());

    act(() => result.current.refresh());
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(2));
  });

  it("reports the reason a mint refused, and shows no frame", async () => {
    mint.mockResolvedValue({ kind: "report", reason: "noSiteUrl" });

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.reason).toBe("noSiteUrl"));

    expect(result.current.url).toBeNull();
  });
});
