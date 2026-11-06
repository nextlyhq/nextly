import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  EntryLocaleProvider,
  type EntryLocaleContextValue,
} from "../EntryLocaleContext";
import { PublishAllLanguagesButton } from "../PublishAllLanguagesButton";

const { useBranding, publish, canFor } = vi.hoisted(() => ({
  useBranding: vi.fn(),
  publish: vi.fn(),
  canFor: vi.fn((_slug: string) => true),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));
// No mutation hook is mocked here, deliberately. The button reaches its action
// through the context seam, so whichever form supplied it — an entry's or a
// Single's — is the same shape to this component.
// Publishing every language is answered by the server's cell for that
// request, keyed here as `<request>:<slug>`; the caller may by default, so the
// render cases below stay about localization, not authorization.
vi.mock("@admin/hooks/useCanRequest", () => ({
  useCanRequest: (slug: string, request: string) =>
    canFor(`${request}:${slug}`),
}));

const LOCALES = {
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "de", label: "German", rtl: false, fallbackLocale: [] },
  ],
};

const CTX: EntryLocaleContextValue = {
  rtl: false,
  collectionLocalized: true,
  isNonDefaultLocale: false,
  publishAllLanguages: {
    slug: "pages",
    publish,
    pending: false,
    preview: () =>
      Promise.resolve({
        languages: [
          { locale: "en", outcome: "goes-live-with-pending-change" },
          { locale: "de", outcome: "goes-live" },
        ],
        blockers: [],
      }),
    previewKey: ["publish-all-preview", "pages", "entry-1"],
  },
};

/** Confirm in the open "Publish all" dialog, once its preview is read. */
async function confirmPublishAll() {
  const dialog = await screen.findByRole("alertdialog");
  await screen.findByRole("list", { name: "What happens to each language" });
  const confirm = Array.from(dialog.querySelectorAll("button")).find(
    button => button.textContent === "Publish all"
  );
  await userEvent.click(confirm!);
}

function renderButton(
  over: Partial<EntryLocaleContextValue> = {},
  hasStatus = true
) {
  return render(
    <EntryLocaleProvider value={{ ...CTX, ...over }}>
      <PublishAllLanguagesButton hasStatus={hasStatus} />
    </EntryLocaleProvider>
  );
}

describe("PublishAllLanguagesButton", () => {
  beforeEach(() => {
    useBranding.mockReset();
    publish.mockReset();
    canFor.mockReset();
    canFor.mockImplementation(() => true);
  });

  it("renders nothing when the document has no status (drafts)", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const { container } = renderButton({}, false);
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders nothing when the document is not localized", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const { container } = renderButton({ collectionLocalized: false });
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders nothing when no publish action is supplied (create mode)", () => {
    // A create form has no saved document to publish, so it supplies no seam.
    useBranding.mockReturnValue({ locales: LOCALES });
    const { container } = renderButton({ publishAllLanguages: undefined });
    expect(container.querySelector("button")).toBeNull();
  });

  // The rail confirms through the same dialog as the language panel: a click
  // says what publishing does to each language, and only the confirm
  // publishes. The plausible broken implementation publishes on the click,
  // with nothing said first.
  it("says what publishing does to each language, and publishes on confirm", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: /publish all languages/i })
    );
    expect(publish).not.toHaveBeenCalled();
    const list = await screen.findByRole("list", {
      name: "What happens to each language",
    });
    expect(list).toHaveTextContent("EnglishIts unpublished changes go live.");
    expect(list).toHaveTextContent("GermanGoes live for the first time.");

    await confirmPublishAll();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("serves a Single, whose seam names its own slug", async () => {
    // The reason the action is a seam at all: a Single is addressed by its slug
    // alone and has no collection or entry id, so a component reading those
    // could never offer it. Here the ONLY thing that changed is the seam.
    useBranding.mockReturnValue({ locales: LOCALES });
    const singlePublish = vi.fn();
    render(
      <EntryLocaleProvider
        value={{
          ...CTX,
          publishAllLanguages: {
            ...CTX.publishAllLanguages!,
            slug: "homepage",
            publish: singlePublish,
            previewKey: ["publish-all-preview", "single", "homepage"],
          },
        }}
      >
        <PublishAllLanguagesButton hasStatus />
      </EntryLocaleProvider>
    );

    await userEvent.click(
      screen.getByRole("button", { name: /publish all languages/i })
    );
    await confirmPublishAll();
    expect(singlePublish).toHaveBeenCalledTimes(1);
    expect(canFor).toHaveBeenCalledWith("publishEveryLanguage:homepage");
  });

  it("renders nothing for a caller the server would refuse publishing every language", () => {
    // Asked as that request is judged, in every language, not as a publish
    // in the language on screen: a rule refusing one language refuses it.
    useBranding.mockReturnValue({ locales: LOCALES });
    canFor.mockImplementation(
      (key: string) => key !== "publishEveryLanguage:pages"
    );

    const { container } = renderButton();

    expect(container.querySelector("button")).toBeNull();
  });

  it("asks about publishing every language of this document's collection", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    renderButton();

    expect(canFor).toHaveBeenCalledWith("publishEveryLanguage:pages");
  });
});
