/**
 * Where an item is used, as a reader is told it: the record's rows gathered
 * into one entry per document, its fields with the languages that use each
 * only when a shared value does not, the reader's headings on the documents
 * they may read, and the rest counted by scope with nothing about them named.
 */

import { describe, expect, it } from "vitest";

import type { IdentifiedUsageRow } from "../media-usage-store";
import {
  mediaUseDocumentKey,
  mediaUsesOf,
  type MediaUseDocument,
  type MediaUseHeading,
  type MediaUsesSource,
} from "../media-uses";

const ITEM = "item-1";

function row(
  subjectKind: IdentifiedUsageRow["subjectKind"],
  subjectSlug: string,
  documentId: string,
  fieldPath: string,
  locale = "",
  id = `${subjectSlug}-${documentId}-${fieldPath}-${locale}`
): IdentifiedUsageRow {
  return {
    id,
    mediaId: ITEM,
    subjectKind,
    subjectSlug,
    documentId,
    fieldPath,
    locale,
  };
}

/**
 * A source over these rows, where the reader may read `readable`, rich text
 * (`body`) and a template's HTML name items by address, and `previous` are
 * the rows that stood when the item's file was last replaced.
 */
function source(
  rows: IdentifiedUsageRow[],
  readable: Array<[MediaUseDocument, MediaUseHeading]>,
  previous: string[] = []
): MediaUsesSource & { asked: MediaUseDocument[][] } {
  const asked: MediaUseDocument[][] = [];
  return {
    asked,
    rows: () => Promise.resolve(rows),
    addressPaths: kind =>
      Promise.resolve(
        new Set(kind === "email-template" ? ["htmlContent"] : ["body"])
      ),
    previousRows: () => Promise.resolve(new Set(previous)),
    headings: documents => {
      asked.push([...documents]);
      return Promise.resolve(
        new Map(
          readable.map(([document, heading]) => [
            mediaUseDocumentKey(document),
            heading,
          ])
        )
      );
    },
  };
}

const post = {
  kind: "collection",
  slug: "posts",
  documentId: "p1",
} as const;
const secret = {
  kind: "collection",
  slug: "secrets",
  documentId: "s1",
} as const;
const site = { kind: "single", slug: "site", documentId: "" } as const;
const welcome = {
  kind: "email-template",
  slug: "",
  documentId: "t1",
} as const;

describe("mediaUsesOf", () => {
  it("lists each readable document once, with its fields and the languages that use each", async () => {
    const answer = await mediaUsesOf(
      ITEM,
      source(
        [
          row("collection", "posts", "p1", "body", "en"),
          row("collection", "posts", "p1", "body", "es"),
          row("collection", "posts", "p1", "cover"),
          row("collection", "posts", "p1", "gallery", "fr"),
          row("collection", "posts", "p1", "gallery"),
          row("single", "site", "", "logo"),
          row("email-template", "", "t1", "attachments"),
        ],
        [
          [post, { title: "Hello", owner: "Posts" }],
          [site, { title: "Site", owner: "Site" }],
          [welcome, { title: "Welcome", owner: "Email templates" }],
        ]
      )
    );

    expect(answer).toEqual({
      items: [
        {
          ...post,
          title: "Hello",
          owner: "Posts",
          fields: [
            // Only some languages use it, so they are named.
            {
              path: "body",
              locales: ["en", "es"],
              byAddress: true,
              showsPreviousFile: false,
            },
            {
              path: "cover",
              locales: [],
              byAddress: false,
              showsPreviousFile: false,
            },
            // A shared value uses it, so every language does.
            {
              path: "gallery",
              locales: [],
              byAddress: false,
              showsPreviousFile: false,
            },
          ],
        },
        {
          ...site,
          title: "Site",
          owner: "Site",
          fields: [
            {
              path: "logo",
              locales: [],
              byAddress: false,
              showsPreviousFile: false,
            },
          ],
        },
        {
          ...welcome,
          title: "Welcome",
          owner: "Email templates",
          fields: [
            {
              path: "attachments",
              locales: [],
              byAddress: false,
              showsPreviousFile: false,
            },
          ],
        },
      ],
      hidden: [],
    });
  });

  it("counts the documents the reader may not read by scope, naming none of them", async () => {
    const read = source(
      [
        row("collection", "posts", "p1", "cover"),
        row("collection", "secrets", "s1", "cover"),
        row("collection", "secrets", "s1", "body", "en"),
        row("collection", "secrets", "s2", "cover"),
        row("email-template", "", "t1", "html"),
      ],
      [[post, { title: "Hello", owner: "Posts" }]]
    );
    const answer = await mediaUsesOf(ITEM, read);

    expect(answer.items.map(item => item.documentId)).toEqual(["p1"]);
    // Two secrets, each counted once however many fields use the item.
    expect(answer.hidden).toEqual([
      { scopeKind: "collection", scopeSlug: "secrets", count: 2 },
      { scopeKind: "email-template", scopeSlug: "", count: 1 },
    ]);
    expect(JSON.stringify(answer)).not.toContain("s1");
    // Every document is asked about once, in one call.
    expect(read.asked).toEqual([
      [
        post,
        secret,
        { ...secret, documentId: "s2" },
        { kind: "email-template", slug: "", documentId: "t1" },
      ],
    ]);
  });

  it("asks nothing about readers when nothing uses the item", async () => {
    const read = source([], []);
    expect(await mediaUsesOf(ITEM, read)).toEqual({ items: [], hidden: [] });
    expect(read.asked).toEqual([]);
  });

  it("marks the uses naming the item by address, and those still showing the file it had before a Replace", async () => {
    const answer = await mediaUsesOf(
      ITEM,
      source(
        [
          row("collection", "posts", "p1", "body", "en", "kept-row"),
          row("collection", "posts", "p1", "cover"),
          row("email-template", "", "t1", "htmlContent", "", "rewritten-row"),
        ],
        [
          [post, { title: "Hello", owner: "Posts" }],
          [welcome, { title: "Welcome", owner: "Email templates" }],
        ],
        // The post's row stood at the Replace; the template was saved since.
        ["kept-row", "row-gone-since"]
      )
    );

    expect(answer.items.map(item => item.fields)).toEqual([
      [
        {
          path: "body",
          locales: ["en"],
          byAddress: true,
          showsPreviousFile: true,
        },
        {
          path: "cover",
          locales: [],
          byAddress: false,
          showsPreviousFile: false,
        },
      ],
      [
        {
          path: "htmlContent",
          locales: [],
          byAddress: true,
          showsPreviousFile: false,
        },
      ],
    ]);
  });

  it("tells only the uses naming the item by address when asked, counting the unreadable ones", async () => {
    const answer = await mediaUsesOf(
      ITEM,
      source(
        [
          row("collection", "posts", "p1", "cover"),
          row("collection", "secrets", "s1", "body", "en"),
          row("email-template", "", "t1", "htmlContent"),
        ],
        [[welcome, { title: "Welcome", owner: "Email templates" }]]
      ),
      { byAddressOnly: true }
    );

    expect(answer.items.map(item => [item.kind, item.documentId])).toEqual([
      ["email-template", "t1"],
    ]);
    expect(answer.hidden).toEqual([
      { scopeKind: "collection", scopeSlug: "secrets", count: 1 },
    ]);
  });
});
