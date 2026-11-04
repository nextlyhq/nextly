// @vitest-environment jsdom
/**
 * The Pages panel: its list (groups, chips, the page being edited, search,
 * more pages, a failed read), and each row action, through the routes it
 * reads and the client it writes with, ending where an author would land.
 */
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PageItem, PageReference } from "../../pages-search-contract";

interface Read {
  plugin: string;
  path: string;
  signal: AbortSignal;
}

const navigateTo = vi.fn<(href: string) => void>();
const reads: Read[] = [];
let answer: (read: Read) => Promise<unknown> = async () => listing([]);
let identity: {
  kind: "collection";
  slug: string;
  documentId?: string;
} | null = null;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  // The SDK's reading of an error: its message, or the fallback.
  apiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  navigateTo: (href: string) => navigateTo(href),
  readPluginRoute: (read: Read) => {
    reads.push(read);
    return answer(read);
  },
  useDocumentIdentity: () => identity,
  useDocumentStatus: () => liveStatus,
}));

const client = {
  createPage:
    vi.fn<
      (request: { collection: string; title: string }) => Promise<PageItem>
    >(),
  duplicatePage: vi.fn<(page: PageReference) => Promise<PageItem>>(),
  renamePage:
    vi.fn<(page: PageReference, title: string) => Promise<PageItem>>(),
  deletePage: vi.fn<(page: PageReference) => Promise<PageReference>>(),
};
vi.mock("../pages-client", () => ({
  createPage: (request: { collection: string; title: string }) =>
    client.createPage(request),
  duplicatePage: (page: PageReference) => client.duplicatePage(page),
  renamePage: (page: PageReference, title: string) =>
    client.renamePage(page, title),
  deletePage: (page: PageReference) => client.deletePage(page),
}));

const { usePagesPanel } = await import("./pages-panel");

// What Radix's menu and dialog reach for and jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

function item(
  id: string,
  title: string,
  extra: Partial<PageItem> = {}
): PageItem {
  return {
    id,
    collection: "pages",
    collectionLabel: "Pages",
    field: "content",
    title,
    ...extra,
  };
}

/** The search's answer, in the list envelope it uses. */
function listing(items: PageItem[], nextBefore?: string) {
  return {
    items,
    meta: {
      total: items.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasNext: nextBefore !== undefined,
      hasPrev: false,
      ...(nextBefore === undefined ? {} : { nextBefore }),
    },
  };
}

/** One query parameter of a read, or null where it sent none. */
function param(read: Read | undefined, name: string): string | null {
  return new URL(read?.path ?? "/", "http://admin.test").searchParams.get(name);
}

/** A promise answered later, so a test decides the order answers land in. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Whether the document being edited is a page; a component's is not. */
let editingPage = true;

/** Whether the editor holds unsaved work, as the editor tells the panel. */
let unsavedWork = false;
/** The editor's status for the page it has open. */
let liveStatus: { status: string; hasWorkingDraft: boolean } | null = null;

/** The editor's mount of the panel, and what it asks of Settings. */
function Harness() {
  const mount = usePagesPanel(editingPage);
  return (
    <>
      <output aria-label="Settings request">
        {mount.settingsRequest?.count ?? "none"}
      </output>
      {mount.renderPagesPanel({ unsavedWork })}
    </>
  );
}

/** Mounts the panel and waits for its first list. */
async function mount(items: PageItem[]) {
  answer = async () => listing(items);
  render(<Harness />);
  if (items[0] !== undefined) {
    await screen.findByRole("button", { name: items[0].title });
  }
}

function row(title: string): HTMLElement {
  const name = screen.getByRole("button", { name: title });
  const li = name.closest("li");
  if (li === null) throw new Error(`No row for ${title}`);
  return li;
}

async function choose(title: string, action: string) {
  await userEvent.click(
    screen.getByRole("button", { name: `More for ${title}` })
  );
  await userEvent.click(await screen.findByRole("menuitem", { name: action }));
}

const settingsCount = () =>
  screen.getByRole("status", { name: "Settings request" }).textContent;

const address = (id: string, collection = "pages") =>
  `/admin/collections/${collection}/${id}/builder?field=content`;

beforeEach(() => {
  reads.length = 0;
  navigateTo.mockReset();
  for (const write of Object.values(client)) write.mockReset();
  identity = { kind: "collection", slug: "pages", documentId: "current" };
  editingPage = true;
  unsavedWork = false;
  liveStatus = null;
  window.history.replaceState({}, "", "/");
});
afterEach(cleanup);

describe("the list", () => {
  it("heads a group with the collection's plural name when it has one", async () => {
    await mount([
      item("a", "Home"),
      item("b", "Spring launch", {
        collection: "landing",
        collectionLabel: "Landing page",
        collectionPluralLabel: "Landing pages",
      }),
    ]);
    expect(
      screen.getAllByRole("heading", { level: 3 }).map(h => h.textContent)
    ).toEqual(["Pages", "Landing pages · uses the Page Builder"]);
  });

  it("asks for each collection's pages together, as it groups them", async () => {
    await mount([item("a", "Home")]);
    expect(param(reads[0], "order")).toBe("collection");
  });

  it("says why a collection other than the first is listed, and not of the first", async () => {
    // The first collection of an unfiltered list is the plugin's own Pages;
    // another collection is here only because it has a Page Builder field.
    await mount([
      item("a", "Home"),
      item("b", "Blog post", { collection: "posts", collectionLabel: "Posts" }),
    ]);
    const [pages, posts] = screen.getAllByRole("heading", { level: 3 });
    expect(pages?.textContent).not.toContain("uses the Page Builder");
    expect(posts?.textContent).toContain("uses the Page Builder");
  });

  it("heads each collection only when there is more than one", async () => {
    await mount([
      item("a", "Home"),
      item("b", "Blog post", { collection: "posts", collectionLabel: "Posts" }),
    ]);
    expect(
      screen.getAllByRole("heading", { level: 3 }).map(h => h.textContent)
    ).toEqual(["Pages", "Posts · uses the Page Builder"]);
    cleanup();

    await mount([item("a", "Home"), item("c", "About")]);
    expect(screen.queryAllByRole("heading", { level: 3 })).toEqual([]);
  });

  it("shows a chip only where a page is not plainly published", async () => {
    await mount([
      item("a", "Home", { status: "published" }),
      item("b", "Pricing", { status: "draft", state: "draft" }),
      item("c", "About", { status: "published", state: "changed" }),
      item("d", "Launch", { status: "published", state: "scheduled" }),
    ]);
    // A published page with nothing waiting reads as its title alone.
    expect(row("Home").textContent).toBe("Home");
    expect(row("Pricing").textContent).toBe("PricingDraft");
    expect(row("About").textContent).toBe("AboutChanged");
    expect(row("Launch").textContent).toBe("LaunchScheduled");
  });

  it("marks the page being edited, and only that one", async () => {
    identity = { kind: "collection", slug: "pages", documentId: "1" };
    // The same id in another collection is a different page.
    await mount([
      item("1", "Home"),
      item("1", "Blog post", { collection: "posts", collectionLabel: "Posts" }),
    ]);
    const home = screen.getByRole("button", { name: "Home" });
    expect(home.getAttribute("aria-current")).toBe("page");
    const editing = within(row("Home")).getByText("Editing");
    // Plain words, not a status: no dot, so the row does not read as two states.
    expect(editing.querySelector('[aria-hidden="true"]')).toBeNull();
    const post = screen.getByRole("button", { name: "Blog post" });
    expect(post.getAttribute("aria-current")).toBeNull();
    expect(within(row("Blog post")).queryByText("Editing")).toBeNull();

    // Choosing the page already open goes nowhere.
    await userEvent.click(home);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("searches once typing pauses, and a newer search's answer wins", async () => {
    await mount([item("a", "Home")]);
    const answers = new Map<string, ReturnType<typeof deferred<unknown>>>();
    answer = read => {
      const wait = deferred<unknown>();
      answers.set(param(read, "q") ?? "", wait);
      return wait.promise;
    };
    const search = screen.getByRole("textbox", { name: "Search pages" });

    await userEvent.type(search, "pri");
    await waitFor(() => expect(answers.has("pri")).toBe(true));
    // The keystrokes in between were never searched.
    expect(reads.map(read => param(read, "q"))).toEqual([null, "pri"]);

    await userEvent.type(search, "x");
    await waitFor(() => expect(answers.has("prix")).toBe(true));
    expect(reads[1]?.signal.aborted).toBe(true);

    answers.get("prix")?.resolve(listing([item("p", "Prix fixe")]));
    await screen.findByRole("button", { name: "Prix fixe" });
    // The abandoned search answers late, and is not shown.
    answers.get("pri")?.resolve(listing([item("q", "Pricing")]));
    await new Promise(settle => setTimeout(settle, 20));
    expect(screen.queryByRole("button", { name: "Pricing" })).toBeNull();
    expect(screen.getByRole("button", { name: "Prix fixe" })).toBeTruthy();
  });

  it("retires the last search's rows the moment the search changes", async () => {
    await mount([item("a", "Home"), item("b", "About")]);
    // The next answer never lands, so what shows is only what typing left.
    answer = () => new Promise(() => {});
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search pages" }),
      "x"
    );
    expect(screen.queryByRole("button", { name: "Home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More for About" })).toBeNull();
  });

  it("offers more, rather than saying none, when an empty page has more after it", async () => {
    answer = async () => listing([], "cursor-1");
    render(<Harness />);
    await screen.findByRole("button", { name: "Show more pages" });
    expect(screen.queryByText("No pages yet.")).toBeNull();
  });

  it("marks no row as being edited in a component's editor", async () => {
    editingPage = false;
    await mount([item("current", "Home")]);
    expect(within(row("Home")).queryByText("Editing")).toBeNull();
  });

  it("shows more pages from where the last answer stopped", async () => {
    answer = async read =>
      param(read, "before") === "cursor-1"
        ? listing([item("b", "Pricing")])
        : listing([item("a", "Home")], "cursor-1");
    render(<Harness />);
    await screen.findByRole("button", { name: "Home" });

    await userEvent.click(
      screen.getByRole("button", { name: "Show more pages" })
    );
    await screen.findByRole("button", { name: "Pricing" });
    expect(param(reads.at(-1), "before")).toBe("cursor-1");
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
    // The last answer named no further page.
    expect(
      screen.queryByRole("button", { name: "Show more pages" })
    ).toBeNull();
  });

  it("says when the pages could not be read, and Retry reads again", async () => {
    answer = async () => {
      throw new Error("offline");
    };
    render(<Harness />);
    await screen.findByText("Couldn’t load the pages.");

    answer = async () => listing([item("a", "Home")]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Home" });
    expect(reads).toHaveLength(2);
  });
});

describe("a row's actions", () => {
  it("opens another page, from its title and from Open", async () => {
    await mount([item("a", "Home"), item("b", "About")]);
    await userEvent.click(screen.getByRole("button", { name: "About" }));
    expect(navigateTo).toHaveBeenLastCalledWith(address("b"));

    await choose("Home", "Open");
    expect(navigateTo).toHaveBeenLastCalledWith(address("a"));
  });

  it("adds a page in the listed collection and opens it", async () => {
    await mount([item("a", "Home")]);
    client.createPage.mockResolvedValue(
      item("new", "Fresh", { status: "draft" })
    );
    await userEvent.click(screen.getByRole("button", { name: "New page" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Page title" }),
      "Fresh{Enter}"
    );
    expect(client.createPage).toHaveBeenCalledWith({
      collection: "pages",
      title: "Fresh",
    });
    await waitFor(() =>
      expect(navigateTo).toHaveBeenCalledWith(address("new"))
    );
  });

  it("adds new pages to the page being edited's collection, whatever a search ranks first", async () => {
    await mount([
      item("a", "Home"),
      item("p", "Post", { collection: "posts" }),
    ]);
    answer = async () =>
      listing([
        item("p", "Post", { collection: "posts", collectionLabel: "Posts" }),
      ]);
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search pages" }),
      "post"
    );
    await screen.findByRole("button", { name: "Post" });
    client.createPage.mockResolvedValue(item("new", "Fresh"));
    await userEvent.click(screen.getByRole("button", { name: "New page" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Page title" }),
      "Fresh{Enter}"
    );
    expect(client.createPage).toHaveBeenCalledWith({
      collection: "pages",
      title: "Fresh",
    });
  });

  it("keeps New page when a search matches nothing", async () => {
    await mount([item("a", "Home")]);
    answer = async () => listing([]);
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search pages" }),
      "zzz"
    );
    await screen.findByText('No pages match "zzz".');
    expect(screen.getByRole("button", { name: "New page" })).toBeTruthy();
  });

  it("duplicates a published page and opens the copy", async () => {
    const home = item("a", "Home", { status: "published" });
    await mount([home]);
    client.duplicatePage.mockResolvedValue(
      item("copy", "Copy of Home", { status: "draft" })
    );
    await choose("Home", "Duplicate");
    expect(client.duplicatePage).toHaveBeenCalledWith(home);
    await waitFor(() =>
      expect(navigateTo).toHaveBeenCalledWith(address("copy"))
    );
  });

  /** The menu's Duplicate for `page`, and what it is described by. */
  async function duplicateFor(page: PageItem) {
    await mount([page]);
    await userEvent.click(
      screen.getByRole("button", { name: `More for ${page.title}` })
    );
    const entry = await screen.findByRole("menuitem", { name: "Duplicate" });
    const id = entry.getAttribute("aria-describedby");
    return {
      entry,
      description:
        id === null ? undefined : document.getElementById(id)?.textContent,
    };
  }

  const COPIES_PUBLISHED =
    "Copies the published version, without your unpublished changes.";

  it("duplicates a page with unpublished changes, and says the copy is the published version", async () => {
    // The copy is made from the published page, not the changes on screen,
    // so the author is told before choosing it.
    const home = item("a", "Home", { status: "published", state: "changed" });
    client.duplicatePage.mockResolvedValue(
      item("copy", "Copy of Home", { status: "draft" })
    );
    const { entry, description } = await duplicateFor(home);
    expect(entry.getAttribute("aria-disabled")).toBeNull();
    expect(within(entry).getByText(COPIES_PUBLISHED)).toBeTruthy();
    expect(description).toBe(COPIES_PUBLISHED);
    await userEvent.click(entry);
    expect(client.duplicatePage).toHaveBeenCalledWith(home);
  });

  it("says the same for a scheduled page that also holds changes", async () => {
    // It shows "Scheduled", but a copy still takes the live content.
    const { entry, description } = await duplicateFor(
      item("a", "Home", {
        status: "published",
        state: "scheduled",
        pendingChange: true,
      })
    );
    expect(entry.getAttribute("aria-disabled")).toBeNull();
    expect(description).toBe(COPIES_PUBLISHED);
  });

  it("duplicates a never-published draft as it is, with no note", async () => {
    const draft = item("a", "Home", { status: "draft", state: "draft" });
    client.duplicatePage.mockResolvedValue(
      item("copy", "Copy of Home", { status: "draft" })
    );
    const { entry, description } = await duplicateFor(draft);
    expect(entry.getAttribute("aria-disabled")).toBeNull();
    expect(description).toBeUndefined();
    expect(entry.textContent).toBe("Duplicate");
    await userEvent.click(entry);
    expect(client.duplicatePage).toHaveBeenCalledWith(draft);
  });

  it("says Duplicate copies the last saved version of the page being edited with unsaved work", async () => {
    // The copy is made on the server from what is stored, never from the
    // editor's unsaved work, so the author is told before choosing it.
    identity = { kind: "collection", slug: "pages", documentId: "a" };
    unsavedWork = true;
    const home = item("a", "Home", { status: "draft", state: "draft" });
    const { entry, description } = await duplicateFor(home);
    expect(description).toBe(
      "Copies the last saved version, without your unsaved changes."
    );
    expect(entry.getAttribute("aria-disabled")).toBeNull();
  });

  it("reads the page being edited from the editor, which knows of a draft saved since the list was read", async () => {
    // The list read it as plainly published; a save since gave it changes.
    identity = { kind: "collection", slug: "pages", documentId: "a" };
    liveStatus = { status: "published", hasWorkingDraft: true };
    const { description } = await duplicateFor(
      item("a", "Home", { status: "published" })
    );
    expect(description).toBe(COPIES_PUBLISHED);
  });

  it("adds no note to another page's Duplicate while this one has unsaved work", async () => {
    identity = { kind: "collection", slug: "pages", documentId: "elsewhere" };
    unsavedWork = true;
    const { description } = await duplicateFor(
      item("a", "Home", { status: "draft", state: "draft" })
    );
    expect(description).toBeUndefined();
  });

  it("keeps an unavailable item in the arrow-key order, described by its reason", async () => {
    // A `disabled` item is skipped by the arrow keys, so a keyboard or screen
    // reader user would never learn why Delete is missing.
    identity = { kind: "collection", slug: "pages", documentId: "a" };
    await mount([item("a", "Home", { status: "published", state: "changed" })]);
    await userEvent.click(
      screen.getByRole("button", { name: "More for Home" })
    );
    await screen.findByRole("menu");
    const reached = new Set<Element>();
    for (let step = 0; step < 6; step += 1) {
      await userEvent.keyboard("{ArrowDown}");
      if (document.activeElement !== null) reached.add(document.activeElement);
    }
    expect(reached.has(screen.getByRole("menuitem", { name: "Delete…" }))).toBe(
      true
    );

    const described = (name: string) => {
      const entry = screen.getByRole("menuitem", { name });
      const id = entry.getAttribute("aria-describedby") ?? "";
      return document.getElementById(id)?.textContent;
    };
    expect(described("Delete…")).toBe("Open another page to delete this one.");
    expect(described("Duplicate")).toBe(COPIES_PUBLISHED);

    // Choosing it does nothing, and the menu stays open to say why.
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(client.deletePage).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("renames in place: Enter keeps the title, and the list reads again", async () => {
    const about = item("b", "About");
    await mount([item("a", "Home"), about]);
    client.renamePage.mockResolvedValue(item("b", "About us"));
    await choose("About", "Rename");
    const field = screen.getByRole("textbox", { name: "Page title" });
    expect((field as HTMLInputElement).value).toBe("About");

    const readsBefore = reads.length;
    await userEvent.clear(field);
    await userEvent.type(field, "About us{Enter}");
    expect(client.renamePage).toHaveBeenCalledWith(about, "About us");
    expect(client.renamePage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(reads.length).toBe(readsBefore + 1));
  });

  it("renames in place: Escape leaves the title as it was", async () => {
    await mount([item("a", "Home"), item("b", "About")]);
    await choose("About", "Rename");
    const field = screen.getByRole("textbox", { name: "Page title" });
    await userEvent.clear(field);
    await userEvent.type(field, "Something else{Escape}");
    expect(screen.queryByRole("textbox", { name: "Page title" })).toBeNull();
    expect(screen.getByRole("button", { name: "About" })).toBeTruthy();
    expect(client.renamePage).not.toHaveBeenCalled();
  });

  it("asks for Settings, rather than renaming, on the page being edited", async () => {
    identity = { kind: "collection", slug: "pages", documentId: "a" };
    await mount([item("a", "Home"), item("b", "About")]);
    expect(settingsCount()).toBe("none");
    await choose("Home", "Rename");
    expect(settingsCount()).toBe("1");
    expect(screen.queryByRole("textbox", { name: "Page title" })).toBeNull();
    expect(client.renamePage).not.toHaveBeenCalled();
    await choose("Home", "Rename");
    expect(settingsCount()).toBe("2");
  });

  it("opens another page's Settings at that page, and this page's here", async () => {
    identity = { kind: "collection", slug: "pages", documentId: "a" };
    await mount([item("a", "Home"), item("b", "About")]);
    await choose("About", "Settings");
    expect(navigateTo).toHaveBeenCalledWith(`${address("b")}&settings=1`);
    expect(settingsCount()).toBe("none");

    await choose("Home", "Settings");
    expect(settingsCount()).toBe("1");
    expect(navigateTo).toHaveBeenCalledTimes(1);
  });

  it("opens with Settings up when it arrived for them", async () => {
    window.history.replaceState({}, "", "/?field=content&settings=1");
    await mount([item("a", "Home")]);
    expect(settingsCount()).toBe("1");
  });

  it("deletes only once asked, naming the page", async () => {
    const about = item("b", "About");
    await mount([item("a", "Home"), about]);
    client.deletePage.mockResolvedValue(about);

    await choose("About", "Delete…");
    const confirm = await screen.findByRole("alertdialog", {
      name: "Delete “About”?",
    });
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Cancel" })
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(client.deletePage).not.toHaveBeenCalled();

    await choose("About", "Delete…");
    const readsBefore = reads.length;
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete page",
      })
    );
    expect(client.deletePage).toHaveBeenCalledWith(about);
    await waitFor(() => expect(reads.length).toBe(readsBefore + 1));
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("offers no Delete on the page being edited, and says why", async () => {
    // Deleting it under the editor would leave the author on a page that is
    // gone, or, when unsaved work asks first, delete one they chose to keep.
    identity = { kind: "collection", slug: "pages", documentId: "a" };
    await mount([item("a", "Home"), item("b", "About")]);
    await userEvent.click(
      screen.getByRole("button", { name: "More for Home" })
    );
    const remove = await screen.findByRole("menuitem", { name: "Delete…" });
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(
      within(remove).getByText("Open another page to delete this one.")
    ).toBeTruthy();
    await userEvent.click(remove);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(client.deletePage).not.toHaveBeenCalled();
  });

  it("says plainly when an action is refused", async () => {
    await mount([item("a", "Home"), item("b", "About")]);
    client.duplicatePage.mockRejectedValue(new Error("You can't add pages."));
    await choose("About", "Duplicate");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't duplicate \"About\". You can't add pages."
    );
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
