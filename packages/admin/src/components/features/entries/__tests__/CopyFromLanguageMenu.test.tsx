import userEvent from "@testing-library/user-event";
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";

import {
  CopyFromLanguageMenu,
  pickLocalizedValues,
} from "../CopyFromLanguageMenu";
import {
  EntryLocaleProvider,
  type EntryLocaleContextValue,
} from "../EntryLocaleContext";

const { useBranding, findByID, toast } = vi.hoisted(() => ({
  useBranding: vi.fn(),
  findByID: vi.fn(),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));
vi.mock("@admin/services/entryApi", () => ({
  entryApi: { findByID: (...args: unknown[]) => findByID(...args) },
}));
vi.mock("@admin/components/ui", () => ({ toast }));

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
  isNonDefaultLocale: true,
  locale: "de",
  collectionSlug: "pages",
  entryId: "e1",
  localizedFieldNames: ["title", "body"],
};

let seenValues: Record<string, unknown> = {};

function Harness({
  ctx = CTX,
  defaults = {},
}: {
  ctx?: EntryLocaleContextValue;
  defaults?: Record<string, unknown>;
}) {
  const form = useForm<Record<string, unknown>>({ defaultValues: defaults });
  seenValues = form.watch();
  return (
    <FormProvider {...form}>
      <EntryLocaleProvider value={ctx}>
        <CopyFromLanguageMenu />
        <Values form={form} />
      </EntryLocaleProvider>
    </FormProvider>
  );
}

function Values({ form }: { form: ReturnType<typeof useForm> }) {
  seenValues = form.watch();
  return null;
}

describe("pickLocalizedValues", () => {
  it("copies only named localized fields that are present in the source", () => {
    const patch = pickLocalizedValues(
      { title: "Hallo", body: "", price: 9, extra: "x" },
      ["title", "body", "price"]
    );
    // body is blank → skipped; extra isn't a localized field → skipped; price (0/number) kept.
    expect(patch).toEqual({ title: "Hallo", price: 9 });
  });
});

describe("CopyFromLanguageMenu", () => {
  beforeEach(() => {
    useBranding.mockReset();
    findByID.mockReset();
    toast.info.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it("renders nothing when the collection is not localized", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const { container } = render(
      <Harness ctx={{ ...CTX, collectionLocalized: false }} />
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders nothing without an entry id (create mode)", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const { container } = render(
      <Harness ctx={{ ...CTX, entryId: undefined }} />
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("offers the other languages as copy sources", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<Harness />);
    await userEvent.click(
      screen.getByRole("button", {
        name: /copy content from another language/i,
      })
    );
    // Active locale (de) excluded; English offered.
    expect(
      await screen.findByRole("menuitem", { name: "English" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "German" })).toBeNull();
  });

  it("copies the source language's localized fields into the form on confirm", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    findByID.mockResolvedValue({ title: "Hello", body: "World", slug: "x" });
    render(<Harness defaults={{ title: "", body: "" }} />);

    await userEvent.click(
      screen.getByRole("button", {
        name: /copy content from another language/i,
      })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "English" })
    );
    // Confirm dialog
    await userEvent.click(
      await screen.findByRole("button", { name: /^Copy from English$/ })
    );

    await waitFor(() => {
      expect(findByID).toHaveBeenCalledWith("pages", "e1", {
        locale: "en",
        fallbackLocale: "none",
        depth: 0,
      });
    });
    await waitFor(() => {
      expect(seenValues.title).toBe("Hello");
      expect(seenValues.body).toBe("World");
    });
    expect(toast.success).toHaveBeenCalled();
  });
});
