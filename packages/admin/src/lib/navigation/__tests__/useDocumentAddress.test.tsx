/**
 * The rule as the signed-in admin reads it: the published views, each
 * collection as the admin lists it, whether the reader may update it, and the
 * site's default language, kept on a site with only one language too.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDocumentAddress } from "../useDocumentAddress";

const localization = vi.hoisted(() => ({
  value: { enabled: false, locales: [{ code: "en" }], defaultLocale: "en" },
}));

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => localization.value,
}));
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useEveryNavCollection: () => ({
    data: [
      {
        name: "notes",
        fields: [
          { name: "title", type: "text" },
          { name: "excerpt", type: "textarea" },
          { name: "sections", type: "blocks" },
        ],
        admin: { opensIn: "builder" },
      },
    ],
  }),
}));
/** What the reader may do, by the access asked; every access unless a test says otherwise. */
const access = vi.hoisted(() => ({ refused: new Set<string>() }));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    canAccessCollection: (_slug: string, asked: string) =>
      !access.refused.has(asked),
  }),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({
    plugins: [
      {
        name: "@acme/builder",
        documentViews: [
          { fieldType: "blocks", path: "builder", component: "@acme/x#View" },
        ],
      },
    ],
  }),
}));

const NOTE = { kind: "collection", slug: "notes", id: "n1" } as const;
const BUILDER = "/admin/collections/notes/n1/builder?field=sections";

describe("useDocumentAddress", () => {
  it("asks whether the reader may update the default language, which a view edits", () => {
    // On a screen in another language, `update` answers for that language; a
    // reader who may change Spanish but not the default language gets the
    // form, read-only.
    access.refused = new Set(["updateInDefaultLanguage"]);
    const { result } = renderHook(() => useDocumentAddress());
    expect(result.current(NOTE)).toBe("/admin/collections/notes/n1");
    access.refused = new Set(["update"]);
    const { result: other } = renderHook(() => useDocumentAddress());
    expect(other.current(NOTE)).toBe(BUILDER);
    access.refused = new Set();
  });

  it("opens a collection's entry where it says, from the admin's list of collections", () => {
    const { result } = renderHook(() => useDocumentAddress());
    expect(result.current(NOTE)).toBe(BUILDER);
  });

  it("treats the default language as the default on a site with only one", () => {
    // One language: not multilingual, but the language a saved row names is
    // still the default, so it opens where the rule says.
    const { result } = renderHook(() => useDocumentAddress());
    expect(result.current(NOTE, { locale: "en" })).toBe(BUILDER);
  });

  it("opens the form in another language on a site with several", () => {
    localization.value = {
      enabled: true,
      locales: [{ code: "en" }, { code: "es" }],
      defaultLocale: "en",
    };
    const { result } = renderHook(() => useDocumentAddress());
    expect(result.current(NOTE, { locale: "es" })).toBe(
      "/admin/collections/notes/n1?locale=es"
    );
  });
});
