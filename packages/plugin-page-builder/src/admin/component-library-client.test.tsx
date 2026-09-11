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
import { describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: vi.fn(),
}));

import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import {
  COMPONENT_LIBRARY_ROUTE_PATH,
  LIBRARY_ROUTE_PATH,
  type ComponentLibraryResponse,
} from "../library-contract";
import { useComponentLibrary } from "./component-library-client";

const read = vi.mocked(usePluginRoute);

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
  } as unknown as ReturnType<typeof usePluginRoute<ComponentLibraryResponse>>);
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

  it("answers ONE shared empty value across readers while the read is in flight", () => {
    // Identity, not equality — and across INSTANCES, not only across renders
    // of one. The memo already holds a single instance still; what a shared
    // constant adds is that the editor and the panel, each calling this hook,
    // hold the same empty map, so neither resolves or rebuilds against an
    // empty value the other does not have.
    pending();

    const editor = renderHook(() => useComponentLibrary());
    const panel = renderHook(() => useComponentLibrary());

    expect(panel.result.current).toBe(editor.result.current);
    expect(editor.result.current.definitions.size).toBe(0);
    expect(editor.result.current.components).toEqual([]);
  });

  it("says when the ceiling cut the read", () => {
    answering([{ id: "a", title: "A", document: header }], true);

    const { result } = renderHook(() => useComponentLibrary());

    expect(result.current.truncated).toBe(true);
  });
});
