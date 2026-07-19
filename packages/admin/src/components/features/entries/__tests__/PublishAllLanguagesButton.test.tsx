import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  EntryLocaleProvider,
  type EntryLocaleContextValue,
} from "../EntryLocaleContext";
import { PublishAllLanguagesButton } from "../PublishAllLanguagesButton";

const { useBranding, mutate } = vi.hoisted(() => ({
  useBranding: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));
vi.mock("@admin/hooks/queries/usePublishAllLocales", () => ({
  usePublishAllLocales: () => ({ mutate, isPending: false }),
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
});
