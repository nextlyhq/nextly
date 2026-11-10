/**
 * Opening another tab of a document's editor keeps the reader on the page,
 * with the same form mounted, so the unsaved-changes guard lets it through:
 * on a saved entry, a new one and a Single, whichever way it moves, and with
 * a Back between two tabs. Only the open tab's key is let through: any other
 * query change made with it, a language among them, is still asked about.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUnsavedChanges } from "../useUnsavedChanges";

const { pushState, replaceState } = History.prototype;

/** The guard over a form with unsaved changes. */
function guard() {
  return renderHook(() => useUnsavedChanges({ isDirty: true }));
}

/** A history write, as the admin's address helpers make one. */
function write(kind: "pushState" | "replaceState", url: string): void {
  act(() => {
    window.history[kind](null, "", url);
  });
}

const here = () => `${window.location.pathname}${window.location.search}`;

afterEach(() => {
  window.history.pushState = pushState;
  window.history.replaceState = replaceState;
  replaceState.call(window.history, null, "", "/");
  vi.restoreAllMocks();
});

describe("opening another tab of the editor", () => {
  it.each([
    ["a saved entry", "/admin/collections/posts/1"],
    ["a new entry", "/admin/collections/posts/create"],
    ["a Single", "/admin/singles/homepage"],
  ])("is let through on %s, to a tab and back", (_, editor) => {
    replaceState.call(window.history, null, "", editor);
    const { result, unmount } = guard();

    write("replaceState", `${editor}?tab=acme-seo.seo`);
    expect(here()).toBe(`${editor}?tab=acme-seo.seo`);
    write("replaceState", `${editor}?tab=acme-links.links`);
    expect(here()).toBe(`${editor}?tab=acme-links.links`);
    write("replaceState", editor);
    expect(here()).toBe(editor);
    expect(result.current.showDialog).toBe(false);
    unmount();
  });

  it("is let through when the tab is pushed, as well as replaced", () => {
    const editor = "/admin/collections/posts/1";
    replaceState.call(window.history, null, "", editor);
    const { result, unmount } = guard();

    write("pushState", `${editor}?tab=acme-seo.seo`);
    expect(here()).toBe(`${editor}?tab=acme-seo.seo`);
    expect(result.current.showDialog).toBe(false);
    unmount();
  });

  it("still asks when the language changes with the tab", () => {
    const editor = "/admin/collections/posts/1";
    replaceState.call(window.history, null, "", `${editor}?tab=acme-seo.seo`);
    const { result, unmount } = guard();

    write("replaceState", `${editor}?locale=fr`);
    expect(result.current.showDialog).toBe(true);
    expect(here()).toBe(`${editor}?tab=acme-seo.seo`);
    unmount();
  });

  it("still asks when the same tab is opened on another page", () => {
    replaceState.call(
      window.history,
      null,
      "",
      "/admin/collections/posts/1?tab=acme-seo.seo"
    );
    const { result, unmount } = guard();

    write("replaceState", "/admin/collections/posts/2?tab=acme-seo.seo");
    expect(result.current.showDialog).toBe(true);
    unmount();
  });

  it("is not let through off an editor, where the key means something else", () => {
    replaceState.call(window.history, null, "", "/admin/settings");
    const { result, unmount } = guard();

    write("replaceState", "/admin/settings?tab=acme-seo.seo");
    expect(result.current.showDialog).toBe(true);
    unmount();
  });
});
