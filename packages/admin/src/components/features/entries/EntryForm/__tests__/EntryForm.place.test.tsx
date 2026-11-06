/**
 * The entry form's place in the entry editor: plugins' blocks around the
 * form's own fields, in the order the server sent, each told which document
 * the form edits; and nothing changed in the editor when nothing is
 * contributed.
 *
 * The banners are stood in for as the layout test stands them in, so what is
 * read is the editor's own column.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { AdminContributionsMeta } from "nextly/config";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const BLOCK = "@acme/a/admin#FormBlock";
registerComponent(BLOCK, ((props: { context?: unknown; entry?: unknown }) => (
  <pre data-testid="form-block">{JSON.stringify(props.context)}</pre>
)) as never);
const ENTRY_ECHO = "@acme/a/admin#FormEntry";
registerComponent(ENTRY_ECHO, ((props: { entry?: { id?: unknown } }) => (
  <p data-testid="form-entry">{String(props.entry?.id)}</p>
)) as never);

function block(id: string, extra: object = {}) {
  return { plugin: "@acme/a", id, kind: "block", component: BLOCK, ...extra };
}

function renderEditor() {
  return render(<EntryForm collection={posts} entry={entry} mode="edit" />, {
    wrapper: Providers,
  });
}

/** The form's own fields, as the editor frames them. */
function fields(): HTMLElement {
  return screen
    .getByLabelText("Body")
    .closest<HTMLElement>("[class~='@4xl/content:p-8']")!;
}

beforeEach(() => {
  meta.contributions = undefined;
  meta.user = { id: SIGNED_IN };
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the entry form's place in the entry editor", () => {
  it("with no contributions the editor draws as before", () => {
    renderEditor();

    // The fields stand straight in the editor's column, after the title, as
    // they did before the place: nothing wraps them and nothing is added.
    const column = fields().parentElement!;
    expect(column.children).toHaveLength(2);
    expect(column.lastElementChild).toBe(fields());
    expect(
      column.firstElementChild?.contains(screen.getByLabelText("Title"))
    ).toBe(true);
  });

  it("draws a block after the fields, told which document the form edits", () => {
    meta.contributions = {
      "entry.form": {
        block: [{ builtIn: "fields" }, block("acme-a.form-block")],
      },
    } as AdminContributionsMeta;
    renderEditor();

    const drawn = screen.getByTestId("form-block");
    expect(fields().nextElementSibling).toBe(drawn);
    expect(JSON.parse(drawn.textContent ?? "")).toEqual({
      userId: SIGNED_IN,
      kind: "collection",
      slug: "posts",
      entryId: "p1",
    });
  });

  it("hands a block the entry the form edits", () => {
    meta.contributions = {
      "entry.form": {
        block: [
          { builtIn: "fields" },
          {
            plugin: "@acme/a",
            id: "acme-a.form-entry",
            kind: "block",
            component: ENTRY_ECHO,
          },
        ],
      },
    } as AdminContributionsMeta;
    renderEditor();

    expect(screen.getByTestId("form-entry").textContent).toBe("p1");
  });

  it("draws no block before the signed-in admin is known", () => {
    meta.user = null;
    meta.contributions = {
      "entry.form": {
        block: [{ builtIn: "fields" }, block("acme-a.form-block")],
      },
    } as AdminContributionsMeta;
    renderEditor();

    expect(screen.queryByTestId("form-block")).toBeNull();
    expect(fields()).toBeTruthy();
  });
});
