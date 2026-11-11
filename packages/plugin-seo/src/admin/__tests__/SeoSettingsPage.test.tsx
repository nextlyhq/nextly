// @vitest-environment jsdom

/**
 * The SEO settings screen as a person uses it: first-time setup and closing
 * it part-way, a content type's title pattern set by clicking variables with
 * a live preview and returned to its default, and a brand fact changed. What
 * each save sends is read from the save itself.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
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
}));

import {
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
  single = "seo-settings"
): void {
  stored = { id: "s1", updatedAt: "", ...document };
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
          ? { single }
          : { items: [POSTS, CASES] },
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

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    "/admin/plugins/nextlyhq-plugin-seo/settings"
  );
});

describe("first-time setup", () => {
  it("asks three questions, saving each step, then lists what needs attention", async () => {
    serving({});
    render(<SeoSettingsPage />);

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Set up SEO" })
    ).toBeTruthy();
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
    expect(
      screen
        .getByRole("tab", { name: /Content types/ })
        .getAttribute("aria-selected")
    ).toBe("true");
    expect(window.location.search).toBe("?tab=types");
    // Finished: no banner offers setup again.
    expect(screen.queryByText("Finish setting up SEO.")).toBeNull();
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

describe("a content type's title pattern", () => {
  const SET_UP = {
    _rev: "7",
    siteName: "Rext AI",
    productionAddresses: ["https://rext.ai"],
    setupStep: 3,
  };

  it("is set by clicking variables, with a live preview, and saved", async () => {
    serving(SET_UP);
    render(<SeoSettingsPage />);

    expect(screen.queryByRole("dialog")).toBeNull();
    const edit = screen.getByRole("button", {
      name: "Edit the title pattern for Blog posts",
    });
    expect(edit.textContent).toContain("{Title} | {Site name}");
    fireEvent.click(edit);

    const input = screen.getByLabelText("Title pattern for Blog posts");
    // The page's title already ends with the brand, so the preview, like the
    // page's head, does not add it again.
    expect(screen.getByText("Surfer SEO vs Rext AI")).toBeTruthy();
    fireEvent.change(input, { target: { value: "{Title} · " } });
    (input as HTMLInputElement).setSelectionRange(10, 10);
    fireEvent.click(screen.getByRole("button", { name: "{Category}" }));
    fireEvent.change(input, {
      target: { value: `${(input as HTMLInputElement).value} | {Site name}` },
    });

    expect(
      screen.getByText("Surfer SEO vs Rext AI · Comparisons | Rext AI")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
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
    render(<SeoSettingsPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit the title pattern for Blog posts",
      })
    );

    fireEvent.change(screen.getByLabelText("Title pattern for Blog posts"), {
      target: { value: "{Title} by {Author}" },
    });

    expect(
      screen.getByText(/Blog posts have no field called Author/)
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toHaveProperty(
      "disabled",
      true
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty(
      "disabled",
      true
    );
  });

  it("returns to the default, and saving forgets the type's own", async () => {
    serving({ ...SET_UP, patterns: { posts: { title: "{Title}" } } });
    render(<SeoSettingsPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit the title pattern for Blog posts",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(
      (
        screen.getByLabelText(
          "Title pattern for Blog posts"
        ) as HTMLInputElement
      ).value
    ).toBe("{Title} | {Site name}");
    expect(
      screen.getByRole("button", { name: "Reset to default" })
    ).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(sent).toEqual([{ patterns: {}, _rev: "7" }]);
  });

  it("marks a type with no public address, on the row and the tab", () => {
    serving(SET_UP);
    render(<SeoSettingsPage />);

    expect(
      screen.getByRole("tab", { name: /Content types/ }).textContent
    ).toContain("1");
    expect(screen.getByText("Not public yet")).toBeTruthy();
    expect(screen.getByText("/blog/surfer-seo-vs-rext-ai")).toBeTruthy();
  });
});

describe("a brand fact", () => {
  it("is changed on the Brand tab and saved with the version it was read at", async () => {
    serving({
      _rev: "3",
      siteName: "Rext AI",
      brandName: "Rext",
      setupStep: 3,
    });
    render(<SeoSettingsPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Brand" }));
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
  it("keeps what was typed while a save was on its way", async () => {
    serving({ _rev: "2", siteName: "Acme", setupStep: 3 });
    let finish = () => {};
    answerSave = () =>
      new Promise<void>(resolve => {
        finish = resolve;
      });
    render(<SeoSettingsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "General" }));

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
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "General" }));

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
});

describe("the content types table", () => {
  const SET_UP = { _rev: "5", siteName: "Rext AI", setupStep: 3 };

  it("shows each type's SEO as set in code, and hides a whole type from search", async () => {
    serving(SET_UP);
    render(<SeoSettingsPage />);
    expect(screen.getByText("19 entries")).toBeTruthy();

    const seo = screen.getByRole("switch", { name: "SEO for Blog posts" });
    expect(seo.getAttribute("aria-checked")).toBe("true");
    expect(seo).toHaveProperty("disabled", true);

    fireEvent.click(
      screen.getByRole("switch", { name: "Hide all Blog posts from search" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();

    expect(sent).toEqual([{ hiddenTypes: ["posts"], _rev: "5" }]);
  });

  it("chooses a type's structured data, maps the details it lacks, and saves both", async () => {
    serving(SET_UP);
    render(<SeoSettingsPage />);

    fireEvent.change(
      screen.getByRole("combobox", { name: "Structured data for Blog posts" }),
      { target: { value: "article" } }
    );
    // The date is found by its field's name; nothing holds the author or the image.
    expect(screen.getByText("· 2 missing")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Map details" }));
    expect(
      screen.getByText("on Blog posts (this type's default)")
    ).toBeTruthy();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Field that holds author" }),
      { target: { value: "byline" } }
    );
    expect(screen.getByText("from each entry's Byline")).toBeTruthy();
    expect(screen.getByText("· 1 missing")).toBeTruthy();
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
