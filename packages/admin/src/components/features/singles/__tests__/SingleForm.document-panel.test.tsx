/**
 * The Single editor's document panel, as the entry editor's: its sections
 * beside the fields, the preview pane folding it and showing it closing the
 * pane, and its frame at each width. The bar and the pane are recorders, so
 * what is asserted is what the editor hands them and the panel it draws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, render, screen, within } from "@admin/__tests__/utils";

const { barProps, paneProps, released, siteLocales } = vi.hoisted(() => ({
  barProps: vi.fn(),
  paneProps: vi.fn(),
  released: vi.fn(),
  // The site's languages; none unless a case configures them.
  siteLocales: { list: [] as { code: string; label: string }[] },
}));

vi.mock("@admin/components/features/entries/EntryForm/DocumentBar", () => ({
  DocumentBar: (props: Record<string, unknown>) => {
    barProps(props);
    return null;
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
    enabled: true,
    locales: siteLocales.list,
    defaultLocale: "en",
    fallback: true,
    getLocale: (code: string) =>
      siteLocales.list.find(locale => locale.code === code),
  }),
}));
vi.mock("@admin/hooks/queries/useReleases", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useReleases")
  >()),
  useReleasesContaining: (document: unknown) => {
    released(document);
    return { data: { items: [] }, isError: false, isPending: false };
  },
}));
// The Publishing section asks through the hook's own module.
vi.mock("@admin/hooks/queries/useReleasesContaining", () => ({
  useReleasesContaining: (document: unknown) => {
    released(document);
    return { data: { items: [] }, isError: false, isPending: false };
  },
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

import { SingleForm } from "../SingleForm";

// A Single with a publish lifecycle on a localized site: a preview is offered.
const schema = {
  slug: "landing-page",
  label: { singular: "Landing Page" },
  localized: true,
  status: true,
  fields: [{ name: "title", type: "text", label: "Title" }],
} as never;

const document = { id: "s1", title: "Hello", status: "draft" } as never;

function editorWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        width: this.hasAttribute("data-document-editor-frame") ? width : 0,
      } as DOMRect;
    }
  );
}

const renderEditor = () =>
  render(<SingleForm schema={schema} document={document} onSubmit={vi.fn()} />);

const lastBar = () => barProps.mock.calls.at(-1)![0] as Record<string, unknown>;
const lastPane = () =>
  paneProps.mock.calls.at(-1)![0] as Record<string, unknown>;
const run = (prop: string) =>
  act(() => {
    (lastBar()[prop] as () => void)();
  });
const dockedPanel = () =>
  screen.queryByRole("complementary", { name: "Document panel" });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  siteLocales.list = [];
});
afterEach(() => vi.restoreAllMocks());

describe("the Single editor's document panel", () => {
  // The docked rail carries the language panel whenever the panel is docked,
  // so the Single's pending shared change is said there too, not only in the
  // inline panel the docked layout hides.
  it("says in the docked panel while the Single's shared fields hold unpublished changes", () => {
    siteLocales.list = [
      { code: "en", label: "English" },
      { code: "de", label: "German" },
    ];
    const withShared = (pending: boolean) =>
      ({
        id: "s1",
        title: "Hello",
        status: "published",
        _sharedChangesPending: pending,
        _translations: {
          en: { translated: true, status: "published" },
          de: { translated: true, status: "published" },
        },
      }) as never;
    const { unmount } = render(
      <SingleForm
        schema={schema}
        document={withShared(true)}
        locale="de"
        onSubmit={vi.fn()}
      />
    );
    expect(
      within(dockedPanel()!).getByRole("status", {
        name: "Shared changes pending",
      })
    ).toBeInTheDocument();
    // And the inline panel, kept in the page while the docked layout hides
    // it, says it too: both read the one answer.
    expect(
      screen.getAllByRole("status", {
        name: "Shared changes pending",
        hidden: true,
      })
    ).toHaveLength(2);
    unmount();

    // The control: the same docked panel without a pending shared change.
    render(
      <SingleForm
        schema={schema}
        document={withShared(false)}
        locale="de"
        onSubmit={vi.fn()}
      />
    );
    expect(dockedPanel()).toBeInTheDocument();
    expect(
      within(dockedPanel()!).queryByRole("status", {
        name: "Shared changes pending",
      })
    ).toBeNull();
    expect(
      screen.queryAllByRole("status", {
        name: "Shared changes pending",
        hidden: true,
      })
    ).toHaveLength(0);
  });

  it("reads Status, Publishing and Details beside the fields, addressing the Single's releases by its slug", () => {
    renderEditor();
    const sections = within(dockedPanel()!)
      .getAllByRole("region")
      .map(section => section.getAttribute("data-panel-section"));
    expect(sections).toEqual(["Status", "Publishing", "Details"]);
    expect(screen.getByRole("region", { name: "Status" })).toHaveTextContent(
      "is a draft, not published yet."
    );
    // The address the page's scheduled-release banner asks with, so the two
    // read one answer.
    expect(released).toHaveBeenCalledWith({
      scopeKind: "single",
      scopeSlug: "landing-page",
      entryId: "s1",
    });
  });

  // The entry's status is the language being edited's own, not the main
  // row's. The plausible broken implementation reads the main row, so a
  // German nobody has published reads "published" because English is.
  it("shows the status of the language being edited, not the default's", () => {
    siteLocales.list = [
      { code: "en", label: "English" },
      { code: "de", label: "German" },
    ];
    const published = {
      id: "s1",
      title: "Hello",
      status: "published",
      _translations: {
        en: { translated: true, status: "published" },
        de: { translated: false },
      },
    } as never;
    render(
      <SingleForm
        schema={schema}
        document={published}
        locale="de"
        onSubmit={vi.fn()}
      />
    );

    expect(lastBar().documentStatus).toMatchObject({ status: "draft" });
    // German has no content of its own: it is not a draft yet, as the
    // Languages panel's "not translated" says of it.
    expect(screen.getByRole("region", { name: "Status" })).toHaveTextContent(
      "The German version isn't translated or published yet."
    );
  });

  it("calls a language with its own unpublished content a draft", () => {
    siteLocales.list = [
      { code: "en", label: "English" },
      { code: "de", label: "German" },
    ];
    const drafted = {
      id: "s1",
      title: "Hello",
      status: "published",
      _translations: {
        en: { translated: true, status: "published" },
        de: { translated: true, status: "draft" },
      },
    } as never;
    render(
      <SingleForm
        schema={schema}
        document={drafted}
        locale="de"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "Status" })).toHaveTextContent(
      "The German version is a draft, not published yet."
    );
  });

  it("folds while the preview is open, and closes the preview when it is shown again", () => {
    renderEditor();
    run("onTogglePreviewPane");
    expect(lastPane().open).toBe(true);
    expect(dockedPanel()).not.toBeInTheDocument();
    run("onToggleRail");
    expect(lastPane().open).toBe(false);
    expect(dockedPanel()).toBeInTheDocument();
  });

  it("floats under 1000px and is a sheet under 600px, closed until asked for", () => {
    editorWidth(860);
    const { unmount } = renderEditor();
    expect(lastBar().panelMode).toBe("floating");
    expect(dockedPanel()).not.toBeInTheDocument();
    run("onToggleRail");
    expect(dockedPanel()).toHaveAttribute("data-document-panel", "floating");
    unmount();

    vi.restoreAllMocks();
    editorWidth(390);
    renderEditor();
    expect(lastBar().panelMode).toBe("sheet");
    run("onToggleRail");
    expect(screen.getByRole("dialog", { name: "Document" })).toBeVisible();
  });
});
