// @vitest-environment jsdom

/**
 * The SEO settings screen as a person uses it: first-time setup and closing
 * it part-way, tabs with addresses of their own, a content type's title
 * pattern set by clicking variables with a live preview and returned to its
 * default, a brand fact changed, a production address the server sets, and
 * unsaved changes cancelled. What each save sends is read from the save
 * itself.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useSingleDocument: vi.fn(),
  useUpdateSingleDocument: vi.fn(),
  usePluginRoute: vi.fn(),
  useMediaItem: vi.fn(() => ({ data: undefined })),
  MediaPickerDialog: () => null,
  toastMutationResult: vi.fn(),
  usePluginClientConfig: vi.fn(() => undefined),
  // A move within the admin, as the admin makes it: the address changes and
  // the move is announced.
  navigateTo: vi.fn((href: string) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new Event("locationchange"));
  }),
}));

import {
  navigateTo,
  usePluginClientConfig,
  usePluginRoute,
  useSingleDocument,
  useUpdateSingleDocument,
} from "@nextlyhq/plugin-sdk/admin";

import type { SeoContentType } from "../../settings/contract";
import { SeoSettingsPage } from "../SeoSettingsPage";

/** The stored Single, as the fake server holds it between saves. */
let stored: Record<string, unknown>;
/** Every body a save sent, in order. */
let sent: Record<string, unknown>[];

const POSTS: SeoContentType = {
  key: "posts",
  label: "Blog posts",
  fields: [{ name: "category", token: "Category" }],
  example: {
    title: "Surfer SEO vs Rext AI",
    values: { category: "Comparisons" },
    address: "/blog/surfer-seo-vs-rext-ai",
  },
  count: 19,
  mappableFields: [
    { name: "byline", label: "Byline" },
    { name: "publishedAt", label: "Published at" },
    { name: "price", label: "Price" },
    // Two fields labelled alike are told apart by their names.
    { name: "credit", label: "Byline" },
  ],
  public: true,
};
const CASES: SeoContentType = {
  key: "cases",
  label: "Case studies",
  fields: [],
  mappableFields: [],
  public: false,
};

/** How the fake server answers a save: at once, unless a test holds it. */
let answerSave: (body: Record<string, unknown>) => Promise<void>;

function serving(
  document: Record<string, unknown>,
  single = "seo-settings",
  serverAddresses: string[] = []
): void {
  // The document differs per test, so a draft one test leaves held, kept for
  // the settings at that version, never reaches another test.
  stored = { id: `s${tests}`, updatedAt: "", ...document };
  sent = [];
  answerSave = () => Promise.resolve();
  const refetch = vi.fn(async () => ({ data: stored }));
  vi.mocked(useSingleDocument).mockImplementation(
    () =>
      ({ data: stored, error: null, refetch }) as unknown as ReturnType<
        typeof useSingleDocument
      >
  );
  vi.mocked(useUpdateSingleDocument).mockImplementation(
    () =>
      ({
        mutateAsync: vi.fn(async (body: Record<string, unknown>) => {
          sent.push(body);
          await answerSave(body);
          const { _rev: _read, _overwrite: _replace, ...values } = body;
          const revision = Number(stored._rev ?? 0) + 1;
          stored = { ...stored, ...values, _rev: String(revision) };
          return stored;
        }),
      }) as unknown as ReturnType<typeof useUpdateSingleDocument>
  );
  vi.mocked(usePluginRoute).mockImplementation(
    request =>
      ({
        data: request.path.endsWith("/document")
          ? { single, serverAddresses }
          : {
              items: [
                POSTS,
                CASES,
                {
                  key: "testimonials",
                  label: "Testimonials",
                  count: 40,
                  public: false,
                  seo: false,
                },
                { key: "events", label: "Events", public: true, seo: false },
              ],
            },
        pending: false,
        error: null,
        refetch: () => {},
        fetching: false,
      }) as ReturnType<typeof usePluginRoute>
  );
}

/** Waits for every pending save and the re-read after it. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

const SETTINGS = "/admin/plugins/nextlyhq-plugin-seo/settings";

/** How many tests have run: each serves the settings at its own version. */
let tests = 0;

beforeEach(() => {
  window.history.replaceState(null, "", SETTINGS);
  tests += 1;
});

/** Opens one of the screen's tabs by its link. */
function openTab(name: string | RegExp): void {
  fireEvent.click(screen.getByRole("link", { name }));
}

/** Whether the tab named `name` is the one shown. */
function isOpen(name: string | RegExp): boolean {
  return (
    screen.getByRole("link", { name }).getAttribute("aria-current") === "page"
  );
}

/** Chooses `option` in the admin's select named `label`. */
async function choose(label: string, option: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

/** What the admin's select named `label` shows as chosen. */
function chosen(label: string): string | null {
  return screen.getByRole("combobox", { name: label }).textContent;
}

/** The options the admin's select named `label` offers. */
async function optionsOf(label: string): Promise<string[]> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  const names = (await screen.findAllByRole("option")).map(
    option => option.textContent ?? ""
  );
  await user.keyboard("{Escape}");
  return names;
}

describe("first-time setup", () => {
  it("asks three questions, saving each step, then lists what needs attention", async () => {
    serving({});
    render(<SeoSettingsPage />);

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Set up SEO" })
    ).toBeTruthy();
    // The admin's stepper says where setup is.
    expect(
      within(dialog)
        .getByRole("list", { name: "Setup steps" })
        .querySelector('[aria-current="step"]')?.textContent
    ).toContain("Name");
    fireEvent.change(within(dialog).getByLabelText("Site name"), {
      target: { value: "Rext AI" },
    });
    fireEvent.change(within(dialog).getByLabelText("Production address"), {
      target: { value: "https://rext.ai" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await settle();
    expect(sent[0]).toMatchObject({
      siteName: "Rext AI",
      productionAddresses: ["https://rext.ai"],
      setupStep: 1,
      _overwrite: true,
    });

    const second = screen.getByRole("dialog");
    expect(
      within(second).getByRole("heading", {
        name: "What kind of site is this?",
      })
    ).toBeTruthy();
    fireEvent.click(within(second).getByLabelText(/A blog or publication/));
    fireEvent.click(
      within(second).getByLabelText(/Allow AI search, not training/)
    );
    fireEvent.click(within(second).getByRole("button", { name: "Next" }));
    await settle();
    expect(sent[1]).toEqual({
      siteKind: "blog",
      aiCrawlers: "search",
      setupStep: 2,
      _rev: "1",
    });

    const third = screen.getByRole("dialog");
    expect(
      within(third).getByRole("heading", { name: "Logo and share image" })
    ).toBeTruthy();
    fireEvent.click(within(third).getByRole("button", { name: "Finish" }));
    await settle();
    expect(sent[2]).toEqual({ setupStep: 3, _rev: "2" });

    const done = screen.getByRole("dialog");
    expect(
      within(done).getByRole("heading", { name: "You're set up" })
    ).toBeTruthy();
    expect(
      within(done).getByText("Case studies have no public address")
    ).toBeTruthy();
    fireEvent.click(
      within(done).getByRole("button", { name: "See content types" })
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    // The tab it names opens, at its own address.
    expect(isOpen(/Content types/)).toBe(true);
    expect(window.location.search).toBe("?tab=types");
    // Finished: no banner offers setup again.
    expect(screen.queryByText("Finish setting up SEO.")).toBeNull();
  });

  it("ends on the section's Overview", async () => {
    serving({ _rev: "3", siteName: "Rext AI", setupStep: 2 });
    render(<SeoSettingsPage />);

    const third = await screen.findByRole("dialog");
    fireEvent.click(within(third).getByRole("button", { name: "Finish" }));
    await settle();
    const done = screen.getByRole("dialog");
    expect(
      within(done).getByRole("heading", { name: "You're set up" })
    ).toBeTruthy();
    fireEvent.click(
      within(done).getByRole("button", { name: "Go to the overview" })
    );
    // Anything still unsaved is saved first; nothing is, so none is sent.
    await settle();
    expect(sent).toHaveLength(1);

    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/plugins/nextlyhq-plugin-seo/overview"
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closed part-way keeps the answers and offers itself again", async () => {
    serving({});
    render(<SeoSettingsPage />);

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Site name"), {
      target: { value: "Acme" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await settle();

    expect(sent).toEqual([
      { siteName: "Acme", setupDismissed: true, _overwrite: true },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Finish setting up SEO.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    const again = await screen.findByRole("dialog");
    expect(within(again).getByLabelText("Site name")).toHaveProperty(
      "value",
      "Acme"
    );
  });

  it("refuses a production address with a path before moving on", async () => {
    serving({});
    render(<SeoSettingsPage />);

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Production address"), {
      target: { value: "https://rext.ai/blog" },
    });

    expect(
      within(dialog).getByText(/Use the site's address only, without a path/)
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Next" })).toHaveProperty(
      "disabled",
      true
    );
  });
});

describe("the tabs", () => {
  it("opens on General, the tab the board leads with", () => {
    serving({ _rev: "1", setupStep: 3 });
    render(<SeoSettingsPage />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(isOpen("General")).toBe(true);
    expect(screen.getAllByRole("link").map(link => link.textContent)).toEqual(
      expect.arrayContaining([
        "General",
        "Content types1",
        "Share images",
        "Organization",
        "Search engines and AI",
        "Connections",
      ])
    );
  });

  it("says beside the AI choices that OpenAI's ads checker is never asked to stay away", () => {
    serving({ _rev: "1", setupStep: 3 });
    window.history.replaceState(null, "", `${SETTINGS}?tab=crawlers`);
    render(<SeoSettingsPage />);
    expect(isOpen("Search engines and AI")).toBe(true);
    expect(screen.getByText(/OAI-AdsBot/).textContent).toContain(
      "No choice asks OpenAI's ads checker, OAI-AdsBot, to stay away: it visits only pages you submitted as ads in ChatGPT."
    );
  });

  it("asks for large image previews by default, and saves turning them off", async () => {
    serving({ _rev: "1", setupStep: 3 });
    window.history.replaceState(null, "", `${SETTINGS}?tab=crawlers`);
    render(<SeoSettingsPage />);
    const large = screen.getByRole("switch", { name: "Large image previews" });
    expect(large.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText(
        "Lets Google show a big picture from your pages in results and in Discover."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "On by default. Google asks for pictures at least 1200 px wide for this."
      )
    ).toBeTruthy();

    fireEvent.click(large);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(sent).toEqual([{ largeImagePreviews: false, _rev: "1" }]);
  });

  it("opens the tab the address names, and moves the address with each tab", () => {
    serving({ _rev: "1", setupStep: 3 });
    window.history.replaceState(null, "", `${SETTINGS}?tab=brand`);
    render(<SeoSettingsPage />);
    expect(isOpen("Organization")).toBe(true);
    expect(screen.getByLabelText("Other names")).toBeTruthy();

    openTab("Share images");
    expect(window.location.search).toBe("?tab=images");
    expect(isOpen("Share images")).toBe(true);
    expect(screen.getByText("Default share image")).toBeTruthy();
  });

  it("keeps what was typed on another tab, on the same screen and on one mounted again", () => {
    serving({ _rev: "5", siteName: "Rext AI", setupStep: 3 });
    const { unmount } = render(<SeoSettingsPage />);
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme" },
    });
    openTab(/Content types/);
    openTab("General");
    expect((screen.getByLabelText("Site name") as HTMLInputElement).value).toBe(
      "Acme"
    );

    // The admin may mount the screen anew for the new address.
    openTab(/Content types/);
    unmount();
    render(<SeoSettingsPage />);
    openTab("General");
    expect((screen.getByLabelText("Site name") as HTMLInputElement).value).toBe(
      "Acme"
    );
  });

  it("moves what was typed onto a newer version read when the screen is mounted again", () => {
    serving({
      _rev: "5",
      siteName: "Rext AI",
      description: "Old words.",
      setupStep: 3,
    });
    const { unmount } = render(<SeoSettingsPage />);
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme" },
    });
    openTab(/Content types/);
    unmount();

    // Someone else saves before the screen is mounted for the new address.
    stored = { ...stored, description: "Their words.", _rev: "6" };
    render(<SeoSettingsPage />);
    openTab("General");
    expect((screen.getByLabelText("Site name") as HTMLInputElement).value).toBe(
      "Acme"
    );
    expect(
      (screen.getByLabelText("Default description") as HTMLTextAreaElement)
        .value
    ).toBe("Their words.");
  });

  it("lets go of what was typed once the screen is left for another page", () => {
    serving({ _rev: "5", siteName: "Rext AI", setupStep: 3 });
    const { unmount } = render(<SeoSettingsPage />);
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme" },
    });
    window.history.pushState(null, "", "/admin/collections/posts");
    unmount();

    window.history.replaceState(null, "", SETTINGS);
    render(<SeoSettingsPage />);
    expect((screen.getByLabelText("Site name") as HTMLInputElement).value).toBe(
      "Rext AI"
    );
  });
});

describe("the General tab", () => {
  it("describes an address it can't take by what is wrong with it", () => {
    serving({ _rev: "1", siteName: "Nextly", setupStep: 3 });
    render(<SeoSettingsPage />);
    const address = screen.getByRole("textbox", {
      name: "Production address",
    });
    fireEvent.change(address, { target: { value: "nextlyhq.com" } });
    expect(address.getAttribute("aria-invalid")).toBe("true");
    const describedBy = address.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe(
      "Start the address with https://, for example https://example.com."
    );
  });

  it("shows the production address the server sets, read-only, and saves none", async () => {
    serving({ _rev: "1", siteName: "Nextly", setupStep: 3 }, "seo-settings", [
      "https://nextlyhq.com",
    ]);
    render(<SeoSettingsPage />);

    const address = screen.getByLabelText(
      "Production address"
    ) as HTMLInputElement;
    expect(address.value).toBe("https://nextlyhq.com");
    expect(address.readOnly).toBe(true);
    expect(
      screen.getByText("Set by NEXTLY_PRODUCTION_ADDRESSES on the server")
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Add an address for a language on its own domain",
      })
    ).toBeNull();
  });

  it("asks for no address in setup where the server sets one", async () => {
    serving({}, "seo-settings", ["https://nextlyhq.com"]);
    render(<SeoSettingsPage />);

    const dialog = await screen.findByRole("dialog");
    expect(
      (within(dialog).getByLabelText("Production address") as HTMLInputElement)
        .readOnly
    ).toBe(true);
  });

  it("says how long the default description is", () => {
    serving({
      _rev: "1",
      setupStep: 3,
      description: "x".repeat(128),
    });
    render(<SeoSettingsPage />);
    expect(screen.getByText("128 characters · Good")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Default description"), {
      target: { value: "y".repeat(170) },
    });
    expect(
      screen.getByText("170 characters · Google shows about 160")
    ).toBeTruthy();
  });

  it("chooses the title separator, shown in the example", async () => {
    serving({ _rev: "2", siteName: "Acme", setupStep: 3 });
    render(<SeoSettingsPage />);

    fireEvent.click(screen.getByRole("radio", { name: "Separator ·" }));
    expect(screen.getByText("Pricing · Acme")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(sent).toEqual([{ separator: "·", _rev: "2" }]);
  });
});

describe("a content type's title pattern", () => {
  const SET_UP = {
    _rev: "7",
    siteName: "Rext AI",
    productionAddresses: ["https://rext.ai"],
    setupStep: 3,
  };

  it("is set by clicking variables, with a live preview, and saved", async () => {
    serving(SET_UP);
    window.history.replaceState(null, "", `${SETTINGS}?tab=types`);
    render(<SeoSettingsPage />);

    expect(screen.queryByRole("dialog")).toBeNull();
    const input = screen.getByLabelText(
      "Title pattern for Blog posts"
    ) as HTMLInputElement;
    expect(input.value).toBe("{Title} | {Site name}");
    // The page's title already ends with the brand, so the preview, like the
    // page's head, does not add it again.
    expect(screen.getByText("Surfer SEO vs Rext AI")).toBeTruthy();
    fireEvent.change(input, { target: { value: "{Title} · " } });
    input.setSelectionRange(10, 10);
    fireEvent.click(screen.getByRole("button", { name: "{Category}" }));
    fireEvent.change(input, {
      target: { value: `${input.value} | {Site name}` },
    });

    expect(
      screen.getByText("Surfer SEO vs Rext AI · Comparisons | Rext AI")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();

    expect(sent).toEqual([
      {
        patterns: { posts: { title: "{Title} · {Category} | {Site name}" } },
        _rev: "7",
      },
    ]);
  });

  it("refuses a variable the type has no field for", () => {
    serving(SET_UP);
    window.history.replaceState(null, "", `${SETTINGS}?tab=types`);
    render(<SeoSettingsPage />);

    fireEvent.change(screen.getByLabelText("Title pattern for Blog posts"), {
      target: { value: "{Title} by {Author}" },
    });

    expect(
      screen.getByText(/Blog posts have no field called Author/)
    ).toBeTruthy();
    // Said beside Save, which waits for the fix.
    expect(
      screen.getByText("Fix the title pattern for Blog posts first.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty(
      "disabled",
      true
    );
  });

  it("returns to the default, and saving forgets the type's own", async () => {
    serving({ ...SET_UP, patterns: { posts: { title: "{Title}" } } });
    window.history.replaceState(null, "", `${SETTINGS}?tab=types`);
    render(<SeoSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(
      (
        screen.getByLabelText(
          "Title pattern for Blog posts"
        ) as HTMLInputElement
      ).value
    ).toBe("{Title} | {Site name}");
    expect(
      screen.queryByRole("button", { name: "Reset to default" })
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(sent).toEqual([{ patterns: {}, _rev: "7" }]);
  });

  it("marks a type with no public address, on the row and the tab", () => {
    serving(SET_UP);
    render(<SeoSettingsPage />);
    expect(
      screen.getByRole("link", { name: /Content types/ }).textContent
    ).toContain("1");

    openTab(/Content types/);
    expect(
      screen.getByText(
        "Not public yet: a developer sets where these pages live"
      )
    ).toBeTruthy();
    expect(
      screen.getByText("19 entries · e.g. /blog/surfer-seo-vs-rext-ai")
    ).toBeTruthy();
  });
});

describe("a brand fact", () => {
  it("is changed on the Organization tab and saved with the version it was read at", async () => {
    serving({
      _rev: "3",
      siteName: "Rext AI",
      brandName: "Rext",
      setupStep: 3,
    });
    render(<SeoSettingsPage />);

    openTab("Organization");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Rext AI" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add a profile/ }));
    fireEvent.change(screen.getByLabelText("Profile address"), {
      target: { value: "https://www.linkedin.com/company/rext-ai" },
    });
    // The network is read from the address.
    expect(screen.getByLabelText("LinkedIn profile")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();

    expect(sent).toEqual([
      {
        brandName: "Rext AI",
        socialProfiles: [
          {
            network: "LinkedIn",
            url: "https://www.linkedin.com/company/rext-ai",
          },
        ],
        _rev: "3",
      },
    ]);
  });
});

describe("saving", () => {
  it("says unsaved changes are waiting, and Cancel lets go of them", () => {
    serving({ _rev: "2", siteName: "Acme", setupStep: 3 });
    render(<SeoSettingsPage />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveProperty("disabled", true);
    expect(screen.queryByText("You have unsaved changes")).toBeNull();

    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme Ltd" },
    });
    expect(screen.getByText("You have unsaved changes")).toBeTruthy();
    fireEvent.click(cancel);

    expect((screen.getByLabelText("Site name") as HTMLInputElement).value).toBe(
      "Acme"
    );
    expect(screen.queryByText("You have unsaved changes")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("keeps an edit made while a save was on its way when a read lands first", async () => {
    serving({ _rev: "2", siteName: "Acme", setupStep: 3 });
    let finish = () => {};
    answerSave = () =>
      new Promise<void>(resolve => {
        finish = resolve;
      });
    const { rerender } = render(<SeoSettingsPage />);
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme Ltd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    // Changed back while the save is on its way.
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme" },
    });
    // The save's own refresh reads the new version before the save answers.
    stored = { ...stored, siteName: "Acme Ltd", _rev: "3" };
    rerender(<SeoSettingsPage />);
    finish();
    await settle();
    expect((screen.getByLabelText("Site name") as HTMLInputElement).value).toBe(
      "Acme"
    );
  });

  it("opens no other tab while a save is on its way", async () => {
    serving({ _rev: "2", siteName: "Acme", setupStep: 3 });
    let finish = () => {};
    answerSave = () =>
      new Promise<void>(resolve => {
        finish = resolve;
      });
    render(<SeoSettingsPage />);
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme Ltd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    openTab(/Content types/);
    expect(window.location.search).toBe("");
    finish();
    await settle();
    openTab(/Content types/);
    expect(window.location.search).toBe("?tab=types");
  });

  it("keeps what was typed while a save was on its way", async () => {
    serving({ _rev: "2", siteName: "Acme", setupStep: 3 });
    let finish = () => {};
    answerSave = () =>
      new Promise<void>(resolve => {
        finish = resolve;
      });
    render(<SeoSettingsPage />);

    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme Ltd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    fireEvent.change(screen.getByLabelText("Default description"), {
      target: { value: "Typed while saving" },
    });
    finish();
    await settle();

    expect(sent).toEqual([{ siteName: "Acme Ltd", _rev: "2" }]);
    expect(
      (screen.getByLabelText("Default description") as HTMLTextAreaElement)
        .value
    ).toBe("Typed while saving");
    // Still unsaved, so it can be saved next.
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty(
      "disabled",
      false
    );
  });

  it("reads and saves the Single under the name the host gave it", async () => {
    serving({ _rev: "1", setupStep: 3 }, "site-seo");
    render(<SeoSettingsPage />);

    expect(vi.mocked(useSingleDocument).mock.calls.at(-1)?.[0]).toBe(
      "site-seo"
    );
    expect(vi.mocked(useUpdateSingleDocument).mock.calls.at(-1)?.[0]).toBe(
      "site-seo"
    );
  });

  it("lets a person who may not save close first-time setup", async () => {
    serving({});
    answerSave = () =>
      Promise.reject(new Error("You may not change these settings."));
    render(<SeoSettingsPage />);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await settle();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Finish setting up SEO.")).toBeTruthy();
  });

  it("keeps the form, and what was typed, when a later read of the settings fails", () => {
    serving({ _rev: "1", siteName: "Acme", setupStep: 3 });
    const { rerender } = render(<SeoSettingsPage />);
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme Ltd" },
    });

    const refetch = vi.fn(async () => ({ data: stored }));
    vi.mocked(useSingleDocument).mockImplementation(
      () =>
        ({
          data: stored,
          error: new Error("The network is down."),
          refetch,
        }) as unknown as ReturnType<typeof useSingleDocument>
    );
    rerender(<SeoSettingsPage />);

    expect((screen.getByLabelText("Site name") as HTMLInputElement).value).toBe(
      "Acme Ltd"
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be read again"
    );
  });

  it("takes the saved document as the new baseline when the re-read after a save fails", async () => {
    serving({ _rev: "1", siteName: "Acme", setupStep: 3 });
    const before = stored;
    // The re-read fails, answering with the copy cached before the save.
    vi.mocked(useSingleDocument).mockImplementation(
      () =>
        ({
          data: before,
          error: null,
          refetch: async () => ({ data: before, error: new Error("offline") }),
        }) as unknown as ReturnType<typeof useSingleDocument>
    );
    render(<SeoSettingsPage />);

    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme Ltd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect((screen.getByLabelText("Site name") as HTMLInputElement).value).toBe(
      "Acme Ltd"
    );

    fireEvent.change(screen.getByLabelText("Default description"), {
      target: { value: "Things." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();

    // The second save sends only its own change, at the version the first
    // save answered with.
    expect(sent).toEqual([
      { siteName: "Acme Ltd", _rev: "1" },
      { description: "Things.", _rev: "2" },
    ]);
  });

  it("keeps what a save stored over a read that landed while it was on its way", async () => {
    serving({ _rev: "1", siteName: "Acme", setupStep: 3 });
    let cached = stored;
    // The re-read after the save fails, answering with the cached copy.
    vi.mocked(useSingleDocument).mockImplementation(
      () =>
        ({
          data: cached,
          error: null,
          refetch: async () => ({ data: cached, error: new Error("offline") }),
        }) as unknown as ReturnType<typeof useSingleDocument>
    );
    let finish = () => {};
    answerSave = () =>
      new Promise<void>(resolve => {
        finish = resolve;
      });
    const { rerender } = render(<SeoSettingsPage />);
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme Ltd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();

    // Someone else's save is read while this one is on its way; this one
    // then stores a later version, holding both.
    stored = { ...stored, description: "Theirs.", _rev: "2" };
    cached = stored;
    rerender(<SeoSettingsPage />);
    finish();
    await settle();
    rerender(<SeoSettingsPage />);
    await settle();

    expect((screen.getByLabelText("Site name") as HTMLInputElement).value).toBe(
      "Acme Ltd"
    );
    fireEvent.change(screen.getByLabelText("Default description"), {
      target: { value: "Mine." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(sent.at(-1)).toEqual({ description: "Mine.", _rev: "3" });
  });
});

describe("the content types tab", () => {
  const SET_UP = { _rev: "5", siteName: "Rext AI", setupStep: 3 };
  beforeEach(() => {
    window.history.replaceState(null, "", `${SETTINGS}?tab=types`);
  });

  it("hides a whole type from search", async () => {
    serving(SET_UP);
    render(<SeoSettingsPage />);

    fireEvent.click(
      screen.getByRole("switch", { name: "Hide all Blog posts from search" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();

    expect(sent).toEqual([{ hiddenTypes: ["posts"], _rev: "5" }]);
  });

  it("lists a type with SEO switched off in code, greyed and with nothing to set", async () => {
    serving(SET_UP);
    render(<SeoSettingsPage />);

    const without = screen.getByRole("group", { name: "Without SEO" });
    expect(within(without).getByText("Testimonials")).toBeTruthy();
    expect(
      within(without).getByText("40 entries · No public pages")
    ).toBeTruthy();
    // A type served at its own address without SEO says so.
    expect(within(without).getByText("Public, without SEO")).toBeTruthy();
    expect(
      screen.queryByRole("switch", {
        name: "Hide all Testimonials from search",
      })
    ).toBeNull();
    expect(
      screen.queryByRole("combobox", {
        name: "Structured data for Testimonials",
      })
    ).toBeNull();
    expect(
      screen.queryByLabelText("Title pattern for Testimonials")
    ).toBeNull();
  });

  it("keeps the types the plugin hides hidden when the site hides another", async () => {
    serving(SET_UP);
    vi.mocked(usePluginClientConfig).mockReturnValue({
      hiddenTypes: ["cases"],
    });
    try {
      render(<SeoSettingsPage />);
      expect(
        screen
          .getByRole("switch", { name: "Hide all Case studies from search" })
          .getAttribute("aria-checked")
      ).toBe("true");

      fireEvent.click(
        screen.getByRole("switch", { name: "Hide all Blog posts from search" })
      );
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await settle();

      expect(sent).toEqual([{ hiddenTypes: ["cases", "posts"], _rev: "5" }]);
    } finally {
      vi.mocked(usePluginClientConfig).mockReturnValue(undefined);
    }
  });

  it("shows the plugin's structured data choice and mapping until the site chooses", async () => {
    serving(SET_UP);
    vi.mocked(usePluginClientConfig).mockReturnValue({
      structuredData: {
        posts: {
          type: "article",
          details: { article: { author: { value: "The Rext team" } } },
        },
      },
    });
    try {
      render(<SeoSettingsPage />);
      expect(chosen("Structured data for Blog posts")).toBe("Article");
      expect(screen.getByText("· all set")).toBeTruthy();
      expect(
        (
          screen.getByRole("button", {
            name: "Save changes",
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);

      // A value the site's code fixes is shown as that value.
      fireEvent.click(screen.getByRole("button", { name: "Map details" }));
      expect(chosen("Field that holds author")).toBe('Always "The Rext team"');
      expect(screen.getByText("set in the site's code")).toBeTruthy();
    } finally {
      vi.mocked(usePluginClientConfig).mockReturnValue(undefined);
    }
  });

  it("says beside Questions and answers that Google no longer shows it, and names only the type once chosen", async () => {
    serving(SET_UP);
    render(<SeoSettingsPage />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("combobox", { name: "Structured data for Blog posts" })
    );
    const options = (await screen.findAllByRole("option")).map(
      option => option.textContent
    );
    expect(options).toContain(
      "Questions and answers · no longer shown by Google"
    );
    // Only that kind carries the note.
    expect(options.filter(text => text?.includes("·"))).toHaveLength(1);
    await user.click(
      screen.getByRole("option", {
        name: "Questions and answers · no longer shown by Google",
      })
    );
    // Once chosen, the choice is named alone, so it fits its box.
    expect(chosen("Structured data for Blog posts")).toBe(
      "Questions and answers"
    );
    fireEvent.click(screen.getByRole("button", { name: "Map details" }));
    expect(chosen("Details for")).toBe("Questions and answers");
  });

  it("offers the details a type may use as well as those it needs, counting only the needed as missing", async () => {
    serving(SET_UP);
    render(<SeoSettingsPage />);
    await choose("Structured data for Blog posts", "Product");
    // The price is found by its name; nothing holds the availability.
    expect(screen.getByText("· 1 missing")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Map details" }));
    expect(
      screen.getByRole("combobox", { name: "Field that holds currency" })
    ).toBeTruthy();
    expect(screen.getByText("Optional for Product")).toBeTruthy();
    expect(screen.getByText("Google needs this for Product")).toBeTruthy();
  });

  it("keeps the open details on the type chosen when the type changes", async () => {
    serving(SET_UP);
    render(<SeoSettingsPage />);
    await choose("Structured data for Blog posts", "Article");
    fireEvent.click(screen.getByRole("button", { name: "Map details" }));
    expect(
      screen.getByRole("combobox", { name: "Field that holds author" })
    ).toBeTruthy();

    await choose("Structured data for Blog posts", "Product");
    expect(
      screen.getByRole("combobox", { name: "Field that holds currency" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: "Field that holds author" })
    ).toBeNull();
  });

  it("shows the field the markup reads first by its name, and keeps another chosen over it", async () => {
    serving(SET_UP);
    // `writer` is declared first, but the markup looks for `author` first.
    vi.mocked(usePluginRoute).mockImplementation(
      request =>
        ({
          data: request.path.endsWith("/document")
            ? { single: "seo-settings", serverAddresses: [] }
            : {
                items: [
                  {
                    ...POSTS,
                    mappableFields: [
                      { name: "writer", label: "Writer" },
                      { name: "author", label: "Author" },
                    ],
                  },
                ],
              },
          pending: false,
          error: null,
          refetch: () => {},
          fetching: false,
        }) as ReturnType<typeof usePluginRoute>
    );
    render(<SeoSettingsPage />);
    await choose("Structured data for Blog posts", "Article");
    fireEvent.click(screen.getByRole("button", { name: "Map details" }));
    expect(chosen("Field that holds author")).toBe("Author");

    await choose("Field that holds author", "Writer");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();

    expect(sent).toEqual([
      {
        structuredData: {
          posts: {
            type: "article",
            details: { article: { author: "writer" } },
          },
        },
        _rev: "5",
      },
    ]);

    // Choosing no field returns the author to being found by its name.
    await choose("Field that holds author", "Author");
    expect(chosen("Field that holds author")).toBe("Author");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(sent[1]).toEqual({
      structuredData: { posts: { type: "article" } },
      _rev: "6",
    });
  });

  it("chooses a type's structured data, maps the details it lacks, and saves both", async () => {
    serving(SET_UP);
    render(<SeoSettingsPage />);

    await choose("Structured data for Blog posts", "Article");
    // The date is found by its field's name, and the image is the page's
    // share image; nothing holds the author.
    expect(screen.getByText("· 1 missing")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Map details" }));
    expect(
      screen.getByText("on Blog posts (this type's default)")
    ).toBeTruthy();
    // A field found by its name is shown as that field.
    expect(chosen("Field that holds date published")).toBe("Published at");
    expect(await optionsOf("Field that holds date published")).toContain(
      "Byline (credit)"
    );
    await choose("Field that holds author", "Byline (byline)");
    expect(screen.getByText("from each entry's Byline")).toBeTruthy();
    expect(screen.getByText("from each page's share image")).toBeTruthy();
    expect(screen.getByText("· all set")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();

    expect(sent).toEqual([
      {
        structuredData: {
          posts: {
            type: "article",
            details: { article: { author: "byline" } },
          },
        },
        _rev: "5",
      },
    ]);
  });
});

describe("what review asked of the tabs", () => {
  it("offers a type's optional details where it needs none", async () => {
    serving({ _rev: "5", setupStep: 3 });
    window.history.replaceState(null, "", `${SETTINGS}?tab=types`);
    render(<SeoSettingsPage />);
    await choose("Structured data for Blog posts", "Software app");
    expect(screen.getByRole("button", { name: "Map details" })).toBeTruthy();
  });

  it("lists the types without SEO where no type has it", () => {
    serving({ _rev: "5", setupStep: 3 });
    vi.mocked(usePluginRoute).mockImplementation(
      request =>
        ({
          data: request.path.endsWith("/document")
            ? { single: "seo-settings", serverAddresses: [] }
            : {
                items: [
                  { key: "events", label: "Events", public: true, seo: false },
                ],
              },
          pending: false,
          error: null,
          refetch: () => {},
          fetching: false,
        }) as ReturnType<typeof usePluginRoute>
    );
    window.history.replaceState(null, "", `${SETTINGS}?tab=types`);
    render(<SeoSettingsPage />);
    expect(screen.getByText(/No content type has SEO yet/)).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "Without SEO" })).getByText(
        "Events"
      )
    ).toBeTruthy();
  });

  it("holds up no save for a saved address the server's address replaces", async () => {
    serving(
      {
        _rev: "5",
        setupStep: 3,
        siteName: "Acme",
        productionAddresses: ["https://acme.com/"],
      },
      "seo-settings",
      ["https://acme.com"]
    );
    render(<SeoSettingsPage />);
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme Ltd" },
    });
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty(
      "disabled",
      false
    );
  });

  it("keeps setup closed on a screen mounted again after it was closed", async () => {
    serving({ _rev: "5" });
    answerSave = () => Promise.reject(new Error("offline"));
    const { unmount } = render(<SeoSettingsPage />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Site name"), {
      target: { value: "Acme" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await settle();
    unmount();
    render(<SeoSettingsPage />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Finish setting up SEO.")).toBeTruthy();
  });

  it("takes a newer copy of the settings read since as the baseline a save names", async () => {
    serving({ _rev: "5", siteName: "Acme", setupStep: 3 });
    const { rerender } = render(<SeoSettingsPage />);
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Acme Ltd" },
    });
    fireEvent.change(screen.getByLabelText("Default description"), {
      target: { value: "Things." },
    });
    // A save made on the screen this one replaced lands: the read moves on.
    stored = { ...stored, siteName: "Acme Ltd", _rev: "6" };
    rerender(<SeoSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(sent).toEqual([{ description: "Things.", _rev: "6" }]);
  });

  it("keeps a value someone else changed meanwhile, saving only what was edited here", async () => {
    serving({ _rev: "5", siteName: "Acme", setupStep: 3 });
    const { rerender } = render(<SeoSettingsPage />);
    fireEvent.change(screen.getByLabelText("Default description"), {
      target: { value: "Things." },
    });
    // Another person renames the site, and the read moves on.
    stored = { ...stored, siteName: "Acme Ltd", _rev: "6" };
    rerender(<SeoSettingsPage />);
    expect((screen.getByLabelText("Site name") as HTMLInputElement).value).toBe(
      "Acme Ltd"
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(sent).toEqual([{ description: "Things.", _rev: "6" }]);
  });
});
