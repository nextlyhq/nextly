import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { LanguagesMenu } from "../LanguagesMenu";

const useBranding = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));

// The menu is a composition surface: the copy and publish behaviours have
// their own implementations (and the rail's tests exercise the same hooks),
// so these tests pin what the MENU decides — what it offers, and when it
// withholds — with the hooks replaced by their contracts.
const copyState = vi.fn();
vi.mock("../useCopyFromLanguage", () => ({
  useCopyFromLanguage: () => copyState(),
}));
const publishState = vi.fn();
vi.mock("../usePublishAllLanguages", () => ({
  usePublishAllLanguages: () => publishState(),
}));
vi.mock("../CopyFromLanguageDialog", () => ({
  CopyFromLanguageDialog: () => null,
}));

const LOCALES = {
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "de", label: "German", rtl: false, fallbackLocale: [] },
  ],
};

const COPY_IDLE = {
  available: true,
  sources: [{ code: "en", label: "English", rtl: false }],
  activeLabel: "German",
  pendingLabel: "",
  pending: null,
  busy: false,
  requestCopy: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
};
const PUBLISH_IDLE = { available: true, pending: false, publishAll: vi.fn() };

describe("LanguagesMenu", () => {
  beforeEach(() => {
    useBranding.mockReset();
    copyState.mockReturnValue(COPY_IDLE);
    publishState.mockReturnValue(PUBLISH_IDLE);
  });

  it("renders nothing when localization is not configured", () => {
    useBranding.mockReturnValue({ locales: undefined });
    const { container } = render(<LanguagesMenu hasStatus />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the actions and the legend from one always-present trigger", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<LanguagesMenu hasStatus />);
    await userEvent.click(
      screen.getByRole("button", { name: "Language actions" })
    );
    expect(
      screen.getByRole("menuitem", { name: "Copy from English…" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Publish all languages" })
    ).toBeInTheDocument();
    // The legend decodes every state in text, not tooltip-only.
    expect(screen.getByText("not translated")).toBeInTheDocument();
    expect(screen.getByText("published")).toBeInTheDocument();
  });

  it("keeps the legend when no action applies (a new, unsaved entry)", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    copyState.mockReturnValue({ ...COPY_IDLE, available: false });
    publishState.mockReturnValue({ ...PUBLISH_IDLE, available: false });
    render(<LanguagesMenu hasStatus />);
    await userEvent.click(
      screen.getByRole("button", { name: "Language actions" })
    );
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(screen.getByText("Language states")).toBeInTheDocument();
  });

  it("withholds the mutations while actions are disabled, keeping the legend readable", async () => {
    // Reading a past version: nothing in the header may write the live
    // document, so both actions are withheld rather than hidden.
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<LanguagesMenu hasStatus actionsDisabled />);
    await userEvent.click(
      screen.getByRole("button", { name: "Language actions" })
    );
    expect(
      screen.getByRole("menuitem", { name: "Copy from English…" })
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("menuitem", { name: "Publish all languages" })
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Language states")).toBeInTheDocument();
  });

  it("routes a copy request to the shared implementation", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const requestCopy = vi.fn();
    copyState.mockReturnValue({ ...COPY_IDLE, requestCopy });
    render(<LanguagesMenu hasStatus />);
    await userEvent.click(
      screen.getByRole("button", { name: "Language actions" })
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Copy from English…" })
    );
    expect(requestCopy).toHaveBeenCalledWith("en");
  });
});
