// @vitest-environment jsdom
/**
 * "What search engines received" as a person uses it: it checks the page its
 * address names, or the site's first page, shows each crawler's values
 * beside what Nextly holds, numbers each difference in the table and explains
 * it below, says plainly why an address was refused, and asks for the
 * production address where the site has none.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginRoute: vi.fn(),
  writePluginRoute: vi.fn(),
  navigateTo: vi.fn(),
}));

import {
  navigateTo,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";

import type {
  CrawlerKey,
  ReceivedAnswer,
  ReceivedCell,
  ReceivedPagesBody,
  RowKey,
} from "../../received/contract";
import { SeoReceivedPage } from "../SeoReceivedPage";

const PAGE = "https://rext.ai/blog/surfer-seo-vs-rext-ai";

/** Every crawler's cell for one row. */
function all(cell: ReceivedCell): Record<CrawlerKey, ReceivedCell> {
  return { googlebot: cell, linkedin: cell, x: cell, slack: cell };
}

const SAME_ROWS: Record<RowKey, Record<CrawlerKey, ReceivedCell>> = {
  title: {
    googlebot: { kind: "same" },
    linkedin: { kind: "same", note: "without “| Rext AI”" },
    x: { kind: "same", note: "X doesn't display it" },
    slack: { kind: "same" },
  },
  description: all({ kind: "same" }),
  image: all({ kind: "same" }),
  canonical: all({ kind: "same" }),
  robots: {
    googlebot: { kind: "same" },
    linkedin: { kind: "not-used" },
    x: { kind: "not-used" },
    slack: { kind: "not-used" },
  },
};

const CHECKED: Extract<ReceivedAnswer, { kind: "checked" }> = {
  kind: "checked",
  address: PAGE,
  fetchedAt: new Date().toISOString(),
  stored: {
    title: "Surfer SEO vs Rext AI | Rext AI",
    description: "Surfer scores a draft.",
    image: {
      url: "https://rext.ai/media/share-surfer.jpg",
      width: 1200,
      height: 630,
    },
    canonical: PAGE,
    listed: true,
  },
  crawlers: [
    {
      key: "googlebot",
      name: "Googlebot",
      status: 200,
      ms: 400,
      redirected: false,
    },
    {
      key: "linkedin",
      name: "LinkedIn",
      status: 200,
      ms: 500,
      redirected: false,
    },
    { key: "x", name: "X", status: 200, ms: 400, redirected: false },
    { key: "slack", name: "Slack", status: 200, ms: 300, redirected: false },
  ],
  rows: SAME_ROWS,
  differences: [],
};

let pages: ReceivedPagesBody;

beforeEach(() => {
  pages = {
    origins: ["https://rext.ai"],
    pages: [PAGE, "https://rext.ai/pricing"],
  };
  vi.mocked(usePluginRoute).mockImplementation(
    () =>
      ({
        data: pages,
        pending: false,
        error: null,
        refetch: () => {},
        fetching: false,
      }) as unknown as ReturnType<typeof usePluginRoute>
  );
  vi.mocked(writePluginRoute).mockResolvedValue(CHECKED);
  window.history.replaceState(
    null,
    "",
    "/admin/plugins/nextlyhq-plugin-seo/received"
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The address each check asked for. */
const asked = () =>
  vi
    .mocked(writePluginRoute)
    .mock.calls.map(
      ([request]) => (request.body as { address: string }).address
    );

describe("what search engines received", () => {
  it("checks the page its address names and shows each crawler beside Nextly", async () => {
    const pricing = "https://rext.ai/pricing";
    window.history.replaceState(
      null,
      "",
      `?address=${encodeURIComponent(pricing)}`
    );
    render(<SeoReceivedPage />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "What search engines received",
      })
    ).toBeVisible();
    expect(
      screen.getByText(
        "Fetches one of your pages as each crawler would, and compares it with what Nextly holds. Only rext.ai addresses can be checked."
      )
    ).toBeVisible();
    expect(
      await screen.findByText("Every crawler received what Nextly holds.")
    ).toBeVisible();
    expect(asked()).toEqual([pricing]);
    expect(screen.getByLabelText("Page")).toHaveValue(pricing);
    expect(screen.getByText("Fetched just now")).toBeVisible();

    const table = screen.getByRole("table");
    const heads = within(table)
      .getAllByRole("columnheader")
      .map(head => head.textContent);
    expect(heads).toEqual([
      "Value",
      "Stored in Nextlywhat the page should say",
      "Googlebot200 · 0.4 s",
      "LinkedIn200 · 0.5 s",
      "X200 · 0.4 s",
      "Slack200 · 0.3 s",
    ]);
    const titleRow = within(table).getByRole("row", { name: /^Title/ });
    expect(titleRow).toHaveTextContent(
      "TitleSurfer SEO vs Rext AI | Rext AI Same Samewithout “| Rext AI” SameX doesn't display it Same"
    );
    const imageRow = within(table).getByRole("row", { name: /^Share image/ });
    expect(imageRow).toHaveTextContent("share-surfer.jpg1200 × 630");
    const listingRow = within(table).getByRole("row", {
      name: /^Search listing/,
    });
    expect(listingRow).toHaveTextContent(
      "Search listingListed in search SameNot usedNot usedNot used"
    );
    expect(screen.queryByText("Differences, explained")).toBeNull();
  });

  it("numbers each difference in the table and explains it below", async () => {
    vi.mocked(writePluginRoute).mockResolvedValue({
      ...CHECKED,
      rows: {
        ...SAME_ROWS,
        image: {
          ...SAME_ROWS.image,
          linkedin: {
            kind: "different",
            difference: 1,
            received: "opengraph-image.png",
          },
        },
      },
      differences: [
        {
          number: 1,
          title: "LinkedIn received a different share image.",
          text: "Nextly holds share-surfer.jpg; the page served opengraph-image.png.",
          action: {
            label: "Open LinkedIn Post Inspector",
            href: "https://www.linkedin.com/post-inspector/inspect/x",
          },
        },
      ],
    });
    render(<SeoReceivedPage />);
    expect(
      await screen.findByText(
        "1 difference between what crawlers received and what Nextly holds."
      )
    ).toBeVisible();
    const imageRow = screen.getByRole("row", { name: /^Share image/ });
    expect(imageRow).toHaveTextContent(
      "1LinkedIn received opengraph-image.png"
    );
    expect(within(imageRow).getByLabelText("Difference 1")).toBeVisible();
    const explained = screen.getByRole("listitem");
    expect(explained).toHaveTextContent(
      "1LinkedIn received a different share image.Nextly holds share-surfer.jpg; the page served opengraph-image.png."
    );
    const inspector = within(explained).getByRole("link", {
      name: "Open LinkedIn Post Inspector",
    });
    expect(inspector).toHaveAttribute(
      "href",
      "https://www.linkedin.com/post-inspector/inspect/x"
    );
    expect(inspector).toHaveAttribute("target", "_blank");
    // With no page named, the site's first page is checked.
    expect(asked()).toEqual([PAGE]);
  });

  it("says plainly why an address was refused, and checks any address typed in", async () => {
    render(<SeoReceivedPage />);
    await screen.findByText("Every crawler received what Nextly holds.");
    vi.mocked(writePluginRoute).mockResolvedValue({
      kind: "refused",
      address: "https://evil.example/",
      message:
        "That address is on another site, evil.example. Only rext.ai addresses can be checked.",
    });
    const field = screen.getByLabelText("Page");
    await userEvent.clear(field);
    await userEvent.type(field, "https://evil.example/");
    await userEvent.click(screen.getByRole("button", { name: "Fetch again" }));
    expect(
      await screen.findByText("This address can't be checked.")
    ).toBeVisible();
    expect(
      screen.getByText(
        "That address is on another site, evil.example. Only rext.ai addresses can be checked."
      )
    ).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    expect(asked()).toEqual([PAGE, "https://evil.example/"]);
    expect(new URLSearchParams(window.location.search).get("address")).toBe(
      "https://evil.example/"
    );
  });

  it("checks one of the site's pages as soon as it is chosen", async () => {
    render(<SeoReceivedPage />);
    await screen.findByText("Every crawler received what Nextly holds.");
    const field = screen.getByLabelText("Page");
    await userEvent.clear(field);
    await userEvent.paste("https://rext.ai/pricing");
    expect(asked()).toEqual([PAGE, "https://rext.ai/pricing"]);
  });

  it("shows what was received, comparing nothing, where Nextly holds no page there", async () => {
    const { stored: _none, ...unstored } = CHECKED;
    vi.mocked(writePluginRoute).mockResolvedValue({
      ...unstored,
      rows: {
        ...SAME_ROWS,
        title: all({ kind: "received", received: "Pricing" }),
      },
    });
    render(<SeoReceivedPage />);
    expect(
      await screen.findByText("No published page in Nextly has this address.")
    ).toBeVisible();
    expect(screen.getByRole("row", { name: /^Title/ })).toHaveTextContent(
      "TitleNot in NextlyPricingPricingPricingPricing"
    );
  });

  it("asks for the production address where the site has none, and checks nothing", async () => {
    pages = { origins: [], pages: [] };
    render(<SeoReceivedPage />);
    expect(
      screen.getByText("The site has no production address yet.")
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("link", { name: "Set it in the SEO settings" })
    );
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/plugins/nextlyhq-plugin-seo/settings"
    );
    expect(writePluginRoute).not.toHaveBeenCalled();
  });

  it("says the page could not be checked where the request fails", async () => {
    vi.mocked(writePluginRoute).mockRejectedValue(
      new Error("Too many requests.")
    );
    render(<SeoReceivedPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The page could not be checked."
    );
  });
});
