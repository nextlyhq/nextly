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
// Publishing every language is a publish; the caller holds the permission by
// default so the render cases below stay about localization, not authorization.
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
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
  publishAllLanguages: { slug: "pages", publish, pending: false },
};

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

  it("publishes all languages on click", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: /publish all languages/i })
    );
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
            slug: "homepage",
            publish: singlePublish,
            pending: false,
          },
        }}
      >
        <PublishAllLanguagesButton hasStatus />
      </EntryLocaleProvider>
    );

    await userEvent.click(
      screen.getByRole("button", { name: /publish all languages/i })
    );
    expect(singlePublish).toHaveBeenCalledTimes(1);
    expect(canFor).toHaveBeenCalledWith("publish-homepage");
  });

  it("renders nothing for a caller without publish permission", () => {
    // Otherwise an author holding only update-<slug> could publish every
    // language from the sidebar, bypassing the header Publish gate.
    useBranding.mockReturnValue({ locales: LOCALES });
    canFor.mockImplementation((slug: string) => slug !== "publish-pages");

    const { container } = renderButton();

    expect(container.querySelector("button")).toBeNull();
  });

  it("checks the publish permission for this document's slug", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    renderButton();

    expect(canFor).toHaveBeenCalledWith("publish-pages");
  });
});
