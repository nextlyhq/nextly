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
vi.mock("@admin/hooks/queries/useSingles", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEverySingle: () => ({
    data: [
      {
        // Named like the collection above, whose entries open in the builder:
        // the Single is read for itself, an email first, so a form.
        slug: "notes",
        fields: [
          { name: "email", type: "email" },
          { name: "extras", type: "blocks" },
        ],
      },
      {
        slug: "homepage",
        fields: [
          { name: "title", type: "text" },
          { name: "layout", type: "blocks" },
        ],
      },
    ],
  }),
}));
/** What the reader may do, by the access asked; every access unless a test says otherwise. */
const access = vi.hoisted(() => ({
  refused: new Set<string>(),
  asked: [] as string[],
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    canAccessCollection: (slug: string, asked: string) => {
      access.asked.push(`${slug}:${asked}`);
      return !access.refused.has(asked);
    },
  }),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({
    plugins: [
      {
        name: "@acme/builder",
        documentViews: [
          {
            fieldType: "blocks",
            path: "builder",
            component: "@acme/x#View",
            opensFirst: "mainField",
          },
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

describe("useDocumentAddress on a Single", () => {
  const HOMEPAGE = { kind: "single", slug: "homepage" } as const;

  it("opens a Single where the rule says, from the admin's list of Singles", () => {
    const { result } = renderHook(() => useDocumentAddress());
    expect(result.current(HOMEPAGE)).toBe(
      "/admin/singles/homepage/builder?field=layout"
    );
  });

  it("asks whether the reader may update the Single's default language", () => {
    access.asked = [];
    access.refused = new Set(["updateInDefaultLanguage"]);
    const { result } = renderHook(() => useDocumentAddress());
    expect(result.current(HOMEPAGE)).toBe("/admin/singles/homepage");
    expect(access.asked).toContain("homepage:updateInDefaultLanguage");
    access.refused = new Set();
  });

  it("reads the Single, not a collection sharing its slug", () => {
    const { result } = renderHook(() => useDocumentAddress());
    expect(result.current({ kind: "single", slug: "notes" })).toBe(
      "/admin/singles/notes"
    );
  });

  it("reads a Single the caller holds before the admin's list", () => {
    const { result } = renderHook(() => useDocumentAddress());
    expect(
      result.current(
        { kind: "single", slug: "notes" },
        {
          collection: {
            fields: [{ name: "layout", type: "blocks" }],
          },
        }
      )
    ).toBe("/admin/singles/notes/builder?field=layout");
  });
});
