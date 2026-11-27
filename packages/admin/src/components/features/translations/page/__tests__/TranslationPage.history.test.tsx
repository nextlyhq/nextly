/**
 * History on the translation page: its button beside the language's actions, a
 * version in place of the live text, and a restore into the page's own form,
 * which its own save then sends. Only the requests and the person's rights are
 * replaced.
 *
 * The plausible broken pages: one whose restore is not the form's, so a save
 * names no version; one that puts back a shared value, or the built-in title
 * and slug, which the page never writes; one that offers the page's own actions
 * over a past version; and one that offers history where none is kept.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { answerMediaQueries } from "@admin/__tests__/helpers/media-query";
import { renderHook, renderWithProviders } from "@admin/__tests__/utils";
import { useHistoryAddress } from "@admin/components/features/versions/history-address";
// Loaded with this file, so the panel's own deferred load is answered at once.
import "@admin/components/features/versions/VersionHistorySheet";
import type { VersionDetail, VersionMeta } from "@admin/services/versionApi";

import { TranslationPage } from "../TranslationPage";

const api = vi.hoisted(() => ({
  findByID: vi.fn(),
  update: vi.fn(),
}));
const reads = vi.hoisted(() => ({
  list: vi.fn(),
  events: vi.fn(),
  get: vi.fn(),
  diff: vi.fn(),
  markSeen: vi.fn(),
}));
const schema = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const reader = vi.hoisted(() => ({
  update: "allowed" as "allowed" | "refused",
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
vi.mock("@admin/services/versionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/versionApi")>();
  return { ...actual, versionApi: { ...actual.versionApi, ...reads } };
});
vi.mock("@admin/hooks/queries/useCollections", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useCollections")
  >()),
  useCollectionSchema: () => ({
    data: schema.value,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => true,
}));
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => reader.update,
}));
// No workflow holds the document.
vi.mock("@admin/hooks/queries/useReviewState", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useReviewState")
  >()),
  useReviewState: () => ({ data: { attached: false } }),
}));
vi.mock("@admin/hooks/queries/useDocumentLockHolder", () => ({
  useDocumentLockHolder: () => null,
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "me",
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [], locales: LOCALES }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
    retry: vi.fn(),
  }),
}));

const LOCALES = vi.hoisted(() => ({
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "es", label: "Spanish", rtl: false, fallbackLocale: ["en"] },
  ],
}));

/** A collection with no title of its own, as its read describes it. */
const COLLECTION = {
  name: "authors",
  label: "Authors",
  localized: true,
  status: true,
  draftsEnabled: true,
  workflow: null,
  versions: { enabled: true, maxPerDoc: 50 },
  fields: [
    { name: "title", type: "text", label: "Title", localized: false },
    { name: "slug", type: "text", label: "Slug", localized: false },
    { name: "bio", type: "textarea", label: "Biography" },
    { name: "rank", type: "number", label: "Rank" },
  ],
};

const ENTRY = { kind: "collection", slug: "authors", id: "a1" } as const;
const PAGE = "/admin/translations/collections/authors/a1?locale=es";
const SCOPE = { kind: "collection", slug: "authors", entryId: "a1" };

type Read = { everyLanguage?: boolean };

function answer(read: Read): Record<string, unknown> {
  const row = {
    id: "a1",
    title: "Grace Hopper",
    slug: "grace-hopper",
    status: "published",
    bio: "Ahora",
    rank: 10,
    _rev: "7.es:3",
  };
  return read.everyLanguage
    ? { ...row, _allLocales: { bio: { en: "Now", es: "Ahora" } } }
    : {
        ...row,
        _translations: {
          en: { translated: true, status: "published" },
          es: { translated: true, status: "draft" },
        },
      };
}

function meta(versionNo: number): VersionMeta {
  const at = `2026-03-0${versionNo}T10:00:00.000Z`;
  return {
    id: `v${versionNo}`,
    versionNo,
    status: "draft",
    isAutosave: false,
    label: null,
    locale: "es",
    sourceVersionNo: null,
    createdBy: "u1",
    author: { id: "u1", name: "Ada" },
    createdAt: at,
    updatedAt: at,
  };
}

/** A version in which every field was otherwise. */
const VERSION: VersionDetail = {
  ...meta(1),
  snapshot: { title: "Was", slug: "was", bio: "Antes", rank: 5 },
  withheld: [],
};

const render = () => renderWithProviders(<TranslationPage document={ENTRY} />);
const actions = async () =>
  within(await screen.findByRole("group", { name: "Spanish actions" }));
const bio = () =>
  within(screen.getByRole("group", { name: "Biography" })).getByRole("textbox");

/** The page with history open on the version, as a link to it opens it. */
async function readingVersion(): Promise<void> {
  window.history.replaceState(null, "", `${PAGE}&history=1&version=1`);
  render();
  await waitFor(() => expect(reads.get).toHaveBeenCalledWith(SCOPE, 1));
}

/** Opens the restore list from the version's own actions. */
async function openRestore() {
  const restore = await (
    await actions()
  ).findByRole("button", { name: "Restore…" });
  await waitFor(() => expect(restore).toBeEnabled());
  await userEvent.click(restore);
  return within(await screen.findByRole("alertdialog"));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", PAGE);
  // Read closed once, so no test steps back off an entry an earlier one added.
  renderHook(() => useHistoryAddress()).unmount();
  for (const method of ["pushState", "replaceState"] as const) {
    const move = window.history[method].bind(window.history);
    vi.spyOn(window.history, method).mockImplementation(
      (data: unknown, unused: string, url?: string | URL | null) => {
        move(data, unused, url);
        queueMicrotask(() => window.dispatchEvent(new Event("locationchange")));
      }
    );
  }
  // Wide enough for the panel to stand beside the page.
  answerMediaQueries(true);
  schema.value = COLLECTION;
  reader.update = "allowed";
  api.findByID.mockImplementation((_s: string, _i: string, read: Read) =>
    Promise.resolve(answer(read))
  );
  api.update.mockResolvedValue({ item: { ...answer({}), bio: "Antes" } });
  reads.list.mockResolvedValue({ items: [meta(1)], meta: { hasNext: false } });
  reads.events.mockResolvedValue({ items: [], meta: { hasNext: false } });
  reads.get.mockResolvedValue(VERSION);
  reads.diff.mockResolvedValue({
    from: 1,
    to: 1,
    locale: "es",
    hasChanges: false,
    fields: [],
  });
  reads.markSeen.mockResolvedValue({ message: "Marked as seen.", item: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("history on the translation page", () => {
  it("stands beside the language's actions, and opens by the address", async () => {
    render();
    const history = (await actions()).getByRole("button", { name: "History" });
    expect(
      (await actions()).getByRole("button", { name: "Publish Spanish" })
    ).toBeInTheDocument();

    await userEvent.click(history);

    expect(
      await screen.findByRole("heading", { name: "History" })
    ).toBeInTheDocument();
    const query = new URLSearchParams(window.location.search);
    expect(query.get("history")).toBe("1");
    // The language the page writes stays in the address.
    expect(query.get("locale")).toBe("es");
  });

  it("is not offered where no versions are kept", async () => {
    schema.value = { ...COLLECTION, versions: null };
    render();

    expect(
      (await actions()).getByRole("button", { name: "Publish Spanish" })
    ).toBeInTheDocument();
    expect(
      (await actions()).queryByRole("button", { name: "History" })
    ).toBeNull();
  });

  it("opens over unsaved work without asking to leave it, and keeps it", async () => {
    render();
    await actions();
    await userEvent.type(bio(), "!");
    await userEvent.click(
      (await actions()).getByRole("button", { name: "History" })
    );

    expect(
      await screen.findByRole("heading", { name: "History" })
    ).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("history")).toBe(
      "1"
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(bio()).toHaveValue("Ahora!");
  });

  it("restores from history opened by its button, and closing it asks nothing of the restored text", async () => {
    render();
    await userEvent.click(
      (await actions()).getByRole("button", { name: "History" })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Version 1\b/ })
    );
    const dialog = await openRestore();
    await userEvent.click(
      dialog.getByRole("button", { name: "Restore 1 field" })
    );

    // Closing steps back off the entry opening added, which the form is now
    // unsaved on.
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).has("history")).toBe(
        false
      )
    );
    await waitFor(() => expect(bio()).toHaveValue("Antes"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.update).not.toHaveBeenCalled();
  });

  it("puts the version's actions in place of the page's, which act on the live text", async () => {
    await readingVersion();

    expect(
      await (await actions()).findByRole("button", { name: "Restore…" })
    ).toBeInTheDocument();
    expect(
      (await actions()).queryByRole("button", { name: "Publish Spanish" })
    ).toBeNull();
    expect(
      (await actions()).queryByRole("button", { name: /^Save/ })
    ).toBeNull();
  });

  it("restores the language's text into the page, sends nothing, and names the version when it is saved", async () => {
    await readingVersion();
    const dialog = await openRestore();

    await userEvent.click(
      dialog.getByRole("button", { name: "Restore 1 field" })
    );
    await waitFor(() => expect(bio()).toHaveValue("Antes"));
    expect(api.update).not.toHaveBeenCalled();

    await userEvent.click(
      (await actions()).getByRole("button", { name: "Save draft" })
    );
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const payload = api.update.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload).toMatchObject({ bio: "Antes", _restoredFrom: { bio: 1 } });
    for (const shared of ["title", "slug", "rank"]) {
      expect(payload).not.toHaveProperty(shared);
    }
  });

  it("lists a shared field, and the built-in title and slug, and puts back none of them", async () => {
    await readingVersion();
    const dialog = await openRestore();

    expect(dialog.getByRole("checkbox", { name: "Biography" })).toBeChecked();
    for (const name of ["Title", "Slug", "Rank"]) {
      const box = dialog.getByRole("checkbox", { name });
      expect(box).toBeDisabled();
      expect(box).not.toBeChecked();
    }
    expect(
      dialog.getByRole("button", { name: "Restore 1 field" })
    ).toBeEnabled();
  });

  it("offers no restore to a reader who may not write, who may still read the version", async () => {
    reader.update = "refused";
    await readingVersion();

    expect(
      await (await actions()).findByRole("button", { name: "Back to current" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Restore/ })).toBeNull();
  });
});
