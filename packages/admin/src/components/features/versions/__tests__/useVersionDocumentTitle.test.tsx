/**
 * A comparison page has to say which document it belongs to.
 *
 * The URL carries an opaque id and the dashboard header shows no breadcrumbs,
 * so a page that cannot name its document leaves a reader unable to tell what
 * the snapshots are of without navigating away.
 *
 * The fallback cases matter as much as the happy one: a title that silently
 * becomes empty is worse than an ugly one, because the heading then reads the
 * same as a page that failed to load.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderHook } from "@admin/__tests__/utils";

const { collectionMock, entryMock, singleSchemaMock } = vi.hoisted(() => ({
  collectionMock: vi.fn(),
  entryMock: vi.fn(),
  singleSchemaMock: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useCollections", () => ({
  useCollection: (...a: unknown[]) => collectionMock(...a),
}));
vi.mock("@admin/hooks/queries/useEntry", () => ({
  useEntry: (...a: unknown[]) => entryMock(...a),
}));
vi.mock("@admin/hooks/queries/useSingles", () => ({
  useSingleSchema: (...a: unknown[]) => singleSchemaMock(...a),
}));

import { useVersionDocumentTitle } from "../useVersionDocumentTitle";

const field = (name: string) => ({ name, type: "text" });

beforeEach(() => {
  vi.clearAllMocks();
  collectionMock.mockReturnValue({ data: undefined });
  entryMock.mockReturnValue({ data: undefined });
  singleSchemaMock.mockReturnValue({ data: undefined });
});

const forEntry = () =>
  renderHook(() =>
    useVersionDocumentTitle({
      kind: "collection",
      slug: "posts",
      entryId: "e1",
    })
  );

describe("useVersionDocumentTitle — a collection entry", () => {
  it("uses the field the collection nominates as its title", () => {
    collectionMock.mockReturnValue({
      data: {
        admin: { useAsTitle: "headline" },
        fields: [field("headline"), field("title")],
      },
    });
    entryMock.mockReturnValue({
      data: { headline: "Ada writes a compiler", title: "ignored" },
    });

    // `useAsTitle` wins over the conventional `title`, which is the author's
    // decision and the reason the setting exists.
    expect(forEntry().result.current).toBe("Ada writes a compiler");
  });

  it("falls back to a conventional field when none is nominated", () => {
    collectionMock.mockReturnValue({ data: { fields: [field("title")] } });
    entryMock.mockReturnValue({ data: { title: "Untitled draft" } });

    expect(forEntry().result.current).toBe("Untitled draft");
  });

  /**
   * The heading has to say something. An entry whose title field is blank, or
   * whose data has not arrived, would otherwise render an empty heading — which
   * reads as a page that failed rather than one still loading.
   */
  it("names the entry by slug and id when its title is empty", () => {
    collectionMock.mockReturnValue({ data: { fields: [field("title")] } });
    entryMock.mockReturnValue({ data: { title: "   " } });

    expect(forEntry().result.current).toBe("posts · e1");
  });

  it("names the entry by slug and id before anything has loaded", () => {
    expect(forEntry().result.current).toBe("posts · e1");
  });

  /**
   * The fallback carries the ID, not the slug alone. Every entry in a
   * collection shares its slug, so a slug-only heading would name them all the
   * same and tell a reader nothing about which one is on screen.
   */
  it("distinguishes two entries of the same collection", () => {
    const other = renderHook(() =>
      useVersionDocumentTitle({
        kind: "collection",
        slug: "posts",
        entryId: "e2",
      })
    );
    expect(forEntry().result.current).not.toBe(other.result.current);
  });
});

describe("useVersionDocumentTitle — a single", () => {
  const forSingle = () =>
    renderHook(() =>
      useVersionDocumentTitle({ kind: "single", slug: "site-settings" })
    );

  it("uses the single's label", () => {
    singleSchemaMock.mockReturnValue({ data: { label: "Site settings" } });
    expect(forSingle().result.current).toBe("Site settings");
  });

  it("names a single by a NUMERIC label, as the editor heading does", () => {
    // 🔴 The private rule this hook used refused a number while the editor's
    // accepted one, so a Single labelled with an issue or invoice number was
    // named by it in the editor and by its slug on the page comparing its
    // versions. Two names for one document, from two spellings of one rule.
    singleSchemaMock.mockReturnValue({ data: { label: 4021 } });
    expect(forSingle().result.current).toBe("4021");
  });

  it("falls back to the slug, which is what the URL shows", () => {
    singleSchemaMock.mockReturnValue({ data: { label: "  " } });
    expect(forSingle().result.current).toBe("site-settings");
  });

  /**
   * The control on scope: a Single must not be asked for through the entry
   * query, and a collection entry must not be named from a Single's schema.
   * Without this, a hook that ignored `kind` would satisfy everything above.
   */
  it("does not read a single's schema for a collection entry", () => {
    collectionMock.mockReturnValue({ data: { fields: [field("title")] } });
    entryMock.mockReturnValue({ data: { title: "An entry" } });
    singleSchemaMock.mockReturnValue({ data: { label: "A single" } });

    expect(forEntry().result.current).toBe("An entry");
  });
});

describe("useVersionDocumentTitle — the language it reads in", () => {
  /**
   * A localized entry holds a title per language. Read without one, a French
   * comparison is headed by the English title — while the editor it was opened
   * from passes its own active locale, so the two surfaces name one document
   * by different states of it.
   */
  it("reads the entry in the language it was given", () => {
    collectionMock.mockReturnValue({ data: { fields: [field("title")] } });
    entryMock.mockReturnValue({ data: { title: "Bonjour" } });

    renderHook(() =>
      useVersionDocumentTitle(
        { kind: "collection", slug: "posts", entryId: "e1" },
        "fr"
      )
    );

    expect(entryMock).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "fr" })
    );
  });

  /**
   * The control. Without a locale the query must ask for none rather than
   * inventing one — the server resolves the default, which is what a
   * non-localized document needs.
   */
  it("asks for no locale when the address names none", () => {
    collectionMock.mockReturnValue({ data: { fields: [field("title")] } });
    entryMock.mockReturnValue({ data: { title: "Hello" } });

    renderHook(() =>
      useVersionDocumentTitle({
        kind: "collection",
        slug: "posts",
        entryId: "e1",
      })
    );

    expect(entryMock).toHaveBeenCalledWith(
      expect.objectContaining({ locale: undefined })
    );
  });
});
