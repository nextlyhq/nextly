import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { useEntryPreview } from "../useEntryPreview";

const mint = vi.hoisted(() => vi.fn());

vi.mock("@admin/services/previewLinkApi", () => ({
  previewLinkApi: { mint },
}));

/** The shape `protectedApi` throws: a status the caller can discriminate on. */
function apiError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

/** A stand-in for the tab `window.open` hands back. */
function fakeTab() {
  return { location: { href: "" }, close: vi.fn(), opener: {} as unknown };
}

const collection = {
  name: "posts",
  admin: { preview: { hasPreview: true } },
};

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mint.mockReset();
  // The default for every case that gets as far as minting. A test asserting
  // WHICH url is navigated to overrides it.
  mint.mockResolvedValue({
    token: "tok",
    url: "https://site.example/api/preview?token=tok",
    expiresAt: "2026-01-01T00:00:00.000Z",
  });
  openSpy = vi.spyOn(window, "open");
});

afterEach(() => {
  openSpy.mockRestore();
});

describe("isPreviewAvailable", () => {
  it("follows the stored boolean without asking the server", () => {
    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" } })
    );

    expect(result.current.isPreviewAvailable).toBe(true);
    // Availability is a render-time question; a round trip here would make the
    // button appear late on every entry that has one — and would mint a
    // credential for a preview nobody asked to open.
    expect(mint).not.toHaveBeenCalled();
  });

  it("is false when the collection stores no preview", () => {
    const { result } = renderHook(() =>
      useEntryPreview({ collection: { name: "posts" }, entry: { id: "1" } })
    );

    expect(result.current.isPreviewAvailable).toBe(false);
  });

  it("is true from a stored template alone, with no boolean present", () => {
    // A UI-created collection stores its template directly and never goes
    // through the code-first sync that writes the boolean, so requiring the
    // boolean would hide a preview the stored data plainly declares. Every row
    // written before the boolean existed is this case.
    const { result } = renderHook(() =>
      useEntryPreview({
        collection: {
          name: "posts",
          admin: { preview: { urlTemplate: "/preview/{slug}" } },
        },
        entry: { id: "1" },
      })
    );

    expect(result.current.isPreviewAvailable).toBe(true);
  });

  it("is false for an empty stored template", () => {
    // What a cleared field yields; it declares nothing.
    const { result } = renderHook(() =>
      useEntryPreview({
        collection: {
          name: "posts",
          admin: { preview: { urlTemplate: "" } },
        },
        entry: { id: "1" },
      })
    );

    expect(result.current.isPreviewAvailable).toBe(false);
  });

  it("is false when the collection stores hasPreview: false", () => {
    const { result } = renderHook(() =>
      useEntryPreview({
        collection: {
          name: "posts",
          admin: { preview: { hasPreview: false } },
        },
        entry: { id: "1" },
      })
    );

    expect(result.current.isPreviewAvailable).toBe(false);
  });
});

describe("openPreview", () => {
  const MINTED = "https://site.example/api/preview?token=tok";

  it("claims the tab BEFORE awaiting, so the popup blocker does not eat it", async () => {
    const tab = fakeTab();
    const order: string[] = [];
    openSpy.mockImplementation(() => {
      order.push("open");
      return tab as unknown as Window;
    });
    mint.mockImplementation(() => {
      order.push("mint");
      return Promise.resolve({ token: "tok", url: MINTED, expiresAt: "x" });
    });

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" } })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // A window opened after an await has lost the user-gesture context and
    // Safari and Firefox block it. Asserting only that open() was called would
    // pass on the broken ordering too.
    expect(order).toEqual(["open", "mint"]);
    expect(tab.location.href).toBe(MINTED);
  });

  it("opens the tab without noopener, then severs the reference by hand", async () => {
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" } })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // Passing "noopener" would make window.open return null and leave nothing
    // to navigate, so the reference is cut manually instead.
    const features = openSpy.mock.calls[0]?.[2];
    expect(features ?? "").not.toContain("noopener");
    expect(tab.opener).toBeNull();
  });

  it("navigates to the CREDENTIALLED url the mint returned", async () => {
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1", slug: "saved" } })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // The point of the whole path. The site renders on its own origin, where
    // the admin's session does not reach, so a bare address arrives
    // unauthenticated and the draft gate answers with the PUBLISHED page — or a
    // 404 where nothing is published. The destination has to be the minted url.
    expect(tab.location.href).toBe(MINTED);

    // Scoped to the one document, and short-lived because it is spent by the
    // tab opening as it is issued rather than sent to anybody.
    expect(mint).toHaveBeenCalledWith({
      collection: "posts",
      entryId: "1",
      ttlSeconds: 15 * 60,
    });
  });

  it("scopes the token to the language being edited", async () => {
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" }, locale: "fr" })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // The route redirects from the TOKEN's scope, so an unscoped token opens
    // the default language whichever one was being edited — the reader is sent
    // to the wrong translation while holding a broader credential than needed.
    expect(mint).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "fr" })
    );
  });

  it("omits the locale entirely when the caller names none", async () => {
    // The positive control for the case above: a non-localized collection has
    // one document and no language to name, and scoping to an invented one
    // would refuse a preview that should work. Without this, a hook that always
    // sent a locale would satisfy the previous test perfectly.
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" } })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    expect(mint).toHaveBeenCalledWith(
      expect.not.objectContaining({ locale: expect.anything() })
    );
  });

  it("asks the server ONCE — it resolves the destination itself", async () => {
    // The mint already resolves the redirect through the same function the
    // preview route will call, and refuses before signing when a document has
    // no address. Asking a second endpoint first was a second implementation of
    // that question, and it ran an author's `preview.url` function twice.
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" } })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("reports noSiteUrl when the server could not assemble the link", async () => {
    // The site's address lives in settings the previewing roles cannot read, so
    // the server is the only place the link can be built — a null url is that
    // setting missing, which an administrator can fix.
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    mint.mockResolvedValue({ token: "tok", url: null, expiresAt: "x" });
    const onUnavailable = vi.fn();

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" }, onUnavailable })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    expect(onUnavailable).toHaveBeenCalledWith("noSiteUrl");
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
  });

  it("reads a 409 as an entry with no preview address yet", async () => {
    // The one refusal the editor can act on themselves — usually an empty slug.
    // Collapsed into the generic failure it would send them looking at
    // configuration that was never the problem.
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    mint.mockRejectedValue(apiError(409));
    const onUnavailable = vi.fn();

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" }, onUnavailable })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    expect(onUnavailable).toHaveBeenCalledWith("unavailable");
    expect(tab.close).toHaveBeenCalled();
  });

  it("reads any other refusal as a failure rather than guessing", async () => {
    // The negative control for the 409 mapping. A hook that answered
    // "unavailable" for everything would pass the test above.
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    mint.mockRejectedValue(apiError(403));
    const onUnavailable = vi.fn();

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" }, onUnavailable })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    expect(onUnavailable).toHaveBeenCalledWith("failed");
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
  });

  it("reports a blocked popup instead of navigating the admin away", async () => {
    openSpy.mockReturnValue(null);
    const onUnavailable = vi.fn();
    const before = window.location.href;

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" }, onUnavailable })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // Falling back to this window would take the editor off the form and
    // discard every unsaved change — the opposite of what preview is for.
    expect(window.location.href).toBe(before);
    expect(onUnavailable).toHaveBeenCalledWith("popupBlocked");
    // And it must not even ask: the click cannot succeed either way, so no
    // credential is minted for a preview that has nowhere to open.
    expect(mint).not.toHaveBeenCalled();
  });

  it("mints NOTHING for an entry that has never been saved", async () => {
    // A draft is authorized by naming ONE document, and an unsaved entry has no
    // name to give. Every case above is the positive control: a saved entry
    // does reach the mint.
    const onUnavailable = vi.fn();

    const { result } = renderHook(() =>
      useEntryPreview({
        collection,
        entry: { title: "unsaved" },
        onUnavailable,
      })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    expect(mint).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith("unavailable");
  });

  it("navigates the current window when the collection opts out of a new tab", async () => {
    const { result } = renderHook(() =>
      useEntryPreview({
        collection: {
          name: "posts",
          admin: { preview: { hasPreview: true, openInNewTab: false } },
        },
        entry: { id: "1" },
      })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // jsdom refuses to navigate, so the destination cannot be observed here —
    // `settle` handles both branches and the new-tab cases above pin the url.
    // What IS observable, and what this case is about, is that no second window
    // was claimed.
    expect(openSpy).not.toHaveBeenCalled();
    expect(mint).toHaveBeenCalledTimes(1);
  });
});
