/**
 * Whether the admin would draw a contribution at a place for a document,
 * asked from elsewhere: the same answer the place's own page reaches, for
 * every way a plugin's tab is delivered. Each configuration below is the
 * SEO tab as the server delivers it for one of the SEO plugin's setups, and
 * the answer is checked against the edit page's own row of tabs for the
 * same document, so the two can be seen to agree rather than assumed to.
 */
import { renderHook } from "@testing-library/react";
import type { AdminContributionsMeta } from "nextly/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useContributionApplies, usePlaceTabs } from "..";

const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
  /** The document form around the caller, as the entry form provides it. */
  form: null as null | {
    kind: "collection" | "single";
    collectionSlug: string;
    fields?: { name?: string }[];
  },
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ contributions: meta.contributions }),
}));
vi.mock(
  "@admin/components/features/entries/EntryForm/EntryFormContext",
  () => ({ useOptionalEntryFormContext: () => meta.form })
);

afterEach(() => {
  meta.contributions = undefined;
  meta.form = null;
});

const SEO_TAB = "nextlyhq-plugin-seo.tab";

/** The SEO tab as the server delivers it, offered on `collections`. */
function seoTabOn(collections: string[]): AdminContributionsMeta {
  return {
    "collection.edit": {
      tab: [
        {
          plugin: "@nextlyhq/plugin-seo",
          id: SEO_TAB,
          kind: "tab",
          label: "SEO",
          component: "@nextlyhq/plugin-seo/admin#SeoTab",
          collections,
          fields: ["seo"],
        },
      ],
    },
  } as AdminContributionsMeta;
}

/** A page's top-level fields, with or without the plugin's group. */
const WITH_SEO = ["title", "slug", "layout", "seo"];
const WITHOUT_SEO = ["title", "slug", "layout"];

/** Both answers for one page: the read, and the edit page's own row. */
function bothAnswers(collection: string, fieldNames: string[]) {
  meta.form = {
    kind: "collection",
    collectionSlug: collection,
    fields: fieldNames.map(name => ({ name })),
  };
  const { result } = renderHook(() => ({
    applies: useContributionApplies("collection.edit", SEO_TAB, {
      kind: "collection",
      slug: collection,
    }),
    // What the edit page draws, as its row of tabs reads the place.
    drawn: usePlaceTabs({
      place: "collection.edit",
      context: { collection, entryId: "e1" } as never,
      fieldNames,
    }).some(tab => tab.id === SEO_TAB),
  }));
  return result.current;
}

describe("whether a contribution would be drawn here, asked from elsewhere", () => {
  it.each([
    // The site names its types: offered on those, with the group there.
    ["named types, a named one", ["pages", "posts"], "pages", WITH_SEO, true],
    ["named types, one left out", ["posts"], "pages", WITHOUT_SEO, false],
    // SEO on every type: the server narrows it to where the plugin's group
    // was added, so a type left out in the site's code is not among them.
    ["every type", ["pages", "posts", "authors"], "pages", WITH_SEO, true],
    [
      "every type, one left out in code",
      ["posts"],
      "pages",
      WITHOUT_SEO,
      false,
    ],
    // A collection the host renamed is offered by the slug it is served as.
    ["a renamed collection", ["site-pages"], "site-pages", WITH_SEO, true],
    [
      "a renamed collection, by its old name",
      ["site-pages"],
      "pages",
      WITH_SEO,
      false,
    ],
    // SEO turned off for the type in the settings: the type's group is kept
    // off its form, so the tab, which edits it, is not drawn.
    ["SEO turned off for the type", ["pages"], "pages", WITHOUT_SEO, false],
  ])(
    "agrees with the edit page: %s",
    (_name, offered, collection, fieldNames, expected) => {
      meta.contributions = seoTabOn(offered);
      const { applies, drawn } = bothAnswers(collection, fieldNames);
      expect(drawn).toBe(expected);
      expect(applies).toBe(drawn);
    }
  );

  it("answers no where the plugin is not installed, or the reader is not sent the tab", () => {
    meta.contributions = {};
    expect(bothAnswers("pages", WITH_SEO)).toEqual({
      applies: false,
      drawn: false,
    });
    meta.contributions = undefined;
    expect(bothAnswers("pages", WITH_SEO).applies).toBe(false);
  });

  it("judges a tab by the fields of the form around it only where that form edits the same document", () => {
    meta.contributions = seoTabOn(["pages"]);
    // A form for another collection says nothing of this page's fields.
    meta.form = {
      kind: "collection",
      collectionSlug: "posts",
      fields: WITH_SEO.map(name => ({ name })),
    };
    const asked = { kind: "collection", slug: "pages" } as const;
    const { result, rerender } = renderHook(
      (props: { fieldNames?: string[] }) =>
        useContributionApplies("collection.edit", SEO_TAB, {
          ...asked,
          ...(props.fieldNames === undefined
            ? {}
            : { fieldNames: props.fieldNames }),
        }),
      { initialProps: {} }
    );
    expect(result.current).toBe(false);
    // Named by the caller, the page's own fields decide.
    rerender({ fieldNames: WITH_SEO });
    expect(result.current).toBe(true);
  });

  it("asks about any kind of contribution by its id, drawn wherever its own rule draws it", () => {
    meta.contributions = {
      "collection.edit": {
        sidebarSection: [
          {
            plugin: "@nextlyhq/plugin-seo",
            id: "nextlyhq-plugin-seo.status",
            kind: "sidebarSection",
            label: "Search",
            component: "@nextlyhq/plugin-seo/admin#SeoStatusSection",
            collections: ["pages"],
          },
        ],
      },
    } as AdminContributionsMeta;
    const ask = (slug: string) =>
      renderHook(() =>
        useContributionApplies(
          "collection.edit",
          "nextlyhq-plugin-seo.status",
          {
            kind: "collection",
            slug,
          }
        )
      ).result.current;
    expect(ask("pages")).toBe(true);
    expect(ask("posts")).toBe(false);
  });
});
