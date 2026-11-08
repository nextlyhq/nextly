/**
 * A document's own metadata: its text values joined from literal and bound
 * segments, its social image from a media field or a URL field, what a page
 * reads for it, and what a save refuses.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import type { BindingFieldShape, BindingSchemaSource } from "./binding-rules";
import {
  DOCUMENT_FORMAT_VERSION,
  MAX_SEO_SEGMENTS,
  type BlockDocument,
  type DocumentSeo,
  type SeoBinding,
} from "./document";
import { resolveDocumentSeo } from "./document-seo";
import { DEFAULT_LIMITS } from "./limits";
import { bindingDemand, createBindingRun } from "./resolve-bindings";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";
import { validate } from "./validation";

const FIELDS: Readonly<Record<string, readonly BindingFieldShape[]>> = {
  posts: [
    { name: "title", type: "text" },
    { name: "excerpt", type: "textarea" },
    { name: "views", type: "number" },
    { name: "publishedAt", type: "date" },
    { name: "cover", type: "upload", relationTo: "media" },
    { name: "avatarUrl", type: "url" },
  ],
};

const schema: BindingSchemaSource = {
  fieldsOf: ref =>
    "collection" in ref
      ? FIELDS[ref.collection]
      : "site" in ref
        ? [{ name: "applicationName", type: "text" }]
        : undefined,
};

function documentWith(seo: unknown): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "template",
    nodes: [],
    settings: { seo: seo as DocumentSeo },
  };
}

/** The page's binding pass for one entry of `posts`. */
function runFor(entry: Record<string, unknown> | null) {
  return createBindingRun({
    sources: { entry, site: { applicationName: "Field Notes" } },
    entryRef: { collection: "posts" },
    schema,
    locale: "en",
    timeZone: "UTC",
    props: { get: () => undefined },
  });
}

const TITLE: DocumentSeo["title"] = [
  { $bind: "title" },
  " | ",
  { $bind: "applicationName", source: "site" },
];

describe("a document's metadata text", () => {
  it("joins literal and bound segments, per entry", () => {
    const document = documentWith({ title: TITLE });
    expect(resolveDocumentSeo(document, runFor({ title: "First" })).title).toBe(
      "First | Field Notes"
    );
    expect(
      resolveDocumentSeo(document, runFor({ title: "Second" })).title
    ).toBe("Second | Field Notes");
  });

  it("formats a bound value as a text prop's would be", () => {
    const document = documentWith({
      description: [
        "Published ",
        {
          $bind: "publishedAt",
          format: { type: "date", options: { dateStyle: "long" } },
        },
      ],
    });
    expect(
      resolveDocumentSeo(document, runFor({ publishedAt: "2026-03-04" }))
        .description
    ).toBe("Published March 4, 2026");
  });

  it("shows a binding's fallback for an empty field, and leaves out a value that comes to nothing", () => {
    const document = documentWith({
      title: [{ $bind: "title", fallback: "Untitled post" }],
      description: [{ $bind: "excerpt" }, "  "],
    });
    const resolved = resolveDocumentSeo(document, runFor({ title: "" }));
    expect(resolved.title).toBe("Untitled post");
    // Nothing but a blank: the key is absent, so the page's other metadata
    // answers instead of an empty description.
    expect(resolved).not.toHaveProperty("description");
  });

  it("keeps a value whose type does not fit text out of the title, and reports it", () => {
    const document = documentWith({ title: ["Seen ", { $bind: "views" }] });
    const resolved = resolveDocumentSeo(document, runFor({ views: 12 }));
    expect(resolved.title).toBe("Seen");
    expect(resolved.issues.map(issue => issue.code)).toEqual([
      "binding-type-misfit",
    ]);
  });

  it("uses literal text as written, never as a placeholder", () => {
    const document = documentWith({ title: ["{{title}} ${title}"] });
    expect(resolveDocumentSeo(document, runFor({ title: "First" })).title).toBe(
      "{{title}} ${title}"
    );
  });

  it("falls back without a binding pass, and ignores a value of any other shape", () => {
    const document = documentWith({
      title: [{ $bind: "title", fallback: "Posts" }],
      description: "not a list",
    });
    expect(resolveDocumentSeo(document, undefined)).toEqual({
      title: "Posts",
      issues: [],
    });
    expect(resolveDocumentSeo(documentWith(42), runFor({}))).toEqual({
      issues: [],
    });
  });
});

describe("a document's social image", () => {
  it("is the media a media field holds: its address when populated, its id otherwise", () => {
    const document = documentWith({ image: { $bind: "cover" } });
    expect(
      resolveDocumentSeo(document, runFor({ cover: "m-1" })).image
    ).toEqual({ kind: "media", value: "m-1" });
    expect(
      resolveDocumentSeo(
        document,
        runFor({ cover: { id: "m-1", url: "/media/cover.jpg" } })
      ).image
    ).toEqual({ kind: "url", value: "/media/cover.jpg" });
    // A populated record without a usable address still names its media.
    expect(
      resolveDocumentSeo(document, runFor({ cover: { id: "m-1" } })).image
    ).toEqual({ kind: "media", value: "m-1" });
    expect(
      resolveDocumentSeo(document, runFor({ cover: { id: 7, url: " " } })).image
    ).toEqual({ kind: "media", value: "7" });
  });

  it("reads a URL field's fallback as an address, whatever it looks like", () => {
    const document = documentWith({
      image: { $bind: "avatarUrl", fallback: "images/default.png" },
    });
    expect(
      resolveDocumentSeo(document, runFor({ avatarUrl: "" })).image
    ).toEqual({ kind: "url", value: "images/default.png" });
  });

  it("is the address a URL field holds", () => {
    const document = documentWith({ image: { $bind: "avatarUrl" } });
    expect(
      resolveDocumentSeo(
        document,
        runFor({ avatarUrl: "https://cdn.example.com/a.png" })
      ).image
    ).toEqual({ kind: "url", value: "https://cdn.example.com/a.png" });
  });

  it("is nothing from a field that holds neither, and the binding is reported", () => {
    const document = documentWith({ image: { $bind: "title" } });
    const resolved = resolveDocumentSeo(document, runFor({ title: "First" }));
    expect(resolved).not.toHaveProperty("image");
    expect(resolved.issues.map(issue => issue.code)).toContain(
      "binding-type-misfit"
    );
  });
});

describe("a document's social image, from stored data a save never checked", () => {
  it("reports a source the page did not read, rather than an empty image", () => {
    const document = documentWith({ image: { $bind: "cover" } });
    const unread = createBindingRun({
      sources: {},
      entryRef: { collection: "posts" },
      schema,
      props: { get: () => undefined },
    });
    const resolved = resolveDocumentSeo(document, unread);
    expect(resolved).not.toHaveProperty("image");
    expect(resolved.issues.map(issue => issue.code)).toEqual([
      "binding-source-unavailable",
    ]);
  });

  it("refuses an object a URL field holds, as a value of the wrong type", () => {
    const document = documentWith({ image: { $bind: "avatarUrl" } });
    const resolved = resolveDocumentSeo(
      document,
      runFor({ avatarUrl: { url: "https://cdn.example.com/a.png" } })
    );
    expect(resolved).not.toHaveProperty("image");
    expect(resolved.issues.map(issue => issue.code)).toEqual([
      "binding-type-misfit",
    ]);
  });
});

describe("a stored value larger than a save allows", () => {
  // Far past the save's cap, and past what a call can take as arguments.
  const huge = Array.from({ length: 200_000 }, (_unused, index) => ({
    $bind: index < MAX_SEO_SEGMENTS ? "title" : `field${String(index)}`,
  }));
  const document = documentWith({ title: huge });

  it("is read for only as far as a save would accept", () => {
    const demand = bindingDemand([document]);
    expect(demand.entry?.fields).toEqual(["title"]);
  });

  it("joins only the segments a save would accept", () => {
    expect(resolveDocumentSeo(document, runFor({ title: "x" })).title).toBe(
      "x".repeat(MAX_SEO_SEGMENTS)
    );
  });
});

describe("what a page reads for its metadata", () => {
  it("lists the entry's, a Single's and the site's fields the metadata binds", () => {
    const demand = bindingDemand([
      documentWith({
        title: [
          { $bind: "title" },
          { $bind: "applicationName", source: "site" },
        ],
        description: [
          { $bind: "tagline", source: "single", sourceKey: "brand" },
        ],
        image: { $bind: "cover" },
      }),
    ]);
    expect(demand.any).toBe(true);
    expect(demand.entry?.fields).toEqual(["title", "cover"]);
    expect(demand.site).toBe(true);
    expect(demand.singles.get("brand")?.fields).toEqual(["tagline"]);
  });

  it("reads nothing for literal-only metadata", () => {
    const demand = bindingDemand([documentWith({ title: ["About us"] })]);
    expect(demand.any).toBe(false);
  });
});

describe("the metadata's binding type", () => {
  it("takes every source but a list item", () => {
    expectTypeOf<{ $bind: string; source: "site" }>().toExtend<SeoBinding>();
    expectTypeOf<{
      $bind: string;
      source: "single";
      sourceKey: string;
    }>().toExtend<SeoBinding>();
    expectTypeOf<{ $bind: string }>().toExtend<SeoBinding>();
    expectTypeOf<{
      $bind: string;
      source: "item";
    }>().not.toExtend<SeoBinding>();
  });
});

describe("saving a document's metadata", () => {
  const issuesOf = (seo: unknown) =>
    validate(documentWith(seo), {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    }).map(issue => ({ path: issue.path, code: issue.code }));

  it("accepts literal and bound segments and an image binding", () => {
    expect(issuesOf({ title: TITLE, image: { $bind: "cover" } })).toEqual([]);
  });

  it("refuses a value of the wrong shape, an unknown field and a list item", () => {
    expect(issuesOf("title")).toEqual([
      { path: "/settings/seo", code: "invalid-seo" },
    ]);
    expect(
      issuesOf({
        title: "Not a list",
        keywords: ["a"],
        description: [{ $bind: "name", source: "item" }],
        image: { $bind: "cover | upper" },
      })
    ).toEqual([
      { path: "/settings/seo/title", code: "invalid-seo" },
      { path: "/settings/seo/keywords", code: "invalid-seo" },
      { path: "/settings/seo/description/0/source", code: "invalid-binding" },
      { path: "/settings/seo/image/$bind", code: "invalid-binding" },
    ]);
  });

  it("holds bindings to the sources' schema when it is given, as the page will", () => {
    const issues = validate(
      documentWith({
        title: [{ $bind: "views" }],
        image: { $bind: "title" },
      }),
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        bindingSchema: schema,
        bindingEntry: { collection: "posts" },
      }
    ).map(issue => ({ path: issue.path, code: issue.code }));
    expect(issues).toEqual([
      { path: "/settings/seo/title/0", code: "binding-type-misfit" },
      { path: "/settings/seo/image", code: "binding-type-misfit" },
    ]);
  });

  it("walks no metadata past the document's limits", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 5000 }, (_unused, index) => [
        `key${String(index)}`,
        ["x"],
      ])
    );
    const issues = validate(documentWith(wide), {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      limits: { ...DEFAULT_LIMITS, maxBytes: 1024 },
    });
    expect(issues.some(issue => issue.code === "invalid-seo")).toBe(false);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("bounds how many pieces a value holds, and how long its text is", () => {
    expect(
      issuesOf({
        title: Array.from({ length: MAX_SEO_SEGMENTS + 1 }, () => "a"),
      })
    ).toEqual([{ path: "/settings/seo/title", code: "invalid-seo" }]);
    expect(issuesOf({ title: ["a".repeat(1001)] })).toEqual([
      { path: "/settings/seo/title/0", code: "invalid-seo" },
    ]);
  });
});

describe("a social image's fallback", () => {
  // A page's export and import carry no media from the document's own
  // metadata, so its fallback is an image address only, while a block's
  // image may fall back to a media library image.
  const bothBound = (fallback: string): BlockDocument => ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "template",
    nodes: [
      {
        id: "picture",
        type: "core/image",
        version: 1,
        props: {},
        bindings: { mediaId: { $bind: "cover", fallback } },
      },
    ],
    settings: { seo: { image: { $bind: "cover", fallback } } },
  });
  const saved = (document: BlockDocument) =>
    validate(document, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      bindingSchema: schema,
      bindingEntry: { collection: "posts" },
      definitions: {
        get: type =>
          type === "core/image"
            ? { version: 1, props: { mediaId: { type: "media" } } }
            : undefined,
      },
    });

  it("refuses a media id on the social image at save, and accepts it on a block's image", () => {
    const issues = saved(bothBound("m-fallback"));
    expect(
      issues.map(issue => ({ path: issue.path, code: issue.code }))
    ).toEqual([
      { path: "/settings/seo/image", code: "binding-fallback-invalid" },
    ]);
    expect(issues[0]?.message).toContain(
      "is not an image address (https://, http:// or a path on the site)"
    );
    expect(issues[0]?.message).toContain("the social image takes an address");
  });

  it("accepts an address on both at save", () => {
    expect(saved(bothBound("/media/fallback.jpg"))).toEqual([]);
  });

  it("is drawn when it is an address", () => {
    const document = documentWith({
      image: { $bind: "cover", fallback: "/media/fallback.jpg" },
    });
    expect(resolveDocumentSeo(document, runFor({ cover: null })).image).toEqual(
      { kind: "url", value: "/media/fallback.jpg" }
    );
    expect(resolveDocumentSeo(document, undefined).image).toEqual({
      kind: "url",
      value: "/media/fallback.jpg",
    });
  });

  it("is never looked up as media when it is a media id, with or without a binding pass", () => {
    const document = documentWith({
      image: { $bind: "cover", fallback: "m-fallback" },
    });
    const read = resolveDocumentSeo(document, runFor({ cover: null }));
    expect(read).not.toHaveProperty("image");
    expect(read.issues.map(issue => issue.code)).toEqual([
      "binding-fallback-invalid",
    ]);
    expect(resolveDocumentSeo(document, undefined)).not.toHaveProperty("image");
  });
});
