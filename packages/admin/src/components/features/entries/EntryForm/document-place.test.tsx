/**
 * A past version of a page is drawn as it was stored, less any field a
 * plugin's switch keeps off the page's type now.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const branding = vi.hoisted(() => ({
  value: { withheldFields: { "collection:authors": ["seo"] } } as Record<
    string,
    unknown
  >,
}));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => branding.value,
}));

import { useWithoutWithheldFields, type DocumentPlace } from "./document-place";

const place = (collection: string): DocumentPlace =>
  ({
    place: "collection.edit",
    context: { collection, entryId: "1" },
  }) as unknown as DocumentPlace;

const fields = [{ name: "title" }, { name: "seo" }, { name: "body" }];

describe("useWithoutWithheldFields", () => {
  it("leaves out of a past version the fields withheld on its type", () => {
    const { result } = renderHook(() =>
      useWithoutWithheldFields(place("authors").context, fields)
    );
    expect(result.current?.map(field => field.name)).toEqual(["title", "body"]);
  });

  it("keeps every field on a type with none withheld, and nothing viewed as nothing", () => {
    expect(
      renderHook(() => useWithoutWithheldFields(place("posts").context, fields))
        .result.current
    ).toEqual(fields);
    expect(
      renderHook(() => useWithoutWithheldFields(place("authors").context, null))
        .result.current
    ).toBeNull();
  });
});
