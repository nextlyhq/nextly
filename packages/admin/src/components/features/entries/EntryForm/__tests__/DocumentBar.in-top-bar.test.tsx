/**
 * Inside the admin's shell an open document draws no bar of its own: its
 * state and its actions are drawn in the admin's one top bar, after the trail,
 * on that bar's one row. The editor's frame then has nothing to stick under, so
 * its panel's offset is zero. Outside the shell (a page rendered alone) the
 * document keeps its own sticky bar, as the other DocumentBar tests cover.
 */
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import { DashboardHeader } from "@admin/components/layout/header/DashboardHeader";
import { HeaderTrailProvider } from "@admin/components/layout/header/HeaderTrail";
import { TopBarPlacesProvider } from "@admin/components/layout/header/TopBarPlaces";

import { DocumentEditorLayout } from "../DocumentEditorLayout";

import { BarUnderTest as DocumentBar } from "./bar-under-test";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ plugins: [] }),
}));

function Editor() {
  const methods = useForm({ defaultValues: { title: "" } });
  return (
    <FormProvider {...methods}>
      <DocumentEditorLayout
        place={{ place: "collection.edit", context: null }}
        bar={
          <DocumentBar
            mode="edit"
            hasStatus={false}
            isDirty={false}
            isSubmitting={false}
            entry={{ id: "e1", status: "draft" }}
            collectionSlug="posts"
            onSaveDraft={vi.fn()}
            onPublish={vi.fn()}
            onSaveChanges={vi.fn()}
          />
        }
        banners={<div role="status">Scheduled for tomorrow</div>}
      >
        <div data-testid="fields" />
      </DocumentEditorLayout>
    </FormProvider>
  );
}

function renderInShell() {
  return render(
    <HeaderTrailProvider>
      <TopBarPlacesProvider>
        <DashboardHeader />
        <main>
          <Editor />
        </main>
      </TopBarPlacesProvider>
    </HeaderTrailProvider>
  );
}

describe("an open document inside the admin's shell", () => {
  it("draws its controls in the admin's top bar, and no bar of its own", () => {
    renderInShell();
    const bars = screen.getAllByTestId("document-bar");
    expect(bars).toHaveLength(1);
    const banner = screen.getByRole("banner");
    expect(banner).toContainElement(bars[0]!);
    expect(banner.querySelector('[data-top-bar-place="end"]')).toContainElement(
      bars[0]!
    );
    // Its actions are there, in the bar, and the page draws none of them.
    expect(within(banner).getByRole("button", { name: /save/i })).toBeTruthy();
    expect(
      within(screen.getByRole("main")).queryByRole("button", { name: /save/i })
    ).toBeNull();
  });

  it("keeps its banners in the page, directly above the fields", () => {
    renderInShell();
    const main = screen.getByRole("main");
    expect(within(main).getByRole("status").textContent).toBe(
      "Scheduled for tomorrow"
    );
  });

  it("gives the panel nothing to stick under in the frame", () => {
    renderInShell();
    const frame = document.querySelector("[data-document-editor-frame]");
    expect(frame?.className).toContain("[--document-bar-height:0px]");
  });

  it("keeps every part on the bar's one row", () => {
    renderInShell();
    const bar = screen.getByTestId("document-bar");
    for (const group of bar.querySelectorAll("div")) {
      expect(group.className).not.toMatch(/(^|\s)flex-wrap(\s|$)/);
    }
  });
});
