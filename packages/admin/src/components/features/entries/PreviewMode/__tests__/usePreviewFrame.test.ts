/**
 * When a refresh RELOADS and when it mints a new credential, and when the pane
 * refuses to frame a URL it nonetheless holds.
 *
 * The reload/re-mint distinction is the hook's original reason to exist:
 * reloading is free and re-minting issues a bearer credential and an audit row,
 * so doing the second every time would be wasteful, and doing the first when the
 * token has lapsed shows the PUBLISHED page while looking like a working
 * preview.
 *
 * The refusals are the same failure by two other routes. A cross-origin frame
 * never receives the preview cookie, and a second pane overwrites the one cookie
 * the site keeps — both end in the published page rendering inside something
 * captioned as a draft. None of the three is visible from inside the frame, so
 * each is asserted here on the state the pane renders from.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

import type { SelfPreviewScope } from "@admin/hooks/useEntryPreview";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mint = vi.hoisted(() => vi.fn());
vi.mock("@admin/hooks/useEntryPreview", () => ({
  mintSelfPreview: mint,
  previewMessage: (r: string) => r,
}));

import { previewScopeKey } from "../previewSessionLock";
import { usePreviewFrame } from "../usePreviewFrame";

/*
 * Same-origin by construction. jsdom serves the test document from some origin
 * and the pane only frames a URL matching it, so hardcoding a host here would
 * make every case below exercise the cross-origin refusal instead of the
 * behaviour it names.
 */
const ORIGIN = window.location.origin;

/** A mint that expires the given number of milliseconds from now. */
function expiringIn(ms: number, url = `${ORIGIN}/blog/post?preview=1`) {
  return {
    kind: "open" as const,
    url,
    expiresAt: new Date(Date.now() + ms).toISOString(),
  };
}

const args = { scope: { collection: "pages", entryId: "7" }, active: true };

/** The channel the panes announce on. Must match `previewSessionLock`. */
const CHANNEL = "nextly.preview.session";

/**
 * Another pane taking the browser's one preview session.
 *
 * The key is DERIVED rather than spelled out, because a hand-written one pins
 * the format: when the key gained a kind prefix, a literal `"pages 7 "` stopped
 * meaning "the same scope" and silently started meaning "a different one" —
 * turning the control below into another instance of the case it controls for.
 */
function anotherPaneClaims(
  scope: SelfPreviewScope = { collection: "pages", entryId: "9" }
) {
  const other = new BroadcastChannel(CHANNEL);
  other.postMessage({ scopeKey: previewScopeKey(scope) });
  other.close();
}

/*
 * REAL timers, deliberately. `waitFor` polls on real ones, so faking them
 * starves every assertion here into its timeout — and nothing in this hook
 * needs the clock moved: each fixture states its expiry RELATIVE to now, which
 * is what the margin comparison reads.
 */
beforeEach(() => {
  mint.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
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

  it("renews on a timer, without anyone asking", async () => {
    /*
     * The case a refresh-time check cannot cover: nobody calls `refresh` while
     * an author reads, so the token lapses in place and the next navigation
     * inside the frame is answered with the published page.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mint.mockResolvedValue(expiringIn(90_000));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.url).not.toBeNull());
    expect(mint).toHaveBeenCalledTimes(1);

    // Past the margin, without touching `refresh`.
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });

    await waitFor(() => expect(mint).toHaveBeenCalledTimes(2));
  });

  it("schedules NOTHING for a token that is already inside the margin", async () => {
    /*
     * Such a token means the TTL is shorter than the margin. Renewing at once
     * returns another token inside the margin and schedules the next
     * immediately — an unbounded mint loop, each turn issuing a credential and
     * an audit row. The count staying put is the whole assertion, and the test
     * above is its control: the timer DOES fire when there is time to wait.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mint.mockResolvedValue(expiringIn(10_000));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.url).not.toBeNull());

    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("mints again when the language being previewed changes", async () => {
    /*
     * A token is scoped per locale, so switching language inside the editor
     * makes the held credential the wrong one — it opens the language the
     * author just left. Nothing navigates on a locale switch, so this is the
     * only thing that can notice.
     */
    mint.mockResolvedValue(expiringIn(15 * 60_000));

    const { rerender } = renderHook(
      ({ scope }: { scope: SelfPreviewScope }) =>
        usePreviewFrame({ scope, active: true }),
      {
        initialProps: {
          scope: { collection: "pages", entryId: "7", locale: "en" },
        },
      }
    );
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(1));

    rerender({ scope: { collection: "pages", entryId: "7", locale: "fr" } });

    await waitFor(() => expect(mint).toHaveBeenCalledTimes(2));
  });

  it("mints NOTHING for a scope that is merely a new object", async () => {
    /*
     * The control for the case above, and the reason the dependency is a KEY
     * rather than the scope itself. Callers build the scope inline, so its
     * identity changes on every render — depending on it would issue a
     * credential and an audit row for every keystroke in the editor beside the
     * pane, which is the failure that would hide behind the test above passing.
     */
    mint.mockResolvedValue(expiringIn(15 * 60_000));

    const { rerender } = renderHook(
      ({ scope }: { scope: SelfPreviewScope }) =>
        usePreviewFrame({ scope, active: true }),
      {
        initialProps: {
          scope: { collection: "pages", entryId: "7", locale: "en" },
        },
      }
    );
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(1));

    // Equal by value, different by identity — three times over, so a single
    // render slipping through would not be mistaken for stability.
    rerender({ scope: { collection: "pages", entryId: "7", locale: "en" } });
    rerender({ scope: { collection: "pages", entryId: "7", locale: "en" } });
    rerender({ scope: { collection: "pages", entryId: "7", locale: "en" } });
    await act(async () => {});

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("reports the reason a mint refused, and shows no frame", async () => {
    mint.mockResolvedValue({ kind: "report", reason: "noSiteUrl" });

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.reason).toBe("noSiteUrl"));

    expect(result.current.url).toBeNull();
  });
});

describe("a site served from another origin", () => {
  it("blocks the frame but KEEPS the url, because the tab still works", async () => {
    /*
     * The browser will not carry the preview cookie into a cross-origin frame,
     * and the site answers a frame without one by serving the published page.
     * Nothing about that is observable from the admin — the frame's document
     * belongs to the site — so the pane declines rather than rendering
     * something it cannot check.
     */
    mint.mockResolvedValue(expiringIn(15 * 60_000, "https://elsewhere.test/p"));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.block).toBe("crossOrigin"));

    // Kept, so the toolbar's "open in a new tab" — which is the remedy this
    // state points the author at — has somewhere to go.
    expect(result.current.url).toBe("https://elsewhere.test/p");
    expect(result.current.reason).toBeNull();
  });

  it("does NOT block a same-origin site", async () => {
    // The control: the refusal above is about the origin rather than about a
    // gate that blocks everything.
    mint.mockResolvedValue(expiringIn(15 * 60_000));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.url).not.toBeNull());

    expect(result.current.block).toBeNull();
  });

  it("schedules no renewal for a blocked pane", async () => {
    // Nothing is framed, so nothing needs a live credential — and renewing
    // would claim the shared cookie away from a pane that is using it.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mint.mockResolvedValue(expiringIn(90_000, "https://elsewhere.test/p"));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.block).toBe("crossOrigin"));

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });
});

describe("another pane taking the browser's one preview session", () => {
  it("marks this pane superseded when another scope claims", async () => {
    /*
     * The site keeps ONE preview cookie, so the last mint wins and the loser is
     * not told. Its next in-frame navigation carries the winner's scope, the
     * draft gate refuses it, and the published page is served into a pane
     * captioned "last saved draft".
     */
    mint.mockResolvedValue(expiringIn(15 * 60_000));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.url).not.toBeNull());

    act(() => anotherPaneClaims());

    await waitFor(() => expect(result.current.block).toBe("superseded"));
    // The url survives so refreshing can take the session back.
    expect(result.current.url).not.toBeNull();
  });

  it("ignores a claim on the SAME scope, which shares one valid cookie", async () => {
    // The control, and a real case: the same entry open in two tabs is not a
    // conflict, because both are covered by the one cookie.
    mint.mockResolvedValue(expiringIn(15 * 60_000));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.url).not.toBeNull());

    act(() => anotherPaneClaims({ collection: "pages", entryId: "7" }));
    await act(async () => {});

    expect(result.current.block).toBeNull();
  });

  it("takes the session back on refresh, by minting rather than reloading", async () => {
    /*
     * A superseded pane holds no session, so remounting the frame would replay
     * the same refusal. Only a mint rewrites the cookie.
     */
    mint.mockResolvedValue(expiringIn(15 * 60_000));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.url).not.toBeNull());
    act(() => anotherPaneClaims());
    await waitFor(() => expect(result.current.block).toBe("superseded"));

    act(() => result.current.refresh());

    // A second credential, even though the first has 15 minutes left — which is
    // exactly what the reload/re-mint rule would otherwise have declined.
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.block).toBeNull());
  });

  it("schedules no renewal while superseded, so two panes cannot fight", async () => {
    /*
     * Renewal re-claims. Two idle panes both renewing on a timer would take the
     * session from each other forever with nobody touching anything, trading a
     * silent failure for a perpetual one.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mint.mockResolvedValue(expiringIn(90_000));

    const { result } = renderHook(() => usePreviewFrame(args));
    await waitFor(() => expect(result.current.url).not.toBeNull());
    act(() => anotherPaneClaims());
    await waitFor(() => expect(result.current.block).toBe("superseded"));

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });
});
