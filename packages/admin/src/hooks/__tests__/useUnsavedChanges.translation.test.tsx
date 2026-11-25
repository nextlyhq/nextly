/**
 * On a document's translation page, another source beside the same language
 * keeps the same form, so it is let through; another language, document or page
 * is still asked about.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useUnsavedChanges } from "../useUnsavedChanges";

const { pushState, replaceState } = History.prototype;

const write = (url: string): void => {
  act(() => {
    window.history.pushState(null, "", url);
  });
};
const here = () => `${window.location.pathname}${window.location.search}`;

afterEach(() => {
  window.history.pushState = pushState;
  window.history.replaceState = replaceState;
  replaceState.call(window.history, null, "", "/");
});

describe.each([
  ["an entry", "/admin/translations/collections/posts/1"],
  ["a Single", "/admin/translations/singles/homepage"],
])("the translation page of %s", (_what, page) => {
  beforeEach(() => {
    replaceState.call(window.history, null, "", `${page}?locale=es`);
  });

  it("lets another source through, and back", () => {
    const { result, unmount } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );
    write(`${page}?locale=es&source=fr`);
    expect(here()).toBe(`${page}?locale=es&source=fr`);
    write(`${page}?locale=es`);
    expect(here()).toBe(`${page}?locale=es`);
    expect(result.current.showDialog).toBe(false);
    unmount();
  });

  it("lets its history through: opened, on a version, with a restore, and closed", () => {
    const { result, unmount } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );
    for (const query of [
      "&history=1",
      "&history=1&version=3",
      "&history=1&version=3&restore=title",
      // Opened beside another source.
      "&source=fr&history=1",
      "",
    ]) {
      write(`${page}?locale=es${query}`);
      expect(here()).toBe(`${page}?locale=es${query}`);
    }
    expect(result.current.showDialog).toBe(false);
    unmount();
  });

  it.each([
    ["another language, its history open", `${page}?locale=ar&history=1`],
    ["another language alone", `${page}?locale=ar`],
  ])("from an open history, still asks about %s", (_where, url) => {
    replaceState.call(
      window.history,
      null,
      "",
      `${page}?locale=es&history=1&version=3`
    );
    const { result, unmount } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );
    write(url);
    expect(result.current.showDialog).toBe(true);
    unmount();
  });

  it.each([
    ["another language", `${page}?locale=ar`],
    ["another language with a source", `${page}?locale=ar&source=fr`],
    ["an editor's tab, which it has none of", `${page}?locale=es&tab=seo`],
    ["the editor", "/admin/collections/posts/1"],
    ["the translations list", "/admin/translations"],
  ])("asks about %s", (_where, url) => {
    const { result, unmount } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );
    write(url);
    expect(result.current.showDialog).toBe(true);
    expect(here()).toBe(`${page}?locale=es`);
    unmount();
  });
});

it("still asks about a source anywhere else, where the key means something else", () => {
  replaceState.call(window.history, null, "", "/admin/collections/posts/1");
  const { result, unmount } = renderHook(() =>
    useUnsavedChanges({ isDirty: true })
  );
  write("/admin/collections/posts/1?source=fr");
  expect(result.current.showDialog).toBe(true);
  unmount();
});
