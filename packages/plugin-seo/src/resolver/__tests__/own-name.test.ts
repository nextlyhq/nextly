/**
 * A page's own name, the one every output names it by: read from the field
 * the site chooses for its type, else the one its admin names entries by,
 * else `title`, `name` or `heading`; a Single's `title` that Nextly keeps
 * (its label, "Blog Page") only after the route's own title; and never with
 * markup or the site's name after it.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { defineCollection, defineSingle, text } from "nextly";
import { describe, expect, it } from "vitest";

import { pageNameOf, titleSourcesOf } from "../own-name";

/** A site declaring a Single with Nextly's title, one with its own, and a collection. */
const ctx = {
  config: {
    singles: [
      // Declares no `title`: Nextly keeps one, filled from the label.
      defineSingle({
        slug: "blog",
        label: { singular: "Blog Page" },
        fields: [text({ name: "heading" })],
      }),
      // Declares its own `title`.
      defineSingle({ slug: "about", fields: [text({ name: "title" })] }),
    ],
    collections: [
      defineCollection({
        slug: "posts",
        admin: { useAsTitle: "headline" },
        fields: [text({ name: "headline" }), text({ name: "title" })],
      }),
    ],
  },
} as unknown as PluginContext;

describe("where a type's pages take their name from", () => {
  it("leaves out a Single's title that Nextly keeps, and says so", () => {
    expect(titleSourcesOf(ctx, "single:blog")).toEqual({
      fields: ["name", "heading"],
      labelTitle: true,
    });
  });

  it("reads a Single's own title first, where its author declared it", () => {
    expect(titleSourcesOf(ctx, "single:about")).toEqual({
      fields: ["title", "name", "heading"],
      labelTitle: false,
    });
  });

  it("treats a Single made in the Schema Builder as keeping Nextly's title", () => {
    expect(titleSourcesOf(ctx, "single:made-in-admin").labelTitle).toBe(true);
  });

  it("reads the field the admin names entries by, then the field the site chooses, first", () => {
    expect(titleSourcesOf(ctx, "posts").fields).toEqual([
      "headline",
      "title",
      "name",
      "heading",
    ]);
    expect(
      titleSourcesOf(ctx, "single:blog", { "single:blog": "hero.heading" })
        .fields
    ).toEqual(["hero.heading", "name", "heading"]);
  });
});

describe("a page's own name", () => {
  const blog = titleSourcesOf(ctx, "single:blog").fields;

  it("is the route's own title, without the site's name, where a Single's title is Nextly's", () => {
    expect(
      pageNameOf({
        home: false,
        document: { title: "Blog Page" },
        fields: blog,
        codeTitle: "Thoughts & Insights | Mobeen",
        codePage: false,
        title: "Thoughts & Insights | Mobeen",
        siteName: "Mobeen",
      })
    ).toBe("Thoughts & Insights");
  });

  it("is read from the field the site chooses, at a dotted path", () => {
    expect(
      pageNameOf({
        home: false,
        document: { title: "Blog Page", hero: { heading: "Field notes" } },
        fields: titleSourcesOf(ctx, "single:blog", {
          "single:blog": "hero.heading",
        }).fields,
        codeTitle: "Thoughts & Insights | Mobeen",
        codePage: false,
        siteName: "Mobeen",
      })
    ).toBe("Field notes");
  });

  it("is the head's title without the site's name, and its markup, where nothing else names it", () => {
    expect(
      pageNameOf({
        home: false,
        document: {},
        fields: blog,
        codePage: false,
        title: 'Things I\'ve <span class="x">Built</span> | Mobeen',
        siteName: "Mobeen",
      })
    ).toBe("Things I've Built");
  });

  it("is the home page's whole title", () => {
    expect(
      pageNameOf({
        home: true,
        document: { title: "Home" },
        fields: ["title"],
        codePage: false,
        title: "Acme | Rockets",
        siteName: "Acme",
      })
    ).toBe("Acme | Rockets");
  });
});
