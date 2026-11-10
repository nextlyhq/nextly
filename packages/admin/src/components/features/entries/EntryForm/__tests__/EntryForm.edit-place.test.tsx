/**
 * The edit page's place in the entry editor: plugins' blocks around the
 * document bar and the editor, in the order the server sent, each told which
 * entry the page shows; a block replacing the editor drawn in its place with
 * the bar and its banners staying; a tab strip over the field column only
 * when a tab is delivered, the page's own content first; and nothing changed
 * when nothing is contributed.
 *
 * The banners are stood in for as the layout test stands them in, so what is
 * read is where the page puts its parts.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { AdminContributionsMeta } from "nextly/config";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import userEvent from "@testing-library/user-event";

import { cleanup, createTestQueryClient, screen } from "@admin/__tests__/utils";
import {
  HeaderTrail,
  HeaderTrailProvider,
} from "@admin/components/layout/header/HeaderTrail";
import { registerComponent } from "@admin/lib/plugins/component-registry";

const SIGNED_IN = "11111111-1111-4111-8111-111111111111";

// What the admin metadata delivers to the form's place, and who is signed in,
// set per case.
const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
}));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ contributions: meta.contributions }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: meta.user }),
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({
  useDocumentLock: () => ({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  }),
}));
vi.mock("@admin/hooks/useAutosaveRecovery", () => ({
  useAutosaveRecovery: () => ({
    offer: null,
    isResolved: true,
    dismiss: () => {},
    restore: () => {},
  }),
}));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => true,
}));
// The banners, as markers drawn whatever the document's state.
vi.mock("../DocumentLockBanner", () => ({
  DocumentLockBanner: () => <p>lock banner</p>,
}));
vi.mock("../AutosaveRecoveryBanner", () => ({
  LiveDocumentRecoveryOffer: () => <p>recovery banner</p>,
}));
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

import { EntryForm } from "../EntryForm";

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>
        <HeaderTrailProvider>
          <HeaderTrail />
          {children}
        </HeaderTrailProvider>
      </ShortcutProvider>
    </QueryClientProvider>
  );
}

const posts = {
  name: "posts",
  slug: "posts",
  label: "Posts",
  labels: { singular: "Post", plural: "Posts" },
  status: true,
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "body", type: "text", label: "Body" },
  ],
} as never;

const entry = {
  id: "p1",
  title: "Hello world",
  body: "",
  status: "draft",
} as never;

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
const TOP = component("@acme/a/admin#Top", "top-block");
const MIDDLE = component("@acme/a/admin#Middle", "middle-block");
const BOTTOM = component("@acme/a/admin#Bottom", "bottom-block");
const EDITOR = component("@acme/a/admin#Editor", "replacement-editor");
const TAB = component("@acme/a/admin#Tab", "plugin-tab");
const SECTION = component("@acme/a/admin#Section", "plugin-section");

function block(id: string, path: string, extra: object = {}) {
  return { plugin: "@acme/a", id, kind: "block", component: path, ...extra };
}

function renderEditor() {
  return render(<EntryForm collection={posts} entry={entry} mode="edit" />, {
    wrapper: Providers,
  });
}

/** The editor's frame, which holds the bar, the banners and the row. */
function frame(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-document-editor-frame]")!;
}

/** The frame's row of field column and panel. */
function row(): HTMLElement {
  return screen.getByLabelText("Body").closest<HTMLElement>(".relative.flex")!;
}

/** The field column: the row's child holding the title. */
function fieldColumn(): HTMLElement {
  return Array.from(row().children).find(child =>
    child.contains(screen.getByLabelText("Title"))
  ) as HTMLElement;
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

function precedes(a: Element, b: Element): boolean {
  return (
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}

beforeEach(() => {
  meta.contributions = undefined;
  meta.user = { id: SIGNED_IN };
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  window.localStorage.clear();
});

describe("the edit page's place in the entry editor", () => {
  it("with no contributions the edit page draws as before", () => {
    renderEditor();

    // The bar opens the frame and the row closes it, both straight in the
    // frame: nothing wraps the page's parts and nothing is added between.
    expect(frame().firstElementChild).toBe(screen.getByTestId("document-bar"));
    expect(frame().lastElementChild).toBe(row());
    expect(row().parentElement).toBe(frame());
    expect(precedes(screen.getByText("lock banner"), row())).toBe(true);
    // No tab strip, and the field column opens with the title as before.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      fieldColumn().firstElementChild?.contains(screen.getByLabelText("Title"))
    ).toBe(true);
  });

  it("draws blocks before the bar, between the bar and the editor, and after it, as the server ordered them", () => {
    meta.contributions = {
      "collection.edit": {
        block: [
          block("acme-a.top", TOP),
          { builtIn: "document-bar" },
          block("acme-a.middle", MIDDLE),
          { builtIn: "editor" },
          block("acme-a.bottom", BOTTOM),
        ],
      },
    } as AdminContributionsMeta;
    renderEditor();

    const top = screen.getByTestId("top-block");
    const middle = screen.getByTestId("middle-block");
    const bottom = screen.getByTestId("bottom-block");
    // Each contribution stands in its own isolating wrapper, which the
    // frame holds where the server put the contribution.
    expect(frame().firstElementChild).toBe(top.parentElement);
    expect(top.parentElement?.nextElementSibling).toBe(
      screen.getByTestId("document-bar")
    );
    // The banners belong to the bar, so a block after the bar follows them.
    expect(precedes(screen.getByText("lock banner"), middle)).toBe(true);
    expect(precedes(middle, row())).toBe(true);
    expect(frame().lastElementChild).toBe(bottom.parentElement);
  });

  it("tells a block which entry the page shows, and hands it the entry", () => {
    meta.contributions = {
      "collection.edit": {
        block: [
          { builtIn: "document-bar" },
          { builtIn: "editor" },
          block("acme-a.bottom", BOTTOM),
        ],
      },
    } as AdminContributionsMeta;
    renderEditor();

    expect(
      JSON.parse(screen.getByTestId("bottom-block").textContent ?? "")
    ).toEqual({
      context: { userId: SIGNED_IN, collection: "posts", entryId: "p1" },
      entryId: "p1",
    });
  });

  it("draws a block replacing the editor where the editor was, the bar and its banners staying", () => {
    // The server sends the replacement in the built-in's place and the
    // built-in no more.
    meta.contributions = {
      "collection.edit": {
        block: [
          { builtIn: "document-bar" },
          block("acme-a.editor", EDITOR, { replaces: "editor" }),
        ],
      },
    } as AdminContributionsMeta;
    renderEditor();

    expect(screen.queryByLabelText("Body")).toBeNull();
    expect(frame().lastElementChild).toBe(
      screen.getByTestId("replacement-editor").parentElement
    );
    expect(frame().firstElementChild).toBe(screen.getByTestId("document-bar"));
    expect(screen.getByText("lock banner")).toBeInTheDocument();
  });

  it("no tab strip without a delivered tab", () => {
    meta.contributions = {
      "collection.edit": {
        block: [
          { builtIn: "document-bar" },
          { builtIn: "editor" },
          block("acme-a.bottom", BOTTOM),
        ],
      },
    } as AdminContributionsMeta;
    renderEditor();

    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("a delivered tab follows the page's own content, over the field column, the bar staying", async () => {
    meta.contributions = {
      "collection.edit": {
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

    const strip = screen.getByRole("tablist");
    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "Content",
      "Acme",
    ]);
    expect(screen.getByRole("tab", { name: "Content" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // The strip heads the field column, not the page.
    expect(fieldColumn().firstElementChild?.contains(strip)).toBe(true);

    await userEvent.click(screen.getByRole("tab", { name: "Acme" }));
    expect(
      JSON.parse(screen.getByTestId("plugin-tab").textContent ?? "")
    ).toEqual({
      context: { userId: SIGNED_IN, collection: "posts", entryId: "p1" },
      entryId: "p1",
    });
    // The field column's content is hidden, not gone, and the bar stays.
    expect(screen.getByLabelText("Body")).not.toBeVisible();
    expect(screen.getByTestId("document-bar")).toBeVisible();
  });

  it("draws a plugin's section in the side panel, where the server put it", () => {
    meta.contributions = {
      "collection.edit": {
        sidebarSection: [
          { builtIn: "status" },
          {
            plugin: "@acme/a",
            id: "acme-a.notes",
            kind: "sidebarSection",
            label: "Notes",
            component: SECTION,
            after: "status",
          },
          { builtIn: "publishing" },
          { builtIn: "language" },
          { builtIn: "details" },
        ],
      },
    } as AdminContributionsMeta;
    editorWidth(1440);
    renderEditor();

    const notes = screen.getByRole("region", { name: "Notes" });
    expect(notes.previousElementSibling).toBe(
      screen.getByRole("region", { name: "Status" })
    );
    expect(
      JSON.parse(screen.getByTestId("plugin-section").textContent ?? "")
    ).toEqual({
      context: { userId: SIGNED_IN, collection: "posts", entryId: "p1" },
      entryId: "p1",
    });
  });

  it("leaves the editor in place where a replacement's rule does not match the entry", () => {
    // The entry is a draft, and the replacement is for published entries.
    meta.contributions = {
      "collection.edit": {
        block: [
          { builtIn: "document-bar" },
          block("acme-a.editor", EDITOR, {
            replaces: "editor",
            visibleWhen: { field: "status", equals: "published" },
            collections: ["posts"],
          }),
        ],
      },
    } as AdminContributionsMeta;
    renderEditor();

    expect(screen.queryByTestId("replacement-editor")).toBeNull();
    expect(screen.getByLabelText("Body")).toBeInTheDocument();
    expect(frame().lastElementChild).toBe(row());
  });

  it("draws no section scoped to another collection, and keeps the built-in one it replaces", () => {
    meta.contributions = {
      "collection.edit": {
        sidebarSection: [
          {
            plugin: "@acme/a",
            id: "acme-a.status",
            kind: "sidebarSection",
            label: "Ticket status",
            component: SECTION,
            replaces: "status",
            collections: ["tickets"],
          },
          { builtIn: "publishing" },
          { builtIn: "language" },
          { builtIn: "details" },
        ],
      },
    } as AdminContributionsMeta;
    editorWidth(1440);
    renderEditor();

    expect(screen.queryByTestId("plugin-section")).toBeNull();
    expect(screen.getByRole("region", { name: "Status" })).toBeInTheDocument();
  });
});
