// @vitest-environment jsdom
/**
 * What the editor has open, as the shared-style usage reads name it: the
 * saved document, the field the editor is bound to, the language and the
 * stored form, so the site's counts take the open field's live blocks in
 * place of its saved ones. Both reads name it: the inspector's, and the
 * Design panel's Shared styles tab.
 */
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const document = vi.hoisted(() => ({
  identity: null as null | {
    kind: "collection" | "single";
    slug: string;
    documentId?: string;
  },
  locale: null as null | { code: string | null },
  status: null as null | { status: string; hasWorkingDraft: boolean },
  storedAt: null as null | Date,
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useDocumentIdentity: () => document.identity,
  useDocumentLocale: () => document.locale,
  useDocumentStatus: () => document.status,
  useDocumentActions: () => ({ storedAt: document.storedAt }),
  usePluginClientConfig: () => undefined,
}));

vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: () => true,
}));

// The shared-style routes, recording what each read is told is open, and
// how often the usage is read.
const asked = vi.hoisted(() => [] as unknown[]);
const usageReads = vi.hoisted(() => ({
  access: undefined as undefined | { usage: (...args: never[]) => unknown },
}));
vi.mock("../shared-styles-client", () => {
  const access = {
    usage: vi.fn(async () => ({
      whole: true,
      counting: false,
      mayLock: false,
      styles: new Map(),
    })),
    uses: async () => ({
      items: [],
      total: 0,
      hidden: 0,
      hasNext: false,
      complete: true,
    }),
    lock: async () => undefined,
    remove: async () => undefined,
  };
  usageReads.access = access;
  return {
    useSharedStylesClient: (here: unknown) => {
      asked.push(here);
      return access;
    },
  };
});

import type { ClassSurface } from "./site-style-class-surface";
import { SharedStylesStudio } from "./site-style-shared-styles";
import { UsageHereField, useUsageHere } from "./usage-here";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  asked.length = 0;
  document.identity = null;
  document.locale = null;
  document.status = null;
  document.storedAt = null;
});

/** The editor bound to `field`, around whatever reads what is open. */
const boundTo =
  (field: string) =>
  ({ children }: { children: React.ReactNode }) => (
    <UsageHereField.Provider value={field}>{children}</UsageHereField.Provider>
  );

describe("what the editor has open", () => {
  it("names the document, the field, the language and the main row", () => {
    document.identity = { kind: "collection", slug: "pages", documentId: "p1" };
    document.locale = { code: "fr" };
    document.status = { status: "draft", hasWorkingDraft: false };
    const { result } = renderHook(() => useUsageHere(), {
      wrapper: boundTo("content"),
    });
    expect(result.current).toEqual({
      document: { collection: "pages", id: "p1" },
      field: "content",
      locale: "fr",
      variant: "published",
    });
  });

  it("keeps a published page's saved copy while it has no pending draft", () => {
    document.identity = { kind: "collection", slug: "pages", documentId: "p1" };
    document.status = { status: "published", hasWorkingDraft: false };
    const { result } = renderHook(() => useUsageHere(), {
      wrapper: boundTo("content"),
    });
    expect(result.current).toEqual({
      document: { collection: "pages", id: "p1" },
      field: "content",
      variant: "published",
      keepsSaved: true,
    });
  });

  it("names the pending draft where the document has one, and a Single by its slug", () => {
    document.identity = { kind: "single", slug: "home" };
    document.status = { status: "published", hasWorkingDraft: true };
    const { result } = renderHook(() => useUsageHere(), {
      wrapper: boundTo("content"),
    });
    // No language: the site's default, which the route resolves.
    expect(result.current).toEqual({
      document: { single: "home" },
      field: "content",
      variant: "draft",
    });
  });

  it("names nothing before the entry is saved, or outside an editor", () => {
    document.identity = { kind: "collection", slug: "pages" };
    expect(
      renderHook(() => useUsageHere(), { wrapper: boundTo("content") }).result
        .current
    ).toBeUndefined();
    document.identity = { kind: "collection", slug: "pages", documentId: "p1" };
    expect(renderHook(() => useUsageHere()).result.current).toBeUndefined();
  });
});

describe("the Design panel's Shared styles tab", () => {
  const surfaceOf = (library: ClassSurface["library"]): ClassSurface => ({
    library,
    absence: "pending",
    add: async () => undefined,
    writeStyles: async () => undefined,
    pendingNames: {},
    currentRenameAttempt: () => 0,
    rename: async () => ({ ok: true }),
    edit: async () => undefined,
  });
  const studio = (surface: ClassSurface) => (
    <UsageHereField.Provider value="content">
      <SharedStylesStudio
        classes={surface}
        pageBlocks={{ counts: new Map(), complete: true }}
        styleContext={{ breakpoints: { viewport: [], container: [] } }}
        suppliedClassIds={undefined}
        tokens={undefined}
      />
    </UsageHereField.Provider>
  );

  it("reads every row's usage again once what is open changes", async () => {
    // A draft, then published with no pending draft: the rows' counts were
    // read with the draft's parts, which no longer describe the open page.
    document.identity = { kind: "collection", slug: "pages", documentId: "p1" };
    document.status = { status: "draft", hasWorkingDraft: false };
    const surface = surfaceOf([
      {
        id: "c-card",
        slug: "card",
        label: "Card",
        orderIndex: 0,
        styles: { base: { base: { color: "#111111" } } },
      },
    ]);
    const view = render(studio(surface));
    const usage = vi.mocked(usageReads.access?.usage);
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(1));
    document.status = { status: "published", hasWorkingDraft: false };
    view.rerender(studio(surface));
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(2));
  });

  it("reads every row's usage again once the page is stored", async () => {
    // A published page saved again where the collection keeps no drafts:
    // nothing about what is open changes, but its saved parts do.
    document.identity = { kind: "collection", slug: "pages", documentId: "p1" };
    document.status = { status: "published", hasWorkingDraft: false };
    const surface = surfaceOf([
      {
        id: "c-card",
        slug: "card",
        label: "Card",
        orderIndex: 0,
        styles: { base: { base: { color: "#111111" } } },
      },
    ]);
    const view = render(studio(surface));
    const usage = vi.mocked(usageReads.access?.usage);
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(1));
    document.storedAt = new Date(1_000);
    view.rerender(studio(surface));
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(2));
  });

  it("names what the editor has open in its usage read", () => {
    document.identity = { kind: "collection", slug: "pages", documentId: "p1" };
    const surface: ClassSurface = {
      library: [],
      absence: "pending",
      add: async () => undefined,
      writeStyles: async () => undefined,
      pendingNames: {},
      currentRenameAttempt: () => 0,
      rename: async () => ({ ok: true }),
      edit: async () => undefined,
    };
    render(
      <UsageHereField.Provider value="content">
        <SharedStylesStudio
          classes={surface}
          pageBlocks={{ counts: new Map(), complete: true }}
          styleContext={{ breakpoints: { viewport: [], container: [] } }}
          suppliedClassIds={undefined}
          tokens={undefined}
        />
      </UsageHereField.Provider>
    );
    expect(asked.at(-1)).toEqual({
      document: { collection: "pages", id: "p1" },
      field: "content",
      variant: "published",
    });
  });
});
