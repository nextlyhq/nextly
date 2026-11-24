/**
 * The page over its own reads and its own save: only the requests and the
 * reader's permissions are replaced, so what it asks for, what it draws of the
 * answers and what it sends are the code's own.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";
import { parseApiError } from "@admin/lib/api/parseApiError";

import { TranslationPage } from "../TranslationPage";

const api = vi.hoisted(() => ({
  findByID: vi.fn(),
  update: vi.fn(),
  getDocument: vi.fn(),
  updateDocument: vi.fn(),
}));
const schemas = vi.hoisted(() => ({
  collection: undefined as unknown,
  single: undefined as unknown,
}));
const reader = vi.hoisted(() => ({
  update: "allowed" as "allowed" | "refused" | "unknown",
  readsTranslations: true,
}));
const branding = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  status: { isPending: false, isUnavailable: false },
  retry: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      findByID: api.findByID,
      update: api.update,
    },
  };
});
vi.mock("@admin/services/singleApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/singleApi")>();
  return {
    ...actual,
    singleApi: {
      ...actual.singleApi,
      getDocument: api.getDocument,
      updateDocument: api.updateDocument,
    },
  };
});
vi.mock("@admin/hooks/queries/useCollections", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useCollections")
  >()),
  useCollectionSchema: (slug: string | undefined) => ({
    data: slug === undefined ? undefined : schemas.collection,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@admin/hooks/queries/useSingles", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries/useSingles")>()),
  useSingleSchema: (slug: string | undefined) => ({
    data: slug === undefined ? undefined : schemas.single,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => reader.readsTranslations,
}));
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => reader.update,
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => false }));
vi.mock("@admin/hooks/queries/useDocumentLockHolder", () => ({
  useDocumentLockHolder: () => null,
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "me",
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding.value,
  useBrandingStatus: () => ({
    ...branding.status,
    isBrandingUnavailable: false,
    retry: branding.retry,
  }),
}));
vi.mock("@admin/components/ui/toaster", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui/toaster")>()),
  toast,
}));

const LOCALES = {
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "es", label: "Spanish", rtl: false, fallbackLocale: ["en"] },
    { code: "fr", label: "French", rtl: false, fallbackLocale: ["en"] },
  ],
};

const COLLECTION = {
  name: "authors",
  label: "Authors",
  localized: true,
  status: true,
  draftsEnabled: true,
  admin: { useAsTitle: "name" },
  fields: [
    { name: "name", type: "text", label: "Name", localized: false },
    { name: "bio", type: "textarea", label: "Biography", required: true },
    { name: "jobTitle", type: "text", label: "Role / Title" },
    { name: "articleCount", type: "number", label: "Article count" },
    { name: "secret", type: "text", label: "Secret" },
  ],
};

const PUBLISHED = { translated: true, status: "published" };

/** The document as its language stands, with what the reader may read. */
const WRITTEN = {
  id: "a1",
  name: "Grace Hopper",
  articleCount: 4,
  status: "published",
  bio: "Una pionera",
  jobTitle: null,
  _rev: "7.es:3",
  _translations: {
    en: PUBLISHED,
    es: {
      ...PUBLISHED,
      fields: { bio: { origin: "person", outOfDate: true } },
    },
    fr: PUBLISHED,
  },
};
/** The document as served, with every language's values. */
const LIVE = {
  ...WRITTEN,
  _translations: undefined,
  _allLocales: {
    bio: { en: "A pioneer", es: "Una pionera", fr: "Une pionnière" },
    // Nothing published to translate from.
    jobTitle: { en: null, es: null, fr: null },
  },
};

const ENTRY = { kind: "collection", slug: "authors", id: "a1" } as const;

const go = (
  search: string,
  path = "/admin/translations/collections/authors/a1"
) => window.history.replaceState(null, "", `${path}${search}`);
const here = () => `${window.location.pathname}${window.location.search}`;

const field = (name: string) => screen.findByRole("group", { name });
const bio = async () =>
  within(await field("Biography")).getByRole("textbox", { name: "Biography" });
const saveButton = () => screen.getByRole("button", { name: "Save Spanish" });

type Read = { everyLanguage?: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  go("?locale=es");
  branding.value = { plugins: [], locales: LOCALES };
  branding.status = { isPending: false, isUnavailable: false };
  reader.update = "allowed";
  reader.readsTranslations = true;
  schemas.collection = COLLECTION;
  schemas.single = undefined;
  api.findByID.mockImplementation((_slug: string, _id: string, read: Read) =>
    Promise.resolve(read.everyLanguage ? LIVE : WRITTEN)
  );
  api.update.mockImplementation(
    (_slug: string, _id: string, payload: Record<string, unknown>) =>
      Promise.resolve({ item: { ...WRITTEN, ...payload, _rev: "7.es:4" } })
  );
});

describe("what the page reads", () => {
  it("reads the language with its held draft, and the sources without one", async () => {
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await field("Biography");
    const reads = api.findByID.mock.calls.map(call => call[2] as object);
    expect(reads).toHaveLength(2);
    expect(reads).toContainEqual({
      locale: "es",
      draft: true,
      translationStatus: true,
      fallbackLocale: "none",
      depth: 0,
    });
    expect(reads).toContainEqual({
      locale: "es",
      draft: false,
      everyLanguage: true,
      fallbackLocale: "none",
      depth: 0,
    });
  });

  it("asks no standings of a reader the server does not let read them", async () => {
    reader.readsTranslations = false;
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await field("Biography");
    for (const [, , read] of api.findByID.mock.calls as [
      string,
      string,
      { translationStatus?: boolean },
    ][]) {
      expect(read.translationStatus ?? false).toBe(false);
    }
  });

  it("reads a Single by its slug, and calls it by its own name", async () => {
    go("?locale=es", "/admin/translations/singles/banner");
    schemas.single = {
      slug: "banner",
      label: "Banner",
      localized: true,
      status: true,
      draftsEnabled: false,
      fields: [{ name: "headline", type: "text", label: "Headline" }],
    };
    api.getDocument.mockImplementation((_slug: string, read: Read) =>
      Promise.resolve(
        read.everyLanguage
          ? {
              id: "s1",
              status: "published",
              _allLocales: { headline: { en: "Welcome", es: null } },
            }
          : {
              id: "s1",
              status: "published",
              headline: null,
              _rev: "1.es:0",
              _translations: { en: PUBLISHED },
            }
      )
    );
    renderWithProviders(
      <TranslationPage document={{ kind: "single", slug: "banner" }} />
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Banner" })
    ).toBeInTheDocument();
    expect(
      within(await field("Headline")).getByText("Welcome")
    ).toBeInTheDocument();
    expect(api.findByID).not.toHaveBeenCalled();
  });
});

describe("what the page shows", () => {
  it("sets each field beside its source, under the entry's title", async () => {
    renderWithProviders(<TranslationPage document={ENTRY} />);
    const row = await field("Biography");
    expect(within(row).getByText("A pioneer")).toBeInTheDocument();
    expect(await bio()).toHaveValue("Una pionera");
    expect(
      screen.getByRole("heading", { level: 1, name: "Grace Hopper" })
    ).toBeInTheDocument();
    expect(screen.getByText("Spanish translation")).toBeInTheDocument();
  });

  it("marks a field whose source changed since, and no other", async () => {
    renderWithProviders(<TranslationPage document={ENTRY} />);
    expect(
      within(await field("Biography")).getByText("Out of date")
    ).toBeInTheDocument();
    expect(
      within(await field("Role / Title")).queryByText("Out of date")
    ).not.toBeInTheDocument();
  });

  it("writes a field with no source as original, beside one that has one", async () => {
    renderWithProviders(<TranslationPage document={ENTRY} />);
    expect(
      within(await field("Role / Title")).getByText(
        /written here as original Spanish/
      )
    ).toBeInTheDocument();
    expect(
      within(await field("Biography")).queryByText(/as original Spanish/)
    ).not.toBeInTheDocument();
  });

  it("names the shared fields without offering them, and no field withheld", async () => {
    renderWithProviders(<TranslationPage document={ENTRY} />);
    const shared = await screen.findByRole("region", { name: "Shared fields" });
    expect(
      within(shared)
        .getAllByRole("listitem")
        .map(item => item.textContent)
    ).toEqual(["Name", "Article count"]);
    expect(within(shared).queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
  });

  it("starts from the source the address asks for", async () => {
    go("?locale=es&source=fr");
    renderWithProviders(<TranslationPage document={ENTRY} />);
    expect(
      within(await field("Biography")).getByText("Une pionnière")
    ).toBeInTheDocument();
  });

  it("changes one field's source and leaves what was written", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TranslationPage document={ENTRY} />);
    const row = await field("Biography");
    await user.type(await bio(), " de la informática");
    await user.click(
      within(row).getByRole("combobox", {
        name: "Source language for Biography",
      })
    );
    await user.click(screen.getByRole("option", { name: "French" }));
    expect(within(row).getByText("Une pionnière")).toBeInTheDocument();
    expect(await bio()).toHaveValue("Una pionera de la informática");
  });
});

describe("what a save sends", () => {
  it("sends the changed field alone, in the language, from the version read", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await user.clear(await bio());
    await user.type(await bio(), "Una precursora");
    await user.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    const [slug, id, payload, options] = api.update.mock.calls[0] as [
      string,
      string,
      object,
      { locale: string },
    ];
    expect([slug, id, options.locale]).toEqual(["authors", "a1", "es"]);
    // No status, no shared field, no unchanged field, no claim.
    expect(payload).toEqual({ bio: "Una precursora", _rev: "7.es:3" });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Spanish saved")
    );
  });

  it.each([
    ["keeps drafts", true],
    ["keeps none", false],
  ])(
    "names no status for a published language of a collection that %s",
    async (_what, draftsEnabled) => {
      const user = userEvent.setup();
      schemas.collection = { ...COLLECTION, draftsEnabled };
      renderWithProviders(<TranslationPage document={ENTRY} />);
      await user.type(await bio(), "!");
      await user.click(saveButton());
      await waitFor(() => expect(api.update).toHaveBeenCalledOnce());
      // The body's own keys: an equality would pass over a status of
      // undefined, which is a status named all the same.
      const payload = api.update.mock.calls[0]?.[2] as object;
      expect(Object.keys(payload).sort()).toEqual(["_rev", "bio"]);
    }
  );

  it("claims a field written with no source as original", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await user.type(
      within(await field("Role / Title")).getByRole("textbox"),
      "Almirante"
    );
    await user.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    expect(api.update.mock.calls[0]?.[2]).toEqual({
      jobTitle: "Almirante",
      _provenance: { jobTitle: { origin: "original" } },
      _rev: "7.es:3",
    });
  });

  it("saves again from the version the save stored", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await user.type(await bio(), "!");
    await user.click(saveButton());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    // The reads after the save answer what it stored.
    api.findByID.mockImplementation((_s: string, _i: string, read: Read) =>
      Promise.resolve({
        ...(read.everyLanguage ? LIVE : WRITTEN),
        bio: "Una pionera!",
        _rev: "7.es:4",
      })
    );
    await user.type(await bio(), "!");
    await user.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
    expect(api.update.mock.calls[1]?.[2]).toMatchObject({ _rev: "7.es:4" });
  });

  it("lets a required field stay empty in a language other than the default", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await user.clear(await bio());
    await user.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    expect(api.update.mock.calls[0]?.[2]).toMatchObject({ bio: null });
  });

  it("sends nothing until something changed", async () => {
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await field("Biography");
    expect(saveButton()).toBeDisabled();
  });

  it("puts a refusal of one field on that field", async () => {
    const user = userEvent.setup();
    api.update.mockRejectedValue(
      parseApiError(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed.",
            data: {
              errors: [
                {
                  path: "bio",
                  code: "TOO_LONG",
                  message: "Too long for a bio.",
                },
              ],
            },
          },
        },
        400
      )
    );
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await user.type(await bio(), "!");
    await user.click(saveButton());
    expect(
      await within(await field("Biography")).findByText("Too long for a bio.")
    ).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    // The words are still there, and still unsaved.
    expect(await bio()).toHaveValue("Una pionera!");
    expect(saveButton()).toBeEnabled();
  });

  it("asks before saving over a change made since it was read", async () => {
    const user = userEvent.setup();
    api.update.mockRejectedValueOnce(
      parseApiError(
        {
          error: {
            code: "STALE_VERSION",
            message: "The document changed.",
            data: { currentVersion: "8.es:3" },
          },
        },
        409
      )
    );
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await user.type(await bio(), "!");
    await user.click(saveButton());
    expect(
      await screen.findByRole("alertdialog", {
        name: "This document changed since you started editing",
      })
    ).toBeInTheDocument();
    expect(api.update).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("who may write", () => {
  it("is told plainly, and offered no save, where the reader may only look", async () => {
    reader.update = "refused";
    renderWithProviders(<TranslationPage document={ENTRY} />);
    const textarea = await bio();
    expect(
      screen.getByText(/Your access lets you view this, but not change it/)
    ).toBeInTheDocument();
    expect(textarea).toHaveAttribute("readonly");
    expect(
      screen.queryByRole("button", { name: "Save Spanish" })
    ).not.toBeInTheDocument();
  });

  it("shows no such notice to a reader who may write", async () => {
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await field("Biography");
    expect(
      screen.queryByText(/Your access lets you view this/)
    ).not.toBeInTheDocument();
  });
});

describe("where the page is offered", () => {
  const EDITOR = "/admin/collections/authors/a1";

  it.each([
    ["the default language", "?locale=en"],
    ["a language the site does not have", "?locale=xx"],
    ["no language", ""],
  ])("goes to the editor for %s", async (_what, search) => {
    go(search);
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await waitFor(() => expect(here()).toBe(EDITOR));
    expect(api.findByID).not.toHaveBeenCalled();
  });

  it("goes to the editor on a site with one language", async () => {
    branding.value = {
      plugins: [],
      locales: { ...LOCALES, locales: LOCALES.locales.slice(0, 1) },
    };
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await waitFor(() => expect(here()).toBe(EDITOR));
  });

  it("goes to the editor for a document with one text for every language", async () => {
    schemas.collection = { ...COLLECTION, localized: false };
    renderWithProviders(<TranslationPage document={ENTRY} />);
    await waitFor(() => expect(here()).toBe(EDITOR));
    expect(api.findByID).not.toHaveBeenCalled();
  });

  it("waits for the site's languages before sending anyone away", () => {
    branding.value = {};
    branding.status = { isPending: true, isUnavailable: false };
    renderWithProviders(<TranslationPage document={ENTRY} />);
    expect(
      screen.getByRole("status", { name: "Loading the translation" })
    ).toBeInTheDocument();
    expect(here()).toBe("/admin/translations/collections/authors/a1?locale=es");
  });

  it("says when the languages never arrived, and asks again", async () => {
    const user = userEvent.setup();
    branding.value = {};
    branding.status = { isPending: false, isUnavailable: true };
    renderWithProviders(<TranslationPage document={ENTRY} />);
    expect(
      screen.getByText("The site's languages couldn't be loaded.")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(branding.retry).toHaveBeenCalledOnce();
    expect(here()).toBe("/admin/translations/collections/authors/a1?locale=es");
  });

  it("says why a document could not be read, in the server's words", async () => {
    api.findByID.mockRejectedValue(
      parseApiError(
        { error: { code: "NOT_FOUND", message: "Not found." } },
        404
      )
    );
    renderWithProviders(<TranslationPage document={ENTRY} />);
    expect(await screen.findByText("Not found.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open in editor" })
    ).toHaveAttribute("href", EDITOR);
  });
});
