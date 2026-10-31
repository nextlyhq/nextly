/**
 * Where an item is used, as a reader is told it: the record's rows gathered
 * into one entry per document, its fields with the languages that use each
 * only when a shared value does not, the reader's headings on the documents
 * they may read, and the rest counted by scope with nothing about them named.
 */

import { describe, expect, it } from "vitest";

import type { IdentifiedUsageRow } from "../media-usage-store";
import {
  mediaUseReadKey,
  mediaUsesOf,
  type MediaUseDocument,
  type MediaUseHeading,
  type MediaUseRead,
  type MediaUsesSource,
} from "../media-uses";

const ITEM = "item-1";

/** One row of the record; `address` set for a field naming the item by it. */
function row(
  subjectKind: IdentifiedUsageRow["subjectKind"],
  subjectSlug: string,
  documentId: string,
  fieldPath: string,
  locale = "",
  address: string | null = null
): IdentifiedUsageRow {
  return {
    id: `${subjectSlug}-${documentId}-${fieldPath}-${locale}`,
    mediaId: ITEM,
    subjectKind,
    subjectSlug,
    documentId,
    fieldPath,
    locale,
    address,
  };
}

/**
 * A source over these rows, where the reader may read each of `readable` in
 * its language (`null` the default one), and `kept` are the addresses whose
 * files the item's last Replace kept.
 */
function source(
  rows: IdentifiedUsageRow[],
  readable: Array<[MediaUseRead, MediaUseHeading]>,
  kept: string[] = []
): MediaUsesSource & { asked: MediaUseRead[][] } {
  const asked: MediaUseRead[][] = [];
  return {
    asked,
    rows: () => Promise.resolve(rows),
    keptAddresses: () => Promise.resolve(new Set(kept)),
    headings: reads => {
      asked.push([...reads]);
      return Promise.resolve(
        new Map(
          readable.map(([read, heading]) => [mediaUseReadKey(read), heading])
        )
      );
    },
  };
}

/** `document` read in `locale`, the default language when `null`. */
function readIn(
  document: MediaUseDocument,
  locale: string | null = null
): MediaUseRead {
  return { ...document, locale };
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
          row("collection", "posts", "p1", "body", "en", "/a.png"),
          row("collection", "posts", "p1", "body", "es", "/a.png"),
          row("collection", "posts", "p1", "cover"),
          row("collection", "posts", "p1", "gallery", "fr"),
          row("collection", "posts", "p1", "gallery"),
          row("single", "site", "", "logo"),
          row("email-template", "", "t1", "attachments"),
        ],
        [
          [readIn(post), { title: "Hello", owner: "Posts" }],
          [readIn(post, "en"), { title: "Hello", owner: "Posts" }],
          [readIn(post, "es"), { title: "Hola", owner: "Posts" }],
          [readIn(post, "fr"), { title: "Salut", owner: "Posts" }],
          [readIn(site), { title: "Site", owner: "Site" }],
          [readIn(welcome), { title: "Welcome", owner: "Email templates" }],
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
      [[readIn(post), { title: "Hello", owner: "Posts" }]]
    );
    const answer = await mediaUsesOf(ITEM, read);

    expect(answer.items.map(item => item.documentId)).toEqual(["p1"]);
    // Two secrets, each counted once however many fields use the item.
    expect(answer.hidden).toEqual([
      { scopeKind: "collection", scopeSlug: "secrets", count: 2 },
      { scopeKind: "email-template", scopeSlug: "", count: 1 },
    ]);
    expect(JSON.stringify(answer)).not.toContain("s1");
    // Every document is asked about once in each language its rows name,
    // the default one for a shared value, all in one call.
    expect(read.asked).toEqual([
      [
        readIn(post),
        readIn(secret),
        readIn(secret, "en"),
        readIn({ ...secret, documentId: "s2" }),
        readIn({ kind: "email-template", slug: "", documentId: "t1" }),
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
          // Names an address whose file the Replace kept.
          row("collection", "posts", "p1", "body", "en", "/old.png"),
          row("collection", "posts", "p1", "cover"),
          // Saved since with the item's address now.
          row("email-template", "", "t1", "htmlContent", "", "/new.png"),
        ],
        [
          [readIn(post), { title: "Hello", owner: "Posts" }],
          [readIn(post, "en"), { title: "Hello", owner: "Posts" }],
          [readIn(welcome), { title: "Welcome", owner: "Email templates" }],
        ],
        ["/old.png"]
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

  it("names a translation's use only where the reader may read the document in that language", async () => {
    const answer = await mediaUsesOf(
      ITEM,
      source(
        [
          row("collection", "posts", "p1", "body", "en", "/a.png"),
          row("collection", "posts", "p1", "body", "es", "/a.png"),
          row("collection", "posts", "p1", "summary", "es", "/a.png"),
          // Used in Spanish alone, which the reader may not read.
          row("collection", "posts", "p2", "body", "es", "/a.png"),
          // Used in Spanish alone, readable there though not by default.
          row("collection", "posts", "p3", "body", "es", "/a.png"),
        ],
        [
          [readIn(post, "en"), { title: "Hello", owner: "Posts" }],
          [
            readIn({ ...post, documentId: "p3" }, "es"),
            { title: "Hola", owner: "Posts" },
          ],
        ]
      )
    );

    expect(answer.items).toEqual([
      {
        ...post,
        title: "Hello",
        owner: "Posts",
        // Neither the Spanish language nor the field only it uses is named.
        fields: [
          {
            path: "body",
            locales: ["en"],
            byAddress: true,
            showsPreviousFile: false,
          },
        ],
      },
      {
        ...post,
        documentId: "p3",
        title: "Hola",
        owner: "Posts",
        fields: [
          {
            path: "body",
            locales: ["es"],
            byAddress: true,
            showsPreviousFile: false,
          },
        ],
      },
    ]);
    expect(answer.hidden).toEqual([
      { scopeKind: "collection", scopeSlug: "posts", count: 1 },
    ]);
    expect(JSON.stringify(answer)).not.toContain("summary");
  });

  it("says how a field names the item from the languages the reader may read alone", async () => {
    const answer = await mediaUsesOf(
      ITEM,
      source(
        [
          // English names the item now, and Spanish a kept earlier address.
          row("collection", "posts", "p1", "body", "en", "/new.png"),
          row("collection", "posts", "p1", "body", "es", "/old.png"),
          // English names it by id, Spanish by address.
          row("collection", "posts", "p1", "hero", "en"),
          row("collection", "posts", "p1", "hero", "es", "/new.png"),
        ],
        // Readable in English alone.
        [[readIn(post, "en"), { title: "Hello", owner: "Posts" }]],
        ["/old.png"]
      )
    );

    expect(answer.items.map(item => item.fields)).toEqual([
      [
        {
          path: "body",
          locales: ["en"],
          byAddress: true,
          showsPreviousFile: false,
        },
        {
          path: "hero",
          locales: ["en"],
          byAddress: false,
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
          row("collection", "secrets", "s1", "body", "en", "/a.png"),
          row("email-template", "", "t1", "htmlContent", "", "/a.png"),
        ],
        [[readIn(welcome), { title: "Welcome", owner: "Email templates" }]]
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
