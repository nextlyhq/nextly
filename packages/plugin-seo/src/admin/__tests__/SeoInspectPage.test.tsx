// @vitest-environment jsdom

/**
 * Inspect as a person uses it: the page its address names fetched as each
 * crawler on open, each crawler's line, a difference explained in a note,
 * the Head table compared with the crawler chosen, the structured data and
 * its JSON-LD; and what Nextly holds still shown where the address isn't
 * fetched or every fetch stopped.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  writePluginRoute: vi.fn(),
  navigateTo: vi.fn(),
}));

import { navigateTo, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import type {
  CrawlerKey,
  ReceivedAnswer,
  ReceivedCell,
  RowKey,
} from "../../received/contract";
import { SeoInspectPage } from "../SeoInspectPage";

const KEYS: CrawlerKey[] = [
  "googlebot",
  "bingbot",
  "facebook",
  "x",
  "linkedin",
  "ai",
];
const NAMES: Record<CrawlerKey, string> = {
  googlebot: "Google",
  bingbot: "Bing",
  facebook: "Facebook",
  x: "X",
  linkedin: "LinkedIn",
  ai: "AI crawlers",
};
const ROWS: RowKey[] = [
  "title",
  "description",
  "canonical",
  "robots",
  "image",
  "locale",
  "siteName",
];
const ADDRESS = "https://nextlyhq.com/blog/introducing-nextly";
const EDIT = "/admin/collections/posts/7?tab=nextlyhq-plugin-seo.tab";

const HELD = {
  name: "Introducing Nextly",
  editHref: EDIT,
  stored: {
    title: "Introducing Nextly | Nextly Blog",
    description: "Nextly is an open-source content platform.",
    image: {
      url: "https://nextlyhq.com/media/cover.svg",
      width: 1200,
      height: 630,
    },
    canonical: ADDRESS,
    listed: true,
    followed: true,
    locale: "en_US",
    siteName: "Nextly",
    from: {
      title: {
        level: "pattern" as const,
        pattern: "{Title} | {Site name} Blog",
      },
      description: { level: "content" as const, field: "summary" },
    },
  },
  structuredData: {
    items: [
      { type: "BlogPosting", name: "Introducing Nextly" },
      { type: "Organization", name: "Nextly" },
    ],
    leftOut: [],
    json: '{ "@graph": [] }',
  },
};

/** Every row's cells the same, but for the image's on X and LinkedIn. */
function rows(): Record<RowKey, Record<CrawlerKey, ReceivedCell>> {
  return Object.fromEntries(
    ROWS.map(row => [
      row,
      Object.fromEntries(
        KEYS.map(key => [
          key,
          row === "image" && (key === "x" || key === "linkedin")
            ? {
                kind: "different",
                difference: 1,
                received: `No picture shown: ${NAMES[key]} doesn't display SVG`,
              }
            : { kind: "same" },
        ])
      ),
    ])
  ) as Record<RowKey, Record<CrawlerKey, ReceivedCell>>;
}

const CHECKED: ReceivedAnswer = {
  kind: "checked",
  address: ADDRESS,
  fetchedAt: new Date().toISOString(),
  aiCrawlers: "all",
  ...HELD,
  crawlers: KEYS.map(key => ({
    key,
    name: NAMES[key],
    status: 200,
    ms: 300,
    redirected: false,
  })),
  rows: rows(),
  differences: [
    {
      number: 1,
      title: "X and LinkedIn show no picture for this page.",
      text: "Its share image is an SVG, which they don't display, so the card appears with text only.",
      action: { label: "Make a share image", href: EDIT },
    },
  ],
};

let asked: unknown[];

/** The check answers `answer` each time it is asked. */
function answering(answer: ReceivedAnswer): void {
  vi.mocked(writePluginRoute).mockImplementation((async (request: {
    body?: unknown;
  }) => {
    asked.push(request.body);
    return answer;
  }) as unknown as typeof writePluginRoute);
}

beforeEach(() => {
  asked = [];
  window.history.pushState(
    {},
    "",
    `/admin/plugins/nextlyhq-plugin-seo/pages/inspect?address=${encodeURIComponent(ADDRESS)}`
  );
  answering(CHECKED);
});

afterEach(() => {
  window.history.pushState({}, "", "/");
});

const strip = () =>
  within(screen.getByRole("region", { name: "Live fetch by crawler" }));

describe("Inspect", () => {
  it("fetches the page its address names, and shows each crawler's line", async () => {
    render(<SeoInspectPage />);
    await screen.findByRole("region", { name: "Live fetch by crawler" });
    expect(asked).toEqual([{ address: ADDRESS }]);
    expect(strip().getAllByText("Matches")).toHaveLength(3);
    expect(strip().getAllByText("1 difference")).toHaveLength(2);
    expect(strip().getByText("Matches · allowed")).toBeTruthy();
    const note = screen.getByRole("note");
    expect(note.textContent).toContain(
      "X and LinkedIn show no picture for this page."
    );
    expect(
      within(note)
        .getByRole("link", { name: "Make a share image" })
        .getAttribute("href")
    ).toBe(EDIT);
    expect(
      screen.getByRole("link", { name: "Edit SEO" }).getAttribute("href")
    ).toBe(EDIT);
  });

  it("shows each value Nextly holds, where it comes from, and what the chosen crawler received", async () => {
    render(<SeoInspectPage />);
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("Google received")).toBeTruthy();
    expect(table.getByText("Pattern: {Title} | {Site name} Blog")).toBeTruthy();
    expect(table.getByText("The page’s summary")).toBeTruthy();
    expect(table.getByText("cover.svg · 1200 × 630")).toBeTruthy();
    expect(table.getByText("Site language")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "LinkedIn" }));
    expect(table.getByText("LinkedIn received")).toBeTruthy();
    expect(
      table.getByText("No picture shown: LinkedIn doesn't display SVG")
    ).toBeTruthy();
  });

  it("lists the structured data, and shows its JSON-LD", async () => {
    render(<SeoInspectPage />);
    await screen.findByText("BlogPosting");
    expect(screen.getAllByText("Valid")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "View the JSON-LD" }));
    expect(
      within(screen.getByRole("dialog")).getByText('{ "@graph": [] }')
    ).toBeTruthy();
  });

  it("fetches again when asked", async () => {
    render(<SeoInspectPage />);
    await screen.findByRole("region", { name: "Live fetch by crawler" });
    fireEvent.click(
      screen.getByRole("button", { name: "Fetch the live page" })
    );
    await vi.waitFor(() => expect(asked).toHaveLength(2));
  });

  it("says an address outside the site isn't fetched, and shows what Nextly holds", async () => {
    answering({
      kind: "refused",
      address: "https://example.com/about",
      reason: "other-site",
      message: "That address is on another site.",
      site: "nextlyhq.com",
      ...HELD,
    });
    render(<SeoInspectPage />);
    const notice = await screen.findByText("This address isn't fetched");
    const alert = notice.closest("[role=status]");
    if (alert === null) throw new Error("no notice");
    expect(alert.textContent).toContain(
      "It points outside nextlyhq.com, so Inspect only shows what Nextly holds for it."
    );
    expect(
      screen.queryByRole("region", { name: "Live fetch by crawler" })
    ).toBeNull();
    expect(screen.getByText("Introducing Nextly | Nextly Blog")).toBeTruthy();
  });

  it("says the live page couldn't be fetched, with the limits, and tries again", async () => {
    answering({
      ...CHECKED,
      crawlers: KEYS.map(key => ({
        key,
        name: NAMES[key],
        ms: 10_000,
        redirected: false,
        failure: "The page didn't answer within 10 seconds.",
        reason: "too-slow" as const,
      })),
      differences: [],
    });
    render(<SeoInspectPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't fetch the live page");
    expect(alert.textContent).toContain(
      "It took longer than 10 seconds to answer. Nextly stops a fetch at 10 seconds, 5 MB or 5 redirects. What Nextly holds is still shown below."
    );
    expect(screen.getByText("Introducing Nextly | Nextly Blog")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await vi.waitFor(() => expect(asked).toHaveLength(2));
  });

  it("shows what each crawler received where Nextly holds no page there, such as a page built in code", async () => {
    const received = Object.fromEntries(
      ROWS.map(row => [
        row,
        Object.fromEntries(
          KEYS.map(key => [
            key,
            row === "title"
              ? { kind: "received", received: "Pricing in code" }
              : { kind: "received" },
          ])
        ),
      ])
    ) as Record<RowKey, Record<CrawlerKey, ReceivedCell>>;
    answering({
      ...CHECKED,
      name: undefined,
      editHref: undefined,
      stored: undefined,
      structuredData: undefined,
      rows: received,
      differences: [],
    });
    render(<SeoInspectPage />);
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("Google received")).toBeTruthy();
    expect(table.getByText("Pricing in code")).toBeTruthy();
    expect(
      screen.getByText(/Nextly holds no published page at this address/)
    ).toBeTruthy();
  });

  it("sends an address naming no page on to Pages", () => {
    window.history.pushState(
      {},
      "",
      "/admin/plugins/nextlyhq-plugin-seo/pages/inspect"
    );
    render(<SeoInspectPage />);
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/plugins/nextlyhq-plugin-seo/pages",
      { replace: true }
    );
  });
});
