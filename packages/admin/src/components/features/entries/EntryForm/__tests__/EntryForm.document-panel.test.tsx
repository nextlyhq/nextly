/**
 * The entry editor's document panel: its sections beside the fields, how it
 * shares the right side with the preview pane, and how it sits at each width
 * the editor can have.
 *
 * The bar is a recorder, so what is asserted is what the editor HANDS it (the
 * toggles it runs, the mode it is told), and the pane is a recorder that still
 * renders the editor, so the panel is the editor's own, as drawn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, render, screen, within } from "@admin/__tests__/utils";

const { barProps, paneProps } = vi.hoisted(() => ({
  barProps: vi.fn(),
  paneProps: vi.fn(),
}));

vi.mock("../DocumentBar", () => ({
  DocumentBar: (props: Record<string, unknown>) => {
    barProps(props);
    return <div data-testid="document-bar" />;
  },
}));
vi.mock("@admin/components/features/entries/PreviewMode/PreviewPanes", () => ({
  PreviewPanes: ({
    children,
    ...rest
  }: { children: React.ReactNode } & Record<string, unknown>) => {
    paneProps(rest);
    return <div data-testid="pane">{children}</div>;
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
  useGeneralSettings: () => ({ data: { siteUrl: "https://site.example" } }),
}));
vi.mock("@admin/hooks/queries/useReleases", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useReleases")
  >()),
  useReleasesContaining: () => ({
    data: { items: [] },
    isError: false,
    isPending: false,
  }),
}));
// The Publishing section asks through the hook's own module.
vi.mock("@admin/hooks/queries/useReleasesContaining", () => ({
  useReleasesContaining: () => ({
    data: { items: [] },
    isError: false,
    isPending: false,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

import { EntryForm } from "../EntryForm";

const collection = {
  name: "posts",
  label: "Posts",
  status: true,
  fields: [{ name: "title", type: "text", label: "Title" }],
  admin: { preview: { hasPreview: true } },
} as never;

const entry = {
  id: "e1",
  title: "Hello",
  status: "published",
  createdAt: "2026-10-01T09:00:00Z",
  updatedAt: "2026-10-02T09:00:00Z",
} as never;

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

function renderEditor() {
  return render(
    <EntryForm collection={collection} entry={entry} mode="edit" />
  );
}

function lastBar(): Record<string, unknown> {
  const calls = barProps.mock.calls;
  expect(calls.length, "the bar was never rendered").toBeGreaterThan(0);
  return calls.at(-1)![0] as Record<string, unknown>;
}

function lastPane(): Record<string, unknown> {
  return paneProps.mock.calls.at(-1)![0] as Record<string, unknown>;
}

const run = (prop: string) =>
  act(() => {
    (lastBar()[prop] as () => void)();
  });

const dockedPanel = () =>
  screen.queryByRole("complementary", { name: "Document panel" });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("the entry editor's document panel", () => {
  it("reads Status, Publishing and Details beside the fields", () => {
    renderEditor();
    const panel = dockedPanel();
    expect(panel).toHaveAttribute("data-document-panel", "docked");
    const sections = within(panel!)
      .getAllByRole("region")
      .map(section => section.getAttribute("data-panel-section"));
    expect(sections).toEqual(["Status", "Publishing", "Details"]);
    expect(
      within(panel!).getByRole("region", { name: "Status" })
    ).toHaveTextContent("This document is published and up to date.");
  });

  it("folds while the preview is open, and closes the preview when it is shown again", () => {
    renderEditor();
    expect(dockedPanel()).toBeInTheDocument();
    expect(lastBar().isRailCollapsed).toBe(false);

    run("onTogglePreviewPane");
    expect(lastPane().open).toBe(true);
    expect(dockedPanel()).not.toBeInTheDocument();
    expect(lastBar().isRailCollapsed).toBe(true);

    run("onToggleRail");
    expect(lastPane().open).toBe(false);
    expect(dockedPanel()).toBeInTheDocument();
  });

  it("keeps the id beside the fields only while the docked panel is not there to carry it", () => {
    renderEditor();
    const copies = () =>
      screen.getAllByRole("button", { name: /copy id to clipboard/i });
    // Docked and open: the panel's Details carry it, once.
    expect(copies()).toHaveLength(1);
    expect(dockedPanel()).toContainElement(copies()[0]!);
    run("onToggleRail");
    // Folded: the line under the title carries it, once.
    expect(copies()).toHaveLength(1);
    expect(dockedPanel()).not.toBeInTheDocument();
  });
});

describe("the entry editor's document panel under 1000px", () => {
  it("is not on screen until asked for, then floats over the fields", () => {
    editorWidth(860);
    renderEditor();
    expect(lastBar().panelMode).toBe("floating");
    expect(screen.queryByText("Created")).not.toBeInTheDocument();
    // The id is still offered, on the line under the title.
    expect(
      screen.getByRole("button", { name: /copy id to clipboard/i })
    ).toBeInTheDocument();

    run("onToggleRail");
    expect(
      screen.getByRole("complementary", { name: "Document panel" })
    ).toHaveAttribute("data-document-panel", "floating");
  });
});

describe("the entry editor's document panel under 600px", () => {
  it("tells the bar to fold its controls into the menu, and opens as a sheet", () => {
    editorWidth(390);
    renderEditor();
    expect(lastBar().panelMode).toBe("sheet");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    run("onToggleRail");
    expect(screen.getByRole("dialog", { name: "Document" })).toHaveAttribute(
      "data-document-panel",
      "sheet"
    );
  });
});
