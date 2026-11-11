// @vitest-environment jsdom
/**
 * Settings: the page's own tab for everyone, the Site tab only for a role that
 * may manage the site, Enter that never saves the page, a breakpoint edit
 * that is not dropped silently, and a default Layout that says how its save
 * went.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  renderHook,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteCodeRead, SiteSettingsRead } from "../../library-contract";
import type { PageAddressResponse } from "../../pages-search-contract";
import {
  settingsAddressOf,
  useSavedRevision,
  type SettingsAddress,
} from "./settings-address";
import type { SettingsPlace } from "./settings-place";

/** What each drawing of the place's tabs was handed. */
const placeTabs: Record<string, unknown>[] = [];

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
const writes: Array<{ path: string }> = [];
let writeAnswer: () => Promise<unknown> = async () => ({});
/** What the readiness question answers; nothing to publish by default. */
let readinessAnswer: unknown = { dependencies: [], missing: 0 };
const asked: unknown[] = [];

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
  // The admin's place tabs, standing in: what the dialog hands them, and
  // the page's own settings drawn as their first tab.
  PlaceTabs: (props: { children: ReactElement } & Record<string, unknown>) => {
    placeTabs.push(props);
    return props.children;
  },
  writePluginRoute: async (write: { path: string; body?: unknown }) => {
    if (write.path === "/publish-readiness") {
      asked.push(write.body);
      return readinessAnswer;
    }
    writes.push(write);
    return writeAnswer();
  },
}));

// The section's own behaviour is the builder's to test; here it only says
// when editing starts, as the real one does.
vi.mock("@nextlyhq/builder/shell", async importOriginal => ({
  // The editor's real words, so the dialog's title reads as an author sees it.
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

// What Radix's Select reaches for and jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const LAYOUT_LABEL = "Pages without a Layout of their own use";

/** Choose a Layout in the default Layout's select, as an author does. */
async function chooseLayout(title: string): Promise<void> {
  await userEvent.click(screen.getByRole("combobox", { name: LAYOUT_LABEL }));
  await userEvent.click(await screen.findByRole("option", { name: title }));
}

const MANAGER: SiteSettingsRead = {
  mayManageSite: true,
  mayChooseDefaultLayout: true,
  defaultLayout: "main",
  breakpoints: null,
  layouts: [
    { id: "main", title: "Main" },
    { id: "bare", title: "No header or footer" },
  ],
};

/** Renders the dialog again with the current read, as a refetch would. */
let reshow: () => void = () => {};

/** The address the dialog is drawn with; a case may change it and reshow. */
let shownAddress: SettingsAddress | null = null;

/** The place the dialog is drawn with; a case may set it before showing. */
let shownPlace: SettingsPlace | null = null;

function show(
  onOpenChange = vi.fn(),
  pageLayout?: ReactElement,
  seoFields = true,
  address: SettingsAddress | null = null
) {
  shownAddress = address;
  // Built afresh each time: React skips a child whose element is unchanged,
  // so re-rendering the same tree would never ask the dialog again.
  const element = (): ReactElement => (
    <form data-testid="page-form" onSubmit={event => event.preventDefault()}>
      <SettingsDialog
        open
        onOpenChange={onOpenChange}
        returnFocus={() => null}
        pageFields={<input aria-label="Title" defaultValue="About us" />}
        place={shownPlace}
        {...(pageLayout === undefined ? {} : { pageLayout })}
        share={{ title: "Who we are", description: "We build tools." }}
        seoFields={seoFields}
        address={shownAddress}
        breakpoints={{
          value: { viewport: [], container: [] },
          onSave: vi.fn(),
          status: "ready",
          refresh: vi.fn(),
        }}
      />
    </form>
  );
  const { rerender } = render(element());
  reshow = () => rerender(element());
  return onOpenChange;
}

beforeEach(() => {
  placeTabs.length = 0;
  shownPlace = null;
  addressRead = undefined;
  addressAsked.length = 0;
  siteRead = MANAGER;
  siteError = null;
  siteFetching = false;
  writes.length = 0;
  writeAnswer = async () => ({});
  asked.length = 0;
  readinessAnswer = { dependencies: [], missing: 0 };
  refetch.mockClear();
});
afterEach(cleanup);

describe("the Settings dialog", () => {
  it("draws the page's Layout section once, after the page's fields and before sharing", () => {
    show(
      vi.fn(),
      <section aria-labelledby="layout-title">
        <h3 id="layout-title">Header and footer</h3>
      </section>
    );
    const sections = screen.getAllByRole("heading", {
      name: "Header and footer",
    });
    expect(sections).toHaveLength(1);
    const title = screen.getByRole("textbox", { name: "Title" });
    const sharing = screen.getByRole("heading", { name: "Search and sharing" });
    const order = (a: Node, b: Node) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order(title, sections[0]!)).toBeTruthy();
    expect(order(sections[0]!, sharing)).toBeTruthy();
  });

  it("draws the page's settings as the first tab of the place other plugins add to", () => {
    const set = vi.fn();
    shownPlace = {
      context: {
        userId: "u1",
        document: "template",
        collection: "templates",
        entryId: "t1",
        draws: { collection: "posts", entryId: null },
      },
      tabProps: {
        seo: { value: undefined, set },
        design: { formatVersion: 1, kind: "template", nodes: [] },
        control: {} as never,
        writable: true,
      },
    };
    show();
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(placeTabs.at(-1)).toMatchObject({
      place: "nextlyhq-plugin-page-builder.settings",
      contentLabel: "General",
      context: shownPlace.context,
      tabProps: { seo: { set }, writable: true },
    });
  });

  it("draws no place for a document that offers none", () => {
    show();
    expect(placeTabs).toEqual([]);
    expect(screen.getByLabelText("Title")).toBeTruthy();
  });

  it("shows the page's fields and an approximate share preview", () => {
    show();
    expect(screen.getByRole("tab", { name: "This page" })).toBeTruthy();
    expect(screen.getByLabelText("Title")).toBeTruthy();
    const preview = screen.getByRole("figure", { name: "Share preview" });
    expect(preview.textContent).toContain("Who we are");
    expect(
      screen.getByText("Approximate: your site's metadata may differ.")
    ).toBeTruthy();
  });

  it("says the SEO plugin adds the sharing fields, only where the page has none", () => {
    show(vi.fn(), undefined, false);
    expect(screen.getByText(/The SEO plugin adds fields/)).toBeTruthy();
    cleanup();

    // With the SEO plugin's fields, they are among the page's own: no line.
    show(vi.fn(), undefined, true);
    expect(screen.queryByText(/The SEO plugin adds fields/)).toBeNull();
  });

  it("says when This page saves, and leaves Site to its own banner", async () => {
    show();
    expect(
      screen.getByText("Saved with the page when you Save or Publish.")
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    // The banner says it applies at once; a footer would say it twice.
    expect(
      screen.queryByText("Saved with the page when you Save or Publish.")
    ).toBeNull();
    expect(screen.queryByText(/save as you change them/)).toBeNull();
  });

  it("shows the page's saved address as the server resolved it", () => {
    addressRead = { path: "/company/about-us" };
    show(vi.fn(), undefined, true, {
      page: { collection: "pages", id: "p-1" },
      locale: "fr",
      savedSlug: "about-us",
      slugChanged: false,
      savedRevision: 0,
    });
    expect(
      screen.getByRole("region", { name: "Address on your site" }).textContent
    ).toContain("/company/about-us");
    // Asked of the server for this page, in the language being edited: the
    // address is never assembled here from the slug.
    expect(addressAsked.at(-1)).toBe(
      "/pages/address?collection=pages&id=p-1&locale=fr"
    );
    expect(screen.queryByText(/changes when you save/)).toBeNull();
  });

  it("reads the address again after every save, whichever field it changed", () => {
    // A host's path can name fields besides the slug: a save that changes
    // one of them moves the page while the slug stays as it was.
    addressRead = { path: "/news/about-us" };
    refetch.mockClear();
    const address: SettingsAddress = {
      page: { collection: "pages", id: "p-1" },
      savedSlug: "about-us",
      slugChanged: false,
      savedRevision: 0,
    };
    show(vi.fn(), undefined, true, address);
    expect(refetch).not.toHaveBeenCalled();
    shownAddress = { ...address, savedRevision: 1 };
    reshow();
    expect(refetch).toHaveBeenCalledTimes(1);
    // Drawn again with nothing saved since: not read again.
    reshow();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("says the saved address changes on save while the slug differs", () => {
    addressRead = { path: "/about-us" };
    show(vi.fn(), undefined, true, {
      page: { collection: "pages", id: "p-1" },
      savedSlug: "about-us",
      slugChanged: true,
      savedRevision: 0,
    });
    // Still the SAVED address: the server knows nothing of the typed slug.
    expect(
      screen.getByRole("region", { name: "Address on your site" }).textContent
    ).toContain("/about-us");
    const line = screen.getByText(
      "This is the saved address. It changes when you save the page."
    );
    // Announced as it appears, as the admin's own address warning is.
    expect(line.getAttribute("role")).toBe("status");
  });

  it("shows no address line where the page has none, or was never saved", () => {
    addressRead = { path: null };
    show(vi.fn(), undefined, true, {
      page: { collection: "posts", id: "x" },
      slugChanged: false,
      savedRevision: 0,
    });
    expect(
      screen.queryByRole("region", { name: "Address on your site" })
    ).toBeNull();
    cleanup();
    show();
    expect(addressAsked).toHaveLength(1);
    expect(
      screen.queryByRole("region", { name: "Address on your site" })
    ).toBeNull();
  });

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

  it("offers no Site tab to a role that may not manage the site", () => {
    siteRead = { ...MANAGER, mayManageSite: false, layouts: [] };
    show();
    expect(screen.queryByRole("tab", { name: "Site" })).toBeNull();
  });

  it("never lets Enter in a Site field submit the page, but lets an IME accept", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
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

  it("leaves Enter in the page's own fields to them", () => {
    show();
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    screen.getByLabelText("Title").dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });

  it("says the Site tab applies at once", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    expect(
      screen.getByText("Changes here apply to the live site immediately.")
    ).toBeTruthy();
  });

  it("asks before closing over a breakpoint edit, and keeps editing on Keep editing", async () => {
    const onOpenChange = show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    const ask = await screen.findByRole("alertdialog");
    expect(ask.textContent).toContain("Discard your breakpoint changes?");
    expect(onOpenChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes on Discard", async () => {
    const onOpenChange = show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Discard" })
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks before closing over unsaved code, naming a breakpoint draft kept under it too", async () => {
    const onOpenChange = show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    // The code opens over the breakpoint draft, which stays.
    await userEvent.click(screen.getByRole("button", { name: "Add code" }));
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
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("changes the default Layout at once, and says Saved", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await chooseLayout("No header or footer");
    await screen.findByText("Saved");
    expect(writes).toEqual([
      expect.objectContaining({ path: "/layouts/bare/make-default" }),
    ]);
    expect(refetch).toHaveBeenCalled();
  });

  it("says Not saved with Retry when the change is refused, and Retry tries again", async () => {
    writeAnswer = () =>
      Promise.reject(new Error("This Layout is not published."));
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await chooseLayout("No header or footer");
    await screen.findByText("Not saved");
    writeAnswer = async () => ({});
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Saved");
    expect(writes).toHaveLength(2);
  });

  it("asks about the Layout's unpublished components before making it the default", async () => {
    readinessAnswer = {
      dependencies: [
        {
          kind: "component",
          id: "hdr",
          title: "Site header",
          mayPublish: true,
        },
      ],
      missing: 0,
    };
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await chooseLayout("No header or footer");
    const question = await screen.findByRole("alertdialog");
    expect(question.textContent).toContain(
      "This Layout uses 1 component that isn't published"
    );
    expect(asked).toEqual([{ documents: [], layout: "bare" }]);
    // Nothing is written while the author is being asked.
    expect(writes).toEqual([]);

    await userEvent.click(
      screen.getByRole("button", { name: "Make default anyway" })
    );
    await screen.findByText("Saved");
    expect(writes).toEqual([
      expect.objectContaining({ path: "/layouts/bare/make-default" }),
    ]);
  });

  it("publishes the components first, then makes the Layout the default", async () => {
    readinessAnswer = {
      dependencies: [
        {
          kind: "component",
          id: "hdr",
          title: "Site header",
          mayPublish: true,
        },
      ],
      missing: 0,
    };
    writeAnswer = async () => ({ item: { published: [], refused: [] } });
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await chooseLayout("No header or footer");
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Publish it, then make default",
      })
    );
    await screen.findByText("Saved");
    expect(writes.map(write => write.path)).toEqual([
      "/publish-dependencies",
      "/layouts/bare/make-default",
    ]);
  });

  it("changes nothing when the author cancels the question", async () => {
    readinessAnswer = {
      dependencies: [
        {
          kind: "component",
          id: "hdr",
          title: "Site header",
          mayPublish: true,
        },
      ],
      missing: 0,
    };
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await chooseLayout("No header or footer");
    await screen.findByRole("alertdialog");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(writes).toEqual([]);
    expect(screen.queryByText("Saving…")).toBeNull();
  });

  it("shows the default read-only, naming it, without the Layout rights", async () => {
    siteRead = {
      ...MANAGER,
      mayChooseDefaultLayout: false,
      layouts: [{ id: "main", title: "Main" }],
    };
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    const select = screen.getByRole("combobox", { name: LAYOUT_LABEL });
    expect(select.hasAttribute("disabled")).toBe(true);
    await waitFor(() =>
      expect(
        screen.getByText(/needs the rights to update and publish Layouts/)
      ).toBeTruthy()
    );
  });

  it("asks before a tab switch drops a breakpoint edit", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    await userEvent.click(screen.getByRole("tab", { name: "This page" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    // Still on Site until the author says to discard (the question hides
    // the dialog behind it from the accessibility tree while it is open).
    expect(
      screen
        .getByRole("tab", { name: "Site", hidden: true })
        .getAttribute("aria-selected")
    ).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(
      screen
        .getByRole("tab", { name: "This page" })
        .getAttribute("aria-selected")
    ).toBe("true");
  });

  it("neither closes nor switches while a breakpoint save is in flight", async () => {
    const onOpenChange = show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    await userEvent.click(screen.getByRole("button", { name: "Start saving" }));
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await userEvent.click(screen.getByRole("tab", { name: "This page" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Site" }).getAttribute("aria-selected")
    ).toBe("true");
  });

  it("says the Site tab could not load, with Retry, rather than hiding it", async () => {
    siteRead = undefined;
    siteError = new Error("Network down");
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    expect(
      screen.getByText("The site's settings could not be loaded.")
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the chosen default shown after Saved, until the read catches up", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await chooseLayout("No header or footer");
    await screen.findByText("Saved");
    expect(
      screen.getByRole("combobox", { name: LAYOUT_LABEL }).textContent
    ).toContain("No header or footer");
  });

  it("follows the read once it confirms the choice, so a later change shows", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await chooseLayout("No header or footer");
    await screen.findByText("Saved");
    siteRead = { ...MANAGER, defaultLayout: "bare" };
    reshow();
    // Someone else then puts it back: the held choice must not hide that.
    siteRead = { ...MANAGER, defaultLayout: "main" };
    reshow();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: LAYOUT_LABEL }).textContent
      ).toContain("Main")
    );
  });

  it("holds the breakpoints back while a reopened read is refreshing", async () => {
    // A cached read shows at once on reopen; editing it as a draft before the
    // refresh lands would save over a newer set.
    siteFetching = true;
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    expect(screen.getByLabelText("Breakpoints status").textContent).toBe(
      "loading"
    );
    siteFetching = false;
    reshow();
    expect(screen.getByLabelText("Breakpoints status").textContent).toBe(
      "ready"
    );
  });

  it("goes back to This page when the Site tab goes away", async () => {
    siteRead = undefined;
    siteError = new Error("Network down");
    const dialog = (
      <SettingsDialog
        open
        onOpenChange={vi.fn()}
        returnFocus={() => null}
        pageFields={<input aria-label="Title" />}
        share={{ title: "Who we are" }}
        breakpoints={{
          value: { viewport: [], container: [] },
          onSave: vi.fn(),
          status: "ready",
          refresh: vi.fn(),
        }}
      />
    );
    const { rerender } = render(dialog);
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    // The retry answers: not this caller's to manage.
    siteRead = { ...MANAGER, mayManageSite: false, layouts: [] };
    siteError = null;
    // A fresh element, so the dialog renders again with the new answer.
    rerender(cloneElement(dialog));
    await waitFor(() =>
      expect(
        screen
          .getByRole("tab", { name: "This page" })
          .getAttribute("aria-selected")
      ).toBe("true")
    );
    expect(screen.queryByRole("tab", { name: "Site" })).toBeNull();
  });
});
