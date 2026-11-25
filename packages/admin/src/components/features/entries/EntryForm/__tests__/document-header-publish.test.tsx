/**
 * Where a person chooses what goes live: the main button's menu, which offers
 * "Choose what to publish…" and "Schedule…", and nowhere a control that
 * publishes every language at once.
 *
 * The plausible broken headers: one that loses either row, and one that still
 * draws, in the bar or in either of its menus, a way to publish all languages
 * beside the choice that replaced it. Drawn with the real bar and the real
 * actions a page contributes to it, for a person holding every permission, so
 * nothing absent here was merely withheld.
 */
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { SCHEDULE_PUBLISH_LABEL } from "@admin/components/features/releases/schedule-publish";
import { useScheduleDocumentAction } from "@admin/components/features/releases/ScheduleDocumentAction";

import { EntryLocaleProvider } from "../../EntryLocaleContext";
import {
  PUBLISH_PARTS_LABEL,
  usePublishPartsAction,
} from "../../publish-parts/usePublishPartsAction";

import { BarUnderTest as DocumentBar } from "./bar-under-test";
import { mainMenuRows } from "./main-menu";

const LOCALES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "ar", label: "Arabic" },
];

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => true,
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: true,
    locales: LOCALES,
    defaultLocale: "en",
    fallback: true,
    getLocale: (code: string | undefined) =>
      LOCALES.find(locale => locale.code === code),
  }),
}));
// No workflow holds the document.
vi.mock("@admin/hooks/queries/useReviewState", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useReviewState")
  >()),
  useReviewState: () => ({ data: { attached: false } }),
}));

/** The header of a saved, translated post, with what its page contributes. */
function Header({ status }: { status: "draft" | "published" }): ReactElement {
  const methods = useForm({ defaultValues: { title: "Hello" } });
  const publishParts = usePublishPartsAction({
    target: { kind: "collection", slug: "posts", id: "e1" },
    lifecycleEnabled: true,
    languages: LOCALES.map(locale => locale.code),
    labelOf: code =>
      LOCALES.find(locale => locale.code === code)?.label ?? code,
    currentLocale: undefined,
    defaultLocale: "en",
    sharedPending: false,
  });
  const schedule = useScheduleDocumentAction({
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "e1",
    lifecycleEnabled: true,
    onDefaultLocale: true,
    documentTitle: () => "Hello",
    savesGoLive: false,
    languages: LOCALES.map(locale => locale.label),
  });
  const contributed = [publishParts.contributed, schedule.contributed].filter(
    action => action !== null
  );
  return (
    <FormProvider {...methods}>
      <EntryLocaleProvider
        value={{
          locale: "en",
          rtl: false,
          collectionLocalized: true,
          isNonDefaultLocale: false,
          collectionSlug: "posts",
          entryId: "e1",
        }}
      >
        <DocumentBar
          mode="edit"
          hasStatus
          draftsEnabled
          isDirty={false}
          isSubmitting={false}
          entry={{ id: "e1", status, title: "Hello" }}
          collectionSlug="posts"
          contributedActions={contributed}
          onSaveDraft={vi.fn()}
          onPublish={vi.fn()}
          onSaveChanges={vi.fn()}
          onSaveWorkingDraft={vi.fn()}
          onUnpublish={vi.fn()}
          onDiscardWorkingDraft={vi.fn()}
        />
      </EntryLocaleProvider>
    </FormProvider>
  );
}

const PUBLISHES_EVERY_LANGUAGE = /publish all|all languages/i;

/** Nothing on screen, in the bar or in a menu open over it, publishes every language. */
function expectNoPublishAll(): void {
  for (const role of ["button", "menuitem"] as const) {
    expect(
      // Hidden ones too: an open menu hides the bar behind it.
      screen
        .queryAllByRole(role, { hidden: true })
        .map(
          control =>
            `${control.getAttribute("aria-label") ?? ""} ${control.textContent ?? ""}`
        )
        .filter(words => PUBLISHES_EVERY_LANGUAGE.test(words))
    ).toEqual([]);
  }
}

describe("publishing from the document header", () => {
  it.each(["draft", "published"] as const)(
    "offers the choice of what to publish and Schedule on the main button's menu of a %s document, and no way to publish every language",
    async status => {
      render(<Header status={status} />);

      const rows = await mainMenuRows();

      expect(rows).toEqual(
        expect.arrayContaining([PUBLISH_PARTS_LABEL, SCHEDULE_PUBLISH_LABEL])
      );
      expectNoPublishAll();
    }
  );

  it("offers none among the document's other actions either", async () => {
    render(<Header status="published" />);

    await userEvent.click(
      screen.getByRole("button", { name: /more actions/i })
    );

    // Opened, with rows of its own.
    expect((await screen.findAllByRole("menuitem")).length).toBeGreaterThan(0);
    expectNoPublishAll();
  });
});
