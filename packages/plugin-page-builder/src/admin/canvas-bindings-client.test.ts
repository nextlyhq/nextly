// @vitest-environment jsdom

/**
 * The canvas's binding sources: asked only for what the page's bindings read,
 * and kept per signed-in person, so no person is ever handed another's.
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** The document the hook test edits; the other tests pass theirs in. */
const editing = vi.hoisted(() => ({
  identity: null as null | {
    kind: "collection";
    slug: string;
    documentId: string;
  },
}));
const writePluginRoute = vi.hoisted(() => vi.fn());

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useCurrentUserId: () => "u1",
  useDocumentIdentity: () => editing.identity,
  writePluginRoute,
}));

const { canvasBindingsFor, canvasBindingsRequest, useCanvasBindings } =
  await import("./canvas-bindings-client");

const page = (bindings?: Record<string, unknown>): BlockDocument =>
  ({
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "h",
        type: "core/heading",
        version: 1,
        props: { text: "Fallback", level: "h1" },
        ...(bindings === undefined ? {} : { bindings }),
      },
    ],
  }) as BlockDocument;

const identity = {
  kind: "collection" as const,
  slug: "posts",
  documentId: "p1",
};

const answer = (title: string) => ({
  entry: { id: "p1", title },
  entryRef: { collection: "posts" },
  singles: [],
  shapes: [],
});

describe("the canvas's binding sources", () => {
  it("asks for what the page's bindings read, and nothing for a page without", () => {
    expect(canvasBindingsRequest(page(), identity, "en")).toBeUndefined();
    expect(
      canvasBindingsRequest(page({ text: { $bind: "title" } }), null, "en")
    ).toBeUndefined();
    expect(
      canvasBindingsRequest(page({ text: { $bind: "title" } }), identity, "en")
    ).toEqual({
      source: { kind: "collection", slug: "posts", id: "p1" },
      demand: {
        entry: { fields: ["title"], follows: {} },
        singles: {},
        site: false,
        formatsDates: false,
      },
      locale: "en",
    });
  });

  it("reads them back as the renderer takes them", async () => {
    const request = canvasBindingsRequest(
      page({ text: { $bind: "title" } }),
      identity,
      undefined
    );
    if (request === undefined) throw new Error("no ask");
    const bindings = await canvasBindingsFor(request, "reader-1", async () =>
      answer("Draft title")
    );
    expect(bindings.entry).toEqual({ id: "p1", title: "Draft title" });
    expect(bindings.singles).toBeInstanceOf(Map);
  });

  it("never hands one person's kept answer to another", async () => {
    const request = canvasBindingsRequest(
      page({ text: { $bind: "title" } }),
      identity,
      "fr"
    );
    if (request === undefined) throw new Error("no ask");
    const ask = vi.fn(async () => answer("A's draft"));
    const first = await canvasBindingsFor(request, "author-a", ask);
    // The same ask again for the same person is answered from what was kept.
    await canvasBindingsFor(request, "author-a", ask);
    expect(ask).toHaveBeenCalledTimes(1);
    // Another person signs in in the same tab: they are asked for afresh.
    const other = vi.fn(async () => answer("B's view"));
    const second = await canvasBindingsFor(request, "author-b", other);
    expect(other).toHaveBeenCalledTimes(1);
    expect(second.entry).toEqual({ id: "p1", title: "B's view" });
    expect(first.entry).toEqual({ id: "p1", title: "A's draft" });
  });

  it("drops the earlier answer when a changed ask fails", async () => {
    editing.identity = identity;
    const bound = page({ text: { $bind: "title" } });
    writePluginRoute.mockResolvedValueOnce(answer("English title"));
    const { result, rerender } = renderHook(
      ({ locale }: { locale: string }) => useCanvasBindings(bound, locale),
      { initialProps: { locale: "en" } }
    );
    await waitFor(() =>
      expect(result.current.entry).toEqual({ id: "p1", title: "English title" })
    );
    // The editor switches locale and that read fails: the English value must
    // not go on standing in for the German page.
    writePluginRoute.mockRejectedValueOnce(new Error("offline"));
    rerender({ locale: "de" });
    await waitFor(() => expect(result.current.entry).toBeUndefined());
    expect(writePluginRoute).toHaveBeenCalledTimes(2);
    editing.identity = null;
  });
});
