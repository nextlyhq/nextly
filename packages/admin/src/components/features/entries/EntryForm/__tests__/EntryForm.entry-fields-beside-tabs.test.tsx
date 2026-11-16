/**
 * The entry's fields a surface draws beside a field that takes the form over
 * (`useEntryFieldsPanel`) leave out the fields a plugin's tab takes over, as
 * the edit page's own content does: they are drawn, and edited, in their tab.
 * A field no tab takes is still drawn.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminContributionsMeta } from "nextly/config";
import type { JSX, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, createTestQueryClient, screen } from "@admin/__tests__/utils";

const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
}));
const { update, create } = vi.hoisted(() => ({
  update: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ contributions: meta.contributions }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({
    user: { id: "11111111-1111-4111-8111-111111111111" },
  }),
}));
vi.mock("@admin/hooks/queries/useDocumentLock", () => ({
  useDocumentLock: () => ({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  }),
}));
vi.mock("@admin/hooks/queries/useUpdateEntry", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useUpdateEntry")
  >()),
  useUpdateEntry: () => ({ mutateAsync: update, isPending: false }),
}));
vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: create, isPending: false }),
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

import {
  registerComponent,
  unregisterComponent,
} from "@admin/lib/plugins/component-registry";

import { EntryForm } from "../EntryForm";
import { useEntryFieldsPanel } from "../EntryFormContext";

const TAKES = "@acme/seo/admin#SummaryTab";
const BESIDE = "@acme/seo/admin#BesideTab";

/** A tab taking over the entry's summary. */
function SummaryTab(): JSX.Element {
  return <p>The summary, edited here</p>;
}

/** The fields drawn beside the title, as a takeover surface draws them. */
function BesideTab(): JSX.Element {
  const beside = useEntryFieldsPanel("title", { presentation: "dialog" });
  return <section aria-label="Beside the title">{beside}</section>;
}

const tabs = {
  "collection.edit": {
    tab: [
      {
        plugin: "@acme/seo",
        id: "acme-seo.summary",
        kind: "tab",
        label: "Summary",
        component: TAKES,
        fields: ["summary"],
      },
      {
        plugin: "@acme/seo",
        id: "acme-seo.beside",
        kind: "tab",
        label: "Beside",
        component: BESIDE,
      },
    ],
  },
} as AdminContributionsMeta;

const collection = {
  name: "posts",
  slug: "posts",
  label: "Posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "summary", type: "text", label: "Summary" },
    { name: "body", type: "text", label: "Body" },
  ],
} as never;
const entry = { id: "e1", title: "Hello", summary: "", body: "" } as never;

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  meta.contributions = tabs;
  window.history.replaceState(null, "", "/admin/collections/posts/e1");
  registerComponent(TAKES, SummaryTab as never);
  registerComponent(BESIDE, BesideTab as never);
});
afterEach(() => {
  cleanup();
  unregisterComponent(TAKES);
  unregisterComponent(BESIDE);
  window.history.replaceState(null, "", "/");
});

describe("the entry's fields drawn beside a takeover field", () => {
  it("leave out a field a plugin's tab takes over, and keep the others", async () => {
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });
    await userEvent.click(await screen.findByRole("tab", { name: /Beside/ }));

    const beside = await screen.findByRole("region", {
      name: "Beside the title",
    });
    expect(beside.querySelector('[data-field="body"]')).not.toBeNull();
    expect(beside.querySelector('[data-field="summary"]')).toBeNull();
  });
});
