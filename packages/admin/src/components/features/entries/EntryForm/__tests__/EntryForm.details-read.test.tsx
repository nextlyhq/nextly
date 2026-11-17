/**
 * The entry's details (its address, and who made and changed it) are read by
 * what draws them, the address chip and the side panel, and not by the editor
 * around them. A document view such as the page builder covers both, so
 * opening an entry straight into one makes no `?details=1` request; the entry
 * page, which draws both, reads them once and shows them.
 *
 * Counted where the read leaves the admin, `protectedApi.get`, because the
 * property is the request itself: a read whose answer nobody draws still
 * costs the open a round trip.
 */
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@admin/__tests__/utils";
import { protectedApi } from "@admin/lib/api/protectedApi";
import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";

const { ANSWER, barProps } = vi.hoisted(() => ({
  barProps: vi.fn(),
  ANSWER: {
    createdBy: { kind: "person", name: "Ana Lopez" },
    updatedBy: { kind: "person", name: "Ana Lopez" },
    updatedAt: "2026-11-16T10:00:00.000Z",
    address: {
      site: "https://ridgeline.com/",
      path: "/hello",
      aroundSlug: { before: "/", after: "" },
    },
  },
}));

// Every other read goes out as it does in the editor's other suites; only
// the details read is answered here.
vi.mock("@admin/lib/api/protectedApi", async importOriginal => {
  const original =
    await importOriginal<typeof import("@admin/lib/api/protectedApi")>();
  return {
    ...original,
    protectedApi: {
      ...original.protectedApi,
      get: vi.fn((url: string, ...rest: unknown[]) =>
        url.includes("details=1")
          ? Promise.resolve({ id: "e1", _details: ANSWER })
          : (
              original.protectedApi.get as (...args: unknown[]) => unknown
            )(url, ...rest)
      ),
    },
  };
});
vi.mock("../DocumentBar", () => ({
  DocumentBar: (props: Record<string, unknown>) => {
    barProps(props);
    return <div data-testid="document-bar" />;
  },
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
vi.mock("@admin/hooks/queries/useGeneralSettings", () => ({
  useGeneralSettings: () => ({ data: { siteUrl: "https://ridgeline.com" } }),
}));
vi.mock("@admin/hooks/queries/useReleasesContaining", () => ({
  useReleasesContaining: () => ({
    data: { items: [] },
    isError: false,
    isPending: false,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

import { EntryForm } from "../EntryForm";

const VIEW = "@acme/pb/admin#Builder";

function BuilderView(): ReactElement {
  return <div data-testid="builder-view" />;
}

const collection = {
  name: "pages",
  label: "Pages",
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "slug", type: "text", label: "Slug" },
  ],
} as never;

const entry = {
  id: "e1",
  title: "Hello",
  slug: "hello",
  createdAt: "2026-10-01T09:00:00Z",
  updatedAt: "2026-10-02T09:00:00Z",
} as never;

/** The URLs of every details read the editor has made. */
function detailsReads(): string[] {
  return vi
    .mocked(protectedApi.get)
    .mock.calls.map(([url]) => String(url))
    .filter(url => url.includes("details=1"));
}

/** Lets every query the editor started on mount send its request. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 50));
}

/** Lays the editor's frame out this wide, as a browser would. */
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
  vi.mocked(protectedApi.get).mockClear();
  barProps.mockClear();
  window.localStorage.clear();
  registerComponent(VIEW, BuilderView);
});

afterEach(() => {
  cleanup();
  clearRegistry();
  vi.restoreAllMocks();
});

describe("the entry's details read", () => {
  it("is not made when the entry opens in a document view, which draws neither the chip nor the panel", async () => {
    render(
      <EntryForm
        collection={collection}
        entry={entry}
        mode="edit"
        documentView={{ component: VIEW, onExit: vi.fn() }}
      />
    );
    expect(await screen.findByTestId("builder-view")).toBeInTheDocument();
    await settle();

    expect(detailsReads()).toEqual([]);
    // The positive control: the editor did make its other reads in this
    // time, so the silence above is the details read not being asked for.
    expect(vi.mocked(protectedApi.get).mock.calls.length).toBeGreaterThan(0);
  });

  it("is made once on the entry page, and the chip and the panel both show its answer", async () => {
    render(<EntryForm collection={collection} entry={entry} mode="edit" />);

    const panel = screen.getByRole("complementary", { name: "Document panel" });
    await waitFor(() =>
      expect(
        within(panel).getByRole("region", { name: "Details" })
      ).toHaveTextContent("Ana Lopez")
    );
    expect(screen.getByTestId("document-address")).toHaveTextContent(
      "ridgeline.com/hello"
    );
    await settle();

    // Two readers, one key, one request.
    expect(detailsReads()).toHaveLength(1);
    expect(detailsReads()[0]).toContain("/collections/pages/entries/e1?");
  });

  it("is not made again when the panel is opened later: the panel takes the chip's answer", async () => {
    // Floating at this width, so the panel is not drawn until asked for.
    editorWidth(860);
    render(<EntryForm collection={collection} entry={entry} mode="edit" />);
    expect(
      screen.queryByRole("complementary", { name: "Document panel" })
    ).not.toBeInTheDocument();
    await waitFor(() => expect(detailsReads()).toHaveLength(1));

    act(() => {
      (barProps.mock.calls.at(-1)![0].onToggleRail as () => void)();
    });
    const panel = screen.getByRole("complementary", { name: "Document panel" });
    expect(
      within(panel).getByRole("region", { name: "Details" })
    ).toHaveTextContent("Ana Lopez");
    await settle();

    expect(detailsReads()).toHaveLength(1);
  });

  it("is not made before the entry exists", async () => {
    render(<EntryForm collection={collection} mode="create" />);
    await settle();

    expect(detailsReads()).toEqual([]);
  });
});
