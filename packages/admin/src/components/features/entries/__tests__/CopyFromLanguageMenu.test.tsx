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

const { useBranding, toast } = vi.hoisted(() => ({
  useBranding: vi.fn(),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));
vi.mock("@admin/components/ui", () => ({ toast }));

/**
 * The source read. The action no longer knows HOW the document is addressed —
 * it asks the context for a reader — so the test supplies one instead of
 * mocking a specific API client.
 */
const fetchSourceValues = vi.fn();

const LOCALES = {
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "de", label: "German", rtl: false, fallbackLocale: [] },
  ],
};

/** A collection entry: addressed by slug and id, and able to read a source. */
const CTX: EntryLocaleContextValue = {
  rtl: false,
  collectionLocalized: true,
  isNonDefaultLocale: true,
  locale: "de",
  collectionSlug: "pages",
  entryId: "e1",
  localizedFieldNames: ["title", "body"],
  fetchSourceValues,
};

/**
 * A single: no collection slug and no entry id, because it genuinely has
 * neither. It can still read another language of itself, which is the whole
 * point of gating on the reader rather than on an address.
 */
const SINGLE_CTX: EntryLocaleContextValue = {
  rtl: false,
  collectionLocalized: true,
  isNonDefaultLocale: true,
  locale: "de",
  localizedFieldNames: ["title", "body"],
  fetchSourceValues,
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
    fetchSourceValues.mockReset();
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

  it("renders nothing without a source reader (create mode)", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const { container } = render(
      <Harness ctx={{ ...CTX, fetchSourceValues: undefined }} />
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("offers itself to a single, which has no collection slug or entry id", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<Harness ctx={SINGLE_CTX} />);
    expect(
      await screen.findByRole("button", {
        name: /copy content from another language/i,
      })
    ).toBeInTheDocument();
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

  it("offers the copy a language switch asked for, and clears the request", async () => {
    // The far side of the seed flow. The request is made in the OLD language's
    // editor and arrives here, in the NEW one's, through context — because the
    // switch unmounts the component that made it. Without this the button in
    // the language panel switches languages and silently does nothing else.
    useBranding.mockReturnValue({ locales: LOCALES });
    const onSeedHandled = vi.fn();
    render(<Harness ctx={{ ...CTX, seedFromLocale: "en", onSeedHandled }} />);

    expect(
      await screen.findByRole("button", { name: /^Copy from English$/ })
    ).toBeInTheDocument();
    // Cleared as soon as it is offered, so a later re-render cannot re-open it.
    await waitFor(() => expect(onSeedHandled).toHaveBeenCalled());
  });

  it("ignores a seed naming the language already being edited", async () => {
    // Copying a language onto itself is a no-op that still shows a confirm
    // step, so it is dropped rather than offered.
    useBranding.mockReturnValue({ locales: LOCALES });
    const onSeedHandled = vi.fn();
    render(<Harness ctx={{ ...CTX, seedFromLocale: "de", onSeedHandled }} />);
    await waitFor(() => expect(onSeedHandled).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /^Copy from/ })).toBeNull();
  });

  it("copies the source language's localized fields into the form on confirm", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    fetchSourceValues.mockResolvedValue({
      title: "Hello",
      body: "World",
      slug: "x",
    });
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

    // The action asks for the SOURCE language by code, and nothing else: how
    // this document is addressed is the reader's business, not its own.
    await waitFor(() => {
      expect(fetchSourceValues).toHaveBeenCalledWith("en");
    });
    await waitFor(() => {
      expect(seenValues.title).toBe("Hello");
      expect(seenValues.body).toBe("World");
    });
    expect(toast.success).toHaveBeenCalled();
  });
});
