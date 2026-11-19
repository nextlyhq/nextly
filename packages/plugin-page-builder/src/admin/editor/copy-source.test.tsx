// @vitest-environment jsdom
/**
 * The stored entry the editor's document is, as Save as section and Turn
 * into component name it: in the translation being edited, so the entry is
 * read, and its CSS judged, in that language, and in none for the default
 * language or a document not kept per language.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useDocumentIdentity: vi.fn(),
  useDocumentLocale: vi.fn(),
}));

import {
  useDocumentIdentity,
  useDocumentLocale,
} from "@nextlyhq/plugin-sdk/admin";

import { useCopySource } from "./copy-source";

const identity = vi.mocked(useDocumentIdentity);
const language = vi.mocked(useDocumentLocale);

/** The editor's language, as the entry form tells it. */
function editing(
  code: string | null,
  options: { localized?: boolean; isDefault?: boolean } = {}
) {
  language.mockReturnValue({
    code,
    documentLocalized: options.localized ?? true,
    isDefaultLocale: options.isDefault ?? false,
    rtl: false,
  } as never);
}

beforeEach(() => {
  identity.mockReturnValue({
    kind: "collection",
    slug: "pages",
    documentId: "page-1",
  } as never);
  language.mockReturnValue(null);
});

describe("the copy source the editor names", () => {
  it("names the translation being edited", () => {
    editing("de");
    const { result } = renderHook(() => useCopySource("content"));
    expect(result.current).toEqual({
      collection: "pages",
      id: "page-1",
      field: "content",
      locale: "de",
    });
  });

  it("names no language for the default one, or a document kept in one", () => {
    editing("en", { isDefault: true });
    expect(renderHook(() => useCopySource("content")).result.current).toEqual({
      collection: "pages",
      id: "page-1",
      field: "content",
    });
    editing("de", { localized: false });
    expect(
      renderHook(() => useCopySource("content")).result.current
    ).not.toHaveProperty("locale");
    language.mockReturnValue(null);
    expect(
      renderHook(() => useCopySource("content")).result.current
    ).not.toHaveProperty("locale");
  });

  it("names nothing for a document not stored yet", () => {
    identity.mockReturnValue({ kind: "collection", slug: "pages" } as never);
    editing("de");
    expect(renderHook(() => useCopySource("content")).result.current).toBe(
      undefined
    );
  });
});
