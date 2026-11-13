// @vitest-environment jsdom

/**
 * Search engines and AI's "Your own rules" box as a person uses it: lines
 * are numbered and read as typed; a rule keeping every crawler from the
 * whole site is refused and holds the save up; a misspelt rule is warned
 * about and a non-standard line kept with a note; a rule blocking pages the
 * sitemap lists names them and saves only once "Block these N pages anyway"
 * is ticked, the tick saved with the text and pages it confirmed; a site
 * serving its own robots.txt is told so. The AI Overviews row says what
 * robots.txt can't do. What each save sends is read from the save itself.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useSingleDocument: vi.fn(),
  useUpdateSingleDocument: vi.fn(),
  usePluginRoute: vi.fn(),
  useMediaItem: vi.fn(() => ({ data: undefined })),
  MediaPickerDialog: () => null,
  toastMutationResult: vi.fn(),
  usePluginClientConfig: vi.fn(() => undefined),
  writePluginRoute: vi.fn(),
  // A move within the admin, as the admin makes it: the address changes and
  // the move is announced.
  navigateTo: vi.fn((href: string) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new Event("locationchange"));
  }),
}));

import {
  usePluginRoute,
  useSingleDocument,
  useUpdateSingleDocument,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";

import type { ConnectionsBody } from "../../connections/contract";
import type { RobotsRulesCheckBody } from "../../settings/robots-rules";

import { SeoSettingsPage } from "../SeoSettingsPage";

/** The stored Single, as the fake server holds it between saves. */
let stored: Record<string, unknown>;
/** Every body a save sent, in order. */
let sent: Record<string, unknown>[];
let connections: ConnectionsBody;
let report: undefined;
let rereads: number;

function serving(
  document: Record<string, unknown>,
  state: ConnectionsBody = {
    searchConsole: { configured: true },
    indexNow: {},
  }
): void {
  connections = state;
  report = undefined;
  rereads = 0;
  stored = { id: "s1", updatedAt: "", setupStep: 3, ...document };
  sent = [];
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
          ? { single: "seo-settings" }
          : request.path === "/connections"
            ? connections
            : request.path.endsWith("/report")
              ? report
              : { items: [] },
        pending: false,
        error: null,
        refetch: () => {
          rereads += 1;
        },
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

/** Opens one of the screen's tabs by its link. */
const openTab = (name: string) =>
  fireEvent.click(screen.getByRole("link", { name }));

const box = () => screen.getByRole("textbox", { name: "Your own rules" });
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const saveButton = () =>
  screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;

/** What the sitemap check answers for each text, unless a test says else. */
let answers: Record<string, RobotsRulesCheckBody>;
let asked: string[];
/** The hidden types each check was asked with. */
let askedHidden: unknown[];
/** Whether the site's robots.txt carries the plugin's header. */
let servedByPlugin: boolean;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  answers = {};
  asked = [];
  askedHidden = [];
  servedByPlugin = true;
  vi.mocked(writePluginRoute).mockImplementation((async (request: {
    body: { text: string; hiddenTypes?: unknown };
  }) => {
    asked.push(request.body.text);
    askedHidden.push(request.body.hiddenTypes);
    return answers[request.body.text] ?? { lines: [], pagesKey: "0:811c9dc5" };
  }) as unknown as typeof writePluginRoute);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      headers: new Headers(
        servedByPlugin ? { "x-nextly-robots": "plugin-seo" } : {}
      ),
    }))
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Lets typing pause long enough for the sitemap check, and its answer land. */
async function pause(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  await settle();
}

/**
 * Each test's settings as a document of their own: an unsaved draft is kept
 * for the document it was made on, so one test's edits never reach the next.
 */
let version = 100;

function openCrawlers(document: Record<string, unknown> = {}): void {
  version += 1;
  serving({ id: `s${version}`, _rev: String(version), ...document });
  render(<SeoSettingsPage />);
  openTab("Search engines and AI");
}

describe("the Search engines and AI tab", () => {
  it("says search engines are allowed except where the site's own rules say otherwise", () => {
    openCrawlers();
    expect(
      screen.getByText(
        "Always allowed, except where your own rules below say otherwise."
      )
    ).toBeTruthy();
  });

  it("says robots.txt can't take a site out of Google's AI Overviews and AI Mode", () => {
    openCrawlers();
    expect(screen.getByText("Google's AI Overviews and AI Mode")).toBeTruthy();
    expect(
      screen.getByText(/robots\.txt can't take your site out of them/)
    ).toBeTruthy();
  });
});

describe("your own rules", () => {
  it("saves rules that block no sitemap page, saying so", async () => {
    openCrawlers();
    type("User-agent: *\nDisallow: /search\n");
    await pause();
    expect(asked).toEqual(["User-agent: *\nDisallow: /search"]);
    expect(
      screen.getByText("No rule blocks a page in your sitemap.")
    ).toBeTruthy();
    fireEvent.click(saveButton());
    await settle();
    expect(sent).toEqual([
      {
        robotsRules: { text: "User-agent: *\nDisallow: /search" },
        _rev: String(version),
      },
    ]);
  });

  it("refuses a rule that keeps every crawler from the whole site, and asks nothing of the server", async () => {
    openCrawlers();
    type("User-agent: *\nDisallow: /");
    await pause();
    expect(
      screen.getByText(
        "Line 2 would keep every crawler away from the whole site, so it can't be saved."
      )
    ).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(
      screen.getByText("Fix line 2 of your own rules first.")
    ).toBeTruthy();
    expect(asked).toEqual([]);
  });

  it("warns about a misspelt rule and keeps a non-standard line with a note", async () => {
    openCrawlers();
    type(
      "User-agent: *\nDisallow: /search\nDissalow: /tmp\nContent-Signal: search=yes, ai-train=no"
    );
    await pause();
    expect(
      screen.getByText(
        'Line 3: "Dissalow" is misspelt. Google reads it as Disallow; other crawlers may skip it.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Line 4 isn't a standard robots.txt rule. It's kept; crawlers may ignore it."
      )
    ).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
  });

  it("names the sitemap pages a rule blocks, and saves only once they are confirmed", async () => {
    const text = "User-agent: *\nDisallow: /search\nDisallow: /blog";
    answers[text] = {
      lines: [
        {
          line: 3,
          rule: "Disallow: /blog",
          count: 24,
          examples: ["/blog/introducing-nextly", "/blog/what-is-nextly"],
        },
      ],
      pagesKey: "24:abc123",
    };
    openCrawlers();
    type(text);
    await pause();
    expect(
      screen.getByText(
        /Line 3 keeps crawlers away from 24 pages in your sitemap:/
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        /\/blog\/introducing-nextly, \/blog\/what-is-nextly and 22 more/
      )
    ).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText("Confirm line 3 first.")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Block these 24 pages anyway" })
    );
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await settle();
    expect(sent).toEqual([
      {
        robotsRules: { text, confirmed: { text, pages: "24:abc123" } },
        _rev: String(version),
      },
    ]);
  });

  it("asks again when the rules change after they were confirmed", async () => {
    const text = "User-agent: *\nDisallow: /blog";
    const longer = `${text}\nDisallow: /news`;
    const blocking = {
      lines: [
        {
          line: 2,
          rule: "Disallow: /blog",
          count: 2,
          examples: ["/blog/a", "/blog/b"],
        },
      ],
      pagesKey: "2:aa",
    };
    answers[text] = blocking;
    answers[longer] = blocking;
    openCrawlers({ robotsRules: { text, confirmed: { text, pages: "2:aa" } } });
    await pause();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Block these 2 pages anyway",
        }) as HTMLButtonElement
      ).getAttribute("aria-checked")
    ).toBe("true");

    type(longer);
    await pause();
    expect(
      screen
        .getByRole("checkbox", { name: "Block these 2 pages anyway" })
        .getAttribute("aria-checked")
    ).toBe("false");
    expect(screen.getByText("Confirm line 2 first.")).toBeTruthy();
  });

  it("asks again when the rules come to block other pages, without holding up other saves", async () => {
    const text = "User-agent: *\nDisallow: /blog";
    answers[text] = {
      lines: [
        { line: 2, rule: "Disallow: /blog", count: 3, examples: ["/blog/a"] },
      ],
      pagesKey: "3:bb",
    };
    openCrawlers({ robotsRules: { text, confirmed: { text, pages: "2:aa" } } });
    await pause();
    expect(
      screen
        .getByRole("checkbox", { name: "Block these 3 pages anyway" })
        .getAttribute("aria-checked")
    ).toBe("false");
    fireEvent.click(screen.getByRole("switch", { name: "llms.txt" }));
    expect(saveButton().disabled).toBe(false);
  });

  it("clears the rules when the box is emptied", async () => {
    openCrawlers({ robotsRules: { text: "User-agent: *\nDisallow: /search" } });
    await pause();
    type("");
    fireEvent.click(saveButton());
    await settle();
    expect(sent).toEqual([{ robotsRules: null, _rev: String(version) }]);
  });

  it("opens empty, asking nothing, for settings saved before the box existed", async () => {
    openCrawlers({ robotsRules: undefined });
    await pause();
    expect((box() as HTMLTextAreaElement).value).toBe("");
    expect(asked).toEqual([]);
  });

  it("says when the site serves its own robots.txt", async () => {
    servedByPlugin = false;
    openCrawlers();
    await settle();
    expect(
      screen.getByText(
        /Your site has its own robots\.txt file, so these rules and the AI tools choice aren't used\./
      )
    ).toBeTruthy();
  });

  it("says nothing of its own file where the plugin serves robots.txt", async () => {
    openCrawlers();
    await settle();
    expect(
      screen.queryByText(/Your site has its own robots\.txt file/)
    ).toBeNull();
  });
});

describe("which tools the AI choice covers", () => {
  it("lists each crawler by what it does, and what the chosen option asks of it", () => {
    openCrawlers({ aiCrawlers: "search" });
    const toggle = screen.getByRole("button", {
      name: "See which tools this covers",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const rowOf = (name: string) =>
      screen.getByRole("rowheader", { name: new RegExp(name) }).closest("tr");
    const training = rowOf("Collect pages to train AI models");
    expect(training?.textContent).toContain("GPTBot");
    expect(training?.textContent).toContain("Asked to stay away");
    const answers = rowOf("Read pages to answer questions and cite them");
    expect(answers?.textContent).toContain("OAI-SearchBot");
    expect(answers?.textContent).toContain("Allowed");
    const own = rowOf("Visit only what the site asked for");
    expect(own?.textContent).toContain("OAI-AdsBot");
    expect(own?.textContent).toContain("Never asked to stay away");
    expect(screen.getByText(/Last checked 13 Nov 2026\./)).toBeTruthy();
  });

  it("follows the choice as it changes", () => {
    openCrawlers({ aiCrawlers: "all" });
    fireEvent.click(
      screen.getByRole("button", { name: "See which tools this covers" })
    );
    const answers = () =>
      screen
        .getByRole("rowheader", { name: /Read pages to answer questions/ })
        .closest("tr")?.textContent;
    expect(answers()).toContain("Allowed");
    fireEvent.click(screen.getByRole("radio", { name: /Block all AI tools/ }));
    expect(answers()).toContain("Asked to stay away");
  });
});

describe("the check and the draft's other settings", () => {
  it("asks with the content types the draft hides, and again when they change", async () => {
    openCrawlers({ hiddenTypes: ["posts"] });
    type("User-agent: *\nDisallow: /blog");
    await pause();
    expect(askedHidden).toEqual([["posts"]]);
  });
});
