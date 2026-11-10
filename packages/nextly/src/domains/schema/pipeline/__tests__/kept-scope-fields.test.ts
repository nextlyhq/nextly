/**
 * Which held-back fields a schema change keeps on a switched-off type.
 *
 * The roads a schema change takes are covered end to end elsewhere; these are
 * the rules they share: a field is kept only while its column exists, on the
 * type's own table or its translations', never beside a field of the same
 * name the type declares itself, and never as required.
 */
import { afterEach, describe, expect, it } from "vitest";

import { number, text } from "../../../../config";
import { columnsByTable, keptScopeFields } from "../kept-scope-fields";
import {
  publishWithheldScopeFields,
  scopedTypeKey,
} from "../withheld-scope-fields";

const pages = {
  slug: "pages",
  tableName: "dc_pages",
  fields: [text({ name: "title" })],
};

function hold(
  ...fields: (ReturnType<typeof text> | ReturnType<typeof number>)[]
): void {
  publishWithheldScopeFields(
    new Map([[scopedTypeKey("collection", "pages"), fields]])
  );
}

/** The tables as a snapshot of them states them, each column as `text`. */
const live = (tables: Record<string, string[]>) =>
  columnsByTable(
    {
      tables: Object.entries(tables).map(([name, columns]) => ({
        name,
        columns: columns.map(column => ({
          name: column,
          type: "text",
          nullable: true,
        })),
        indexes: [],
      })),
    } as never,
    "sqlite"
  );

afterEach(() => publishWithheldScopeFields(new Map()));

describe("keptScopeFields", () => {
  it("keeps a held-back field only while its column exists", () => {
    hold(text({ name: "seo_title" }));

    expect(
      keptScopeFields(
        "collection",
        pages,
        live({ dc_pages: ["title", "seo_title"] })
      ).map(field => field.name)
    ).toEqual(["seo_title"]);
    expect(
      keptScopeFields("collection", pages, live({ dc_pages: ["title"] }))
    ).toEqual([]);
    // Another kind with the same slug holds nothing back.
    expect(
      keptScopeFields(
        "single",
        pages,
        live({ dc_pages: ["title", "seo_title"] })
      )
    ).toEqual([]);
  });

  it("keeps one whose column is on the type's translations table", () => {
    hold(text({ name: "seo_title" }));

    expect(
      keptScopeFields(
        "collection",
        pages,
        live({ dc_pages: ["title"], dc_pages_locales: ["seo_title"] })
      ).map(field => field.name)
    ).toEqual(["seo_title"]);
  });

  it("leaves a type that declares a field of that name with its own", () => {
    hold(text({ name: "seo_title" }));
    const own = { ...pages, fields: [text({ name: "SEO_Title" })] };

    expect(
      keptScopeFields("collection", own, live({ dc_pages: ["seo_title"] }))
    ).toEqual([]);
  });

  it("leaves a type whose own field, spelled otherwise, has that column", () => {
    hold(text({ name: "seo_title" }));
    // `seoTitle` is stored in `seo_title` too.
    const own = { ...pages, fields: [text({ name: "seoTitle" })] };

    expect(
      keptScopeFields("collection", own, live({ dc_pages: ["seo_title"] }))
    ).toEqual([]);
  });

  it("keeps, of two declarations of one name, the one the column was made as", () => {
    // Two scopes' declarations of `seo`, the fold's preferred one first; the
    // column there is text, as the second declares it.
    hold(number({ name: "seo" }), text({ name: "seo" }));

    const kept = keptScopeFields(
      "collection",
      pages,
      live({ dc_pages: ["seo"] })
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ name: "seo", type: "text" });
  });

  it("keeps the first of two declarations when the column matches neither", () => {
    hold(text({ name: "seo" }), text({ name: "SEO", required: true }));

    const kept = keptScopeFields(
      "collection",
      pages,
      columnsByTable({ tables: [] }, "sqlite")
    );
    expect(kept).toEqual([]);
    expect(
      keptScopeFields("collection", pages, live({ dc_pages: ["seo"] }))
    ).toHaveLength(1);
  });

  it("keeps a required field as optional", () => {
    hold(text({ name: "seo_title", required: true }));

    const [kept] = keptScopeFields(
      "collection",
      pages,
      live({ dc_pages: ["seo_title"] })
    );
    expect(kept).toMatchObject({ name: "seo_title", required: false });
  });
});
