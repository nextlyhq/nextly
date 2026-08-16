import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { useEntryPreview } from "../useEntryPreview";

const resolve = vi.hoisted(() => vi.fn());

vi.mock("@admin/services/previewUrlApi", () => ({
  previewUrlApi: { resolve },
}));

vi.mock("@admin/lib/preview/preview-data", () => ({
  storePreviewData: vi.fn(() => "preview-key"),
  generatePreviewUrlWithData: vi.fn(
    (url: string, key: string) => `${url}?__preview=${key}`
  ),
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

  it("sends unsaved form values, not the saved row", async () => {
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    // Same-origin on purpose: this test is about WHICH VALUES reach the
    // resolver, and a cross-origin URL would additionally drop the session-key
    // handoff, mixing a second behaviour into the assertion.
    resolve.mockResolvedValue({
      status: "resolved",
      url: `${window.location.origin}/p/new`,
    });

    const { result } = renderHook(() =>
      useEntryPreview({
        collection,
        entry: { id: "1", slug: "saved" },
        getFormValues: () => ({ slug: "edited" }),
      })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // Resolving against the saved row would open the previous URL and show the
    // wrong page, which is worse than not offering the button.
    expect(resolve).toHaveBeenCalledWith({
      collection: "posts",
      entry: { id: "1", slug: "edited" },
    });
    expect(tab.location.href).toBe(
      `${window.location.origin}/p/new?__preview=preview-key`
    );
  });

  it("stores unsaved data BEFORE opening the tab, not after", async () => {
    const tab = fakeTab();
    const order: string[] = [];
    const { storePreviewData } = await import(
      "@admin/lib/preview/preview-data"
    );
    vi.mocked(storePreviewData).mockImplementation(() => {
      order.push("store");
      return "preview-key";
    });
    openSpy.mockImplementation(() => {
      order.push("open");
      return tab as unknown as Window;
    });
    resolve.mockResolvedValue({ status: "resolved", url: "https://s.dev/p/1" });

    const { result } = renderHook(() =>
      useEntryPreview({
        collection,
        entry: { id: "1" },
        getFormValues: () => ({ slug: "edited" }),
      })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // A new browsing context gets a COPY of session storage taken at creation.
    // Written afterwards, the key stays in this window and the preview silently
    // shows the last saved values instead of the edits on screen.
    expect(order).toEqual(["store", "open"]);
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

  it("drops the unsaved-data key cross-origin and says so, rather than sending a dead one", async () => {
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    // jsdom serves the admin from localhost; the site is elsewhere, which is
    // what a configured site URL now routinely means.
    resolve.mockResolvedValue({
      status: "resolved",
      url: "https://site.example.com/p/1",
    });
    const onUnsavedChangesNotSent = vi.fn();

    const { result } = renderHook(() =>
      useEntryPreview({
        collection,
        entry: { id: "1" },
        getFormValues: () => ({ slug: "edited" }),
        onUnsavedChangesNotSent,
      })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    // Session storage is partitioned per origin, so the key would name a
    // payload the preview page cannot reach. Appending it would look like it
    // worked while quietly rendering stale content.
    expect(tab.location.href).toBe("https://site.example.com/p/1");
    expect(tab.location.href).not.toContain("__preview");
    // Reported, because silently previewing saved data is the failure mode this
    // whole path exists to prevent.
    expect(onUnsavedChangesNotSent).toHaveBeenCalled();
  });

  it("still sends the key when the site is same-origin", async () => {
    // The positive control for the drop above: without it, a hook that never
    // appended the key would satisfy that test perfectly.
    const tab = fakeTab();
    openSpy.mockReturnValue(tab as unknown as Window);
    resolve.mockResolvedValue({
      status: "resolved",
      url: `${window.location.origin}/p/1`,
    });
    const onUnsavedChangesNotSent = vi.fn();

    const { result } = renderHook(() =>
      useEntryPreview({
        collection,
        entry: { id: "1" },
        getFormValues: () => ({ slug: "edited" }),
        onUnsavedChangesNotSent,
      })
    );
    await act(async () => {
      await result.current.openPreview();
    });

    expect(tab.location.href).toContain("__preview=preview-key");
    expect(onUnsavedChangesNotSent).not.toHaveBeenCalled();
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
