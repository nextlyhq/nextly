/**
 * The setup checklist's items, each worked out from what the plugin stores:
 * a fixture for each item open and done, and the import item listed only
 * where the site holds old values to bring in.
 */
import { describe, expect, it } from "vitest";

import type { ImportGroup } from "../../import/contract";
import {
  checklistItems,
  holdsOldValues,
  searchConsoleConnected,
  type ChecklistFacts,
} from "../checklist";

/** A site with nothing set up. */
const BARE: ChecklistFacts = {
  rules: { patterns: {} },
  productionAddresses: [],
  brand: {},
  types: ["posts", "pages"],
  searchConsole: false,
  imports: "none",
};

/** The site with everything set up. */
const DONE: ChecklistFacts = {
  rules: {
    siteName: "Acme",
    productionAddresses: ["https://acme.example"],
    image: { url: "https://acme.example/share.png" },
    patterns: {
      posts: { title: "{Title} | {Site name}" },
      pages: { title: "{Title}" },
    },
  },
  productionAddresses: ["https://acme.example"],
  brand: { name: "Acme", logo: { url: "https://acme.example/logo.png" } },
  types: ["posts", "pages"],
  searchConsole: true,
  imports: "imported",
};

/** Whether each item is done, by id. */
const doneOf = (facts: ChecklistFacts) =>
  Object.fromEntries(checklistItems(facts).map(item => [item.id, item.done]));

describe("checklistItems", () => {
  it("lists every item open on a bare site, without the import where there is nothing to import", () => {
    expect(checklistItems(BARE)).toEqual([
      { id: "site", done: false },
      { id: "patterns", done: false, types: 2 },
      { id: "shareImage", done: false },
      { id: "brand", done: false },
      { id: "searchConsole", done: false },
    ]);
  });

  it("marks every item done on a site set up", () => {
    expect(doneOf(DONE)).toEqual({
      site: true,
      patterns: true,
      shareImage: true,
      brand: true,
      import: true,
      searchConsole: true,
    });
  });

  it("needs both the site's name and a production address", () => {
    expect(
      doneOf({ ...DONE, rules: { ...DONE.rules, siteName: " " } }).site
    ).toBe(false);
    expect(doneOf({ ...DONE, productionAddresses: [] }).site).toBe(false);
  });

  it("needs a title pattern of its own for every content type", () => {
    expect(
      doneOf({
        ...DONE,
        rules: { ...DONE.rules, patterns: { posts: { title: "{Title}" } } },
      }).patterns
    ).toBe(false);
    // A description pattern alone is not a title pattern.
    expect(
      doneOf({
        ...DONE,
        rules: {
          ...DONE.rules,
          patterns: { ...DONE.rules.patterns, pages: { description: "x" } },
        },
      }).patterns
    ).toBe(false);
  });

  it("needs a default share image", () => {
    const { image: _image, ...rules } = DONE.rules;
    expect(doneOf({ ...DONE, rules }).shareImage).toBe(false);
  });

  it("needs the organization's name and its logo", () => {
    expect(doneOf({ ...DONE, brand: { name: "Acme" } }).brand).toBe(false);
    expect(doneOf({ ...DONE, brand: { logo: { url: "/l.png" } } }).brand).toBe(
      false
    );
  });

  it("lists the import open while old values wait, and done once imported", () => {
    expect(doneOf({ ...BARE, imports: "waiting" }).import).toBe(false);
    expect(doneOf({ ...BARE, imports: "imported" }).import).toBe(true);
    expect(
      checklistItems({ ...BARE, imports: "waiting" }).map(i => i.id)
    ).toEqual([
      "site",
      "patterns",
      "shareImage",
      "brand",
      "import",
      "searchConsole",
    ]);
  });

  it("needs Search Console connected", () => {
    expect(doneOf({ ...DONE, searchConsole: false }).searchConsole).toBe(false);
  });
});

describe("holdsOldValues", () => {
  const group = (own: boolean, fields: ImportGroup["fields"]): ImportGroup => ({
    field: own ? "seo" : "metaData",
    label: "Meta data",
    types: [{ slug: "posts", label: "Posts" }],
    pages: 3,
    fields,
    own,
  });

  it("finds old values in a group other than the plugin's own", () => {
    expect(
      holdsOldValues([
        group(false, [
          { name: "title", label: "Title", filled: 2, suggested: "title" },
        ]),
      ])
    ).toBe(true);
  });

  it("finds none in the plugin's own group, an empty one, or fields the import leaves out", () => {
    expect(
      holdsOldValues([
        group(true, [
          { name: "metaTitle", label: "Title", filled: 3, suggested: "title" },
        ]),
        group(false, [
          { name: "title", label: "Title", filled: 0, suggested: "title" },
          { name: "keywords", label: "Keywords", filled: 3, suggested: "skip" },
        ]),
      ])
    ).toBe(false);
  });
});

describe("searchConsoleConnected", () => {
  const token = { refreshToken: "r" };
  it("needs the site's property, and no failure since", () => {
    expect(
      searchConsoleConnected({
        searchConsole: { ...token, property: "sc-domain:acme.example" },
      })
    ).toBe(true);
    // Signed in, but no property matched the site.
    expect(searchConsoleConnected({ searchConsole: token })).toBe(false);
    expect(
      searchConsoleConnected({
        searchConsole: { ...token, property: "sc-domain:acme.example" },
        searchConsoleFailed: {
          at: "2026-11-12T00:00:00Z",
          result: "failed",
          message: "x",
        },
      })
    ).toBe(false);
    expect(searchConsoleConnected({})).toBe(false);
  });
});
