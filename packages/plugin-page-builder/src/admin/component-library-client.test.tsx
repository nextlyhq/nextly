// @vitest-environment jsdom
/**
 * What the component read hands the editor, in both shapes.
 *
 * The two properties that carry the value are the two that fail quietly: the
 * canvas gets its definitions as a MAP the renderer resolves against, and an
 * empty map is exactly what it draws placeholders from — so a hook that built
 * the map wrongly, or asked for the wrong tier, would leave every instance a
 * placeholder while looking like a read that simply returned nothing yet.
 *
 * @module admin/component-library-client.test
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: vi.fn(),
  useDocumentLocale: vi.fn(),
}));

import { useDocumentLocale, usePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import {
  COMPONENT_LIBRARY_ROUTE_PATH,
  LIBRARY_ROUTE_PATH,
  type ComponentLibraryResponse,
} from "../library-contract";
import { useComponentLibrary } from "./component-library-client";

const read = vi.mocked(usePluginRoute);
const documentLocale = vi.mocked(useDocumentLocale);

// A field outside any localized form by default: the language is not
// knowable, and the read asks for the app default.
beforeEach(() => {
  documentLocale.mockReturnValue(null);
});

function answering(
  items: ComponentLibraryResponse["items"],
  truncated = false
): void {
  read.mockReturnValue({
    data: { items, meta: { count: items.length, truncated } },
    error: null,
    pending: false,
  } as unknown as ReturnType<typeof usePluginRoute<ComponentLibraryResponse>>);
}

function pending(): void {
  read.mockReturnValue({
    data: undefined,
    error: null,
    pending: true,
    refetch: () => {},
  } as unknown as ReturnType<typeof usePluginRoute<ComponentLibraryResponse>>);
}

/** A read that failed before any data arrived, with the refetch it offers. */
function failed(refetch: () => void): void {
  read.mockReturnValue({
    data: undefined,
    error: new Error("Forbidden"),
    pending: false,
    refetch,
  } as unknown as ReturnType<typeof usePluginRoute<ComponentLibraryResponse>>);
}

/**
 * A read whose refetch failed AFTER an earlier answer: the data the query
 * cached stays, and the error is set beside it.
 */
function failedWithCached(
  items: ComponentLibraryResponse["items"],
  refetch: () => void
): void {
  read.mockReturnValue({
    data: { items, meta: { count: items.length, truncated: false } },
    error: new Error("Forbidden"),
    pending: false,
    refetch,
  } as unknown as ReturnType<typeof usePluginRoute<ComponentLibraryResponse>>);
}

/**
 * A read answering the SAME data on every render, with a refetch wrapper
 * minted per render — which is what the route hook hands back.
 */
function answeringEachRender(
  items: ComponentLibraryResponse["items"],
  refetches: Array<() => void>
): void {
  const data = { items, meta: { count: items.length, truncated: false } };
  read.mockImplementation(
    () =>
      ({
        data,
        error: null,
        pending: false,
        refetch: refetches.shift() ?? (() => {}),
      }) as unknown as ReturnType<
        typeof usePluginRoute<ComponentLibraryResponse>
      >
  );
}

const header = {
  formatVersion: 1,
  kind: "component",
  nodes: [{ id: "d1", type: "core/box", version: 1, props: {} }],
} as unknown as NonNullable<
  ComponentLibraryResponse["items"][number]["document"]
>;

describe("the component read", () => {
  it("asks the COMPONENT route, not the pattern library's, fresh on every mount", () => {
    // The pattern tier can run to the whole byte ceiling, and this read runs
    // on every surface that draws the page — asking the pattern route would
    // spend that to draw a header, and would be refused for a role that may
    // read components and not patterns. And `staleTime: 0` for the reason the
    // pattern read gives: a definition is edited through its own screen,
    // which invalidates nothing here.
    answering([]);

    renderHook(() => useComponentLibrary());

    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        path: COMPONENT_LIBRARY_ROUTE_PATH,
        staleTime: 0,
      })
    );
    expect(COMPONENT_LIBRARY_ROUTE_PATH).not.toBe(LIBRARY_ROUTE_PATH);
  });

  it("asks for the language the surrounding document is being edited in, and the default when it is the default or unknown", () => {
    /*
     * A component's document field can be localized, and the public renderer
     * reads definitions in the page's locale. The language travels in the
     * path — the read hook's cache key — so a switch of language is a
     * different read rather than the last language's definitions served from
     * cache, and two surfaces drawing the same language share one.
     *
     * The literal spelling, not the helper that produced it: the route reads
     * this exact query, and a test comparing the helper to itself would agree
     * with any spelling.
     */
    answering([]);
    documentLocale.mockReturnValue({
      code: "de",
      documentLocalized: true,
      isDefaultLocale: false,
      rtl: false,
    });

    renderHook(() => useComponentLibrary());

    expect(read).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: `${COMPONENT_LIBRARY_ROUTE_PATH}?locale=de`,
      })
    );

    // The default language is addressed by an ABSENT parameter, as it is
    // everywhere in the admin.
    documentLocale.mockReturnValue({
      code: null,
      documentLocalized: true,
      isDefaultLocale: true,
      rtl: false,
    });
    renderHook(() => useComponentLibrary());
    expect(read).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: COMPONENT_LIBRARY_ROUTE_PATH })
    );
  });

  it("hands the canvas a map by id and the panel a list, from ONE response", () => {
    // The positive control: without it every assertion below is satisfied by
    // a hook that hands over nothing at all.
    answering([
      { id: "header", title: "Header", category: "Sections", document: header },
      { id: "footer", title: "Footer", document: header },
    ]);

    const { result } = renderHook(() => useComponentLibrary());

    expect([...result.current.definitions.keys()]).toEqual([
      "header",
      "footer",
    ]);
    expect(result.current.definitions.get("header")).toBe(header);
    expect(result.current.components).toEqual([
      { id: "header", title: "Header", category: "Sections", document: header },
      { id: "footer", title: "Footer", document: header },
    ]);
  });

  it("hands the panel the rows AS RECEIVED, so a field the wire carries reaches a tile", () => {
    // The wire shape extends the panel's own, so nothing is translated on the
    // way — and a translation was where a field went missing: the route could
    // carry search terms or a usage count and the tile would never see them.
    const rows = [
      {
        id: "header",
        title: "Header",
        keywords: "nav, top",
        usedOn: 12,
        document: header,
      },
    ];
    answering(rows);

    const { result } = renderHook(() => useComponentLibrary());

    expect(result.current.components).toBe(rows);
  });

  it("keeps a row saved without content OUT of the map, and in the list as null", () => {
    // The renderer draws a placeholder for an id the map does not hold, and
    // the panel skips a null document: both are the honest answer for a
    // definition that holds nothing, and neither should be reached by putting
    // `null` in the map.
    answering([
      { id: "empty", title: "Empty", document: null },
      { id: "header", title: "Header", document: header },
    ]);

    const { result } = renderHook(() => useComponentLibrary());

    expect(result.current.definitions.has("empty")).toBe(false);
    expect(result.current.definitions.has("header")).toBe(true);
    expect(result.current.components.map(c => c.document)).toEqual([
      null,
      header,
    ]);
  });

  it("answers ONE shared empty map and list across readers while the read is in flight", () => {
    // Identity, not equality — and across INSTANCES, not only across renders
    // of one. The memo already holds a single instance still; what a shared
    // constant adds is that the editor and the panel, each calling this hook,
    // hold the same empty map, so neither resolves or rebuilds against an
    // empty value the other does not have.
    pending();

    const editor = renderHook(() => useComponentLibrary());
    const panel = renderHook(() => useComponentLibrary());

    expect(panel.result.current.definitions).toBe(
      editor.result.current.definitions
    );
    expect(panel.result.current.components).toBe(
      editor.result.current.components
    );
    expect(editor.result.current.definitions.size).toBe(0);
    expect(editor.result.current.state).toBe("pending");
  });

  it("tells a FAILED read apart from a pending one, and hands over the retry", () => {
    // Both have no data, and only one of them will ever have any. Folded
    // together, every instance on the page draws as could-not-be-loaded
    // behind a "loading" that never resolves, with no way to ask again.
    const refetch = vi.fn();
    failed(refetch);

    const { result } = renderHook(() => useComponentLibrary());

    expect(result.current.state).toBe("unavailable");
    expect(result.current.definitions.size).toBe(0);
    result.current.retry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("says a read that failed with an earlier answer still cached is STALE, and keeps what it had", () => {
    // The route hook reads fresh on every mount and keeps the cached answer
    // while it does. A refetch that fails leaves that answer in place with the
    // error beside it — and a state read off the data alone calls that ready,
    // so the canvas draws definitions an edit may have changed, with no
    // sentence and no retry. Its own state rather than `unavailable`: the map
    // stays, so the page still draws and the tiles still stand, and the
    // sentences for a read that answered nothing would be false beside them.
    const refetch = vi.fn();
    failedWithCached(
      [{ id: "header", title: "Header", document: header }],
      refetch
    );

    const { result } = renderHook(() => useComponentLibrary());

    expect(result.current.state).toBe("stale");
    expect(result.current.definitions.size).toBe(1);
    expect(result.current.components).toHaveLength(1);
    result.current.retry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the map, the list and the retry across renders that hand it a new refetch wrapper", () => {
    // The route hook mints its refetch closure per render. Keyed on it, the
    // memo runs every render and hands the canvas a NEW map each time, which
    // is what the canvas re-resolves every instance on — per keystroke,
    // since the editor re-renders the field on every edit.
    const first = vi.fn();
    const second = vi.fn();
    answeringEachRender(
      [{ id: "header", title: "Header", document: header }],
      [first, second]
    );

    const { result, rerender } = renderHook(() => useComponentLibrary());
    const before = result.current;
    rerender();
    const after = result.current;

    expect(after.definitions).toBe(before.definitions);
    expect(after.components).toBe(before.components);
    expect(after.retry).toBe(before.retry);
    // And the retry asks the read as it stands NOW, not as it stood when the
    // wrapper was first taken.
    after.retry();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("is ready once the read has answered", () => {
    // The control for the two above.
    answering([]);

    const { result } = renderHook(() => useComponentLibrary());

    expect(result.current.state).toBe("ready");
  });

  it("says when the ceiling cut the read", () => {
    answering([{ id: "a", title: "A", document: header }], true);

    const { result } = renderHook(() => useComponentLibrary());

    expect(result.current.truncated).toBe(true);
  });
});
