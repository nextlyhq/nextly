// @vitest-environment jsdom
/**
 * Page settings: one row of tabs (General, Fields, the place's tabs in their
 * order) with "Site settings ▸" apart for a role that may manage the site;
 * General's title and address, header & footer and sharing; Fields through
 * the form's renderer, with another builder field as a line; the line every
 * tab ends with and "Open as form"; read-only said once; "Show me" opening
 * the field's tab; Enter and Escape that stay with the field. Then Site
 * settings in its own dialog: live at once, and asking before a draft goes.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteCodeRead, SiteSettingsRead } from "../../library-contract";
import type { PageAddressResponse } from "../../pages-search-contract";
import {
  settingsAddressOf,
  useSavedRevision,
  type SettingsAddress,
} from "./settings-address";
import type { SettingsPlace } from "./settings-place";

let siteRead: SiteSettingsRead | undefined;
/** The site code read, empty: its section has tests of its own. */
const codeRead: SiteCodeRead = {
  head: "",
  body: "",
  version: null,
  policyDeclared: false,
  described: { head: [], body: [] },
  changedAt: null,
  changedBy: null,
};
// The page address read's answer, and the paths it was asked at.
let addressRead: PageAddressResponse | undefined;
const addressAsked: string[] = [];
let siteError: Error | null = null;
let siteFetching = false;
const refetch = vi.fn();

/** A tab the place delivers, as the admin's hook hands it. */
interface DeliveredTab {
  id: string;
  label: string;
  trigger: ReactNode;
  panel: ReactNode;
  accessibleName?: string;
}
/** The place's tabs, in the order delivered; a case sets them. */
let delivered: DeliveredTab[] = [];
/** What each read of the place's tabs was handed. */
const placeAsked: Record<string, unknown>[] = [];
/** What each draw of the entry's fields asked for. */
const fieldsAsked: { name: string; options: Record<string, unknown> }[] = [];
/** Whether the page's content has anything left for Fields. */
let contentLeft = true;
/** The content's top-level fields, as the entry page lays them out. */
let contentFields: { name: string; type: string; label: string }[] = [];
/** Where the entry page draws a path; a case sets it. */
let tabOf: (path: string) => unknown = () => null;
/** The reveal Page settings registered for "Show me", as last registered. */
let reveal: ((path: string) => (() => void) | null) | null = null;
/** Whether the page takes edits now. */
let titleWritable = true;
const navigateTo = vi.fn();

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: ({ path }: { path: string }) => {
    if (path === "/site/code") {
      return {
        data: codeRead,
        pending: false,
        error: null,
        fetching: false,
        refetch: vi.fn(),
      };
    }
    if (path === "/layouts/page-collection") {
      return {
        data: {
          pagesCollection: "pages",
          layoutsCollection: "site_layouts",
          templatesCollection: "templates",
        },
        pending: false,
        error: null,
        fetching: false,
        refetch: vi.fn(),
      };
    }
    if (path.startsWith("/pages/address")) {
      addressAsked.push(path);
      return {
        data: addressRead,
        pending: false,
        error: null,
        fetching: false,
        refetch,
      };
    }
    return {
      data: siteRead,
      pending: false,
      error: siteError,
      fetching: siteFetching,
      refetch,
    };
  },
  usePlaceTabs: (options: Record<string, unknown>) => {
    placeAsked.push(options);
    return options.context === null ? [] : delivered;
  },
  // The entry's own renderer, standing in: the identity as two real
  // controls, the rest as one, so a case can type and press keys in them.
  useEntryFieldsPanel: (
    name: string,
    options: Record<string, unknown> = {}
  ) => {
    fieldsAsked.push({ name, options });
    if (options.group === "page") {
      return (
        <div data-field="title">
          <input aria-label="Title" defaultValue="Pricing" name="title" />
          <div role="group" aria-label="Address">
            ridgeline.com/pricing
          </div>
        </div>
      );
    }
    if (options.group === "content") {
      return contentLeft ? (
        <div data-field="summary">
          <label>
            Summary
            <input name="summary" defaultValue="Fixed quotes." />
          </label>
        </div>
      ) : null;
    }
    return <input aria-label="Component title" defaultValue="Card" />;
  },
  useEntryFieldsLayout: () => ({ tabOf, contentFields }),
  useRevealField: (next: typeof reveal) => {
    reveal = next;
  },
  useDocumentField: (path: string) =>
    path === "title"
      ? { value: "Pricing", writable: titleWritable, set: vi.fn() }
      : null,
  useDocumentIdentity: () => ({
    kind: "collection",
    slug: "pages",
    documentId: "p1",
  }),
  navigateTo: (href: string) => navigateTo(href),
}));

// The header & footer menu has tests of its own; here it only takes its
// place, and says whether it was held.
vi.mock("../page-layout", () => ({
  PageLayoutPicker: ({ disabled }: { disabled?: boolean }) => (
    <div
      role="group"
      aria-label="Header & footer"
      data-held={String(disabled)}
    />
  ),
}));

// The section's own behaviour is the builder's to test; here it only says
// when editing starts, as the real one does.
vi.mock("@nextlyhq/builder/shell", async importOriginal => ({
  ...(({ EDITOR_WORDS, BASE_DEVICE_LABEL, SITE_CODE_POLICY_DOCS_HREF }) => ({
    EDITOR_WORDS,
    BASE_DEVICE_LABEL,
    SITE_CODE_POLICY_DOCS_HREF,
  }))(await importOriginal<typeof import("@nextlyhq/builder/shell")>()),
  BreakpointManager: ({
    status,
    onEditingChange,
    onSavingChange,
  }: {
    status?: string;
    onEditingChange?: (editing: boolean) => void;
    onSavingChange?: (saving: boolean) => void;
  }) => (
    <>
      <output aria-label="Breakpoints status">{status}</output>
      <button type="button" onClick={() => onEditingChange?.(true)}>
        Edit breakpoints
      </button>
      <button type="button" onClick={() => onSavingChange?.(true)}>
        Start saving
      </button>
      <input aria-label="Breakpoint name" defaultValue="Tablet" />
    </>
  ),
}));

const { SettingsDialog } = await import("./settings-dialog");
const { HeaderFooterMenu } = await import("./settings-general");

// What Radix's Select reaches for and jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const MANAGER: SiteSettingsRead = {
  mayManageSite: true,
  mayChooseDefaultLayout: true,
  defaultLayout: "main",
  breakpoints: null,
  // The default only, which Site settings names.
  layouts: [{ id: "main", title: "Main" }],
};

/** The place a page's dialog is drawn with. */
const PAGE_PLACE: SettingsPlace = {
  context: {
    userId: "u1",
    document: "page",
    collection: "pages",
    entryId: "p1",
    draws: null,
  },
  tabProps: {
    seo: { value: undefined, set: vi.fn() },
    design: { formatVersion: 1, kind: "page", nodes: [] },
    control: {} as never,
    writable: true,
    holdEdit: () => () => {},
  },
  flushHeld: () => null,
};

/** A tab another plugin adds to the place. */
function placeTab(id: string, label: string): DeliveredTab {
  return {
    id,
    label,
    trigger: label,
    panel: <p>{label} panel</p>,
  };
}

/** Renders the dialog again with the current reads, as a refetch would. */
let reshow: () => void = () => {};

interface Shown {
  onOpenChange?: ReturnType<typeof vi.fn>;
  kind?: "page" | "component" | "template";
  open?: boolean;
  seoFields?: boolean;
  address?: SettingsAddress | null;
  place?: SettingsPlace | null;
  openAsForm?: () => void;
}

function show({
  onOpenChange = vi.fn(),
  kind = "page",
  open = true,
  seoFields = true,
  address = null,
  place = PAGE_PLACE,
  openAsForm,
}: Shown = {}) {
  // Built afresh each time: React skips a child whose element is unchanged,
  // so re-rendering the same tree would never ask the dialog again.
  const element = (isOpen = open): ReactElement => (
    <form data-testid="page-form" onSubmit={event => event.preventDefault()}>
      <button type="button">Settings</button>
      <SettingsDialog
        open={isOpen}
        onOpenChange={onOpenChange}
        returnFocus={() => null}
        kind={kind}
        pageTitle="Pricing"
        fieldName="layout"
        headerFooter={
          kind === "page" ? <HeaderFooterMenu control={{} as never} /> : null
        }
        place={place}
        share={{ title: "Who we are", description: "We build tools." }}
        seoFields={seoFields}
        address={address}
        breakpoints={{
          value: { viewport: [], container: [] },
          onSave: vi.fn(),
          status: "ready",
          refresh: vi.fn(),
        }}
        openAsForm={openAsForm}
      />
    </form>
  );
  const { rerender } = render(element());
  reshow = () => rerender(element());
  return {
    onOpenChange,
    reopen: () => rerender(element(true)),
  };
}

const tabNames = () =>
  within(screen.getByRole("tablist"))
    .getAllByRole("tab")
    .map(tab => tab.textContent);

const order = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  delivered = [];
  placeAsked.length = 0;
  fieldsAsked.length = 0;
  contentLeft = true;
  contentFields = [
    { name: "summary", type: "textarea", label: "Summary" },
    { name: "layout", type: "blocks", label: "Layout" },
  ];
  tabOf = () => null;
  reveal = null;
  titleWritable = true;
  navigateTo.mockClear();
  addressRead = undefined;
  addressAsked.length = 0;
  siteRead = MANAGER;
  siteError = null;
  siteFetching = false;
  refetch.mockClear();
});
afterEach(cleanup);

describe("Page settings", () => {
  it("is titled by the page, with one row of tabs: General, then Fields", () => {
    show();
    expect(
      screen.getByRole("dialog", { name: "Page settings · Pricing" })
    ).toBeTruthy();
    expect(tabNames()).toEqual(["General", "Fields"]);
  });

  it("lifts the place's tabs into the same row, after Fields, in the order delivered", () => {
    delivered = [
      placeTab("nextlyhq-plugin-seo.page-builder-tab", "SEO"),
      placeTab("acme-reviews.tab", "Reviews"),
    ];
    show();
    expect(tabNames()).toEqual(["General", "Fields", "SEO", "Reviews"]);
    // Handed the place, its context and the page's props, with a way back
    // to General.
    expect(placeAsked.at(-1)).toMatchObject({
      place: "nextlyhq-plugin-page-builder.settings",
      context: PAGE_PLACE.context,
      tabProps: { writable: true },
    });
  });

  it("keeps a place tab mounted while closed, and shows General again when it asks", async () => {
    delivered = [placeTab("acme-reviews.tab", "Reviews")];
    show();
    // Mounted, only hidden: its count stays current and what it holds kept.
    expect(screen.getByText("Reviews panel", { selector: "p" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Reviews" }));
    expect(
      screen.getByRole("tab", { name: "Reviews" }).getAttribute("aria-selected")
    ).toBe("true");
    const handed = placeAsked.at(-1) as {
      tabProps: { openGeneral: () => void };
    };
    act(() => handed.tabProps.openGeneral());
    expect(
      screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")
    ).toBe("true");
  });

  it("offers Site settings apart from the tabs, only to a role that may manage the site", () => {
    show();
    const site = screen.getByRole("button", { name: "Site settings" });
    expect(
      within(screen.getByRole("tablist")).queryByText("Site settings")
    ).toBeNull();
    expect(order(screen.getByRole("tablist"), site)).toBe(true);
    cleanup();

    siteRead = { ...MANAGER, mayManageSite: false, layouts: [] };
    show();
    expect(screen.queryByRole("button", { name: "Site settings" })).toBeNull();
  });

  it("ends every tab with the line saying it saves with the page, and Open as form", async () => {
    const openAsForm = vi.fn();
    delivered = [placeTab("acme-reviews.tab", "Reviews")];
    show({ openAsForm });
    for (const name of ["General", "Fields", "Reviews"]) {
      await userEvent.click(screen.getByRole("tab", { name }));
      expect(
        screen.getByText("Saved with the page when you Save or Publish.")
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open as form" })).toBeTruthy();
    }
    await userEvent.click(screen.getByRole("button", { name: "Open as form" }));
    expect(openAsForm).toHaveBeenCalledTimes(1);
  });

  it("moves between the tabs with the arrow keys", async () => {
    delivered = [placeTab("acme-reviews.tab", "Reviews")];
    show();
    screen.getByRole("tab", { name: "General" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Fields" })
    );
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Reviews" })
    );
  });

  it("draws General in order: the title and address, the header & footer, then sharing", () => {
    show();
    const title = screen.getByRole("textbox", { name: "Title" });
    const address = screen.getByRole("group", { name: "Address" });
    const headerFooter = screen.getByRole("group", { name: "Header & footer" });
    const sharing = screen.getByRole("heading", { name: "Search and sharing" });
    expect(order(title, address)).toBe(true);
    expect(order(address, headerFooter)).toBe(true);
    expect(order(headerFooter, sharing)).toBe(true);
    // The title and the address are the renderer's identity, asked of the
    // entry form for the page, never drawn by the builder itself.
    expect(fieldsAsked).toContainEqual({
      name: "layout",
      options: { presentation: "dialog", group: "page" },
    });
  });

  it("keeps the hint about / in an address where the page's address can sit beneath another's", () => {
    const address: SettingsAddress = {
      page: { collection: "pages", id: "p-1" },
      locale: "fr",
      savedSlug: "pricing",
      slugChanged: false,
      savedRevision: 0,
    };
    addressRead = { path: "/company/pricing" };
    show({ address });
    expect(
      screen.getByText(/To put this page beneath another, use \//)
    ).toBeTruthy();
    // Asked of the server for this page, in the language being edited.
    expect(addressAsked.at(-1)).toBe(
      "/pages/address?collection=pages&id=p-1&locale=fr"
    );
    cleanup();

    // Another collection's page has no address the plugin answers: no hint.
    addressRead = { path: null };
    show({ address });
    expect(screen.queryByText(/To put this page beneath another/)).toBeNull();
  });

  it("shows the share preview on General, and says the SEO plugin adds fields only without them", () => {
    show({ seoFields: false });
    const preview = screen.getByRole("figure", { name: "Share preview" });
    expect(preview.textContent).toContain("Who we are");
    expect(screen.getByText(/The SEO plugin adds fields/)).toBeTruthy();
    cleanup();
    show({ seoFields: true });
    expect(screen.queryByText(/The SEO plugin adds fields/)).toBeNull();
  });

  it("draws Fields with the form's renderer, the page's identity left to General", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Fields" }));
    expect(screen.getByRole("textbox", { name: "Summary" })).toBeTruthy();
    expect(fieldsAsked).toContainEqual({
      name: "layout",
      options: { presentation: "dialog", group: "content", leaveOut: [] },
    });
  });

  it("draws another field the builder edits as a line with Open in builder, never as an editor", async () => {
    contentFields = [
      { name: "summary", type: "textarea", label: "Summary" },
      { name: "layout", type: "blocks", label: "Layout" },
      { name: "sidebar", type: "blocks", label: "Sidebar" },
    ];
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Fields" }));
    // Left out of the renderer, which would draw its editor.
    expect(
      fieldsAsked.filter(asked => asked.options.group === "content").at(-1)
        ?.options
    ).toEqual({
      presentation: "dialog",
      group: "content",
      leaveOut: ["sidebar"],
    });
    const line = screen.getByRole("group", { name: "Sidebar" });
    await userEvent.click(
      within(line).getByRole("button", { name: "Open in builder" })
    );
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/pages/p1/builder?field=sidebar"
    );
  });

  it("leaves Fields out where nothing is left for it", () => {
    contentLeft = false;
    show();
    expect(tabNames()).toEqual(["General"]);
  });

  it("keeps a component's own settings on General, with no Fields tab", () => {
    show({ kind: "component", place: null });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(tabNames()).toEqual(["General"]);
    expect(
      screen.getByRole("textbox", { name: "Component title" })
    ).toBeTruthy();
    // Asked for as it always was: both groups, as the form draws them.
    expect(fieldsAsked).toContainEqual({
      name: "layout",
      options: { presentation: "dialog" },
    });
    expect(screen.queryByRole("group", { name: "Header & footer" })).toBeNull();
  });

  it("puts a template's place tabs in the same single row", () => {
    delivered = [placeTab("nextlyhq-plugin-seo.page-builder-tab", "SEO")];
    show({
      kind: "template",
      place: {
        ...PAGE_PLACE,
        context: {
          ...PAGE_PLACE.context!,
          document: "template",
          collection: "templates",
          draws: { collection: "posts", entryId: null },
        },
      },
    });
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(tabNames()).toEqual(["General", "SEO"]);
  });

  it("says once at the top why the settings are read-only, and holds the menu", () => {
    titleWritable = false;
    delivered = [placeTab("acme-reviews.tab", "Reviews")];
    show();
    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(screen.getByRole("note").textContent).toMatch(/read-only/);
    expect(
      screen.getByRole("group", { name: "Header & footer" }).dataset.held
    ).toBe("true");
    cleanup();
    titleWritable = true;
    show();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("never lets Enter in a field submit the page, but lets an IME accept", () => {
    const submitted = vi.fn((event: Event) => event.preventDefault());
    show();
    screen.getByTestId("page-form").addEventListener("submit", submitted);
    const input = screen.getByRole("textbox", { name: "Title" });
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    const composing = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    input.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
  });

  it("leaves Escape to a control that answers it, and closes on it elsewhere", () => {
    const { onOpenChange } = show();
    const own = document.createElement("input");
    own.setAttribute("data-own-escape", "");
    screen.getByRole("group", { name: "Address" }).append(own);
    own.focus();
    fireEvent.keyDown(own, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();

    const title = screen.getByRole("textbox", { name: "Title" });
    title.focus();
    fireEvent.keyDown(title, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a refused field: Show me opens the dialog on its tab with the field focused", async () => {
    delivered = [placeTab("nextlyhq-plugin-seo.page-builder-tab", "SEO")];
    tabOf = path =>
      path === "summary"
        ? { kind: "content" }
        : path === "title"
          ? { kind: "page" }
          : path.startsWith("seo.")
            ? { kind: "tab", id: "nextlyhq-plugin-seo.tab" }
            : null;
    const { onOpenChange, reopen } = show({ open: false });
    // A field the dialog does not show is left to the message's usual link.
    expect(reveal?.("promo")).toBeNull();

    act(() => reveal?.("summary")?.());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    reopen();
    await waitFor(() =>
      expect(
        screen
          .getByRole("tab", { name: "Fields" })
          .getAttribute("aria-selected")
      ).toBe("true")
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Summary" })
      )
    );

    // A field the SEO plugin's tab takes on the entry page is on its tab here.
    act(() => reveal?.("seo.title")?.());
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "SEO" }).getAttribute("aria-selected")
      ).toBe("true")
    );
    act(() => reveal?.("title")?.());
    await waitFor(() =>
      expect(
        screen
          .getByRole("tab", { name: "General" })
          .getAttribute("aria-selected")
      ).toBe("true")
    );
  });

  it("offers no Show me for the page's content when Fields is left out", () => {
    contentLeft = false;
    tabOf = () => ({ kind: "content" });
    show({ open: false });
    expect(reveal?.("summary")).toBeNull();
  });
});

describe("the page's saved address", () => {
  it("counts a save each time the form takes in new stored values", () => {
    // Every load or save installs a fresh defaults object; drawing again
    // with the same one is not a save.
    const first = { slug: "about-us" };
    const { result, rerender } = renderHook(
      ({ saved }: { saved: unknown }) => useSavedRevision(saved),
      { initialProps: { saved: first as unknown } }
    );
    expect(result.current).toBe(0);
    rerender({ saved: first });
    expect(result.current).toBe(0);
    rerender({ saved: { slug: "about-us" } });
    expect(result.current).toBe(1);
  });

  it("reads the saved entry's address, and a slug typed since as a change", () => {
    const saved = { kind: "collection", slug: "pages", documentId: "p-1" };
    expect(settingsAddressOf(saved, "about-us", "about-us", 0)).toEqual({
      page: { collection: "pages", id: "p-1" },
      savedSlug: "about-us",
      slugChanged: false,
      savedRevision: 0,
    });
    expect(settingsAddressOf(saved, "about", "about-us", 0)?.slugChanged).toBe(
      true
    );
    // Never saved, or a Single: no page address to read.
    expect(
      settingsAddressOf(
        { kind: "collection", slug: "pages" },
        "a",
        undefined,
        0
      )
    ).toBeNull();
    expect(
      settingsAddressOf(
        { kind: "single", slug: "home", documentId: "1" },
        "a",
        "a",
        0
      )
    ).toBeNull();
  });

  it("reads the hint's address again after every save, whichever field it changed", () => {
    // A host's path can name fields besides the slug: a save that changes
    // one of them moves the page while the slug stays as it was.
    addressRead = { path: "/news/about-us" };
    const address: SettingsAddress = {
      page: { collection: "pages", id: "p-1" },
      savedSlug: "about-us",
      slugChanged: false,
      savedRevision: 0,
    };
    let shown = address;
    const element = () => (
      <SettingsDialog
        open
        onOpenChange={vi.fn()}
        returnFocus={() => null}
        kind="page"
        pageTitle="About"
        fieldName="layout"
        share={{ title: "About" }}
        seoFields
        address={shown}
        breakpoints={{
          value: { viewport: [], container: [] },
          onSave: vi.fn(),
          status: "ready",
          refresh: vi.fn(),
        }}
      />
    );
    const { rerender } = render(element());
    expect(refetch).not.toHaveBeenCalled();
    shown = { ...address, savedRevision: 1 };
    rerender(element());
    expect(refetch).toHaveBeenCalledTimes(1);
    rerender(element());
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

/** Opens Site settings from Page settings, as its button does. */
async function openSite(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name: "Site settings" }));
  return screen.findByRole("dialog", { name: "Site settings" });
}

describe("Site settings", () => {
  it("opens in its own dialog, saying it applies to the live site at once", async () => {
    show();
    const site = await openSite();
    expect(
      within(site).getByText("Changes here apply to the live site immediately.")
    ).toBeTruthy();
    // Its own words: the page's line is Page settings'.
    expect(
      within(site).queryByText("Saved with the page when you Save or Publish.")
    ).toBeNull();
  });

  it("never lets Enter in a site field submit the page, but lets an IME accept", async () => {
    show();
    await openSite();
    const input = screen.getByLabelText("Breakpoint name");
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    const composing = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    input.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
  });

  it("asks before closing over a breakpoint edit, and keeps editing on Keep editing", async () => {
    const { onOpenChange } = show();
    await openSite();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    const ask = await screen.findByRole("alertdialog");
    expect(ask.textContent).toContain("Discard your breakpoint changes?");
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("dialog", { name: "Site settings" })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes on Discard, back to Page settings", async () => {
    const { onOpenChange } = show();
    await openSite();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Discard" })
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Site settings" })).toBeNull()
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Page settings · Pricing" })
    ).toBeTruthy();
  });

  it("asks before closing over unsaved code, naming a breakpoint draft kept under it too", async () => {
    show();
    await openSite();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    // The code opens over the breakpoint draft, which stays.
    await userEvent.click(
      await screen.findByRole("button", { name: "Add code" })
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Head" }), {
      target: { value: "<script>a()</script>" },
    });
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    const ask = await screen.findByRole("alertdialog");
    expect(ask.textContent).toContain(
      "Discard your breakpoint and code changes?"
    );
  });

  it("names the site default, and points to the Header & footer list to change it", async () => {
    show();
    await openSite();
    const line = screen.getByRole("region", {
      name: "Site default header & footer",
    });
    expect(line.textContent).toContain("Site default header & footer: Main");
    const change = within(line).getByRole("link", {
      name: /^Change in Pages ▸ Header & footer\s*\(opens in a new tab\)$/,
    });
    expect(change.getAttribute("href")).toBe("/admin/collections/site_layouts");
    expect(change.getAttribute("target")).toBe("_blank");
  });

  it("says when the site has no default", async () => {
    siteRead = { ...MANAGER, defaultLayout: null, layouts: [] };
    show();
    await openSite();
    expect(
      screen.getByRole("region", { name: "Site default header & footer" })
        .textContent
    ).toContain("Site default header & footer: none set");
  });

  it("does not close while a breakpoint save is in flight", async () => {
    show();
    await openSite();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    await userEvent.click(screen.getByRole("button", { name: "Start saving" }));
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Site settings" })).toBeTruthy();
  });

  it("says the site's settings could not load, with Retry, rather than hiding the way in", async () => {
    siteRead = undefined;
    siteError = new Error("Network down");
    show();
    await openSite();
    expect(
      screen.getByText("The site's settings could not be loaded.")
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("holds the breakpoints back while a reopened read is refreshing", async () => {
    // A cached read shows at once on reopen; editing it as a draft before the
    // refresh lands would save over a newer set.
    siteFetching = true;
    show();
    await openSite();
    expect(screen.getByLabelText("Breakpoints status").textContent).toBe(
      "loading"
    );
    siteFetching = false;
    reshow();
    expect(screen.getByLabelText("Breakpoints status").textContent).toBe(
      "ready"
    );
  });

  it("closes, and its way in goes, when the permission goes away", async () => {
    siteRead = undefined;
    siteError = new Error("Network down");
    show();
    await openSite();
    // The retry answers: not this caller's to manage.
    siteRead = { ...MANAGER, mayManageSite: false, layouts: [] };
    siteError = null;
    reshow();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Site settings" })).toBeNull()
    );
    expect(screen.queryByRole("button", { name: "Site settings" })).toBeNull();
  });
});
