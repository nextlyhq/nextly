// @vitest-environment jsdom
/**
 * What the Page Builder shows of a page's search result, as the SEO plugin
 * draws it: nothing on General where the plugin edits SEO for the page's
 * type (its SEO tab is the page's one panel), the tab's own answer in the
 * right panel, and, where it does not edit the type, that SEO is turned off
 * for it, with the way to the settings only for someone who may change them.
 */
import "./dom-setup";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useForm, type FieldValues } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Levels } from "../../resolver/order";
import type { SeoTabContext } from "../../tab/contract";

const handed = vi.hoisted(() => ({
  /** Whether the admin draws the SEO tab on the page's edit page. */
  applies: true,
  /** What the block asked the admin, each time. */
  asked: [] as unknown[][],
  /** The settings document route's answer; undefined where it refused. */
  settings: undefined as { canChange: boolean } | undefined,
  /** Each document the page's SEO answer was read for. */
  resolved: [] as Record<string, unknown>[],
  answer: undefined as unknown,
}));

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useContributionApplies: (...args: unknown[]) => {
    handed.asked.push(args);
    return handed.applies;
  },
  usePluginRoute: () => ({
    data: handed.settings,
    pending: false,
    error: handed.settings === undefined ? new Error("Forbidden") : null,
    fetching: false,
    refetch: () => {},
  }),
  writePluginRoute: (request: { body: Record<string, unknown> }) => {
    handed.resolved.push(request.body);
    return Promise.resolve(handed.answer);
  },
  useDocumentLocale: () => null,
  humanizeFieldName: (name: string) =>
    name.charAt(0).toUpperCase() + name.slice(1),
  navigateTo: () => {},
}));

const { PageBuilderSearchResult } = await import("../PageBuilderSearchResult");

afterEach(() => {
  cleanup();
  handed.applies = true;
  handed.asked = [];
  handed.settings = undefined;
  handed.resolved = [];
});

/** A page's levels: its title made by the type's title pattern. */
const LEVELS: Levels = {
  page: {},
  code: {},
  template: {},
  pattern: {
    title: { value: "Pricing | Ridgeline", pattern: "{Title} | {Site name}" },
  },
  content: {
    title: { value: "Pricing", field: "title" },
    description: { value: "Fixed quotes for every survey.", field: "excerpt" },
  },
  site: { title: "Ridgeline", productionAddresses: ["https://ridgeline.com"] },
  address: "/pricing",
};

const ANSWER: SeoTabContext = {
  levels: LEVELS,
  site: { name: "Ridgeline", origin: "https://ridgeline.com" },
  typeLabel: "Page",
  fieldLabels: { title: "Title" },
  fields: ["metaTitle", "metaDescription", "socialTitle"],
  mayChange: true,
};

const PAGE = {
  userId: "u1",
  document: "page" as const,
  collection: "pages",
  entryId: "p1",
  draws: null,
};

/** The block as the Page Builder draws it, over the page's own form. */
function Block({
  at,
  values = { title: "Pricing" },
  document = "page",
}: {
  at: "general" | "panel";
  values?: FieldValues;
  document?: "page" | "template";
}) {
  const form = useForm<FieldValues>({ defaultValues: values });
  return (
    <PageBuilderSearchResult
      context={{ ...PAGE, document }}
      at={at}
      typePlural="Pages"
      control={form.control}
      design={{ formatVersion: 1, kind: "page", nodes: [] }}
      designField="layout"
    />
  );
}

describe("the page's search result in the Page Builder", () => {
  it("draws nothing on General where the plugin edits SEO for the page's type, as asked of the edit page's own rule", () => {
    const { container } = render(<Block at="general" />);
    expect(handed.asked.at(-1)).toEqual([
      "collection.edit",
      "nextlyhq-plugin-seo.tab",
      { kind: "collection", slug: "pages" },
    ]);
    // No second preview beside the SEO tab, and no word that SEO is missing.
    expect(container.textContent).toBe("");
  });

  it("shows the SEO tab's own answer in the right panel: the title pattern, never a typed social title", async () => {
    handed.answer = ANSWER;
    render(
      <Block
        at="panel"
        values={{ title: "Pricing", seo: { socialTitle: "Shared: Pricing" } }}
      />
    );
    const title = await screen.findByTestId("seo-search-title");
    // The order the page's head is answered by: the type's pattern, which a
    // title for sharing never stands in for.
    expect(title.textContent).toBe("Pricing | Ridgeline");
    expect(screen.queryByText("Shared: Pricing")).toBeNull();
    // Read for the page as typed, with the design on screen at its path.
    expect(handed.resolved.at(-1)).toMatchObject({
      kind: "collection",
      slug: "pages",
      id: "p1",
      document: {
        title: "Pricing",
        seo: { socialTitle: "Shared: Pricing" },
        layout: { kind: "page" },
      },
    });
  });

  it("follows a typed SEO title in the right panel, as the tab's preview does", async () => {
    handed.answer = ANSWER;
    render(
      <Block
        at="panel"
        values={{ title: "Pricing", seo: { metaTitle: "Plans and prices" } }}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId("seo-search-title").textContent).toBe(
        "Plans and prices"
      )
    );
  });

  it("says SEO is turned off for the type where the plugin does not edit it, with the settings for someone who may change them", () => {
    handed.applies = false;
    handed.settings = { canChange: true };
    render(<Block at="general" />);
    expect(screen.getByText("SEO is turned off for Pages.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "SEO settings" });
    expect(link.getAttribute("href")).toBe(
      "/admin/plugins/nextlyhq-plugin-seo/settings?tab=types"
    );
    // And no preview at all.
    expect(screen.queryByTestId("seo-search-result")).toBeNull();
    cleanup();

    // Someone who may read but not change the settings: no way there.
    handed.settings = { canChange: false };
    render(<Block at="panel" />);
    expect(screen.getByText("SEO is turned off for Pages.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "SEO settings" })).toBeNull();
    cleanup();

    // Someone the settings route refuses: no way there either.
    handed.settings = undefined;
    render(<Block at="general" />);
    expect(screen.getByText("SEO is turned off for Pages.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "SEO settings" })).toBeNull();
  });

  it("leaves a design's search and sharing to its SEO tab", () => {
    handed.applies = false;
    const { container } = render(<Block at="general" document="template" />);
    expect(container.textContent).toBe("");
  });
});
