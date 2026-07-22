import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  EntryLocaleProvider,
  type EntryLocaleContextValue,
} from "../EntryLocaleContext";
import { PublishAllLanguagesButton } from "../PublishAllLanguagesButton";

const { useBranding, mutate, canFor } = vi.hoisted(() => ({
  useBranding: vi.fn(),
  mutate: vi.fn(),
  canFor: vi.fn((_slug: string) => true),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));
vi.mock("@admin/hooks/queries/usePublishAllLocales", () => ({
  usePublishAllLocales: () => ({ mutate, isPending: false }),
}));
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
  collectionSlug: "pages",
  entryId: "e1",
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
    mutate.mockReset();
    canFor.mockReset();
    canFor.mockImplementation(() => true);
  });

  it("renders nothing when the collection has no status (drafts)", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const { container } = renderButton({}, false);
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders nothing when the collection is not localized", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const { container } = renderButton({ collectionLocalized: false });
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders nothing without an entry id (create mode)", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const { container } = renderButton({ entryId: undefined });
    expect(container.querySelector("button")).toBeNull();
  });

  it("publishes all languages on click", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: /publish all languages/i })
    );
    expect(mutate).toHaveBeenCalledWith("e1");
  });

  it("renders nothing for a caller without publish permission", () => {
    // Otherwise an author holding only update-<slug> could publish every
    // language from the sidebar, bypassing the header Publish gate.
    useBranding.mockReturnValue({ locales: LOCALES });
    canFor.mockImplementation((slug: string) => slug !== "publish-pages");

    const { container } = renderButton();

    expect(container.querySelector("button")).toBeNull();
  });

  it("checks the publish permission for this collection's slug", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    renderButton();

    expect(canFor).toHaveBeenCalledWith("publish-pages");
  });
});
