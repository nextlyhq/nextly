/**
 * The edit page's place in the Single editor: plugins' blocks around the
 * document bar and the editor, their tabs over the field column and their
 * sections in the side panel, each told which Single the page shows; and
 * nothing changed when nothing is contributed.
 */
import type { AdminContributionsMeta } from "nextly/config";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import userEvent from "@testing-library/user-event";

import { render, screen } from "@admin/__tests__/utils";
import {
  HeaderTrail,
  HeaderTrailProvider,
} from "@admin/components/layout/header/HeaderTrail";
import { registerComponent } from "@admin/lib/plugins/component-registry";

const SIGNED_IN = "11111111-1111-4111-8111-111111111111";

// What the admin metadata delivers to the form's place, set per case.
const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
}));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ contributions: meta.contributions }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: { id: SIGNED_IN } }),
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({
  useDocumentLock: () => ({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  }),
}));
vi.mock(
  "@admin/components/features/entries/EntryForm/DocumentLockBanner",
  () => ({ DocumentLockBanner: () => <p>lock banner</p> })
);
vi.mock(
  "@admin/components/features/entries/EntryForm/AutosaveRecoveryBanner",
  () => ({ LiveDocumentRecoveryOffer: () => <p>recovery banner</p> })
);
vi.mock(
  "@admin/components/features/versions/viewed-version-host",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("@admin/components/features/versions/viewed-version-host")
    >()),
    ViewedVersionBody: ({
      children,
      bannerSlot,
    }: {
      children?: ReactNode;
      bannerSlot?: HTMLElement | null;
    }) => {
      const banner = <p>version banner</p>;
      return (
        <>
          {bannerSlot ? createPortal(banner, bannerSlot) : banner}
          {children}
        </>
      );
    },
  })
);

import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  status: true,
  fields: [
    { type: "text", name: "title", label: "Title" },
    { type: "text", name: "heroTitle", label: "Hero Title" },
  ],
} as unknown as SingleSchema;

const document = {
  id: "s1",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  heroTitle: "",
  status: "draft",
} as unknown as SingleDocumentData;

function component(path: string, testId: string): string {
  registerComponent(path, ((props: { context?: unknown; entry?: unknown }) => (
    <pre data-testid={testId}>
      {JSON.stringify({
        context: props.context,
        entryId: (props.entry as { id?: unknown } | undefined)?.id,
      })}
    </pre>
  )) as never);
  return path;
}
const TOP = component("@acme/a/admin#SingleTop", "top-block");
const TAB = component("@acme/a/admin#SingleTab", "plugin-tab");
const SECTION = component("@acme/a/admin#SingleSection", "plugin-section");

/** What a Single's page tells each contribution. */
const TOLD = {
  context: { userId: SIGNED_IN, single: "homepage" },
  entryId: "s1",
};

function renderEditor() {
  return render(
    <HeaderTrailProvider>
      <HeaderTrail />
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    </HeaderTrailProvider>
  );
}

/** The editor's frame, which holds the bar, the banners and the row. */
function frame(): HTMLElement {
  return window.document.querySelector<HTMLElement>(
    "[data-document-editor-frame]"
  )!;
}

/** The frame's row of field column and panel. */
function row(): HTMLElement {
  return screen
    .getByLabelText("Hero Title")
    .closest<HTMLElement>(".relative.flex")!;
}

/** Lays the editor's frame out this wide, as a browser would, so the panel docks. */
function editorWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        width: this.hasAttribute("data-document-editor-frame") ? width : 0,
      } as DOMRect;
    }
  );
}

beforeEach(() => {
  meta.contributions = undefined;
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("the edit page's place in the Single editor", () => {
  it("with no contributions the edit page draws as before", () => {
    renderEditor();

    expect(frame().firstElementChild).toBe(screen.getByTestId("document-bar"));
    expect(frame().lastElementChild).toBe(row());
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("draws a block before the bar, told which Single the page shows", () => {
    meta.contributions = {
      "single.edit": {
        block: [
          {
            plugin: "@acme/a",
            id: "acme-a.top",
            kind: "block",
            component: TOP,
          },
          { builtIn: "document-bar" },
          { builtIn: "editor" },
        ],
      },
    } as AdminContributionsMeta;
    renderEditor();

    const top = screen.getByTestId("top-block");
    expect(frame().firstElementChild).toBe(top);
    expect(top.nextElementSibling).toBe(screen.getByTestId("document-bar"));
    expect(JSON.parse(top.textContent ?? "")).toEqual(TOLD);
  });

  it("a delivered tab follows the page's own content, over the field column", async () => {
    meta.contributions = {
      "single.edit": {
        tab: [
          {
            plugin: "@acme/a",
            id: "acme-a.tab",
            kind: "tab",
            label: "Acme",
            component: TAB,
          },
        ],
      },
    } as AdminContributionsMeta;
    renderEditor();

    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "Content",
      "Acme",
    ]);
    expect(row().contains(screen.getByRole("tablist"))).toBe(true);
    await userEvent.click(screen.getByRole("tab", { name: "Acme" }));
    expect(
      JSON.parse(screen.getByTestId("plugin-tab").textContent ?? "")
    ).toEqual(TOLD);
    expect(screen.getByLabelText("Hero Title")).not.toBeVisible();
  });

  it("draws a plugin's section in the side panel, where the server put it", () => {
    meta.contributions = {
      "single.edit": {
        sidebarSection: [
          { builtIn: "status" },
          { builtIn: "publishing" },
          { builtIn: "language" },
          { builtIn: "details" },
          {
            plugin: "@acme/a",
            id: "acme-a.notes",
            kind: "sidebarSection",
            label: "Notes",
            component: SECTION,
          },
        ],
      },
    } as AdminContributionsMeta;
    editorWidth(1440);
    renderEditor();

    const notes = screen.getByRole("region", { name: "Notes" });
    expect(notes.previousElementSibling).toBe(
      screen.getByRole("region", { name: "Details" })
    );
    expect(
      JSON.parse(screen.getByTestId("plugin-section").textContent ?? "")
    ).toEqual(TOLD);
  });
});
