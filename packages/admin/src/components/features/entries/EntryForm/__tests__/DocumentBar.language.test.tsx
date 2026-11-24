/**
 * What the document bar says about language. Editing a language other than
 * the default shows that language's code, titled with its name; creating an
 * entry on a localized site says which language it starts in. Neither shows
 * on the plain path: an unlocalized site, or the default language.
 */
import type { ReactNode } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  EntryLocaleProvider,
  type EntryLocaleContextValue,
} from "../../EntryLocaleContext";

import { BarUnderTest as DocumentBar } from "./bar-under-test";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
// History is offered to a reader who may read it.
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => true,
}));

const localization = vi.hoisted(() => ({
  enabled: true,
  locales: [] as { code: string; label: string }[],
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: localization.enabled,
    locales: localization.locales,
    defaultLocale: "en",
    fallback: true,
    getLocale: (code: string) =>
      ({ en: { label: "English" }, fr: { label: "French" } })[code],
  }),
}));

function Harness({
  mode = "edit",
  locale,
  languagesControl,
}: {
  mode?: "create" | "edit";
  locale?: EntryLocaleContextValue;
  languagesControl?: ReactNode;
}) {
  const methods = useForm({ defaultValues: { title: "" } });
  const bar = (
    <DocumentBar
      mode={mode}
      hasStatus
      isDirty={false}
      isSubmitting={false}
      entry={mode === "edit" ? { id: "e1", status: "draft" } : undefined}
      collectionSlug="posts"
      historyFields={[]}
      languagesControl={languagesControl}
      onSaveDraft={vi.fn()}
      onPublish={vi.fn()}
      onSaveChanges={vi.fn()}
      onSaveWorkingDraft={vi.fn()}
      onUnpublish={vi.fn()}
      onDiscardWorkingDraft={vi.fn()}
    />
  );
  return (
    <FormProvider {...methods}>
      {locale ? (
        <EntryLocaleProvider value={locale}>{bar}</EntryLocaleProvider>
      ) : (
        bar
      )}
    </FormProvider>
  );
}

const french: EntryLocaleContextValue = {
  locale: "fr",
  rtl: false,
  collectionLocalized: true,
  isNonDefaultLocale: true,
};

describe("DocumentBar language", () => {
  it("draws the languages control right after History, on a site with two languages or more", () => {
    localization.locales = [
      { code: "en", label: "English" },
      { code: "fr", label: "French" },
    ];
    render(
      <Harness languagesControl={<button type="button">Languages</button>} />
    );
    const history = screen.getByRole("button", { name: "History" });
    const languages = screen.getByRole("button", { name: "Languages" });
    expect(
      history.compareDocumentPosition(languages) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Before the main button.
    expect(
      languages.compareDocumentPosition(
        screen.getByRole("button", { name: /^publish$/i })
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("draws no languages control on a one-language site", () => {
    localization.locales = [{ code: "en", label: "English" }];
    render(
      <Harness languagesControl={<button type="button">Languages</button>} />
    );
    expect(
      screen.queryByRole("button", { name: "Languages" })
    ).not.toBeInTheDocument();
    // The control: the bar itself is drawn.
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
  });

  it("names the language being edited when it is not the default", () => {
    localization.enabled = true;
    render(<Harness locale={french} />);
    expect(screen.getByText("fr")).toHaveAttribute("title", "Editing French");
  });

  it("shows no language code while the default language is edited", () => {
    localization.enabled = true;
    render(
      <Harness
        locale={{ ...french, locale: "en", isNonDefaultLocale: false }}
      />
    );
    expect(screen.getByTestId("document-bar")).toBeInTheDocument();
    expect(screen.queryByTitle(/^Editing /)).not.toBeInTheDocument();
  });

  it("says which language a new entry starts in on a localized site", () => {
    localization.enabled = true;
    render(<Harness mode="create" />);
    const sentence =
      "Creating in English — other languages can be added after the first save";
    const note = screen.getByTestId("document-bar-creating-in");
    // The whole sentence is what a screen reader hears, at every width, and
    // what a pointer's tooltip shows where the bar has room only for less.
    expect(note).toHaveTextContent(sentence);
    expect(note).toHaveAttribute("title", sentence);
  });

  it("shortens the note as the bar narrows: the sentence, then the language, then its code", () => {
    // jsdom lays nothing out, so this reads the classes that hide: the
    // explanation gives way first, then the words "Creating in English" give
    // way to the language's code, so a phone's bar keeps to one row.
    localization.enabled = true;
    render(<Harness mode="create" />);
    const note = screen.getByTestId("document-bar-creating-in");
    const part = (text: string) =>
      [...note.querySelectorAll("span")].find(
        span => span.textContent?.trim() === text
      );
    const explanation = part(
      "— other languages can be added after the first save"
    );
    const language = part("Creating in English");
    const code = part("en");
    expect(explanation?.className).toMatch(/\/toolbar:sr-only/);
    expect(language?.className).toMatch(/\/toolbar:sr-only/);
    // The code is drawn only where the words are not, and is not read out
    // beside them.
    expect(code?.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(code).toHaveAttribute("aria-hidden", "true");
    expect(note.querySelector("svg")?.getAttribute("class")).toMatch(
      /shrink-0/
    );
  });

  it("says nothing about language when creating on an unlocalized site", () => {
    localization.enabled = false;
    render(<Harness mode="create" />);
    expect(screen.getByTestId("document-bar")).toBeInTheDocument();
    expect(screen.queryByText(/Creating in/)).not.toBeInTheDocument();
  });
});
