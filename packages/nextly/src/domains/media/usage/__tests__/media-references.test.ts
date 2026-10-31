/**
 * The references a stored value makes, in each shape content stores them:
 * the walk that both the writes and the rebuild read a document with.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { mediaLibraryCountsOf } from "../../media-library-query";
import { emailTemplateReferences } from "../email-template-usage";
import { collectMediaReferences } from "../media-references";

const ID_1 = "0b6f4f3e-58a5-4c3e-9a51-0d6c1c1e0a01";
const ID_2 = "0b6f4f3e-58a5-4c3e-9a51-0d6c1c1e0a02";
const NODE_ID = "0b6f4f3e-58a5-4c3e-9a51-0d6c1c1e0aff";

const f = (field: Record<string, unknown>): FieldConfig =>
  field as unknown as FieldConfig;

describe("collectMediaReferences", () => {
  it("reads an upload in each shape it is stored in", () => {
    const fields = [
      f({ type: "upload", name: "one" }),
      f({ type: "upload", name: "list", hasMany: true }),
      f({ type: "upload", name: "text", hasMany: true }),
      f({ type: "upload", name: "either" }),
      f({ type: "upload", name: "expanded" }),
      f({ type: "upload", name: "empty" }),
    ];

    expect(
      collectMediaReferences(fields, {
        one: ID_1,
        list: [ID_1, ID_2],
        // As SQLite and MySQL return a JSON column.
        text: JSON.stringify([ID_2]),
        either: { relationTo: "media", value: ID_1 },
        expanded: { id: ID_2, url: "/uploads/x.png" },
        empty: null,
      })
    ).toEqual([
      { fieldPath: "one", mediaId: ID_1 },
      { fieldPath: "list", mediaId: ID_1 },
      { fieldPath: "list", mediaId: ID_2 },
      { fieldPath: "text", mediaId: ID_2 },
      { fieldPath: "either", mediaId: ID_1 },
      { fieldPath: "expanded", mediaId: ID_2 },
    ]);
  });

  // An id is a media item's only where the field can point at media: a
  // polymorphic value names its own collection, and an id held for another
  // collection may also be a media item's id.
  it("reads an upload's id only where it points at media", () => {
    const fields = [
      f({ type: "upload", name: "media", relationTo: "media" }),
      f({ type: "upload", name: "docs", relationTo: "docs" }),
      f({ type: "upload", name: "either", relationTo: ["media", "docs"] }),
      f({
        type: "upload",
        name: "many",
        relationTo: ["media", "docs"],
        hasMany: true,
      }),
      f({ type: "upload", name: "expanded", relationTo: ["docs", "media"] }),
      f({ type: "upload", name: "elsewhere", relationTo: ["docs", "files"] }),
    ];

    expect(
      collectMediaReferences(fields, {
        media: ID_1,
        docs: ID_2,
        either: { relationTo: "docs", value: ID_1 },
        many: [
          { relationTo: "media", value: ID_1 },
          { relationTo: "docs", value: ID_2 },
        ],
        // An expanded value says which collection it is from, or it is read
        // by what the field may hold.
        expanded: { relationTo: "docs", value: { id: ID_2 } },
        elsewhere: { id: ID_1 },
      })
    ).toEqual([
      { fieldPath: "media", mediaId: ID_1 },
      { fieldPath: "many", mediaId: ID_1 },
    ]);
  });

  it("reads a rich-text image, video and gallery by the address each shows", () => {
    const body = {
      root: {
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Hi" }] },
          { type: "image", src: "/a.png" },
          { type: "video", src: "/b.mp4" },
          { type: "gallery", images: [{ src: "/c.png" }, { src: "/d.png" }] },
          { type: "link", url: "https://example.com" },
        ],
      },
    };

    expect(
      collectMediaReferences([f({ type: "richText", name: "body" })], {
        body: JSON.stringify(body),
      }).map(ref => ref.url)
    ).toEqual(["/a.png", "/b.mp4", "/c.png", "/d.png"]);
  });

  it("reads a block document's own list, and walks one that has none", () => {
    const listed = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: NODE_ID, type: "core/image", props: { image: ID_2 } }],
      assets: { mediaIds: [ID_1] },
    };
    const unlisted = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: NODE_ID,
          type: "core/image",
          props: { image: ID_1, poster: { src: "/p.png" }, title: "Hello" },
        },
      ],
    };
    const fields = [
      f({ type: "blocks", name: "listed" }),
      f({ type: "json", name: "unlisted" }),
    ];

    expect(collectMediaReferences(fields, { listed, unlisted })).toEqual([
      // The list is the document's own account: its nodes are not walked.
      { fieldPath: "listed", mediaId: ID_1 },
      // Walked: the id-shaped prop and the address, never the node's own id.
      { fieldPath: "unlisted", mediaId: ID_1 },
      { fieldPath: "unlisted", url: "/p.png" },
    ]);
  });

  it("reads a JSON value's addresses, and an item named by its media route by id", () => {
    // A Page Builder site style keeps its font files this way.
    const fonts = [
      {
        family: "Brand",
        src: [{ url: `/api/media/${ID_1}/raw`, format: "woff2" }],
        weight: 400,
      },
    ];
    const settings = {
      id: ID_2,
      image: { url: "/uploads/2026/10/og.png" },
      label: "/uploads/not-an-address.png",
    };
    const fields = [
      f({ type: "json", name: "fonts" }),
      f({ type: "json", name: "settings" }),
      f({ type: "richText", name: "body" }),
    ];

    expect(
      collectMediaReferences(fields, {
        fonts,
        // As SQLite and MySQL return a JSON column.
        settings: JSON.stringify(settings),
        body: {
          root: { children: [{ type: "image", src: `/api/media/${ID_2}` }] },
        },
      })
    ).toEqual([
      { fieldPath: "fonts", mediaId: ID_1 },
      // Only what a `src` or `url` holds: not its own id, not any string.
      { fieldPath: "settings", url: "/uploads/2026/10/og.png" },
      { fieldPath: "body", mediaId: ID_2 },
    ]);
  });

  it("names a nested field by its containers, without positions", () => {
    const fields = [
      f({
        type: "group",
        name: "card",
        fields: [f({ type: "upload", name: "photo" })],
      }),
      f({
        type: "repeater",
        name: "items",
        fields: [f({ type: "upload", name: "photo" })],
      }),
      f({ type: "component", name: "hero", component: "hero" }),
      f({ type: "component", name: "missing", component: "gone" }),
    ];
    const schemas = new Map([
      ["hero", { fields: [f({ type: "upload", name: "image" })] }],
    ]);

    expect(
      collectMediaReferences(
        fields,
        {
          card: JSON.stringify({ photo: ID_1 }),
          items: [{ photo: ID_2 }, { photo: ID_1 }],
          hero: { image: ID_2 },
          // A field group whose schema is not known is not guessed at.
          missing: { image: ID_1 },
        },
        schemas
      )
    ).toEqual([
      { fieldPath: "card.photo", mediaId: ID_1 },
      { fieldPath: "items.photo", mediaId: ID_2 },
      { fieldPath: "items.photo", mediaId: ID_1 },
      { fieldPath: "hero.image", mediaId: ID_2 },
    ]);
  });
});

describe("emailTemplateReferences", () => {
  it("reads attachments by id and HTML images by address", () => {
    expect(
      emailTemplateReferences({
        attachments: JSON.stringify([{ mediaId: ID_1 }, { filename: "x" }]),
        htmlContent:
          '<img src="/a.png"><p>x</p><IMG alt="" SRC=\'/b.png\'><a href="/c.png">c</a>',
      })
    ).toEqual([
      { fieldPath: "attachments", mediaId: ID_1 },
      { fieldPath: "htmlContent", url: "/a.png" },
      { fieldPath: "htmlContent", url: "/b.png" },
    ]);
  });

  // Read as a browser reads the HTML the email is sent with: an unquoted
  // value, a value with entities, and only an `<img>` element's own `src`.
  it("reads each image's src as HTML does, and nothing that only looks like one", () => {
    expect(
      emailTemplateReferences({
        htmlContent: [
          "<img src=/uploads/a.png alt=x>",
          '<img data-src="/uploads/b.png" srcset="/uploads/c.png 2x">',
          '<img alt="src=/uploads/d.png" src="/uploads/e.png?w=1&amp;h=2">',
          "<!-- <img src=/uploads/f.png> -->",
          '<script>"<img src=/uploads/g.png>"</script>',
          '<p title="<img src=/uploads/h.png>">x</p>',
          "<img\nsrc\n=\n'/uploads/i.png'>",
          "<img src>",
        ].join(""),
      })
    ).toEqual([
      { fieldPath: "htmlContent", url: "/uploads/a.png" },
      { fieldPath: "htmlContent", url: "/uploads/e.png?w=1&h=2" },
      { fieldPath: "htmlContent", url: "/uploads/i.png" },
    ]);
  });
});

describe("mediaLibraryCountsOf", () => {
  it("adds up the folders, reading each dialect's sums as numbers", () => {
    expect(
      mediaLibraryCountsOf(
        [
          // MySQL returns its sums as strings, PostgreSQL its counts.
          {
            folderId: null,
            items: "3",
            missingAlt: "1",
            unused: "2",
            recorded: 1,
          },
          { folderId: "f1", items: 4, missingAlt: 2, unused: 0, recorded: "1" },
        ],
        true
      )
    ).toEqual({
      all: 7,
      missingAltText: 3,
      unused: 2,
      usageRecorded: true,
      root: 3,
      folders: { f1: 4 },
    });
  });

  it("says nothing is unused, nor recorded, before the usage table exists", () => {
    expect(
      mediaLibraryCountsOf(
        [{ folderId: null, items: 1, missingAlt: 0, unused: 0, recorded: 0 }],
        false
      )
    ).toMatchObject({ unused: null, usageRecorded: false });
  });

  it("reads the record as unbuilt when any group lacks the mark", () => {
    expect(
      mediaLibraryCountsOf(
        [{ folderId: "f1", items: 1, missingAlt: 0, unused: 1, recorded: 0 }],
        true
      )
    ).toMatchObject({ usageRecorded: false });
  });
});
