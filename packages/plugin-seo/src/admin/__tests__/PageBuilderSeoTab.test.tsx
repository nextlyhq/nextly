// @vitest-environment jsdom
/**
 * Which panel the SEO tab in the Page Builder's Settings draws: a page's own
 * SEO tab exactly where the page's edit page draws its SEO tab, asked of the
 * admin by that page's own rule, handed the page's form and which page it
 * is; out of the row where it does not; and for a design, its rule, or a
 * word while it draws no content type yet.
 */
import "./dom-setup";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const handed = vi.hoisted(() => ({
  tab: undefined as unknown,
  rule: undefined as unknown,
  /** Whether the admin draws the SEO tab on the page's edit page. */
  applies: true,
  /** What the tab asked the admin, each time. */
  asked: [] as unknown[][],
}));

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useContributionApplies: (...args: unknown[]) => {
    handed.asked.push(args);
    return handed.applies;
  },
}));
vi.mock("../SeoTab", () => ({
  SeoTab: (props: unknown) => {
    handed.tab = props;
    return <p>The SEO tab</p>;
  },
}));
vi.mock("../TemplateSeoPanel", () => ({
  TemplateSeoPanel: (props: unknown) => {
    handed.rule = props;
    return <p>The rule</p>;
  },
}));

const { PageBuilderSeoTab } = await import("../PageBuilderSeoTab");

afterEach(() => {
  cleanup();
  handed.applies = true;
  handed.asked = [];
  handed.tab = undefined;
});

const control = { name: "the page's form" } as never;
const base = { userId: "u1", entryId: "e1", draws: null };
const row = { setBadge: () => {}, setLeftOut: vi.fn() };

describe("the SEO tab in the Page Builder's Settings", () => {
  it("draws a page's own SEO tab, with its form and which page it is", () => {
    render(
      <PageBuilderSeoTab
        context={{ ...base, document: "page", collection: "posts" }}
        {...row}
        control={control}
        writable
      />
    );
    expect(screen.getByText("The SEO tab")).toBeTruthy();
    expect(handed.tab).toMatchObject({
      context: { userId: "u1", collection: "posts", entryId: "e1" },
      control,
      entry: { id: "e1" },
      documentLock: { readOnly: false },
    });
  });

  it("hands a page's tab the design being edited, and shows General for a field the page lacks", () => {
    const design = { formatVersion: 1, kind: "page", nodes: [] };
    const openGeneral = () => {};
    render(
      <PageBuilderSeoTab
        context={{ ...base, document: "page", collection: "posts" }}
        {...row}
        control={control}
        writable
        design={design}
        designField="content"
        openGeneral={openGeneral}
      />
    );
    expect(handed.tab).toMatchObject({
      unsaved: { path: "content", value: design },
      onGoToContent: openGeneral,
    });
  });

  it("is in the row exactly where the page's edit page draws its SEO tab, by the admin's own answer", () => {
    const setLeftOut = vi.fn();
    const { rerender } = render(
      <PageBuilderSeoTab
        context={{ ...base, document: "page", collection: "pages" }}
        setBadge={() => {}}
        setLeftOut={setLeftOut}
        control={control}
        writable
      />
    );
    // The edit page's own question: its SEO tab, at its place, for the
    // page's collection.
    expect(handed.asked.at(-1)).toEqual([
      "collection.edit",
      "nextlyhq-plugin-seo.tab",
      { kind: "collection", slug: "pages" },
    ]);
    expect(setLeftOut).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("The SEO tab")).toBeTruthy();

    // The edit page draws no SEO tab for the type (left out of the site's
    // SEO types, left out in its code, or turned off in the SEO settings):
    // out of the row, and nothing that reads as SEO for the page.
    handed.applies = false;
    rerender(
      <PageBuilderSeoTab
        context={{ ...base, document: "page", collection: "pages" }}
        setBadge={() => {}}
        setLeftOut={setLeftOut}
        control={control}
        writable
      />
    );
    expect(setLeftOut).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText("The SEO tab")).toBeNull();
    expect(document.body.textContent).toBe("");
  });

  it("keeps a design's tab in the row, whatever the edit page draws", () => {
    handed.applies = false;
    const setLeftOut = vi.fn();
    render(
      <PageBuilderSeoTab
        context={{
          ...base,
          document: "template",
          collection: "templates",
          draws: { collection: "posts", entryId: null },
        }}
        setBadge={() => {}}
        setLeftOut={setLeftOut}
        seo={{ value: undefined, set: () => {} }}
        design={{}}
        writable
      />
    );
    expect(setLeftOut).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("The rule")).toBeTruthy();
  });

  it("draws a design's rule for the type it draws, and a word until it draws one", () => {
    const seo = { value: undefined, set: () => {} };
    const holdEdit = () => () => {};
    const { rerender } = render(
      <PageBuilderSeoTab
        context={{ ...base, document: "template", collection: "templates" }}
        {...row}
        seo={seo}
        design={{}}
        writable
      />
    );
    expect(
      screen.getByText(/Choose the content type this template draws/)
    ).toBeTruthy();

    rerender(
      <PageBuilderSeoTab
        context={{
          ...base,
          document: "template",
          collection: "templates",
          draws: { collection: "posts", entryId: null },
        }}
        {...row}
        seo={seo}
        design={{}}
        writable
        holdEdit={holdEdit}
      />
    );
    expect(screen.getByText("The rule")).toBeTruthy();
    expect(handed.rule).toMatchObject({
      draws: { collection: "posts" },
      seo,
      holdEdit,
    });
  });
});
