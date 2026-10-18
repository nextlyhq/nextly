/**
 * The history panel's state, as the address keeps it.
 *
 * Driven through the real `window.history` and the real query reader: the
 * properties are about which address a move leaves behind, and how many steps
 * back it takes to undo, which a stubbed history would only restate.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useHistoryAddress } from "../history-address";

/** Start from this address, as a page load would. */
function at(address: string) {
  window.history.replaceState(null, "", address);
}

const search = () => new URLSearchParams(window.location.search);

afterEach(() => at("/"));

describe("useHistoryAddress", () => {
  it("opens where the address says, at the version it names", () => {
    at("/admin/collections/posts/e1?history=1&version=4");
    const { result } = renderHook(() => useHistoryAddress());
    expect(result.current).toMatchObject({ open: true, version: 4 });
  });

  it("reads no version while history is closed, nor one that is not a version", () => {
    at("/admin/collections/posts/e1?version=4");
    expect(renderHook(() => useHistoryAddress()).result.current).toMatchObject({
      open: false,
      version: null,
    });
    at("/admin/collections/posts/e1?history=1&version=draft");
    expect(renderHook(() => useHistoryAddress()).result.current).toMatchObject({
      open: true,
      version: null,
    });
  });

  it("adds a step back for opening, none for choosing a version, and closes by stepping back off it", async () => {
    at("/admin/collections/posts/e1?locale=es");
    const start = window.history.length;
    const { result } = renderHook(() => useHistoryAddress());

    act(() => result.current.setOpen(true));
    expect(search().get("history")).toBe("1");
    expect(window.history.length).toBe(start + 1);

    act(() => result.current.setVersion(3));
    act(() => result.current.setVersion(2));
    expect(search().get("version")).toBe("2");
    // Looking down the list does not fill the back button with rows.
    expect(window.history.length).toBe(start + 1);
    expect(result.current).toMatchObject({ open: true, version: 2 });

    act(() => result.current.setOpen(false));
    expect(result.current).toMatchObject({ open: false, version: null });
    // Back to the entry before opening, so Back cannot reopen the panel: no
    // new entry for closing.
    await waitFor(() => expect(search().get("history")).toBeNull());
    expect(window.history.length).toBe(start + 1);
    expect(search().get("version")).toBeNull();
    // Other keys are the page's own and stay.
    expect(search().get("locale")).toBe("es");
  });

  it("closes a panel a link opened in place, adding no entry", () => {
    at("/admin/collections/posts/e1?history=1&version=2");
    const start = window.history.length;
    const { result } = renderHook(() => useHistoryAddress());

    act(() => result.current.setOpen(false));
    expect(search().get("history")).toBeNull();
    expect(search().get("version")).toBeNull();
    expect(window.history.length).toBe(start);
  });

  it("reads history as closed where it is not available, whatever the address says", () => {
    at("/admin/collections/posts/e1?history=1&version=4");
    const { result } = renderHook(() => useHistoryAddress(false));
    expect(result.current).toMatchObject({ open: false, version: null });
  });

  it("follows the address when it moves back", () => {
    at("/admin/collections/posts/e1");
    const { result } = renderHook(() => useHistoryAddress());
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);

    act(() => {
      at("/admin/collections/posts/e1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.open).toBe(false);
  });
});
