// @vitest-environment jsdom
/**
 * Which panel the SEO tab in the Page Builder's Settings draws: a page's own
 * SEO tab where the plugin adds SEO to its type, handed the page's form and
 * which page it is; a word where it does not; and for a design, its rule, or
 * a word while it draws no content type yet.
 */
import "./dom-setup";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const handed = vi.hoisted(() => ({
  tab: undefined as unknown,
  rule: undefined as unknown,
  /** The SEO plugin's client config, as the site's options make it. */
  config: { tabCollections: ["posts"] } as Record<string, unknown>,
}));

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginClientConfig: () => handed.config,
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
  handed.config = { tabCollections: ["posts"] };
  handed.tab = undefined;
});

const control = { name: "the page's form" } as never;
const base = { userId: "u1", entryId: "e1", draws: null };

describe("the SEO tab in the Page Builder's Settings", () => {
  it("draws a page's own SEO tab, with its form and which page it is", () => {
    render(
      <PageBuilderSeoTab
        context={{ ...base, document: "page", collection: "posts" }}
        setBadge={() => {}}
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
        setBadge={() => {}}
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

  it("says so for a page whose type has no SEO tab", () => {
    render(
      <PageBuilderSeoTab
        context={{ ...base, document: "page", collection: "pages" }}
        setBadge={() => {}}
        control={control}
        writable
      />
    );
    expect(screen.queryByText("The SEO tab")).toBeNull();
    expect(
      screen.getByText(/SEO isn.t added to this content type/)
    ).toBeTruthy();
  });

  it("says SEO is off for the pages where SEO is on every type but the site's code leaves them out", () => {
    handed.config = {
      tabCollections: [],
      tabEveryType: true,
      tabExcluded: ["pages"],
    };
    render(
      <PageBuilderSeoTab
        context={{ ...base, document: "page", collection: "pages" }}
        setBadge={() => {}}
        control={control}
        writable
      />
    );
    // Not the page's tab, whose read of a type without SEO only fails.
    expect(screen.queryByText("The SEO tab")).toBeNull();
    expect(handed.tab).toBeUndefined();
    expect(
      screen.getByText("SEO is off for Page Builder pages in this site's code.")
    ).toBeTruthy();
  });

  it("draws the page's tab where SEO is on every type and the site leaves out another", () => {
    handed.config = {
      tabCollections: [],
      tabEveryType: true,
      tabExcluded: ["audit-log"],
    };
    render(
      <PageBuilderSeoTab
        context={{ ...base, document: "page", collection: "pages" }}
        setBadge={() => {}}
        control={control}
        writable
      />
    );
    expect(screen.getByText("The SEO tab")).toBeTruthy();
  });

  it("draws a design's rule for the type it draws, and a word until it draws one", () => {
    const seo = { value: undefined, set: () => {} };
    const holdEdit = () => () => {};
    const { rerender } = render(
      <PageBuilderSeoTab
        context={{ ...base, document: "template", collection: "templates" }}
        setBadge={() => {}}
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
        setBadge={() => {}}
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
