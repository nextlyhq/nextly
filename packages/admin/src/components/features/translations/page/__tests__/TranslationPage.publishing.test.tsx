/**
 * Publishing one language from its page, taking it offline, leaving with
 * unsaved work, and someone else having the document: only the requests, the
 * reader's rights and who holds the document are replaced.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";
import { parseApiError } from "@admin/lib/api/parseApiError";
import type {
  PartsLanguageOutcome,
  PublishPartsChoice,
  PublishPartsResult,
} from "@admin/services/publishParts";

import { TranslationPage } from "../TranslationPage";

const api = vi.hoisted(() => ({
  findByID: vi.fn(),
  update: vi.fn(),
  publishParts: vi.fn(),
  takeLive: vi.fn(),
}));
const schema = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const reader = vi.hoisted(() => ({
  update: "allowed" as "allowed" | "refused",
  readsTranslations: true,
  can: new Set<string>(),
}));
const lock = vi.hoisted(() => ({
  holder: null as { ownerId: string; ownerLabel: string | null } | null,
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
      publishParts: api.publishParts,
    },
  };
});
vi.mock("@admin/services/versionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/versionApi")>();
  return {
    ...actual,
    versionApi: { ...actual.versionApi, takeLiveSharedValues: api.takeLive },
  };
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
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (permission: string) => reader.can.has(permission),
}));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => reader.readsTranslations,
}));
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => reader.update,
}));
vi.mock("@admin/hooks/queries/useDocumentLockHolder", () => ({
  useDocumentLockHolder: () => lock.holder,
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
vi.mock("@admin/components/ui/toaster", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui/toaster")>()),
  toast,
}));

const LOCALES = vi.hoisted(() => ({
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "es", label: "Spanish", rtl: false, fallbackLocale: ["en"] },
  ],
}));

const COLLECTION = {
  name: "authors",
  label: "Authors",
  localized: true,
  status: true,
  draftsEnabled: true,
  admin: { useAsTitle: "name" },
  fields: [
    { name: "name", type: "text", label: "Name", localized: false },
    { name: "bio", type: "textarea", label: "Biography" },
    { name: "jobTitle", type: "text", label: "Role" },
  ],
};

const PUBLISHED = { translated: true, status: "published" };
const DRAFT = { translated: true, status: "draft" };

/** What the server holds, changed by a test before it renders. */
let stored: {
  bio: string;
  rev: string;
  es: Record<string, unknown>;
  status: string;
};
/** What a publish of Spanish would do, and what its shared fields do. */
let outcome: Omit<PartsLanguageOutcome, "locale">;
let shared: PublishPartsResult["shared"];

const ENTRY = { kind: "collection", slug: "authors", id: "a1" } as const;
const ADDRESS = "/admin/translations/collections/authors/a1?locale=es";

type Read = { everyLanguage?: boolean; locale?: string };

function answer(read: Read): Record<string, unknown> {
  const row = {
    id: "a1",
    name: "Grace Hopper",
    status: stored.status,
    bio: stored.bio,
    jobTitle: null,
    _rev: stored.rev,
  };
  return read.everyLanguage
    ? {
        ...row,
        _allLocales: {
          bio: { en: "A pioneer", es: stored.bio },
          jobTitle: { en: "Admiral", es: null },
        },
      }
    : { ...row, _translations: { en: PUBLISHED, es: stored.es } };
}

/** The calls to the publish routes, each with its direction. */
const moves = () =>
  (
    api.publishParts.mock.calls as [
      string,
      string,
      string,
      PublishPartsChoice,
    ][]
  ).map(([slug, id, direction, choice]) => ({
    slug,
    id,
    direction,
    ...choice,
  }));
const sent = () => moves().filter(move => move.describe !== true);

const render = () => renderWithProviders(<TranslationPage document={ENTRY} />);
const bio = async () =>
  within(await screen.findByRole("group", { name: "Biography" })).getByRole(
    "textbox"
  );
const publishButton = () =>
  screen.getByRole("button", { name: "Publish Spanish" });

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", ADDRESS);
  schema.value = COLLECTION;
  reader.update = "allowed";
  reader.readsTranslations = true;
  reader.can = new Set(["publish-authors", "unpublish-authors"]);
  lock.holder = null;
  stored = {
    bio: "Una pionera",
    rev: "7.es:3",
    es: DRAFT,
    status: "published",
  };
  outcome = { outcome: "goes-live" } as typeof outcome;
  shared = { changes: false, added: false };
  api.findByID.mockImplementation((_s: string, _i: string, read: Read) =>
    Promise.resolve(answer(read))
  );
  api.update.mockImplementation(
    (_s: string, _i: string, payload: Record<string, unknown>) => {
      stored = { ...stored, rev: "7.es:4", bio: String(payload.bio) };
      return Promise.resolve({ item: answer({}) });
    }
  );
  api.publishParts.mockImplementation(
    (_s: string, _i: string, direction: string, choice: PublishPartsChoice) => {
      if (choice.describe !== true) {
        stored = {
          ...stored,
          rev: "8.es:5",
          es: direction === "publish" ? PUBLISHED : DRAFT,
        };
      }
      return Promise.resolve({
        id: "a1",
        languages: [{ locale: "es", ...outcome }],
        shared,
      });
    }
  );
});

/** Press Publish and wait for what it does to be described. */
async function openPublish(user: ReturnType<typeof userEvent.setup>) {
  await bio();
  await user.click(publishButton());
  const dialog = await screen.findByRole("dialog", {
    name: "Publish Spanish?",
  });
  await waitFor(() =>
    expect(within(dialog).queryByText(/Checking what/)).not.toBeInTheDocument()
  );
  return dialog;
}

describe("publishing the language", () => {
  it("says first what its readers will see, the empty fields' stand-ins among it", async () => {
    const user = userEvent.setup();
    render();
    const dialog = await openPublish(user);
    expect(
      within(dialog).getByText("Spanish readers will see this translation.")
    ).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map(item => item.textContent)
    ).toEqual(["Role: English is shown"]);
    expect(
      within(dialog).queryByText(/shared fields aren't published/)
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(/marked published/)
    ).not.toBeInTheDocument();
    // Described and not done.
    expect(moves()).toHaveLength(1);
    expect(moves()[0]).toMatchObject({
      direction: "publish",
      locales: ["es"],
      describe: true,
    });
  });

  it("publishes that language alone, and says what stayed as it was", async () => {
    const user = userEvent.setup();
    render();
    const dialog = await openPublish(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Publish Spanish" })
    );
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toMatchObject({
      slug: "authors",
      id: "a1",
      direction: "publish",
      locales: ["es"],
      version: "7.es:3",
    });
    expect(sent()[0]?.shared).toBeUndefined();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Spanish is published. English and the shared fields are unchanged."
      )
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("says before and after that the shared fields, and English, go live with it", async () => {
    const user = userEvent.setup();
    stored.status = "draft";
    shared = { changes: true, added: true };
    render();
    const dialog = await openPublish(user);
    expect(
      within(dialog).getByText(
        "The shared fields aren't published yet. They go live with Spanish."
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "English is already marked published, so it goes live too."
      )
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Publish Spanish" })
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Spanish is published, and the shared fields went live with it. So did English."
      )
    );
  });

  it("publishes a language marked published in a document that is not", async () => {
    const user = userEvent.setup();
    stored.status = "draft";
    stored.es = PUBLISHED;
    outcome = { outcome: "stays-published" } as typeof outcome;
    shared = { changes: true, added: true };
    render();
    const dialog = await openPublish(user);
    expect(
      within(dialog).queryByText(/nothing to publish/)
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Publish Spanish" })
    );
    await waitFor(() => expect(sent()).toHaveLength(1));
  });

  it("keeps saying what was confirmed until it is done", async () => {
    const user = userEvent.setup();
    render();
    const dialog = await openPublish(user);
    // The reads after the publish don't answer yet, and it is described anew.
    let release: () => void = () => undefined;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const read = api.findByID.getMockImplementation();
    const move = api.publishParts.getMockImplementation();
    api.publishParts.mockImplementation(async (...args: unknown[]) => {
      const answered: unknown = await move?.(...args);
      outcome = { outcome: "stays-published" } as typeof outcome;
      api.findByID.mockImplementation(async (...asked: unknown[]) => {
        await waiting;
        return read?.(...asked) as unknown;
      });
      return answered;
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Publish Spanish" })
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Spanish readers will see this translation."
    );
    expect(within(dialog).getByRole("status")).not.toHaveTextContent(
      /Checking|nothing to publish/
    );
    release();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("can be pressed again after a publish that failed", async () => {
    const user = userEvent.setup();
    render();
    const dialog = await openPublish(user);
    const move = api.publishParts.getMockImplementation();
    let failed = false;
    api.publishParts.mockImplementation((...args: unknown[]) => {
      const choice = args[3] as PublishPartsChoice;
      if (choice.describe !== true && !failed) {
        failed = true;
        return Promise.reject(
          parseApiError(
            { error: { code: "INTERNAL", message: "It broke." } },
            500
          )
        );
      }
      return move?.(...args) as unknown;
    });
    const confirm = within(dialog).getByRole("button", {
      name: "Publish Spanish",
    });
    await user.click(confirm);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "It broke."
    );
    expect(confirm).toHaveFocus();
    await waitFor(() =>
      expect(confirm).toHaveAttribute("aria-disabled", "false")
    );
    await user.click(confirm);
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
  });

  it("waits for Save where saving might change what readers see", async () => {
    const user = userEvent.setup();
    schema.value = { ...COLLECTION, draftsEnabled: false };
    reader.readsTranslations = false;
    api.findByID.mockImplementation((_s: string, _i: string, read: Read) =>
      Promise.resolve({ ...answer(read), _translations: undefined })
    );
    render();
    await user.type(await bio(), "!");
    expect(publishButton()).toHaveAttribute("aria-disabled", "true");
    expect(publishButton()).toHaveAccessibleDescription(
      "Save your changes before publishing Spanish or taking it offline."
    );
    await user.click(publishButton());
    expect(api.update).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves unsaved work first, and publishes from what the save stored", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await bio(), "!");
    const dialog = await openPublish(user);
    expect(api.update).toHaveBeenCalledOnce();
    expect(Object.keys(api.update.mock.calls[0]?.[2] as object)).not.toContain(
      "status"
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Publish Spanish" })
    );
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]?.version).toBe("7.es:4");
  });

  it("opens nothing when that save is refused", async () => {
    const user = userEvent.setup();
    api.update.mockRejectedValue(
      parseApiError(
        { error: { code: "FORBIDDEN", message: "You may not." } },
        403
      )
    );
    render();
    await user.type(await bio(), "!");
    await user.click(publishButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(moves()).toHaveLength(0);
  });

  it("saves the next change from the version the publish left", async () => {
    const user = userEvent.setup();
    render();
    const dialog = await openPublish(user);
    // The reads after the publish take a while, so a dialog that closed before
    // they were in would leave the next change on the version before it.
    api.findByID.mockImplementation(
      async (_s: string, _i: string, read: Read) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return answer(read);
      }
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Publish Spanish" })
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    await user.type(await bio(), "!");
    await user.click(screen.getByRole("button", { name: /^Save( draft)?$/ }));
    await waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    expect(api.update.mock.calls[0]?.[2]).toMatchObject({ _rev: "8.es:5" });
  });

  it("holds Publish and says why where the server refuses the description", async () => {
    const user = userEvent.setup();
    api.publishParts.mockRejectedValue(
      parseApiError(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed.",
            data: {
              errors: [
                { path: "es", code: "NOT_APPROVED", message: "In review." },
              ],
            },
          },
        },
        400
      )
    );
    render();
    const dialog = await openPublish(user);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "In review."
    );
    expect(
      within(dialog).getByRole("button", { name: "Publish Spanish" })
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("offers the live values to a language behind them, then publishes", async () => {
    const user = userEvent.setup();
    stored.es = { ...PUBLISHED, pendingChange: true };
    outcome = {
      outcome: "out-of-date",
      fields: ["name"],
    } as unknown as typeof outcome;
    api.takeLive.mockImplementation(() => {
      outcome = {
        outcome: "goes-live-with-pending-change",
      } as typeof outcome;
      return Promise.resolve({ message: "", item: { taken: ["name"] } });
    });
    render();
    const dialog = await openPublish(user);
    expect(within(dialog).queryByText("Publish Spanish")).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: "Take the live values" })
    );
    expect(api.takeLive).toHaveBeenCalledExactlyOnceWith(
      { kind: "collection", slug: "authors", entryId: "a1" },
      "es",
      "7.es:3"
    );
    const publish = await within(dialog).findByRole("button", {
      name: "Publish Spanish",
    });
    await waitFor(() =>
      expect(publish).toHaveAttribute("aria-disabled", "false")
    );
    expect(sent()).toHaveLength(0);
    await user.click(publish);
    await waitFor(() => expect(sent()).toHaveLength(1));
  });

  it("says when the live values couldn't be taken, or were and couldn't be read", async () => {
    const user = userEvent.setup();
    stored.es = { ...PUBLISHED, pendingChange: true };
    outcome = {
      outcome: "out-of-date",
      fields: ["name"],
    } as unknown as typeof outcome;
    api.takeLive.mockRejectedValueOnce(
      parseApiError(
        { error: { code: "FORBIDDEN", message: "You may not." } },
        403
      )
    );
    render();
    const dialog = await openPublish(user);
    const take = within(dialog).getByRole("button", {
      name: "Take the live values",
    });
    await user.click(take);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You may not."
    );
    api.takeLive.mockResolvedValueOnce({ message: "", item: {} });
    api.findByID.mockRejectedValue(new Error("offline"));
    await waitFor(() => expect(take).toHaveAttribute("aria-disabled", "false"));
    await user.click(take);
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "The live values were taken, but they couldn't be loaded."
      )
    );
  });

  it("is held, not hidden, while a published language has nothing to publish", async () => {
    const user = userEvent.setup();
    stored.es = PUBLISHED;
    render();
    await bio();
    expect(publishButton()).toHaveAttribute("aria-disabled", "true");
    await user.click(publishButton());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.type(await bio(), "!");
    expect(publishButton()).toHaveAttribute("aria-disabled", "false");
  });

  it("follows its own right, for a reader who may not write", async () => {
    const user = userEvent.setup();
    reader.update = "refused";
    render();
    expect(await openPublish(user)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Save( draft)?$/ })
    ).not.toBeInTheDocument();
  });

  it.each([
    ["without the right", () => reader.can.delete("publish-authors")],
    [
      "where nothing is published",
      () => (schema.value = { ...COLLECTION, status: false }),
    ],
    [
      "of a document removed from code",
      () => (schema.value = { ...COLLECTION, removedFromCode: true }),
    ],
  ])("is not offered %s", async (_where, given) => {
    given();
    render();
    await bio();
    expect(
      screen.queryByRole("button", { name: "Publish Spanish" })
    ).not.toBeInTheDocument();
  });
});

describe("a save that changes what readers see", () => {
  const note = () =>
    document.querySelector('[data-slot="translation-save-reach"]');

  it("is said beside Save before it is made", async () => {
    schema.value = { ...COLLECTION, draftsEnabled: false };
    stored.es = PUBLISHED;
    render();
    await bio();
    expect(note()).toHaveTextContent(
      "Spanish is published and no drafts are kept here: saving changes what its readers see at once."
    );
    expect(
      screen.getByRole("button", { name: /^Save( draft)?$/ })
    ).toHaveAccessibleDescription(/saving changes what its readers see/);
    expect(
      screen.queryByRole("button", { name: "Publish Spanish" })
    ).not.toBeInTheDocument();
  });

  it.each([
    ["drafts are held", true, PUBLISHED],
    ["the language is not published", false, DRAFT],
  ])("is not claimed where %s", async (_where, draftsEnabled, es) => {
    schema.value = { ...COLLECTION, draftsEnabled };
    stored.es = es;
    render();
    await bio();
    expect(note()).toBeNull();
  });

  it("is not taken for held by a collection that only reads an old draft", async () => {
    schema.value = {
      ...COLLECTION,
      draftsEnabled: false,
      draftsDisabledReason: "localized-component",
    };
    stored.es = { ...PUBLISHED, pendingChange: true };
    render();
    await bio();
    expect(note()).not.toBeNull();
    // And such a draft is never offered to readers.
    expect(
      screen.getByText(/holds a draft from before drafts stopped being kept/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Publish Spanish" })
    ).not.toBeInTheDocument();
  });
});

describe("taking the language offline", () => {
  const arrow = () =>
    screen.getByRole("button", { name: "More actions for Spanish" });
  const item = () => screen.queryByRole("menuitem", { name: "Take offline…" });
  /** Open the arrow's menu, and press its Take offline. */
  async function pressOffline(user: ReturnType<typeof userEvent.setup>) {
    await user.click(arrow());
    await user.click(
      await screen.findByRole("menuitem", { name: "Take offline…" })
    );
  }

  beforeEach(() => {
    stored.es = PUBLISHED;
  });

  it("asks first, saying what its readers get, and moves that language alone", async () => {
    const user = userEvent.setup();
    render();
    await bio();
    await pressOffline(user);
    const dialog = await screen.findByRole("alertdialog", {
      name: "Take Spanish offline?",
    });
    expect(dialog).toHaveTextContent(
      "Spanish readers will get “not found”, or the fallback language where the site shows the whole document in another language."
    );
    expect(sent()).toHaveLength(0);
    await user.click(
      within(dialog).getByRole("button", { name: "Take Spanish offline" })
    );
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toMatchObject({
      direction: "unpublish",
      locales: ["es"],
      version: "7.es:3",
    });
    expect(sent()[0]?.shared).toBeUndefined();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Spanish is offline. English and the shared fields are unchanged."
      )
    );
    await waitFor(() => expect(arrow()).toHaveFocus());
    // Offline now, so it can't be taken offline again.
    await user.click(arrow());
    await screen.findByRole("menuitem", { name: "Open in editor" });
    expect(item()).not.toBeInTheDocument();
  });

  it("changes nothing when the reader changes their mind", async () => {
    const user = userEvent.setup();
    render();
    await bio();
    await pressOffline(user);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(moves()).toHaveLength(0);
    await waitFor(() => expect(arrow()).toHaveFocus());
  });

  it("keeps the dialog, with the server's reason, when it is refused", async () => {
    const user = userEvent.setup();
    api.publishParts.mockRejectedValue(
      parseApiError(
        { error: { code: "FORBIDDEN", message: "You may not." } },
        403
      )
    );
    render();
    await bio();
    await pressOffline(user);
    await user.click(
      await screen.findByRole("button", { name: "Take Spanish offline" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("You may not.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("waits for unsaved work, and says so", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await bio(), "!");
    await user.click(arrow());
    const held = await screen.findByRole("menuitem", {
      name: "Take offline…",
    });
    expect(held).toHaveAttribute("aria-disabled", "true");
    expect(held).toHaveAccessibleDescription(
      "Save your changes before taking Spanish offline."
    );
  });

  it.each([
    ["without the right", () => reader.can.delete("unpublish-authors")],
    ["while the language is not published", () => (stored.es = DRAFT)],
  ])("is not offered %s", async (_where, given) => {
    const user = userEvent.setup();
    given();
    render();
    await bio();
    await user.click(arrow());
    await screen.findByRole("menuitem", { name: "Open in editor" });
    expect(item()).not.toBeInTheDocument();
  });
});

describe("leaving with unsaved work", () => {
  const leave = () =>
    act(() => {
      window.history.pushState(null, "", "/admin/translations");
    });

  it("asks first, naming the language", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await bio(), "!");
    leave();
    expect(
      await screen.findByText(/You have unsaved changes in Spanish that will/)
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(
      "/admin/translations/collections/authors/a1"
    );
  });

  it("asks nothing where nothing is unsaved", async () => {
    render();
    await bio();
    leave();
    expect(window.location.pathname).toBe("/admin/translations");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks nothing once it is saved", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await bio(), "!");
    await user.click(screen.getByRole("button", { name: /^Save( draft)?$/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Save( draft)?$/ })
      ).toBeDisabled()
    );
    leave();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("a document someone else has open", () => {
  it("says who, and still lets the language be written", async () => {
    const user = userEvent.setup();
    lock.holder = { ownerId: "u2", ownerLabel: "Bob" };
    render();
    expect(
      await screen.findByText("Bob is editing this document right now.")
    ).toBeInTheDocument();
    await user.type(await bio(), "!");
    expect(
      screen.getByRole("button", { name: /^Save( draft)?$/ })
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Take over" })
    ).not.toBeInTheDocument();
  });

  it.each([
    ["nobody has it", null],
    ["the reader has it themselves", { ownerId: "me", ownerLabel: "Ada" }],
  ])("says nothing where %s", async (_where, holder) => {
    lock.holder = holder;
    render();
    await bio();
    expect(screen.queryByTestId("document-lock-banner")).toBeNull();
  });
});
