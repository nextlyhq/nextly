/**
 * The Markdown answer: names beside IDs, rich text as Markdown, links into
 * the admin, and the data block a client can parse back.
 */
import { describe, expect, it } from "vitest";

import { adminLink, answerText, conciseCut } from "../answers";

import { fencedData } from "./fixtures";

const ORIGIN = "https://site.example";

const ENTRY = {
  id: "12",
  title: "Spring menu",
  adminPath: "/admin/collections/posts/12",
  body: "## Spring menu\n\nNew dishes, **fresh** from the market.",
  author: { id: "u1", name: "Sara Malik", adminPath: "/admin/users/u1" },
  cover: { id: "m1", filename: "spring.jpg", adminPath: "/admin/media/m1" },
};

describe("an entry with rich text, a relation and an upload", () => {
  const text = answerText(ENTRY, {
    title: "Get an entry",
    format: "detailed",
    adminOrigin: ORIGIN,
  });

  it("names the entry by its title beside its ID, linked into the admin", () => {
    expect(text).toContain(
      "[Spring menu](<https://site.example/admin/collections/posts/12>) (ID `12`)"
    );
  });

  it("names the related person and the upload beside their IDs, each linked", () => {
    expect(text).toContain(
      "- author: [Sara Malik](<https://site.example/admin/users/u1>) (ID `u1`)"
    );
    expect(text).toContain(
      "- cover: [spring.jpg](<https://site.example/admin/media/m1>) (ID `m1`)"
    );
  });

  it("gives rich text as Markdown, quoted as a block of content", () => {
    expect(text).toContain(
      [
        "- body:",
        "  > ## Spring menu",
        "  >",
        "  > New dishes, **fresh** from the market.",
      ].join("\n")
    );
  });

  it("carries the same data as JSON in a fenced block labeled as data", () => {
    expect(fencedData(text)).toEqual(ENTRY);
  });
});

describe("admin links", () => {
  it.each([
    [
      "an entry",
      "/admin/collections/posts/12",
      "https://site.example/admin/collections/posts/12",
    ],
    ["a page", "/admin/pages/home", "https://site.example/admin/pages/home"],
    ["a media item", "/admin/media/m1", "https://site.example/admin/media/m1"],
  ])(
    "links %s into the admin on the site's own address",
    (_kind, path, link) => {
      expect(adminLink(path, ORIGIN)).toBe(link);
    }
  );

  it.each([
    ["another host", "//evil.example/admin"],
    ["a full address", "https://evil.example/admin"],
    ["a script", "javascript:alert(1)"],
    ["a relative path", "admin/media/m1"],
    ["a backslash", "/\\evil.example"],
    ["a space", "/admin/x y"],
  ])("makes no link from %s", (_kind, path) => {
    expect(adminLink(path, ORIGIN)).toBeUndefined();
  });

  it("names a thing without a link when the door gave no site address", () => {
    const text = answerText(ENTRY, {
      title: "Get an entry",
      format: "detailed",
    });
    expect(text).toContain("Spring menu (ID `12`)");
    expect(text).not.toContain("https://");
  });
});

describe("what stored text can do to the answer", () => {
  it("escapes markup in a title, so a title can't make a link of its own", () => {
    const hostile = {
      id: "1",
      title: "[click](https://evil.example)",
      adminPath: "/admin/x/1",
    };
    const text = answerText(hostile, {
      title: "Get",
      format: "detailed",
      adminOrigin: ORIGIN,
    });
    // The Markdown part, above the data block; inside the fence the title is
    // code, which no client renders as a link.
    const markdown = text.slice(0, text.indexOf("Data (the same"));
    expect(markdown).toContain("\\[click\\](https://evil.example)");
    expect(markdown).not.toContain("[click](https://evil.example)");
  });

  it("fences the data with more backticks than any run inside it", () => {
    const data = { id: "1", title: "Code", body: "Use ```js\nx\n``` here" };
    const text = answerText(data, { title: "Get", format: "detailed" });
    expect(text).toContain("````json");
    expect(fencedData(text)).toEqual(data);
  });
});

describe("the concise cut", () => {
  const schema = {
    type: "object",
    properties: {
      collection: { type: "string" },
      note: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            rating: { type: "number" },
          },
          required: ["id", "rating"],
        },
      },
    },
    required: ["note"],
  };

  it("keeps identifying and required fields, and drops the rest", () => {
    const data = {
      collection: "posts",
      note: "kept, required",
      items: [{ id: "1", title: "One", body: "long text", rating: 4 }],
    };
    expect(conciseCut(data, schema)).toEqual({
      collection: "posts",
      note: "kept, required",
      items: [{ id: "1", title: "One", rating: 4 }],
    });
  });

  it("says in the answer that it is concise, and how to get every field", () => {
    const text = answerText({ id: "1" }, { title: "Get", format: "concise" });
    expect(text).toContain('ask for `format: "detailed"` for every field');
  });
});
