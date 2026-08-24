import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { useEntryPreview } from "../useEntryPreview";

const resolve = vi.hoisted(() => vi.fn());

vi.mock("@admin/services/previewUrlApi", () => ({
  previewUrlApi: { resolve },
}));

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
  resolve.mockReset();
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
    // button appear late on every entry that has one.
    expect(resolve).not.toHaveBeenCalled();
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
  it("claims the tab BEFORE awaiting, so the popup blocker does not eat it", async () => {
    const tab = fakeTab();
    const order: string[] = [];
    openSpy.mockImplementation(() => {
      order.push("open");
      return tab as unknown as Window;
    });
    resolve.mockImplementation(() => {
      order.push("resolve");
      return Promise.resolve({ status: "resolved", url: "https://s.dev/p/1" });
    });

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" } })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // The whole point: a window opened after an await has lost the user-gesture
    // context and Safari and Firefox block it. Asserting only that open() was
    // called would pass on the broken ordering too.
    expect(order).toEqual(["open", "resolve"]);
    expect(tab.location.href).toBe("https://s.dev/p/1");
  });

  it("opens the tab without noopener, then severs the reference by hand", async () => {
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    resolve.mockResolvedValue({ status: "resolved", url: "https://s.dev/p/1" });

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" } })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // Passing "noopener" would make window.open return null and leave nothing to
    // navigate, so the reference has to be cut manually instead.
    const features = openSpy.mock.calls[0]?.[2];
    expect(features ?? "").not.toContain("noopener");
    expect(tab.opener).toBeNull();
  });

  it("closes the claimed tab and reports why when no host is configured", async () => {
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    resolve.mockResolvedValue({ status: "noSiteUrl", path: "/p/1" });
    const onUnavailable = vi.fn();

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" }, onUnavailable })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // Leaving a blank tab open would look like a preview that failed to load.
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
    // Distinct from "unavailable": this one is fixed by an admin setting a site
    // URL, not by the editor filling in a field.
    expect(onUnavailable).toHaveBeenCalledWith("noSiteUrl");
  });

  it("reports an entry that is not previewable yet", async () => {
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    resolve.mockResolvedValue({ status: "unavailable" });
    const onUnavailable = vi.fn();

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" }, onUnavailable })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    expect(onUnavailable).toHaveBeenCalledWith("unavailable");
  });

  it("stays silent when the collection has no preview at all", async () => {
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    resolve.mockResolvedValue({ status: "notConfigured" });
    const onUnavailable = vi.fn();

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" }, onUnavailable })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // The button should not have been offered, so an error here would describe a
    // state the editor cannot act on.
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(tab.close).toHaveBeenCalled();
  });

  it("closes the tab and reports when the request itself fails", async () => {
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    resolve.mockRejectedValue(new Error("network"));
    const onUnavailable = vi.fn();

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" }, onUnavailable })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    expect(tab.close).toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith("failed");
  });

  /*
   * Four tests stood here and are gone with the behaviour they described: the
   * hook sent unsaved form values to the resolver, wrote them to session
   * storage before opening the tab, appended `?_preview=<key>` same-origin and
   * dropped it cross-origin.
   *
   * That handoff never worked. Nothing ever read the key back — `_preview`
   * appeared nowhere outside the admin — so the preview always rendered saved
   * content while the tests asserted the machinery around a payload with no
   * reader. They are obsolete rather than redundant: there is no other file
   * covering this, because the behaviour itself was removed.
   */
  it("resolves against the SAVED row and appends nothing to the URL", async () => {
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    // Same-origin on purpose. The removed handoff was gated on origin, so a
    // cross-origin URL could pass this assertion for the wrong reason — it
    // would be bare because the gate refused it, not because nothing appends.
    resolve.mockResolvedValue({
      status: "resolved",
      url: `${window.location.origin}/p/saved`,
    });

    const { result } = renderHook(() =>
      useEntryPreview({
        collection,
        entry: { id: "1", slug: "saved" },
      })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // The address and the content have to agree. What opens is the site's draft
    // route, which renders the saved row, so resolving from anything else names
    // a page that does not exist yet.
    expect(resolve).toHaveBeenCalledWith({
      collection: "posts",
      entry: { id: "1", slug: "saved" },
    });
    // Navigated to unchanged: no key, no query, nothing claiming to carry
    // edits the server will never see.
    expect(tab.location.href).toBe(`${window.location.origin}/p/saved`);
  });

  it("reports a blocked popup instead of navigating the admin away", async () => {
    // window.open returns null when the browser blocks it.
    openSpy.mockReturnValue(null);
    resolve.mockResolvedValue({ status: "resolved", url: "https://s.dev/p/1" });
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
    // And it must not even ask: the click cannot succeed either way.
    expect(resolve).not.toHaveBeenCalled();
  });

  it("navigates a CROSS-ORIGIN site URL unchanged", async () => {
    // The counterpart to the same-origin case above. A configured site URL
    // routinely names another origin, and the URL must survive that untouched —
    // this is where the removed handoff used to branch.
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    resolve.mockResolvedValue({
      status: "resolved",
      url: "https://site.example.com/p/1",
    });

    const { result } = renderHook(() =>
      useEntryPreview({ collection, entry: { id: "1" } })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    expect(tab.location.href).toBe("https://site.example.com/p/1");
  });

  it("navigates the current window when the collection opts out of a new tab", async () => {
    resolve.mockResolvedValue({ status: "resolved", url: "https://s.dev/p/1" });

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

    expect(openSpy).not.toHaveBeenCalled();
  });
});
